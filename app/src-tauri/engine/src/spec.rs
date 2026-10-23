//! Job description handed to `render_prn` (built from the sheet + printer profile).
use crate::colour::{ColourSettings, RenderIntent};
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
    /// Less colour under black: where black is above `ucr_start_pct`, cyan, magenta and yellow
    /// are cut, rising to `ucr_pct` % less at full black (0 = off; see `compose::under_colour`).
    #[serde(default)]
    pub ucr_start_pct: f32,
    #[serde(default)]
    pub ucr_pct: f32,
    pub white_density_pct: f32,
    pub white_choke_mm: f32,
    /// Soft white edge: pixels of fade at each end of a white run, 0 (off) ..= 3 (see `white::edge_marks`).
    #[serde(default)]
    pub white_edge_steps: u8,
    pub screening: Screening,
    /// Dot-gain curves for K, C, M, Y, W (`None` = linear).
    pub curves: Option<[Vec<(f32, f32)>; 5]>,
    pub lead_in_mm: f32,
    pub icc_profile_path: Option<PathBuf>,
    /// Lighter/darker slider, -100 ..= 100 (0 = unchanged).
    #[serde(default)]
    pub darkness: f32,
    /// Colour slider, 50 ..= 150 % (100 = unchanged).
    #[serde(default = "default_saturation_pct")]
    pub saturation_pct: f32,
    #[serde(default)]
    pub render_intent: RenderIntent,
    /// See `ColourSettings::grid_points` (0 = exact).
    #[serde(default)]
    pub icc_grid_points: u8,
}

fn default_saturation_pct() -> f32 {
    100.0
}

impl Default for EngineSettings {
    fn default() -> Self {
        Self {
            // Measured from a Maintop PRN of the colour chart: yellow, magenta, cyan, black, white, white.
            channel_order: ["Y", "M", "C", "K", "W", "W"].map(String::from),
            ink_limit_pct: 280.0,
            ucr_start_pct: 40.0,
            ucr_pct: 0.0,
            white_density_pct: 100.0,
            white_choke_mm: 0.2,
            white_edge_steps: 0,
            screening: Screening::BlueNoise,
            curves: None,
            lead_in_mm: 0.0,
            icc_profile_path: None,
            darkness: 0.0,
            saturation_pct: 100.0,
            render_intent: RenderIntent::default(),
            icc_grid_points: 0,
        }
    }
}

impl From<&EngineSettings> for ColourSettings {
    fn from(s: &EngineSettings) -> Self {
        ColourSettings {
            white_density_pct: s.white_density_pct,
            icc_profile_path: s.icc_profile_path.clone(),
            tone: crate::colour::Tone { darkness: s.darkness / 100.0, saturation: s.saturation_pct / 100.0 },
            intent: s.render_intent,
            grid_points: s.icc_grid_points,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrnStats {
    pub lines: u32,
    pub bytes: u64,
    pub millis: u64,
}
