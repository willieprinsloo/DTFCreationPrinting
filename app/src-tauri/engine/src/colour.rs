//! Colour model: the design's RGB (sRGB, or its own embedded profile) -> K,C,M,Y
//! ink amounts (built-in GCR model, or the printer's ICC profile).
use crate::EngineError;
use std::path::PathBuf;
use std::sync::Arc;

/// Colour/white settings for source preparation. Task 5 folds these into
/// `EngineSettings`.
#[derive(Debug, Clone, PartialEq)]
pub struct ColourSettings {
    pub white_density_pct: f32,
    pub icc_profile_path: Option<PathBuf>,
    pub tone: Tone,
    pub intent: RenderIntent,
    /// Convert through a table of the ICC profile with this many points per R, G and B axis,
    /// blending the 8 nearest (trilinear), as Maintop does with 26; 0 = convert every colour
    /// exactly. See `GridTable`.
    pub grid_points: u8,
}

impl Default for ColourSettings {
    fn default() -> Self {
        Self { white_density_pct: 100.0, icc_profile_path: None, tone: Tone::default(), intent: RenderIntent::default(), grid_points: 0 }
    }
}

/// Fewest and most table points per axis (`ColourSettings::grid_points`).
pub const GRID_POINTS: std::ops::RangeInclusive<u8> = 9..=65;

/// An RGB -> K,C,M,Y table of the ICC profile, `n` points per axis, read by trilinear
/// interpolation. Maintop's 700DTF output is the profile sampled on 26 points this way (its
/// `printX.mcm` holds the same numbers), which differs from converting each colour exactly by
/// a few percent in the darkest colours.
#[derive(Debug)]
pub struct GridTable {
    n: usize,
    /// K, C, M, Y per node, index `(r * n + g) * n + b`.
    nodes: Vec<[u16; 4]>,
}

impl GridTable {
    /// Samples `convert` (16-bit RGB row -> K,C,M,Y row) at every node.
    pub fn sample(n: usize, convert: impl FnOnce(&[u16], &mut [[u16; 4]])) -> Self {
        let at = |i: usize| ((i as f64 * 65535.0 / (n - 1) as f64).round()) as u16;
        let mut rgb = Vec::with_capacity(n * n * n * 3);
        for r in 0..n {
            for g in 0..n {
                for b in 0..n {
                    rgb.extend([at(r), at(g), at(b)]);
                }
            }
        }
        let mut nodes = vec![[0u16; 4]; n * n * n];
        convert(&rgb, &mut nodes);
        Self { n, nodes }
    }

    pub fn lookup(&self, px: [u16; 3]) -> [u16; 4] {
        let n = self.n;
        let top = (n - 2) as f32;
        let mut i = [0usize; 3];
        let mut f = [0f32; 3];
        for c in 0..3 {
            let p = px[c] as f32 / 65535.0 * (n - 1) as f32;
            let base = p.floor().min(top);
            i[c] = base as usize;
            f[c] = p - base;
        }
        let node = |dr: usize, dg: usize, db: usize| &self.nodes[((i[0] + dr) * n + i[1] + dg) * n + i[2] + db];
        let mut out = [0f32; 4];
        for (dr, wr) in [(0, 1.0 - f[0]), (1, f[0])] {
            for (dg, wg) in [(0, 1.0 - f[1]), (1, f[1])] {
                for (db, wb) in [(0, 1.0 - f[2]), (1, f[2])] {
                    let w = wr * wg * wb;
                    if w > 0.0 {
                        for (o, v) in out.iter_mut().zip(node(dr, dg, db)) {
                            *o += w * *v as f32;
                        }
                    }
                }
            }
        }
        out.map(|v| v.round().clamp(0.0, 65535.0) as u16)
    }
}

