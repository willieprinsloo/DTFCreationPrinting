use image::imageops::FilterType;
use image::ImageReader;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io;
use std::time::Duration;
use std::path::{Path, PathBuf};
use dtf_engine::pdf;
use tauri::Manager;
use crate::remote;

pub const PREVIEW_MAX_SIDE: u32 = 2048;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub asset_id: String,
    pub path: String,
    pub preview_path: String,
    /// For PDFs: the page size at 300 dpi.
    pub width_px: u32,
    pub height_px: u32,
    /// "raster" or "pdf".
    pub kind: &'static str,
    /// PDF page size (absent for rasters).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_mm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_mm: Option<f64>,
}

/// Resolution a PDF page size is expressed at in `width_px`/`height_px`.
const PDF_NOMINAL_DPI: f64 = 300.0;

fn unsupported(ext: &str) -> String {
    format!("Unsupported file type: .{ext} (use PNG, JPEG, TIFF or PDF)")
}

/// Lowercased extension if supported (png, jpg, jpeg, tif, tiff, pdf), else the unsupported error.
fn supported_ext(ext: &str) -> Result<String, String> {
    let e = ext.to_lowercase();
    match e.as_str() {
        "png" | "jpg" | "jpeg" | "tif" | "tiff" | "pdf" => Ok(e),
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

/// Renders the first page with its long side `max_side` px, transparent where the page is empty.
fn pdf_preview(src: &Path, tmp: &Path, max_side: u32) -> Result<(), String> {
    let (wmm, hmm) = pdf::page_size_mm(src).map_err(|e| e.to_string())?;
    let k = max_side as f64 / wmm.max(hmm);
    let (w, h) = (((wmm * k).round() as u32).max(1), ((hmm * k).round() as u32).max(1));
    let img = pdf::render_page(src, w, h).map_err(|e| e.to_string())?;
    img.save_with_format(tmp, image::ImageFormat::Png)
        .map_err(|e| format!("Could not write preview: {e}"))
}

pub fn ensure_preview(src: &Path, dst: &Path, max_side: u32) -> Result<(), String> {
    if dst.exists() {
        return Ok(());
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    if supported_ext(ext)? == "pdf" {
        let tmp = dst.with_extension("png.tmp");
        pdf_preview(src, &tmp, max_side)?;
        return fs::rename(&tmp, dst).map_err(|e| format!("Could not write preview: {e}"));
    }
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

pub(crate) fn build_info(file: &Path) -> Result<AssetInfo, String> {
    let stem = file
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Invalid cache file name")?
        .to_string();
    let preview = file.with_file_name(format!("{stem}.preview.png"));
    ensure_preview(file, &preview, PREVIEW_MAX_SIDE)?;
    let (w, h, page_mm) = if pdf::is_pdf(file) {
        let (wmm, hmm) = pdf::page_size_mm(file).map_err(|e| e.to_string())?;
        let px = |mm: f64| ((mm / 25.4 * PDF_NOMINAL_DPI).round() as u32).max(1);
        (px(wmm), px(hmm), Some((wmm, hmm)))
    } else {
        let (w, h) = read_dimensions(file)?;
        (w, h, None)
    };
    Ok(AssetInfo {
        asset_id: stem,
        path: file.to_string_lossy().into_owned(),
        preview_path: preview.to_string_lossy().into_owned(),
        width_px: w,
        height_px: h,
        kind: if page_mm.is_some() { "pdf" } else { "raster" },
        width_mm: page_mm.map(|p| p.0),
        height_mm: page_mm.map(|p| p.1),
    })
}

pub(crate) fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

/// Known image types that can't be printed are refused before downloading; any other
/// unusable extension (none, `.php`, an id with dots…) means "look at the bytes" (None).
fn url_ext_hint(url: &str) -> Result<Option<String>, String> {
    match url_extension(url) {
        Ok(e) => Ok(Some(e)),
        Err(err) => {
            let no_query = url.split(['?', '#']).next().unwrap_or("");
            let last = no_query.rsplit('/').next().unwrap_or("");
            let ext = last.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
            if ["gif", "webp", "bmp", "svg", "heic", "avif"].contains(&ext.as_str()) { Err(err) } else { Ok(None) }
        }
    }
}

/// The file type from its first bytes, for URLs that don't end in a usable extension.
fn sniff_ext(path: &Path) -> Result<String, String> {
    let mut head = [0u8; 12];
    let n = io::Read::read(&mut fs::File::open(path).map_err(|e| format!("Could not read download: {e}"))?, &mut head)
        .map_err(|e| format!("Could not read download: {e}"))?;
    let h = &head[..n];
    let ext = if h.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if h.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "jpg"
    } else if h.starts_with(&[b'I', b'I', b'*', 0]) || h.starts_with(&[b'M', b'M', 0, b'*']) {
        "tif"
    } else if h.starts_with(b"%PDF") {
        "pdf"
    } else if h.len() >= 12 && &h[..4] == b"RIFF" && &h[8..12] == b"WEBP" {
        return Err(unsupported("webp"));
    } else if h.starts_with(b"GIF8") {
        return Err(unsupported("gif"));
    } else if h.trim_ascii_start().starts_with(b"<") {
        return Err("The server sent a web page instead of the design file".into());
    } else {
        return Err("Downloaded file is not a PNG, JPEG, TIFF or PDF".into());
    };
    Ok(ext.into())
}

/// Rejects downloads that are not what their extension says (e.g. a login page).
fn validate_download(path: &Path, ext: &str) -> Result<(), String> {
    if ext != "pdf" {
        return validate_image(path);
    }
    match pdf::page_size_mm(path) {
        Ok(_) => Ok(()),
        Err(e @ dtf_engine::EngineError::PdfNotInstalled) => Err(e.to_string()),
        Err(_) => Err("Downloaded file is not a valid PDF".into()),
    }
}

/// Rejects files whose header cannot be read as an image.
fn validate_image(path: &Path) -> Result<(), String> {
    read_dimensions(path)
        .map(|_| ())
        .map_err(|_| "Downloaded file is not a valid image".to_string())
}

/// Downloads `url` into the cache as `<sha256(url)>.<ext>`. With `ext` None (the URL has no usable
/// extension) the type is read from the downloaded bytes. A cached copy is used again once the
/// server confirms it hasn't changed (see `remote`), and replaced when it has.
fn download_into(dir: &Path, url: &str, bearer: Option<&str>, ext: Option<&str>) -> Result<PathBuf, String> {
    let cached = |e: &str| dir.join(cache_file_name(url.as_bytes(), e));
    let hit = match ext {
        Some(e) => Some(cached(e)).filter(|p| p.exists()),
        None => ["png", "jpg", "tif", "pdf"].iter().map(|e| cached(e)).find(|p| p.exists()),
    };
    if let Some(h) = hit.as_ref().filter(|_| remote::recently_checked(url)) {
        return Ok(h.clone());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(None)
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Download failed: {e}"))?;
    let resp = match &hit {
        Some(h) => match remote::check(&client, url, bearer, h, true) {
            remote::Check::Changed(r) => r,
            remote::Check::Unchanged => {
                remote::mark_checked(url);
                return Ok(h.clone());
            }
            remote::Check::Unknown => return Ok(h.clone()),
        },
        None => {
            let mut req = client.get(url);
            if let Some(t) = bearer {
                req = req.bearer_auth(t);
            }
            let resp = req.send().map_err(|e| format!("Download failed: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("Download failed (HTTP {})", resp.status().as_u16()));
            }
            resp
        }
    };
    let saved = save_download(dir, url, resp, ext);
    let dest = match (saved, hit) {
        (Ok(dest), old) => {
            if let Some(old) = old.filter(|o| o != &dest) {
                let _ = fs::remove_file(remote::fingerprint_path(&old));
                let _ = fs::remove_file(old); // the file changed type on the server
            }
            forget_derived(dir, url, &dest);
            dest
        }
        // The new version couldn't be saved (not an image, or the old one is in use): keep the old.
        (Err(_), Some(old)) => old,
        (Err(e), None) => return Err(e),
    };
    remote::mark_checked(url);
    Ok(dest)
}

/// Previews and thumbnails made from an older version of `url`'s file.
fn forget_derived(dir: &Path, url: &str, file: &Path) {
    if let Some(stem) = file.file_stem().and_then(|s| s.to_str()) {
        let _ = fs::remove_file(file.with_file_name(format!("{stem}.preview.png")));
    }
    crate::thumbs::forget(dir, url);
}

/// Saves a download as `<sha256(url)>.<ext>` (replacing an older copy) with its fingerprint.
fn save_download(dir: &Path, url: &str, mut resp: reqwest::blocking::Response, ext: Option<&str>) -> Result<PathBuf, String> {
    let fingerprint = remote::Fingerprint::of(&resp);
    let tmp = dir.join(format!("{}.tmp", cache_file_name(url.as_bytes(), "download")));
    let result = (|| {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Could not save download: {e}"))?;
        io::copy(&mut resp, &mut f).map_err(|e| format!("Download failed: {e}"))?;
        drop(f);
        let ext = match ext {
            Some(e) => e.to_string(),
            None => sniff_ext(&tmp)?,
        };
        validate_download(&tmp, &ext)?;
        Ok::<_, String>(ext)
    })();
    let ext = match result {
        Ok(e) => e,
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
    };
    let dest = dir.join(cache_file_name(url.as_bytes(), &ext));
    fs::rename(&tmp, &dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not save download: {e}")
    })?;
    remote::write_fingerprint(&dest, &fingerprint);
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
        let file = download_into(&dir, &url, bearer.as_deref(), url_ext_hint(&url)?.as_deref())?;
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
        assert_eq!(validate_download(&bad, "png").unwrap_err(), "Downloaded file is not a valid image");
        let good = make_png(d.path(), "g.png", 10, 10);
        assert!(validate_download(&good, "png").is_ok());
    }

    #[test]
    fn sniffs_the_file_type_from_its_first_bytes() {
        let d = tempfile::tempdir().unwrap();
        let png = make_png(d.path(), "x.png", 4, 4);
        assert_eq!(sniff_ext(&png).unwrap(), "png");
        let cases: [(&[u8], Result<&str, &str>); 6] = [
            (&[0xFF, 0xD8, 0xFF, 0xE0], Ok("jpg")),
            (b"%PDF-1.7", Ok("pdf")),
            (&[b'I', b'I', b'*', 0, 8, 0], Ok("tif")),
            (b"RIFF\0\0\0\0WEBPVP8 ", Err(".webp")),
            (b"  <!doctype html>", Err("web page")),
            (b"hello", Err("not a PNG")),
        ];
        for (bytes, want) in cases {
            let f = d.path().join("f");
            fs::write(&f, bytes).unwrap();
            match (sniff_ext(&f), want) {
                (Ok(got), Ok(w)) => assert_eq!(got, w),
                (Err(got), Err(w)) => assert!(got.contains(w), "{got}"),
                (got, w) => panic!("{got:?} vs {w:?}"),
            }
        }
    }

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        image::RgbaImage::new(w, h).write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn a_cached_design_is_used_until_the_server_changes_it_then_replaced() {
        use std::sync::{Arc, Mutex};
        let d = tempfile::tempdir().unwrap();
        let assets = d.path().join("assets");
        fs::create_dir_all(&assets).unwrap();
        let (body, tag) = (Arc::new(Mutex::new(png_bytes(4, 4))), Arc::new(Mutex::new("\"v1\"".to_string())));
        let (url, sent) = remote::tests::serve(body.clone(), tag.clone());
        let f = download_into(&assets, &url, None, Some("png")).unwrap();
        let preview = build_info(&f).unwrap().preview_path;
        assert_eq!(remote::read_fingerprint(&f).unwrap().etag.as_deref(), Some("\"v1\""));
        // Unchanged on the server: asked, not downloaded again.
        remote::tests::forget_check(&url);
        assert_eq!(download_into(&assets, &url, None, Some("png")).unwrap(), f);
        assert_eq!(*sent.lock().unwrap(), 1);
        // Changed: replaced, with its old preview gone, and asked about only once in a while.
        *body.lock().unwrap() = png_bytes(8, 2);
        *tag.lock().unwrap() = "\"v2\"".into();
        assert_eq!(download_into(&assets, &url, None, Some("png")).unwrap(), f, "checked recently, so not asked");
        assert_eq!(read_dimensions(&f).unwrap(), (4, 4));
        remote::tests::forget_check(&url);
        assert_eq!(download_into(&assets, &url, None, Some("png")).unwrap(), f);
        assert_eq!(read_dimensions(&f).unwrap(), (8, 2));
        assert!(!Path::new(&preview).exists(), "old preview dropped");
        assert_eq!(build_info(&f).unwrap().width_px, 8);
        // The server is gone or sends something that isn't the design: the cached copy is kept.
        *body.lock().unwrap() = b"<html>login</html>".to_vec();
        *tag.lock().unwrap() = "\"v3\"".into();
        remote::tests::forget_check(&url);
        assert_eq!(download_into(&assets, &url, None, Some("png")).unwrap(), f);
        assert_eq!(read_dimensions(&f).unwrap(), (8, 2));
        let gone = "http://127.0.0.1:9/f.png";
        let cached = assets.join(cache_file_name(gone.as_bytes(), "png"));
        fs::copy(&f, &cached).unwrap();
        assert_eq!(download_into(&assets, gone, None, Some("png")).unwrap(), cached);
    }

    #[test]
    fn url_hint_trusts_good_extensions_refuses_known_bad_ones_and_sniffs_the_rest() {
        assert_eq!(url_ext_hint("https://x/a.PNG?v=2").unwrap().as_deref(), Some("png"));
        assert!(url_ext_hint("https://x/a.webp").unwrap_err().contains(".webp"));
        assert_eq!(url_ext_hint("https://x/designs/595F1778-5D57").unwrap(), None);
        assert_eq!(url_ext_hint("https://x/image.php?id=3").unwrap(), None);
    }

    /// Serves `body` once on a local port; returns the base URL.
    fn serve_once(body: Vec<u8>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = s.read(&mut buf);
            let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            s.write_all(head.as_bytes()).unwrap();
            s.write_all(&body).unwrap();
        });
        format!("http://{addr}")
    }

    #[test]
    fn downloads_a_design_whose_url_has_no_extension() {
        let d = tempfile::tempdir().unwrap();
        let png = fs::read(make_png(d.path(), "src.png", 6, 3)).unwrap();
        let url = format!("{}/designs/595F1778-5D57-4DA3", serve_once(png));
        let cache = d.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let file = download_into(&cache, &url, None, url_ext_hint(&url).unwrap().as_deref()).unwrap();
        assert_eq!(file.extension().unwrap(), "png");
        assert_eq!(read_dimensions(&file).unwrap(), (6, 3));
        // second time comes from the cache (the one-shot server is gone)
        assert_eq!(download_into(&cache, &url, None, None).unwrap(), file);
    }

    #[test]
    fn rejects_unsupported_types() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.gif");
        fs::write(&p, b"GIF89a").unwrap();
        let err = ensure_preview(&p, &d.path().join("a.preview.png"), 2048).unwrap_err();
        assert_eq!(err, "Unsupported file type: .gif (use PNG, JPEG, TIFF or PDF)");
        assert_eq!(
            url_extension("https://x/a.gif?x=1").unwrap_err(),
            "Unsupported file type: .gif (use PNG, JPEG, TIFF or PDF)"
        );
        assert_eq!(url_extension("https://x/a.JPEG?x=1").unwrap(), "jpeg");
        assert_eq!(url_extension("https://x/sheet.PDF?x=1").unwrap(), "pdf");
    }

    #[test]
    fn raster_info_is_kind_raster_without_page_size() {
        let d = tempfile::tempdir().unwrap();
        let p = make_png(d.path(), "abc.png", 30, 20);
        let v = serde_json::to_value(build_info(&p).unwrap()).unwrap();
        assert_eq!(v["kind"], "raster");
        assert_eq!((v["widthPx"].as_u64(), v["heightPx"].as_u64()), (Some(30), Some(20)));
        assert!(v.get("widthMm").is_none() && v.get("heightMm").is_none());
    }

    fn pdf_fixture(dir: &Path) -> PathBuf {
        let p = dir.join("abc.pdf");
        fs::write(&p, dtf_engine::pdf::testing::square_pdf(70.0, 50.0)).unwrap();
        p
    }

    #[test]
    fn pdf_info_has_page_size_and_a_transparent_preview() {
        if !dtf_engine::pdf::testing::pdfium_ready() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let info = build_info(&pdf_fixture(d.path())).unwrap();
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["kind"], "pdf");
        let (wmm, hmm) = (v["widthMm"].as_f64().unwrap(), v["heightMm"].as_f64().unwrap());
        assert!((wmm - 70.0).abs() < 0.01 && (hmm - 70.0).abs() < 0.01, "{wmm}x{hmm}");
        // pixel size = page size at 300 dpi (for code that only knows pixels)
        assert_eq!((info.width_px, info.height_px), (827, 827));
        let prev = image::open(&info.preview_path).unwrap().to_rgba8();
        assert_eq!(prev.dimensions(), (2048, 2048));
        assert_eq!(prev.get_pixel(1024, 1024).0, [0, 0, 0, 255]);
        assert_eq!(prev.get_pixel(10, 10).0[3], 0, "page background must be transparent");
    }

    #[test]
    fn downloaded_pdf_is_validated_as_pdf() {
        if !dtf_engine::pdf::testing::pdfium_ready() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let good = d.path().join("x.pdf.tmp");
        fs::write(&good, dtf_engine::pdf::testing::square_pdf(70.0, 50.0)).unwrap();
        assert!(validate_download(&good, "pdf").is_ok());
        let bad = d.path().join("y.pdf.tmp");
        fs::write(&bad, b"<html>login</html>").unwrap();
        assert_eq!(validate_download(&bad, "pdf").unwrap_err(), "Downloaded file is not a valid PDF");
    }
}
