//! `thumb` protocol: small, cached thumbnails of the library's online images.
//!
//! The webview asks for `thumb://localhost/<url-encoded image URL>` (`http://thumb.localhost/…`
//! on Windows). The first time, the image is downloaded, shrunk to `THUMB_MAX_SIDE` and saved
//! in the app cache; after that it is read from disk, and remade only when the server says the
//! image changed (see `remote`).
use crate::assets::{cache_dir, cache_file_name, read_dimensions};
use crate::remote;
use image::ImageReader;
use image::imageops::FilterType;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::http::{Response, StatusCode, header};

/// Long side of a thumbnail in pixels (the library shows them at up to ~200 px).
pub const THUMB_MAX_SIDE: u32 = 320;
/// Thumbnails are only fetched from the hosts the app's image policy allows.
const ALLOWED: [(&str, &str, Option<u16>); 2] = [("https", "dtfcreations.co.za", None), ("http", "localhost", Some(8000))];
/// Largest image accepted for a thumbnail.
const MAX_DOWNLOAD: u64 = 300 * 1024 * 1024;
/// Downloads at once, so a page of thumbnails doesn't open dozens of connections.
const PARALLEL: usize = 6;

/// The image URL in a `thumb` request path, if it is one the app may fetch.
pub fn source_url(path: &str) -> Option<String> {
    let raw = decode(path.trim_start_matches('/'))?;
    let u = url::Url::parse(&raw).ok()?;
    ALLOWED
        .iter()
        .any(|(s, h, p)| u.scheme() == *s && u.host_str() == Some(*h) && u.port() == *p)
        .then(|| u.to_string())
}

/// Percent-decoding (the webview encodes the URL with `encodeURIComponent`).
fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Shrinks `src` so its long side is at most `max_side`, as PNG (keeps transparency).
pub fn make_thumb(src: &Path, dst: &Path, max_side: u32) -> Result<(), String> {
    let (w, h) = read_dimensions(src)?;
    let mut reader = ImageReader::open(src).map_err(|e| format!("Could not open image: {e}"))?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(2 * 1024 * 1024 * 1024);
    reader.limits(limits);
    let img = reader
        .with_guessed_format()
        .map_err(|e| format!("Could not read image: {e}"))?
        .decode().map_err(|e| format!("Could not decode image: {e}"))?;
    let thumb = if w.max(h) <= max_side {
        img
    } else {
        let k = max_side as f64 / w.max(h) as f64;
        let (nw, nh) = (((w as f64 * k).round() as u32).max(1), ((h as f64 * k).round() as u32).max(1));
        img.resize_exact(nw, nh, FilterType::Triangle)
    };
    let tmp = tmp_path(dst);
    thumb
        .save_with_format(&tmp, image::ImageFormat::Png)
        .map_err(|e| format!("Could not write thumbnail: {e}"))?;
    fs::rename(&tmp, dst).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not write thumbnail: {e}")
    })
}

/// A temporary name next to `p` that no other request uses at the same time.
fn tmp_path(p: &Path) -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    p.with_extension(format!("{}.{n}.tmp", std::process::id()))
}

/// Counts downloads in flight (at most `PARALLEL`).
struct Slots {
    used: Mutex<usize>,
    freed: Condvar,
}

static SLOTS: Slots = Slots { used: Mutex::new(0), freed: Condvar::new() };

fn with_slot<T>(f: impl FnOnce() -> T) -> T {
    let mut used = SLOTS.used.lock().unwrap_or_else(|e| e.into_inner());
    while *used >= PARALLEL {
        used = SLOTS.freed.wait(used).unwrap_or_else(|e| e.into_inner());
    }
    *used += 1;
    drop(used);
    let out = f();
    *SLOTS.used.lock().unwrap_or_else(|e| e.into_inner()) -= 1;
    SLOTS.freed.notify_one();
    out
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Download failed: {e}"))
}

fn download(resp: reqwest::blocking::Response, to: &Path) -> Result<(), String> {
    if !resp.status().is_success() {
        return Err(format!("Download failed (HTTP {})", resp.status().as_u16()));
    }
    let mut f = fs::File::create(to).map_err(|e| format!("Could not save download: {e}"))?;
    let n = std::io::copy(&mut resp.take(MAX_DOWNLOAD + 1), &mut f).map_err(|e| format!("Download failed: {e}"))?;
    if n > MAX_DOWNLOAD {
        return Err("The image is too large for a thumbnail".into());
    }
    Ok(())
}

