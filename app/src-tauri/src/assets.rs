use image::imageops::FilterType;
use image::ImageReader;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io;
use std::time::Duration;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub const PREVIEW_MAX_SIDE: u32 = 2048;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub asset_id: String,
    pub path: String,
    pub preview_path: String,
    pub width_px: u32,
    pub height_px: u32,
}

fn unsupported(ext: &str) -> String {
    format!("Unsupported file type: .{ext} (use PNG, JPEG or TIFF)")
}

/// Lowercased extension if supported (png, jpg, jpeg, tif, tiff), else the unsupported error.
fn supported_ext(ext: &str) -> Result<String, String> {
    let e = ext.to_lowercase();
    match e.as_str() {
        "png" | "jpg" | "jpeg" | "tif" | "tiff" => Ok(e),
        _ => Err(unsupported(&e)),
    }
}

pub fn cache_file_name(key: &[u8], ext: &str) -> String {
    let digest = Sha256::digest(key);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("{hex}.{ext}")
}

pub fn read_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let size = imagesize::size(path).map_err(|e| format!("Could not read image size: {e}"))?;
    Ok((size.width as u32, size.height as u32))
}

pub fn ensure_preview(src: &Path, dst: &Path, max_side: u32) -> Result<(), String> {
    if dst.exists() {
        return Ok(());
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    supported_ext(ext)?;
    let (w, h) = read_dimensions(src)?;
    let tmp = dst.with_extension("png.tmp");
    if w <= max_side && h <= max_side && ext.eq_ignore_ascii_case("png") {
        fs::copy(src, &tmp).map_err(|e| format!("Could not write preview: {e}"))?;
    } else {
        let mut reader = ImageReader::open(src).map_err(|e| format!("Could not open image: {e}"))?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(30000);
        limits.max_image_height = Some(30000);
        limits.max_alloc = Some(2 * 1024 * 1024 * 1024);
        reader.limits(limits);
        let img = reader
            .with_guessed_format()
            .map_err(|e| format!("Could not read image: {e}"))?
            .decode()
            .map_err(|e| format!("Could not decode image: {e}"))?;
        let out = if w <= max_side && h <= max_side {
            img
        } else {
            let scale = max_side as f64 / w.max(h) as f64;
            let nw = ((w as f64 * scale).round() as u32).max(1);
            let nh = ((h as f64 * scale).round() as u32).max(1);
            let resized = image::imageops::resize(&img, nw, nh, FilterType::Triangle);
            drop(img);
            image::DynamicImage::ImageRgba8(resized)
        };
        out.save_with_format(&tmp, image::ImageFormat::Png)
            .map_err(|e| format!("Could not write preview: {e}"))?;
    }
    fs::rename(&tmp, dst).map_err(|e| format!("Could not write preview: {e}"))
}

fn build_info(file: &Path) -> Result<AssetInfo, String> {
    let stem = file
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Invalid cache file name")?
        .to_string();
    let preview = file.with_file_name(format!("{stem}.preview.png"));
    ensure_preview(file, &preview, PREVIEW_MAX_SIDE)?;
    let (w, h) = read_dimensions(file)?;
    Ok(AssetInfo {
        asset_id: stem,
        path: file.to_string_lossy().into_owned(),
        preview_path: preview.to_string_lossy().into_owned(),
        width_px: w,
        height_px: h,
    })
}

fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("No cache dir: {e}"))?
        .join("assets");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create cache dir: {e}"))?;
    Ok(dir)
}

fn url_extension(url: &str) -> Result<String, String> {
    let no_query = url.split(['?', '#']).next().unwrap_or("");
    let last = no_query.rsplit('/').next().unwrap_or("");
    let ext = last.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    supported_ext(ext)
}

/// Rejects files whose header cannot be read as an image.
fn validate_image(path: &Path) -> Result<(), String> {
    read_dimensions(path)
        .map(|_| ())
        .map_err(|_| "Downloaded file is not a valid image".to_string())
}

