//! Colour model: sRGB -> K,C,M,Y ink amounts (built-in GCR model, or ICC).
use crate::EngineError;
use std::path::PathBuf;

/// Colour/white settings for source preparation. Task 5 folds these into
/// `EngineSettings`.
#[derive(Debug, Clone, PartialEq)]
pub struct ColourSettings {
    pub white_density_pct: f32,
    pub icc_profile_path: Option<PathBuf>,
    pub tone: Tone,
}

impl Default for ColourSettings {
    fn default() -> Self {
        Self { white_density_pct: 100.0, icc_profile_path: None, tone: Tone::default() }
    }
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
pub enum Converter {
    BuiltIn,
    Icc(PathBuf),
}

pub enum Instance {
    BuiltIn,
    #[cfg(feature = "icc")]
    Icc(lcms2::Transform<[u16; 3], [u16; 4]>),
}

impl Converter {
    pub fn from_settings(s: &ColourSettings) -> Result<Self, EngineError> {
        match &s.icc_profile_path {
            None => Ok(Converter::BuiltIn),
            Some(p) => {
                let c = Converter::Icc(p.clone());
                c.instance()?; // fail early on a bad profile
                Ok(c)
            }
        }
    }

    pub fn instance(&self) -> Result<Instance, EngineError> {
        match self {
            Converter::BuiltIn => Ok(Instance::BuiltIn),
            #[cfg(feature = "icc")]
            Converter::Icc(path) => {
                use lcms2::*;
                let out = Profile::new_file(path).map_err(|e| EngineError::Icc(e.to_string()))?;
                let t = Transform::new(
                    &Profile::new_srgb(), PixelFormat::RGB_16, &out, PixelFormat::CMYK_16, Intent::Perceptual,
                )
                .map_err(|e| EngineError::Icc(e.to_string()))?;
                Ok(Instance::Icc(t))
            }
            #[cfg(not(feature = "icc"))]
            Converter::Icc(_) => Err(EngineError::Icc("this build has no ICC support".into())),
        }
    }
}

impl Instance {
    /// Converts one row of RGB16 triples to KCMY16 (no alpha).
    pub fn convert(&self, rgb: &[u16], out: &mut [[u16; 4]]) {
        match self {
            Instance::BuiltIn => {
                for (px, o) in rgb.chunks_exact(3).zip(out.iter_mut()) {
                    let f = |v: u16| v as f32 / 65535.0;
                    let k = rgb_to_kcmy(f(px[0]), f(px[1]), f(px[2]));
                    *o = k.map(|v| (v.clamp(0.0, 1.0) * 65535.0).round() as u16);
                }
            }
            #[cfg(feature = "icc")]
            Instance::Icc(t) => {
                let src: Vec<[u16; 3]> = rgb.chunks_exact(3).map(|p| [p[0], p[1], p[2]]).collect();
                let mut cmyk = vec![[0u16; 4]; src.len()];
                t.transform_pixels(&src, &mut cmyk);
                for (c, o) in cmyk.iter().zip(out.iter_mut()) {
                    *o = [c[3], c[0], c[1], c[2]]; // CMYK -> K,C,M,Y
                }
            }
        }
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
    fn out_of_range_sliders_are_clamped() {
        let wild = Tone { darkness: 9.0, saturation: 9.0 }.adjuster().unwrap();
        let max = Tone { darkness: 1.0, saturation: 1.5 }.adjuster().unwrap();
        assert_eq!(wild.apply(RED), max.apply(RED));
    }
}
