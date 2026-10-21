//! "Enhance": enlarges a low-resolution design with the bundled Real-ESRGAN upscaler
//! (realesrgan-ncnn-vulkan, which runs on the graphics card through Vulkan). The result is
//! a new PNG in the design cache; the original is left as it is.
use crate::assets::{self, AssetInfo};
use crate::prn::{CANCELLED, PrnJobs};
use image::imageops::FilterType;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Names the folder holding the upscaler; checked before the folder set with [`set_tool_dir`].
pub const ENV_VAR: &str = "DTF_REALESRGAN_PATH";

#[cfg(windows)]
const EXE: &str = "realesrgan-ncnn-vulkan.exe";
#[cfg(not(windows))]
const EXE: &str = "realesrgan-ncnn-vulkan";

/// The most the upscaler enlarges by; beyond this it would be inventing the design.
pub const MAX_FACTOR: f64 = 4.0;

static TOOL_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Where the app keeps the bundled upscaler (its resource folder).
pub fn set_tool_dir(dir: &Path) {
    *TOOL_DIR.lock().unwrap_or_else(|e| e.into_inner()) = Some(dir.to_path_buf());
}

fn tool_dir() -> Result<PathBuf, String> {
    let env = std::env::var_os(ENV_VAR).map(PathBuf::from);
    let bundled = TOOL_DIR.lock().unwrap_or_else(|e| e.into_inner()).clone();
    env.into_iter()
        .chain(bundled)
        .find(|d| d.join(EXE).is_file())
        .ok_or_else(|| "Enhance is not installed in this copy of the app".to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// Logos, text, illustrations: the fast compact model.
    Artwork,
    /// Photographs: the larger, slower general model.
    Photo,
}

/// Model and the scale it runs at to reach `factor` (output size / input size).
pub fn model_for(kind: Kind, factor: f64) -> (&'static str, u32) {
    match kind {
        Kind::Artwork => ("realesr-animevideov3", if factor <= 2.0 { 2 } else if factor <= 3.0 { 3 } else { 4 }),
        Kind::Photo => ("realesrgan-x4plus", 4),
    }
}

/// A progress line from the upscaler ("12,50%" or "12.50%") as 0..1.
pub fn parse_progress(line: &str) -> Option<f32> {
    let n: f32 = line.trim().strip_suffix('%')?.replace(',', ".").parse().ok()?;
    Some((n / 100.0).clamp(0.0, 1.0))
}

/// Checks the wanted size against the source: larger, at most `MAX_FACTOR`, and printable.
pub fn check_size(src: (u32, u32), want: (u32, u32)) -> Result<f64, String> {
    let factor = (want.0 as f64 / src.0 as f64).max(want.1 as f64 / src.1 as f64);
    if factor <= 1.0 {
        return Err("This design already has enough pixels".into());
    }
    // Rounding the target to whole pixels can take it a hair over 4x.
    if factor > MAX_FACTOR + 0.01 {
        return Err(format!("Enhance can enlarge a design at most {MAX_FACTOR}x"));
    }
    let px = want.0 as u64 * want.1 as u64;
    if want.0.max(want.1) > dtf_engine::source::MAX_SIDE || px > dtf_engine::source::MAX_PREPARED_PX {
        return Err("The enhanced design would be too large to print; make it smaller first".into());
    }
    Ok(factor)
}

/// `path` without Windows' `\\?\` long-path prefix (Tauri's folders carry it), which the
/// upscaler does not see as a full path. Network (`\\?\UNC\`) paths are left as they are.
pub fn plain_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with(r"UNC\") => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

/// Removes the work folder however the run ends.
struct WorkDir(PathBuf);
impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// What the user is told when the upscaler fails, from its last lines of output.
fn failure_text(lines: &[String]) -> String {
    let gpu = ["invalid gpu device", "vkCreateInstance", "vkEnumeratePhysicalDevices", "vulkan"];
    if lines.iter().any(|l| gpu.iter().any(|g| l.to_lowercase().contains(&g.to_lowercase()))) {
        return "Enhance needs a graphics card with Vulkan support, and none was found on this PC. Updating the graphics driver may help.".into();
    }
    match lines.iter().rev().find(|l| !l.trim().is_empty()) {
        Some(l) => format!("Enhance failed: {}", l.trim()),
        None => "Enhance failed: the upscaler produced no image".into(),
    }
}

/// Enlarges `src` to exactly `want` pixels into `<cache>/<hash>.png` and returns its path (at
/// once if it was made before). `cancel` is polled while the upscaler runs.
pub fn upscale(
    tool: &Path,
    cache: &Path,
    src: &Path,
    want: (u32, u32),
    kind: Kind,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(f32),
) -> Result<PathBuf, String> {
    let name = src.file_name().and_then(|n| n.to_str()).ok_or("Invalid design file name")?;
    let key = format!("upscale:{name}:{kind:?}:{}x{}", want.0, want.1);
    let dest = cache.join(assets::cache_file_name(key.as_bytes(), "png"));
    if dest.exists() {
        return Ok(dest);
    }
    let img = dtf_engine::source::decode(src).map_err(|e| e.to_string())?;
    let factor = check_size((img.width(), img.height()), want)?;
    let (model, scale) = model_for(kind, factor);

    let work = WorkDir(cache.join(format!("{}.upscale", assets::cache_file_name(key.as_bytes(), "tmp"))));
    fs::create_dir_all(&work.0).map_err(|e| format!("Could not prepare the design: {e}"))?;
    // The upscaler reads 8-bit PNG/JPEG/WebP only; TIFFs and 16-bit files go in as 8-bit PNG.
    let (input, output) = (work.0.join("in.png"), work.0.join("out.png"));
    img.to_rgba8().save(&input).map_err(|e| format!("Could not prepare the design: {e}"))?;
    drop(img);

    let mut cmd = Command::new(tool.join(EXE));
    cmd.arg("-i").arg(plain_path(&input)).arg("-o").arg(plain_path(&output));
    // The upscaler finds a relative model folder next to its own program.
    cmd.args(["-n", model, "-s", &scale.to_string(), "-m", "models"]);
    cmd.current_dir(tool).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Could not start the upscaler: {e}"))?;
    let stderr = child.stderr.take().expect("stderr is piped");
    let (tx, rx) = mpsc::channel::<f32>();
    let reader = std::thread::spawn(move || {
        let mut other = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            match parse_progress(&line) {
                Some(p) => {
                    let _ = tx.send(p);
                }
                None => other.push(line),
            }
        }
        other
    });
    // The last 10% is reading, resizing and saving the result.
    let mut done = 0.0f32;
    let status = loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CANCELLED.into());
        }
        for p in rx.try_iter() {
            if p > done {
                done = p;
                on_progress(p * 0.9);
            }
        }
        match child.try_wait().map_err(|e| format!("Enhance failed: {e}"))? {
            Some(s) => break s,
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    };
    let lines = reader.join().unwrap_or_default();
    // It exits with 0 even when it fails, so the output file is what counts.
    if !output.is_file() {
        eprintln!("upscaler exited with {status}: {}", lines.join(" | "));
        return Err(failure_text(&lines));
    }
    let up = image::open(&output).map_err(|e| format!("Enhance failed: could not read the result ({e})"))?;
    let up = if (up.width(), up.height()) == want {
        up.to_rgba8()
    } else {
        image::imageops::resize(&up, want.0, want.1, FilterType::Lanczos3)
    };
    let tmp = work.0.join("result.png");
    up.save(&tmp).map_err(|e| format!("Could not save the enhanced design: {e}"))?;
    fs::rename(&tmp, &dest).map_err(|e| format!("Could not save the enhanced design: {e}"))?;
    on_progress(1.0);
    Ok(dest)
}