/// How colours the printer can't reach are brought into its range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RenderIntent {
    /// Squeezes every colour a little so out-of-range ones keep their differences (photos).
    #[default]
    Perceptual,
    /// Prints reachable colours exactly and clips the rest (logos, brand colours); with
    /// black point compensation so shadows keep their detail.
    RelativeColorimetric,
}

/// The "Lighter / Darker" and "Less / More colour" sliders, applied to the
/// design's RGB before it is converted to ink (so it works with ICC too).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Tone {
    /// -1 (lighter) ..= 1 (darker); 0 = unchanged.
    pub darkness: f32,
    /// 0.5 (less colour) ..= 1.5 (more colour); 1 = unchanged.
    pub saturation: f32,
}

impl Default for Tone {
    fn default() -> Self {
        Self { darkness: 0.0, saturation: 1.0 }
    }
}

/// Darkest/lightest gamma the slider reaches (2^±0.5).
const TONE_GAMMA_RANGE: f32 = 0.5;

impl Tone {
    /// None when the sliders are at their defaults (nothing to do).
    pub fn adjuster(&self) -> Option<ToneAdjust> {
        let darkness = self.darkness.clamp(-1.0, 1.0);
        let saturation = self.saturation.clamp(0.5, 1.5);
        if darkness.abs() < 1e-4 && (saturation - 1.0).abs() < 1e-4 {
            return None;
        }
        // RGB^gamma with gamma > 1 lowers the values, i.e. more ink: darker
        // mid-tones while pure white and solid colours stay put.
        let gamma = 2f32.powf(darkness * TONE_GAMMA_RANGE);
        let lut = (0..=65535u32)
            .map(|v| ((v as f32 / 65535.0).powf(gamma) * 65535.0).round() as u16)
            .collect();
        Some(ToneAdjust { lut, saturation })
    }
}

pub struct ToneAdjust {
    lut: Vec<u16>,
    saturation: f32,
}

impl ToneAdjust {
    /// Saturation about the pixel's luma, then the lighter/darker curve.
    pub fn apply(&self, px: [u16; 3]) -> [u16; 3] {
        let [r, g, b] = px.map(|v| v as f32);
        let luma = 0.299 * r + 0.587 * g + 0.114 * b;
        [r, g, b].map(|c| {
            let s = (luma + (c - luma) * self.saturation).clamp(0.0, 65535.0).round() as usize;
            self.lut[s]
        })
    }
}

const GCR: f32 = 1.0;

/// Built-in model, inputs and outputs 0..1; returns [K, C, M, Y].
pub fn rgb_to_kcmy(r: f32, g: f32, b: f32) -> [f32; 4] {
    let (c, m, y) = (1.0 - r, 1.0 - g, 1.0 - b);
    let k = c.min(m).min(y) * GCR;
    [k, c - k, m - k, y - k]
}

/// Which conversion to use. Cheap to share across threads; each worker calls
/// `instance()` to get its own (lcms2 transforms are not `Sync`).
#[derive(Debug, Clone)]
pub struct Converter {
    /// The printer's ICC profile; `None` = built-in model.
    output: Option<PathBuf>,
    /// The design's own RGB profile; `None` = sRGB.
    source: Option<Arc<Vec<u8>>>,
    #[cfg_attr(not(feature = "icc"), allow(dead_code))]
    intent: RenderIntent,
    /// Built once from the ICC profile when `grid_points` asks for a table.
    grid: Option<Arc<GridTable>>,
}

pub enum Instance {
    BuiltIn {
        /// Design profile -> sRGB, ahead of the built-in model.
        #[cfg(feature = "icc")]
        to_srgb: Option<lcms2::Transform<[u16; 3], [u16; 3]>>,
    },
    #[cfg(feature = "icc")]
    Icc(lcms2::Transform<[u16; 3], [u16; 4]>),
    Grid(Arc<GridTable>),
}