/// Makes `thumb` from a download, keeping the server's fingerprint of the image with it.
fn thumb_from(resp: reqwest::blocking::Response, thumb: &Path) -> Result<(), String> {
    let fingerprint = remote::Fingerprint::of(&resp);
    let tmp = tmp_path(&thumb.with_extension("download"));
    let made = download(resp, &tmp).and_then(|_| make_thumb(&tmp, thumb, THUMB_MAX_SIDE));
    let _ = fs::remove_file(&tmp);
    made.map(|_| remote::write_fingerprint(thumb, &fingerprint))
}

/// The thumbnails folder next to the designs cache `assets`.
fn dir_for(assets: &Path) -> Option<PathBuf> {
    Some(assets.parent()?.join("thumbs"))
}

/// Drops `url`'s thumbnail (its design changed on the server), so it is made again.
pub fn forget(assets: &Path, url: &str) {
    if let Some(dir) = dir_for(assets) {
        let thumb = dir.join(cache_file_name(url.as_bytes(), "png"));
        let _ = fs::remove_file(remote::fingerprint_path(&thumb));
        let _ = fs::remove_file(thumb);
    }
}

/// The cached thumbnail for `url` in `dir`, made first if needed, and made again when the
/// server says the image changed. A design already downloaded for the canvas (in `assets`) is
/// shrunk from disk instead of downloaded again.
pub fn thumbnail(dir: &Path, assets: &Path, url: &str) -> Result<PathBuf, String> {
    let thumb = dir.join(cache_file_name(url.as_bytes(), "png"));
    if thumb.exists() {
        if remote::recently_checked(url) {
            return Ok(thumb);
        }
        return with_slot(|| {
            if remote::recently_checked(url) {
                return Ok(thumb.clone()); // another request checked it while this one waited
            }
            match remote::check(&client()?, url, None, &thumb, false) {
                remote::Check::Changed(r) => {
                    // Keep showing the old one if the new one can't be made.
                    let _ = thumb_from(r, &thumb);
                    remote::mark_checked(url);
                }
                remote::Check::Unchanged => remote::mark_checked(url),
                remote::Check::Unknown => {}
            }
            Ok(thumb.clone())
        });
    }
    if let Some(local) = ["png", "jpg", "jpeg", "tif", "tiff"]
        .iter()
        .map(|e| assets.join(cache_file_name(url.as_bytes(), e)))
        .find(|p| p.exists())
    {
        make_thumb(&local, &thumb, THUMB_MAX_SIDE)?;
        if let Some(f) = remote::read_fingerprint(&local) {
            remote::write_fingerprint(&thumb, &f);
        }
        return Ok(thumb);
    }
    with_slot(|| {
        if thumb.exists() {
            return Ok(thumb.clone()); // another request made it while this one waited
        }
        let resp = client()?.get(url).send().map_err(|e| format!("Download failed: {e}"))?;
        thumb_from(resp, &thumb)?;
        remote::mark_checked(url);
        Ok(thumb.clone())
    })
}

fn thumbs_dir(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let assets = cache_dir(app)?;
    let dir = dir_for(&assets).ok_or("No cache dir")?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create cache dir: {e}"))?;
    Ok((dir, assets))
}

fn reply(status: StatusCode, kind: &str, cache: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, kind)
        .header(header::CACHE_CONTROL, cache)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_default()
}

