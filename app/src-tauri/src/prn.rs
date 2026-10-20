//! `create_prn`: turns the app's sheet + printer profile into an engine job,
//! renders it off the UI thread and reports progress / honours cancel.
use dtf_engine::screen::Screening;
use dtf_engine::{EngineError, EngineSettings, ItemSpec, JobSpec, render_prn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

/// Error text the front end recognises as "the user cancelled".
pub const CANCELLED: &str = "Cancelled";

fn failed(e: impl std::fmt::Display) -> String {
    format!("Creating the PRN failed: {e}")
}

pub fn error_text(e: EngineError) -> String {
    match e {
        EngineError::NothingToPrint => "There is nothing to print on this sheet".to_string(),
        EngineError::Cancelled => CANCELLED.to_string(),
        other => failed(other),
    }
}

// --- The subset of the app's Sheet / PrinterProfile JSON the engine needs. ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SheetDto {
    settings: SheetSettingsDto,
    items: Vec<SheetItemDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SheetSettingsDto {
    width_mm: f64,
    mirror: bool,
    white_enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SheetItemDto {
    asset: AssetDto,
    x_mm: f64,
    y_mm: f64,
    width_mm: f64,
    height_mm: f64,
    rotation_deg: f64,
    white_enabled: bool,
}

#[derive(Deserialize)]
struct AssetDto {
    /// The full cached original (never the preview).
    path: PathBuf,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DotGainDto {
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
struct ProfileDto {
    x_dpi: u32,
    y_dpi: u32,
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
    fn engine_settings(self) -> EngineSettings {
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

/// Builds the engine job from the app's sheet and printer profile JSON.
pub fn job_from_sheet(sheet_json: &str, profile_json: &str) -> Result<JobSpec, String> {
    let sheet: SheetDto = serde_json::from_str(sheet_json).map_err(failed)?;
    let profile: ProfileDto = serde_json::from_str(profile_json).map_err(failed)?;
    Ok(JobSpec {
        width_mm: sheet.settings.width_mm,
        x_dpi: profile.x_dpi,
        y_dpi: profile.y_dpi,
        mirror: sheet.settings.mirror,
        white_enabled: sheet.settings.white_enabled,
        items: sheet
            .items
            .into_iter()
            .map(|i| ItemSpec {
                path: i.asset.path,
                x_mm: i.x_mm,
                y_mm: i.y_mm,
                width_mm: i.width_mm,
                height_mm: i.height_mm,
                rotation_deg: i.rotation_deg,
                white_enabled: i.white_enabled,
            })
            .collect(),
        settings: profile.engine_settings(),
    })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrnStatsDto {
    pub lines: u32,
    pub bytes: u64,
    pub millis: u64,
}

/// Renders `job`; `cancel` is polled after every band.
pub fn run_job(
    job: &JobSpec,
    out: &Path,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(f32),
) -> Result<PrnStatsDto, String> {
    let mut progress = |f: f32| {
        if cancel.load(Ordering::SeqCst) {
            return false;
        }
        on_progress(f);
        true
    };
    let s = render_prn(job, out, &mut progress).map_err(error_text)?;
    Ok(PrnStatsDto {
        lines: s.lines,
        bytes: s.bytes,
        millis: s.millis,
    })
}

/// Cancel flags of running jobs, by job id.
#[derive(Default)]
pub struct PrnJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl PrnJobs {
    fn map(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
    /// Registers a job (keeping a cancel that arrived before it started).
    pub fn start(&self, id: &str) -> Arc<AtomicBool> {
        self.map().entry(id.to_string()).or_default().clone()
    }
    pub fn cancel(&self, id: &str) {
        self.map()
            .entry(id.to_string())
            .or_default()
            .store(true, Ordering::SeqCst);
    }
    pub fn finish(&self, id: &str) {
        self.map().remove(id);
    }
    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.map().is_empty()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    job_id: &'a str,
    fraction: f32,
}

#[tauri::command]
pub async fn create_prn(
    app: AppHandle,
    jobs: State<'_, Arc<PrnJobs>>,
    sheet_json: String,
    profile_json: String,
    out_path: String,
    job_id: String,
) -> Result<PrnStatsDto, String> {
    let jobs = jobs.inner().clone();
    let flag = jobs.start(&job_id);
    let result = match job_from_sheet(&sheet_json, &profile_json) {
        Err(e) => Err(e),
        Ok(job) => {
            let id = job_id.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let mut last = -1.0f32;
                run_job(&job, Path::new(&out_path), &flag, &mut |fraction| {
                    // About 200 updates at most, plus the final 1.0.
                    if fraction >= 1.0 || fraction - last >= 0.005 {
                        last = fraction;
                        let _ = app.emit(
                            "prn-progress",
                            ProgressEvent {
                                job_id: &id,
                                fraction,
                            },
                        );
                    }
                })
            })
            .await
            .unwrap_or_else(|e| Err(failed(e)))
        }
    };
    jobs.finish(&job_id);
    result
}

#[tauri::command]
pub fn cancel_prn(jobs: State<'_, Arc<PrnJobs>>, job_id: String) {
    jobs.cancel(&job_id);
}

/// Opens the system file manager with `path` selected.
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    use std::process::Command;
    let fail = |e: std::io::Error| format!("Could not open the folder: {e}");
    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(fail)?;
    #[cfg(target_os = "windows")]
    Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map_err(fail)?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let dir = Path::new(&path).parent().unwrap_or(Path::new("."));
        Command::new("xdg-open").arg(dir).spawn().map_err(fail)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use dtf_engine::EngineError;
    use dtf_engine::screen::Screening;

    const SHEET: &str = r#"{
      "id": "s1", "name": "Job", "profileId": "dtf-60",
      "settings": { "widthMm": 580, "margins": { "topMm": 5, "rightMm": 5, "bottomMm": 5, "leftMm": 5 },
        "gapMm": 3, "lengthMode": "auto", "fixedLengthMm": 1000, "mirror": true, "whiteEnabled": false, "allowRotate": true },
      "items": [
        { "id": "i1", "asset": { "assetId": "a", "path": "/cache/a.png", "previewPath": "/cache/a.jpg", "widthPx": 10, "heightPx": 10 },
          "source": { "kind": "order-file", "id": "f", "label": "A", "orderId": "o1" },
          "xMm": 10.5, "yMm": 20, "widthMm": 100, "heightMm": 50, "rotationDeg": 90, "whiteEnabled": true },
        { "id": "i2", "asset": { "assetId": "b", "path": "/cache/b.tif", "previewPath": "/cache/b.jpg", "widthPx": 10, "heightPx": 10 },
          "source": { "kind": "local", "id": "b", "label": "B" },
          "xMm": 200, "yMm": 30, "widthMm": 40, "heightMm": 60, "rotationDeg": 0, "whiteEnabled": false }
      ]
    }"#;

    const PROFILE: &str = r#"{
      "id": "dtf-60", "name": "DTF 60 cm", "widthMm": 600, "xDpi": 720, "yDpi": 1800,
      "defaultMargins": { "topMm": 5, "rightMm": 5, "bottomMm": 5, "leftMm": 5 }, "defaultGapMm": 3,
      "channelOrder": ["C", "M", "Y", "K", "W", "W"], "inkLimitPct": 250, "whiteDensityPct": 80,
      "whiteChokeMm": 0.3, "screening": "errorDiffusion",
      "dotGain": { "K": [[0.5, 0.4]], "C": [], "M": [], "Y": [], "W": [] },
      "leadInMm": 2, "iccProfilePath": "/icc/film.icc"
    }"#;

    #[test]
    fn job_from_sheet_maps_geometry_assets_and_settings() {
        let job = job_from_sheet(SHEET, PROFILE).unwrap();
        assert_eq!(job.width_mm, 580.0);
        assert_eq!((job.x_dpi, job.y_dpi), (720, 1800));
        assert!(job.mirror);
        assert!(!job.white_enabled);
        assert_eq!(job.items.len(), 2);
        let a = &job.items[0];
        assert_eq!(a.path, std::path::PathBuf::from("/cache/a.png"));
        assert_eq!(
            (a.x_mm, a.y_mm, a.width_mm, a.height_mm, a.rotation_deg),
            (10.5, 20.0, 100.0, 50.0, 90.0)
        );
        assert!(a.white_enabled);
        assert_eq!(job.items[1].path, std::path::PathBuf::from("/cache/b.tif"));
        assert!(!job.items[1].white_enabled);
        let s = &job.settings;
        assert_eq!(
            s.channel_order,
            ["C", "M", "Y", "K", "W", "W"].map(String::from)
        );
        assert_eq!(
            (
                s.ink_limit_pct,
                s.white_density_pct,
                s.white_choke_mm,
                s.lead_in_mm
            ),
            (250.0, 80.0, 0.3, 2.0)
        );
        assert_eq!(s.screening, Screening::ErrorDiffusion);
        let curves = s.curves.as_ref().expect("a non-linear curve was given");
        assert_eq!(curves[0], vec![(0.5, 0.4)]);
        assert!(curves[1..].iter().all(|c| c.is_empty()));
        assert_eq!(
            s.icc_profile_path,
            Some(std::path::PathBuf::from("/icc/film.icc"))
        );
    }

    #[test]
    fn old_profiles_without_engine_fields_get_engine_defaults() {
        let old = r#"{ "id": "p", "name": "P", "widthMm": 600, "xDpi": 720, "yDpi": 1800,
          "defaultMargins": { "topMm": 5, "rightMm": 5, "bottomMm": 5, "leftMm": 5 }, "defaultGapMm": 3 }"#;
        let job = job_from_sheet(SHEET, old).unwrap();
        let d = dtf_engine::EngineSettings::default();
        let s = &job.settings;
        assert_eq!(s.channel_order, d.channel_order);
        assert_eq!(
            (
                s.ink_limit_pct,
                s.white_density_pct,
                s.white_choke_mm,
                s.lead_in_mm
            ),
            (280.0, 100.0, 0.2, 0.0)
        );
        assert_eq!(s.screening, Screening::BlueNoise);
        assert!(s.curves.is_none());
        assert!(s.icc_profile_path.is_none());
    }

    #[test]
    fn all_linear_curves_become_none_and_blank_icc_is_ignored() {
        let p = PROFILE
            .replace(r#""K": [[0.5, 0.4]]"#, r#""K": []"#)
            .replace("/icc/film.icc", "");
        let job = job_from_sheet(SHEET, &p).unwrap();
        assert!(job.settings.curves.is_none());
        assert!(job.settings.icc_profile_path.is_none());
    }

    #[test]
    fn bad_sheet_json_is_a_plain_error() {
        let e = job_from_sheet("{}", PROFILE).unwrap_err();
        assert!(e.starts_with("Creating the PRN failed: "), "{e}");
    }

    #[test]
    fn engine_errors_read_as_plain_english() {
        assert_eq!(
            error_text(EngineError::NothingToPrint),
            "There is nothing to print on this sheet"
        );
        assert_eq!(error_text(EngineError::Cancelled), CANCELLED);
        assert_eq!(
            error_text(EngineError::Internal("boom".into())),
            "Creating the PRN failed: internal error while printing: boom"
        );
        let io = EngineError::Io(std::io::Error::other("disk full"));
        assert_eq!(
            error_text(io),
            "Creating the PRN failed: I/O error: disk full"
        );
    }

    #[test]
    fn cancel_before_start_is_honoured_and_jobs_are_forgotten_when_done() {
        let jobs = PrnJobs::default();
        jobs.cancel("j1");
        let flag = jobs.start("j1");
        assert!(flag.load(std::sync::atomic::Ordering::SeqCst));
        jobs.finish("j1");
        let fresh = jobs.start("j1");
        assert!(!fresh.load(std::sync::atomic::Ordering::SeqCst));
        jobs.cancel("j1");
        assert!(fresh.load(std::sync::atomic::Ordering::SeqCst));
        jobs.finish("j1");
        assert!(jobs.is_empty());
    }

    #[test]
    fn run_job_reports_progress_and_stops_when_cancelled() {
        use std::sync::Arc;
        use std::sync::atomic::{AtomicBool, Ordering};
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("a.png");
        image::RgbaImage::from_pixel(40, 40, image::Rgba([0, 0, 0, 255]))
            .save(&png)
            .unwrap();
        let sheet = SHEET
            .replace("/cache/a.png", png.to_str().unwrap())
            .replace("/cache/b.tif", png.to_str().unwrap());
        let job = job_from_sheet(&sheet, &PROFILE.replace("/icc/film.icc", "")).unwrap();
        let out = dir.path().join("x.prn");

        let mut seen = Vec::new();
        let flag = Arc::new(AtomicBool::new(false));
        let stats = run_job(&job, &out, &flag, &mut |f| seen.push(f)).unwrap();
        assert!(out.exists());
        assert_eq!(stats.bytes, std::fs::metadata(&out).unwrap().len());
        assert_eq!(seen.last(), Some(&1.0));

        let out2 = dir.path().join("y.prn");
        flag.store(true, Ordering::SeqCst);
        let e = run_job(&job, &out2, &flag, &mut |_| {}).unwrap_err();
        assert_eq!(e, CANCELLED);
        assert!(!out2.exists());
    }
}
