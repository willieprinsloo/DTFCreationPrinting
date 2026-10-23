//! `create_prn`: turns the app's sheet + printer profile into an engine job,
//! renders it off the UI thread and reports progress / honours cancel.
use dtf_engine::profile::ProfileDto;
use dtf_engine::{EngineError, ItemSpec, JobSpec, render_prn};
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
    // mirror and whiteEnabled in saved sheets are ignored: prints are always mirrored with white.
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
}

#[derive(Deserialize)]
struct AssetDto {
    /// The full cached original (never the preview).
    path: PathBuf,
}

/// Where colour profiles shipped with the app live (set at startup).
static PROFILE_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn set_profile_dir(dir: &Path) {
    let _ = PROFILE_DIR.set(dir.to_path_buf());
}

/// A printer profile's colour profile written as `bundled:<file>` is one shipped with the app.
const BUNDLED: &str = "bundled:";

/// The engine settings of a printer profile, with a shipped colour profile turned into its path.
fn settings_of(profile: ProfileDto) -> Result<dtf_engine::EngineSettings, String> {
    let mut s = profile.engine_settings();
    resolve_bundled(&mut s, PROFILE_DIR.get().map(PathBuf::as_path))?;
    Ok(s)
}

fn resolve_bundled(s: &mut dtf_engine::EngineSettings, dir: Option<&Path>) -> Result<(), String> {
    let Some(name) = s.icc_profile_path.as_ref().and_then(|p| p.to_str()).and_then(|p| p.strip_prefix(BUNDLED)) else {
        return Ok(());
    };
    let path = dir.map(|d| d.join(name)).filter(|p| p.is_file()).ok_or_else(|| {
        format!(
            "The built-in colour profile {name} is missing from this installation. Choose the .icm in Settings › Ink & colour."
        )
    })?;
    s.icc_profile_path = Some(path);
    Ok(())
}