/// Answers one `thumb` request (blocking: run it off the main thread).
pub fn respond(app: &tauri::AppHandle, path: &str) -> Response<Vec<u8>> {
    let Some(url) = source_url(path) else {
        return reply(StatusCode::FORBIDDEN, "text/plain", "no-store", b"Not an allowed image address".to_vec());
    };
    let made = thumbs_dir(app).and_then(|(dir, assets)| thumbnail(&dir, &assets, &url));
    match made.and_then(|p| fs::read(p).map_err(|e| e.to_string())) {
        // The webview asks again each time, so a changed image shows; the answer comes from disk,
        // and the server is only asked every `remote::RECHECK_AFTER`.
        Ok(png) => reply(StatusCode::OK, "image/png", "no-cache", png),
        Err(e) => reply(StatusCode::BAD_GATEWAY, "text/plain", "no-store", e.into_bytes()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(path: &Path, w: u32, h: u32) {
        image::RgbaImage::from_pixel(w, h, image::Rgba([200, 10, 10, 128])).save(path).unwrap();
    }

    #[test]
    fn only_the_app_s_own_image_hosts_are_fetched() {
        let enc = |u: &str| format!("/{}", u.replace(':', "%3A").replace('/', "%2F"));
        assert_eq!(
            source_url(&enc("https://dtfcreations.co.za/uploads/a b.png")).as_deref(),
            Some("https://dtfcreations.co.za/uploads/a%20b.png")
        );
        assert!(source_url(&enc("http://localhost:8000/u/a.png")).is_some());
        assert!(source_url(&enc("https://evil.example/a.png")).is_none());
        assert!(source_url(&enc("http://dtfcreations.co.za/a.png")).is_none());
        assert!(source_url(&enc("http://localhost:9000/a.png")).is_none());
        assert!(source_url(&enc("file:///C:/secret.png")).is_none());
        assert!(source_url("/%zz").is_none());
    }

    #[test]
    fn thumbnails_are_small_keep_transparency_and_come_from_the_design_cache() {
        let d = tempfile::tempdir().unwrap();
        let (thumbs, assets) = (d.path().join("thumbs"), d.path().join("assets"));
        fs::create_dir_all(&thumbs).unwrap();
        fs::create_dir_all(&assets).unwrap();
        let url = "https://dtfcreations.co.za/u/big.png";
        png(&assets.join(cache_file_name(url.as_bytes(), "png")), 2000, 1000);
        let t = thumbnail(&thumbs, &assets, url).unwrap();
        assert_eq!(read_dimensions(&t).unwrap(), (THUMB_MAX_SIDE, THUMB_MAX_SIDE / 2));
        assert_eq!(image::open(&t).unwrap().to_rgba8().get_pixel(0, 0)[3], 128);
        // Second time: read from the thumbnail cache, even with the design gone.
        fs::remove_file(assets.join(cache_file_name(url.as_bytes(), "png"))).unwrap();
        remote::mark_checked(url); // (keeps this test off the network)
        assert_eq!(thumbnail(&thumbs, &assets, url).unwrap(), t);
        assert_eq!(fs::read_dir(&thumbs).unwrap().count(), 1, "no temporary files left");
    }

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        image::RgbaImage::new(w, h).write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn a_thumbnail_is_made_again_when_its_image_changes_on_the_server() {
        use std::sync::Arc;
        let d = tempfile::tempdir().unwrap();
        let (thumbs, assets) = (d.path().join("thumbs"), d.path().join("assets"));
        fs::create_dir_all(&thumbs).unwrap();
        let (body, tag) = (Arc::new(Mutex::new(png_bytes(400, 400))), Arc::new(Mutex::new("\"a\"".to_string())));
        let (url, sent) = remote::tests::serve(body.clone(), tag.clone());
        let t = thumbnail(&thumbs, &assets, &url).unwrap();
        assert_eq!(read_dimensions(&t).unwrap(), (320, 320));
        remote::tests::forget_check(&url);
        thumbnail(&thumbs, &assets, &url).unwrap();
        assert_eq!(*sent.lock().unwrap(), 1, "unchanged: not downloaded again");
        *body.lock().unwrap() = png_bytes(640, 320);
        *tag.lock().unwrap() = "\"b\"".into();
        remote::tests::forget_check(&url);
        thumbnail(&thumbs, &assets, &url).unwrap();
        assert_eq!(read_dimensions(&t).unwrap(), (320, 160));
        // A design replaced in the designs cache drops its thumbnail.
        forget(&assets, &url);
        assert!(!t.exists() && !remote::fingerprint_path(&t).exists());
    }

    #[test]
    fn small_images_are_kept_at_their_size() {
        let d = tempfile::tempdir().unwrap();
        let (src, dst) = (d.path().join("s.png"), d.path().join("t.png"));
        png(&src, 100, 40);
        make_thumb(&src, &dst, THUMB_MAX_SIDE).unwrap();
        assert_eq!(read_dimensions(&dst).unwrap(), (100, 40));
    }
}
