//! Colour model: sRGB -> K,C,M,Y ink amounts (built-in GCR model, or ICC).
use crate::EngineError;
use std::path::PathBuf;

/// Colour/white settings for source preparation. Task 5 folds these into
/// `EngineSettings`.
#[derive(Debug, Clone, PartialEq)]
pub struct ColourSettings {
    pub white_density_pct: f32,
    pub icc_profile_path: Option<PathBuf>,
}

impl Default for ColourSettings {
    fn default() -> Self {
        Self { white_density_pct: 100.0, icc_profile_path: None }
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
