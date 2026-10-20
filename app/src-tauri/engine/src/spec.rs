//! Job description handed to `render_prn` (built from the sheet + printer profile).
use crate::colour::ColourSettings;
use crate::screen::Screening;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct JobSpec {
    pub width_mm: f64,
    pub x_dpi: u32,
    pub y_dpi: u32,
    pub mirror: bool,
    pub white_enabled: bool,
    pub settings: EngineSettings,
    /// Later items are drawn on top of earlier ones.
    pub items: Vec<ItemSpec>,
}

/// `x_mm`/`y_mm` are the top-left of the un-rotated item; `rotation_deg` is
/// clockwise about the item centre (as in the app / Konva).
#[derive(Debug, Clone, Deserialize)]
pub struct ItemSpec {
    pub path: PathBuf,
    pub x_mm: f64,
    pub y_mm: f64,
    pub width_mm: f64,
    pub height_mm: f64,
    pub rotation_deg: f64,
    pub white_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EngineSettings {
    /// Logical channel ("K","C","M","Y","W") written to each PRN channel 0..5.
    pub channel_order: [String; 6],
    pub ink_limit_pct: f32,
    pub white_density_pct: f32,
    pub white_choke_mm: f32,
    pub screening: Screening,
    /// Dot-gain curves for K, C, M, Y, W (`None` = linear).
    pub curves: Option<[Vec<(f32, f32)>; 5]>,
    pub lead_in_mm: f32,
    pub icc_profile_path: Option<PathBuf>,
}

impl Default for EngineSettings {
    fn default() -> Self {
        Self {
            channel_order: ["K", "C", "M", "Y", "W", "W"].map(String::from),
            ink_limit_pct: 280.0,
            white_density_pct: 100.0,
            white_choke_mm: 0.2,
            screening: Screening::BlueNoise,
            curves: None,
            lead_in_mm: 0.0,
            icc_profile_path: None,
        }
    }
}

impl From<&EngineSettings> for ColourSettings {
    fn from(s: &EngineSettings) -> Self {
        ColourSettings {
            white_density_pct: s.white_density_pct,
            icc_profile_path: s.icc_profile_path.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrnStats {
    pub lines: u32,
    pub bytes: u64,
    pub millis: u64,
}