/// True when `icc` is a usable RGB profile. The decoders hand over RGB pixels, so a CMYK
/// or grey profile (or a broken one) can't describe them and the pixels are taken as sRGB.
#[cfg(feature = "icc")]
fn is_rgb_profile(icc: &[u8]) -> bool {
    lcms2::Profile::new_icc(icc).is_ok_and(|p| p.color_space() == lcms2::ColorSpaceSignature::RgbData)
}

#[cfg(not(feature = "icc"))]
fn is_rgb_profile(_: &[u8]) -> bool {
    false
}

impl Converter {
    /// `source_icc` is the profile embedded in the design, if any.
    pub fn from_settings(s: &ColourSettings, source_icc: Option<Vec<u8>>) -> Result<Self, EngineError> {
        let mut c = Converter {
            output: s.icc_profile_path.clone(),
            source: source_icc.filter(|p| is_rgb_profile(p)).map(Arc::new),
            intent: s.intent,
            grid: None,
        };
        let exact = c.instance()?; // fail early on a bad profile
        if c.output.is_some() && GRID_POINTS.contains(&s.grid_points) {
            let table = GridTable::sample(s.grid_points as usize, |rgb, out| exact.convert(rgb, out));
            c.grid = Some(Arc::new(table));
        }
        Ok(c)
    }

    /// True when the design's own colour profile is used instead of sRGB.
    pub fn uses_source_profile(&self) -> bool {
        self.source.is_some()
    }

    pub fn instance(&self) -> Result<Instance, EngineError> {
        if let Some(g) = &self.grid {
            return Ok(Instance::Grid(g.clone()));
        }
        #[cfg(feature = "icc")]
        {
            use lcms2::*;
            fn err(e: impl std::fmt::Display) -> EngineError {
                EngineError::Icc(e.to_string())
            }
            let input = match &self.source {
                Some(p) => Profile::new_icc(p).map_err(err)?,
                None => Profile::new_srgb(),
            };
            let (intent, flags) = match self.intent {
                RenderIntent::Perceptual => (Intent::Perceptual, Flags::default()),
                RenderIntent::RelativeColorimetric => (Intent::RelativeColorimetric, Flags::BLACKPOINT_COMPENSATION),
            };
            match &self.output {
                None => {
                    let to_srgb = match &self.source {
                        None => None,
                        Some(_) => Some(
                            Transform::new_flags(&input, PixelFormat::RGB_16, &Profile::new_srgb(), PixelFormat::RGB_16, intent, flags)
                                .map_err(err)?,
                        ),
                    };
                    Ok(Instance::BuiltIn { to_srgb })
                }
                Some(path) => {
                    let out = Profile::new_file(path).map_err(err)?;
                    let t = Transform::new_flags(&input, PixelFormat::RGB_16, &out, PixelFormat::CMYK_16, intent, flags)
                        .map_err(err)?;
                    Ok(Instance::Icc(t))
                }
            }
        }
        #[cfg(not(feature = "icc"))]
        match &self.output {
            None => Ok(Instance::BuiltIn {}),
            Some(_) => Err(EngineError::Icc("this build has no ICC support".into())),
        }
    }
}

impl Instance {
    /// Converts one row of RGB16 triples to KCMY16 (no alpha).
    pub fn convert(&self, rgb: &[u16], out: &mut [[u16; 4]]) {
        match self {
            #[cfg(feature = "icc")]
            Instance::BuiltIn { to_srgb: Some(t) } => {
                let src: Vec<[u16; 3]> = rgb.chunks_exact(3).map(|p| [p[0], p[1], p[2]]).collect();
                let mut srgb = vec![[0u16; 3]; src.len()];
                t.transform_pixels(&src, &mut srgb);
                built_in(srgb.as_flattened(), out);
            }
            Instance::BuiltIn { .. } => built_in(rgb, out),
            #[cfg(feature = "icc")]
            Instance::Icc(t) => {
                let src: Vec<[u16; 3]> = rgb.chunks_exact(3).map(|p| [p[0], p[1], p[2]]).collect();
                let mut cmyk = vec![[0u16; 4]; src.len()];
                t.transform_pixels(&src, &mut cmyk);
                for (c, o) in cmyk.iter().zip(out.iter_mut()) {
                    *o = [c[3], c[0], c[1], c[2]]; // CMYK -> K,C,M,Y
                }
            }
            Instance::Grid(g) => {
                for (px, o) in rgb.chunks_exact(3).zip(out.iter_mut()) {
                    *o = g.lookup([px[0], px[1], px[2]]);
                }
            }
        }
    }
}