/// Cancel flags of running upscales, by job id.
#[derive(Default)]
pub struct UpscaleJobs(PrnJobs);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    job_id: &'a str,
    fraction: f32,
}

#[tauri::command]
pub async fn upscale_asset(
    app: AppHandle,
    jobs: State<'_, Arc<UpscaleJobs>>,
    path: String,
    width_px: u32,
    height_px: u32,
    kind: Kind,
    job_id: String,
) -> Result<AssetInfo, String> {
    let jobs = jobs.inner().clone();
    let flag = jobs.0.start(&job_id);
    let cache = assets::cache_dir(&app)?;
    let id = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&path);
        // Only designs the app has cached; never an arbitrary file.
        let inside = fs::canonicalize(&src).ok().zip(fs::canonicalize(&cache).ok()).is_some_and(|(s, c)| s.starts_with(c));
        if !inside {
            return Err("Only designs on the sheet can be enhanced".to_string());
        }
        let tool = tool_dir()?;
        let mut progress = |fraction: f32| {
            let _ = app.emit("upscale-progress", ProgressEvent { job_id: &id, fraction });
        };
        let out = upscale(&tool, &cache, &src, (width_px, height_px), kind, &flag, &mut progress)?;
        assets::build_info(&out)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Enhance failed: {e}")));
    jobs.0.finish(&job_id);
    result
}