fn download_into(dir: &Path, url: &str, bearer: Option<&str>, name: &str) -> Result<PathBuf, String> {
    let dest = dir.join(name);
    if dest.exists() {
        return Ok(dest);
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(None)
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Download failed: {e}"))?;
    let mut req = client.get(url);
    if let Some(t) = bearer {
        req = req.bearer_auth(t);
    }
    let mut resp = req.send().map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed (HTTP {})", resp.status().as_u16()));
    }
    let tmp = dir.join(format!("{name}.tmp"));
    let result = (|| {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Could not save download: {e}"))?;
        io::copy(&mut resp, &mut f).map_err(|e| format!("Download failed: {e}"))?;
        drop(f);
        validate_image(&tmp)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    fs::rename(&tmp, &dest).map_err(|e| format!("Could not save download: {e}"))?;
    Ok(dest)
}

#[tauri::command]
pub async fn cache_asset(
    app: tauri::AppHandle,
    url: String,
    bearer: Option<String>,
) -> Result<AssetInfo, String> {
    let dir = cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let ext = url_extension(&url)?;
        let name = cache_file_name(url.as_bytes(), &ext);
        let file = download_into(&dir, &url, bearer.as_deref(), &name)?;
        build_info(&file).inspect_err(|_| {
            let _ = fs::remove_file(&file);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_local_file(app: tauri::AppHandle, path: String) -> Result<AssetInfo, String> {
    let dir = cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&path);
        let ext = supported_ext(src.extension().and_then(|e| e.to_str()).unwrap_or(""))?;
        let bytes = fs::read(&src).map_err(|e| format!("Could not read file: {e}"))?;
        let dest = dir.join(cache_file_name(&bytes, &ext));
        if !dest.exists() {
            let tmp = dir.join(format!("{}.tmp", dest.file_name().unwrap().to_string_lossy()));
            fs::write(&tmp, &bytes).map_err(|e| format!("Could not copy file: {e}"))?;
            fs::rename(&tmp, &dest).map_err(|e| format!("Could not copy file: {e}"))?;
        }
        build_info(&dest)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_png(dir: &Path, name: &str, w: u32, h: u32) -> PathBuf {
        let p = dir.join(name);
        image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 255])).save(&p).unwrap();
        p
    }

    #[test]
    fn cache_name_is_sha256_hex_plus_ext_and_stable() {
        let a = cache_file_name(b"https://x/a.png", "png");
        assert_eq!(a, cache_file_name(b"https://x/a.png", "png"));
        let (stem, ext) = a.split_once('.').unwrap();
        assert_eq!(ext, "png");
        assert_eq!(stem.len(), 64);
        assert!(stem.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, cache_file_name(b"https://x/b.png", "png"));
    }

    #[test]
    fn reads_dimensions_from_header() {
        let d = tempfile::tempdir().unwrap();
        let p = make_png(d.path(), "a.png", 3000, 1000);
        assert_eq!(read_dimensions(&p).unwrap(), (3000, 1000));
    }

    #[test]
    fn preview_downsizes_long_side_keeping_aspect() {
        let d = tempfile::tempdir().unwrap();
        let p = make_png(d.path(), "wide.png", 20000, 200);
        let out = d.path().join("wide.preview.png");
        ensure_preview(&p, &out, 2048).unwrap();
        assert_eq!(read_dimensions(&out).unwrap(), (2048, 20));
    }

    #[test]
    fn preview_copies_small_images() {
        let d = tempfile::tempdir().unwrap();
        let p = make_png(d.path(), "s.png", 500, 500);
        let out = d.path().join("s.preview.png");
        ensure_preview(&p, &out, 2048).unwrap();
        assert_eq!(read_dimensions(&out).unwrap(), (500, 500));
    }

    #[test]
    fn validate_image_rejects_non_image() {
        let d = tempfile::tempdir().unwrap();
        let bad = d.path().join("x.tmp");
        fs::write(&bad, b"<html>not an image</html>").unwrap();
        assert_eq!(validate_image(&bad).unwrap_err(), "Downloaded file is not a valid image");
        let good = make_png(d.path(), "g.png", 10, 10);
        assert!(validate_image(&good).is_ok());
    }

    #[test]
    fn rejects_unsupported_types() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.gif");
        fs::write(&p, b"GIF89a").unwrap();
        let err = ensure_preview(&p, &d.path().join("a.preview.png"), 2048).unwrap_err();
        assert_eq!(err, "Unsupported file type: .gif (use PNG, JPEG or TIFF)");
        assert_eq!(
            url_extension("https://x/a.gif?x=1").unwrap_err(),
            "Unsupported file type: .gif (use PNG, JPEG or TIFF)"
        );
        assert_eq!(url_extension("https://x/a.JPEG?x=1").unwrap(), "jpeg");
    }
}