/// Builds the engine job from the app's sheet and printer profile JSON.
pub fn job_from_sheet(sheet_json: &str, profile_json: &str) -> Result<JobSpec, String> {
    let sheet: SheetDto = serde_json::from_str(sheet_json).map_err(failed)?;
    let profile: ProfileDto = serde_json::from_str(profile_json).map_err(failed)?;
    let (x_dpi, y_dpi) = (profile.x_dpi, profile.y_dpi);
    let settings = settings_of(profile)?;
    Ok(JobSpec {
        width_mm: sheet.settings.width_mm,
        x_dpi,
        y_dpi,
        // DTF film is printed on its back, so the print is always mirrored; saved sheets'
        // mirror flags (older sheets could turn it off) are ignored.
        mirror: true,
        // White underbase is always printed; saved sheets' white flags are ignored.
        white_enabled: true,
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
                white_enabled: true,
            })
            .collect(),
        settings,
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

/// Renders a calibration chart ("white" or "colour") with the printer profile's settings.
pub fn chart_from_profile(kind: &str, profile_json: &str, out: &Path) -> Result<PrnStatsDto, String> {
    let profile: ProfileDto = serde_json::from_str(profile_json).map_err(failed)?;
    let (x_dpi, y_dpi) = (profile.x_dpi, profile.y_dpi);
    let settings = settings_of(profile)?;
    let started = std::time::Instant::now();
    let width = 600.0;
    let lines = match kind {
        "white" => dtf_engine::charts::white_chart(out, width, x_dpi, y_dpi, &settings),
        "colour" => dtf_engine::charts::colour_chart(out, None, width, x_dpi, y_dpi, &settings),
        other => return Err(failed(format!("unknown chart '{other}'"))),
    }
    .map_err(error_text)?
    .0;
    let bytes = std::fs::metadata(out).map(|m| m.len()).unwrap_or(0);
    Ok(PrnStatsDto { lines, bytes, millis: started.elapsed().as_millis() as u64 })
}

#[tauri::command]
pub async fn create_chart_prn(kind: String, profile_json: String, out_path: String) -> Result<PrnStatsDto, String> {
    tauri::async_runtime::spawn_blocking(move || chart_from_profile(&kind, &profile_json, Path::new(&out_path)))
        .await
        .unwrap_or_else(|e| Err(failed(e)))
}

#[tauri::command]
pub fn cancel_prn(jobs: State<'_, Arc<PrnJobs>>, job_id: String) {
    jobs.cancel(&job_id);
}

/// Explorer's `/select,"<path>"` argument (passed raw, not re-quoted).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn explorer_select_arg(path: &str) -> String {
    format!("/select,\"{path}\"")
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
    {
        // `arg` would re-quote the whole "/select,..." token when the path has
        // spaces, and Explorer then opens the wrong folder; pass it verbatim.
        use std::os::windows::process::CommandExt;
        Command::new("explorer")
            .raw_arg(explorer_select_arg(&path))
            .spawn()
            .map_err(fail)?;
    }
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
    use dtf_engine::screen::Screening;

    #[test]
    fn a_bundled_colour_profile_becomes_its_file_and_a_missing_one_says_so() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("m.icm"), b"x").unwrap();
        let with = |p: &str| dtf_engine::EngineSettings { icc_profile_path: Some(PathBuf::from(p)), ..Default::default() };
        let mut s = with("bundled:m.icm");
        resolve_bundled(&mut s, Some(d.path())).unwrap();
        assert_eq!(s.icc_profile_path, Some(d.path().join("m.icm")));
        let err = resolve_bundled(&mut with("bundled:gone.icm"), Some(d.path())).unwrap_err();
        assert!(err.contains("gone.icm") && err.contains("missing"), "{err}");
        assert!(resolve_bundled(&mut with("bundled:m.icm"), None).is_err());
        let mut own = with("C:/profiles/own.icm");
        resolve_bundled(&mut own, Some(d.path())).unwrap();
        assert_eq!(own.icc_profile_path, Some(PathBuf::from("C:/profiles/own.icm")));
    }
    use dtf_engine::EngineError;

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
        let unmirrored = SHEET.replace(r#""mirror": true"#, r#""mirror": false"#);
        assert!(unmirrored.contains(r#""mirror": false"#));
        assert!(job_from_sheet(&unmirrored, PROFILE).unwrap().mirror, "always mirrored");
        // white is always printed, even though the saved sheet has it off
        assert!(job.white_enabled);
        assert_eq!(job.items.len(), 2);
        let a = &job.items[0];
        assert_eq!(a.path, std::path::PathBuf::from("/cache/a.png"));
        assert_eq!(
            (a.x_mm, a.y_mm, a.width_mm, a.height_mm, a.rotation_deg),
            (10.5, 20.0, 100.0, 50.0, 90.0)
        );
        assert!(a.white_enabled);
        assert_eq!(job.items[1].path, std::path::PathBuf::from("/cache/b.tif"));
        assert!(job.items[1].white_enabled);
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
    fn explorer_select_arg_quotes_the_path() {
        assert_eq!(
            explorer_select_arg(r"C:\My Prints\job 1.prn"),
            r#"/select,"C:\My Prints\job 1.prn""#
        );
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
        // Escape for JSON: Windows paths contain backslashes.
        let png_json = png.to_str().unwrap().replace('\\', "\\\\");
        let sheet = SHEET
            .replace("/cache/a.png", &png_json)
            .replace("/cache/b.tif", &png_json);
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

    #[test]
    fn chart_from_profile_uses_the_profile_and_rejects_unknown_kinds() {
        let dir = std::env::temp_dir().join(format!("dtf-chart-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (a, b) = (dir.join("a.prn"), dir.join("b.prn"));
        let p = |ink: u32| format!(r#"{{"xDpi":720,"yDpi":1800,"inkLimitPct":{ink}}}"#);
        let sa = chart_from_profile("white", &p(280), &a).unwrap();
        let sb = chart_from_profile("white", &p(100), &b).unwrap();
        assert_eq!(sa.lines, sb.lines);
        assert_ne!(std::fs::read(&a).unwrap(), std::fs::read(&b).unwrap());
        assert!(chart_from_profile("nope", &p(280), &a).unwrap_err().contains("unknown chart"));
        assert!(chart_from_profile("white", "not json", &a).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn chart_from_profile_uses_the_profile_resolution() {
        let dir = std::env::temp_dir().join(format!("dtf-chart-dpi-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for kind in ["white", "colour"] {
            let out = dir.join(format!("{kind}.prn"));
            chart_from_profile(kind, r#"{"xDpi":360,"yDpi":900}"#, &out).unwrap();
            let h = dtf_engine::prn::PrnReader::open(&out).unwrap().header().clone();
            assert_eq!((h.x_dpi, h.y_dpi), (360, 900), "{kind}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