#[tauri::command]
pub fn cancel_upscale(jobs: State<'_, Arc<UpscaleJobs>>, job_id: String) {
    jobs.0.cancel(&job_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_lines_use_either_decimal_mark() {
        let near = |l: &str, want: f32| (parse_progress(l).unwrap() - want).abs() < 1e-6;
        assert!(near("73,33%", 0.7333));
        assert!(near(" 5.00%\r", 0.05));
        assert_eq!(parse_progress("100,00%"), Some(1.0));
        assert_eq!(parse_progress("[0 AMD Radeon(TM) Graphics]  queueC=1[2]"), None);
        assert_eq!(parse_progress("in.png -> out.png done"), None);
    }

    #[test]
    fn artwork_uses_the_smallest_scale_that_reaches_the_size_and_photos_use_4x() {
        assert_eq!(model_for(Kind::Artwork, 1.5), ("realesr-animevideov3", 2));
        assert_eq!(model_for(Kind::Artwork, 2.0), ("realesr-animevideov3", 2));
        assert_eq!(model_for(Kind::Artwork, 2.6), ("realesr-animevideov3", 3));
        assert_eq!(model_for(Kind::Artwork, 4.0), ("realesr-animevideov3", 4));
        assert_eq!(model_for(Kind::Photo, 1.5), ("realesrgan-x4plus", 4));
    }

    #[test]
    fn sizes_must_grow_by_at_most_4x_and_stay_printable() {
        assert_eq!(check_size((100, 50), (200, 100)), Ok(2.0));
        assert_eq!(check_size((100, 50), (401, 200)), Ok(4.01));
        assert!(check_size((100, 50), (100, 50)).unwrap_err().contains("enough pixels"));
        assert!(check_size((100, 50), (500, 250)).unwrap_err().contains("at most 4x"));
        assert!(check_size((9000, 9000), (36000, 36000)).unwrap_err().contains("too large"));
    }

    #[test]
    fn long_path_prefix_is_dropped_except_for_network_paths() {
        assert_eq!(plain_path(Path::new(r"\\?\C:\Users\a b\in.png")), PathBuf::from(r"C:\Users\a b\in.png"));
        assert_eq!(plain_path(Path::new(r"\\?\UNC\server\share\x.png")), PathBuf::from(r"\\?\UNC\server\share\x.png"));
        assert_eq!(plain_path(Path::new(r"C:\x.png")), PathBuf::from(r"C:\x.png"));
    }

    /// The app's folders come as `\\?\C:\...` on Windows; the upscaler must still find everything.
    #[cfg(windows)]
    #[test]
    fn works_from_long_path_folders() {
        let Some(tool) = local_tool() else { return };
        let d = tempfile::tempdir().unwrap();
        let long = |p: &Path| PathBuf::from(format!(r"\\?\{}", std::fs::canonicalize(p).unwrap().to_string_lossy().trim_start_matches(r"\\?\")));
        let src = d.path().join("a.png");
        image::RgbaImage::from_pixel(32, 32, image::Rgba([10, 200, 30, 255])).save(&src).unwrap();
        match upscale(&long(&tool), &long(d.path()), &long(&src), (64, 64), Kind::Artwork, &AtomicBool::new(false), &mut |_| {}) {
            Ok(out) => assert_eq!(image::open(out).unwrap().width(), 64),
            Err(e) if e.contains("Vulkan") => eprintln!("skipped: {e}"),
            Err(e) => panic!("{e}"),
        }
    }

    #[test]
    fn failures_are_explained() {
        let l = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(failure_text(&l(&["invalid gpu device"])).contains("Vulkan"));
        assert!(failure_text(&l(&["vkCreateInstance failed -9"])).contains("Vulkan"));
        assert_eq!(failure_text(&l(&["decode image x.png failed", ""])), "Enhance failed: decode image x.png failed");
        assert!(failure_text(&[]).contains("no image"));
    }

    /// The fetched upscaler (scripts/fetch-realesrgan.*), if present and a GPU is usable.
    fn local_tool() -> Option<PathBuf> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("realesrgan").join(if cfg!(windows) { "win" } else { "mac" });
        dir.join(EXE).is_file().then_some(dir)
    }

    #[test]
    fn enlarges_a_transparent_design_to_the_exact_size_and_reuses_the_result() {
        let Some(tool) = local_tool() else { return };
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("logo.png");
        // Red square on a transparent background.
        image::RgbaImage::from_fn(40, 30, |x, y| {
            if (10..30).contains(&x) && (5..25).contains(&y) { image::Rgba([220, 20, 30, 255]) } else { image::Rgba([0, 0, 0, 0]) }
        })
        .save(&src)
        .unwrap();
        let mut seen = Vec::new();
        let r = upscale(&tool, d.path(), &src, (100, 75), Kind::Artwork, &AtomicBool::new(false), &mut |p| seen.push(p));
        let out = match r {
            Ok(p) => p,
            Err(e) if e.contains("Vulkan") => return eprintln!("skipped: {e}"), // no usable GPU here
            Err(e) => panic!("{e}"),
        };
        let img = image::open(&out).unwrap().to_rgba8();
        assert_eq!(img.dimensions(), (100, 75));
        assert_eq!(img.get_pixel(2, 2)[3], 0, "transparent corner stays transparent");
        let mid = img.get_pixel(50, 37);
        assert!(mid[3] > 250 && mid[0] > 180 && mid[1] < 60, "{mid:?}");
        assert_eq!(seen.last(), Some(&1.0));
        // no work folder left behind
        assert!(fs::read_dir(d.path()).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".upscale")));
        // the second time is the cached file, without running the upscaler
        let again = upscale(Path::new("/nowhere"), d.path(), &src, (100, 75), Kind::Artwork, &AtomicBool::new(false), &mut |_| {});
        assert_eq!(again.unwrap(), out);
    }

    #[test]
    fn cancelling_stops_the_upscaler() {
        let Some(tool) = local_tool() else { return };
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("a.png");
        image::RgbaImage::from_pixel(64, 64, image::Rgba([10, 200, 30, 255])).save(&src).unwrap();
        let r = upscale(&tool, d.path(), &src, (128, 128), Kind::Artwork, &AtomicBool::new(true), &mut |_| {});
        assert_eq!(r.unwrap_err(), CANCELLED);
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1, "only the source is left");
    }
}