fn built_in(rgb: &[u16], out: &mut [[u16; 4]]) {
    for (px, o) in rgb.chunks_exact(3).zip(out.iter_mut()) {
        let f = |v: u16| v as f32 / 65535.0;
        let k = rgb_to_kcmy(f(px[0]), f(px[1]), f(px[2]));
        *o = k.map(|v| (v.clamp(0.0, 1.0) * 65535.0).round() as u16);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MID: [u16; 3] = [32768, 32768, 32768];
    const RED: [u16; 3] = [50000, 20000, 20000];

    #[test]
    fn default_tone_does_nothing() {
        assert!(Tone::default().adjuster().is_none());
    }

    #[test]
    fn darker_lowers_mid_tones_and_keeps_white_and_black() {
        let t = Tone { darkness: 1.0, saturation: 1.0 }.adjuster().unwrap();
        assert!(t.apply(MID)[0] < 32768);
        assert_eq!(t.apply([65535; 3]), [65535; 3]);
        assert_eq!(t.apply([0; 3]), [0; 3]);
        let l = Tone { darkness: -1.0, saturation: 1.0 }.adjuster().unwrap();
        assert!(l.apply(MID)[0] > 32768);
    }

    #[test]
    fn more_colour_spreads_channels_and_leaves_greys_alone() {
        let more = Tone { darkness: 0.0, saturation: 1.5 }.adjuster().unwrap();
        let less = Tone { darkness: 0.0, saturation: 0.5 }.adjuster().unwrap();
        let spread = |p: [u16; 3]| p[0] as i32 - p[1] as i32;
        assert!(spread(more.apply(RED)) > spread(RED));
        assert!(spread(less.apply(RED)) < spread(RED));
        assert_eq!(more.apply(MID), MID);
    }

    #[test]
    fn grid_table_hits_its_nodes_and_blends_between_them() {
        // A made-up conversion with a curve, so blending differs from converting exactly.
        let f = |v: [u16; 3]| [v[0] / 2, v[1], (v[2] as u32 * v[2] as u32 / 65535) as u16, 7];
        let t = GridTable::sample(26, |rgb, out| {
            for (p, o) in rgb.chunks_exact(3).zip(out.iter_mut()) {
                *o = f([p[0], p[1], p[2]]);
            }
        });
        let node = |i: u32| (i * 65535 / 25) as u16; // exact for i = 0, 5, 10, ...
        assert_eq!(t.lookup([node(5), node(10), node(25)]), f([node(5), node(10), node(25)]));
        assert_eq!(t.lookup([65535; 3]), f([65535; 3]));
        // Halfway between the first two nodes on the blue axis: their average, not the exact value.
        let first = (65535.0f64 / 25.0).round() as u16;
        let mid = t.lookup([0, 0, first / 2]);
        assert_eq!(mid[2], (f([0, 0, first])[2] as f32 / 2.0).round() as u16);
        assert_ne!(mid[2], f([0, 0, first / 2])[2]);
        assert_eq!(mid[3], 7);
    }

    #[test]
    fn out_of_range_sliders_are_clamped() {
        let wild = Tone { darkness: 9.0, saturation: 9.0 }.adjuster().unwrap();
        let max = Tone { darkness: 1.0, saturation: 1.5 }.adjuster().unwrap();
        assert_eq!(wild.apply(RED), max.apply(RED));
    }
}
