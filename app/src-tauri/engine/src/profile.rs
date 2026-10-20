//! The subset of the app's printer-profile JSON the engine needs (shared by the app and `prn-tool`).
use crate::EngineSettings;
use crate::screen::Screening;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DotGainDto {
    #[serde(default, rename = "K")]
    k: Vec<(f32, f32)>,
    #[serde(default, rename = "C")]
    c: Vec<(f32, f32)>,
    #[serde(default, rename = "M")]
    m: Vec<(f32, f32)>,
    #[serde(default, rename = "Y")]
    y: Vec<(f32, f32)>,
    #[serde(default, rename = "W")]
    w: Vec<(f32, f32)>,
}

/// Engine fields are optional so profiles saved before they existed still work.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    pub x_dpi: u32,
    pub y_dpi: u32,
    channel_order: Option<[String; 6]>,
    ink_limit_pct: Option<f32>,
    white_density_pct: Option<f32>,
    white_choke_mm: Option<f32>,
    screening: Option<Screening>,
    dot_gain: Option<DotGainDto>,
    lead_in_mm: Option<f32>,
    icc_profile_path: Option<String>,
}

impl ProfileDto {
    pub fn engine_settings(self) -> EngineSettings {
        let d = EngineSettings::default();
        let g = self.dot_gain.unwrap_or_default();
        let curves = [g.k, g.c, g.m, g.y, g.w];
        EngineSettings {
            channel_order: self.channel_order.unwrap_or(d.channel_order),
            ink_limit_pct: self.ink_limit_pct.unwrap_or(d.ink_limit_pct),
            white_density_pct: self.white_density_pct.unwrap_or(d.white_density_pct),
            white_choke_mm: self.white_choke_mm.unwrap_or(d.white_choke_mm),
            screening: self.screening.unwrap_or(d.screening),
            curves: if curves.iter().all(|c| c.is_empty()) {
                None
            } else {
                Some(curves)
            },
            lead_in_mm: self.lead_in_mm.unwrap_or(d.lead_in_mm),
            icc_profile_path: self
                .icc_profile_path
                .filter(|p| !p.trim().is_empty())
                .map(PathBuf::from),
        }
    }
}

