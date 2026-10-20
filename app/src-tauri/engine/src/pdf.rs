//! PDF sources via a dynamically loaded pdfium library (first page only).
use crate::EngineError;
use pdfium_render::prelude::{PdfColor, PdfPage, PdfRenderConfig, Pdfium, PdfiumError};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Names the pdfium library file (or the folder holding it); checked before
/// the folder set with [`set_library_dir`].
pub const ENV_VAR: &str = "DTF_PDFIUM_PATH";

const MM_PER_PT: f64 = 25.4 / 72.0;

static LIB_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
static PDFIUM: OnceLock<Pdfium> = OnceLock::new();
static INIT: Mutex<()> = Mutex::new(());

/// Where the app keeps the bundled library (its resource folder). Only used
/// until the library has been loaded once.
pub fn set_library_dir(dir: &Path) {
    *LIB_DIR.lock().unwrap_or_else(|e| e.into_inner()) = Some(dir.to_path_buf());
}

fn candidates() -> Vec<PathBuf> {
    let name = Pdfium::pdfium_platform_library_name();
    let mut out = Vec::new();
    if let Some(p) = std::env::var_os(ENV_VAR).map(PathBuf::from) {
        out.push(if p.is_dir() { p.join(&name) } else { p });
    }
    if let Some(d) = LIB_DIR.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        out.push(d.join(&name));
    }
    out
}

/// The loaded library, loading it on first use. Not finding it is not
/// remembered, so a later call can still succeed.
fn pdfium() -> Result<&'static Pdfium, EngineError> {
    if let Some(p) = PDFIUM.get() {
        return Ok(p);
    }
    let _g = INIT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(p) = PDFIUM.get() {
        return Ok(p);
    }
    let mut reasons = Vec::new();
    for c in candidates() {
        if !c.is_file() {
            reasons.push(format!("{} not found", c.display()));
            continue;
        }
        match Pdfium::bind_to_library(&c) {
            Ok(b) => return Ok(PDFIUM.get_or_init(|| Pdfium::new(b))),
            Err(e) => reasons.push(format!("{}: {e}", c.display())),
        }
    }
    if reasons.is_empty() {
        reasons.push(format!("no library folder set and {ENV_VAR} is not set"));
    }
    // The user sees only the plain message; the reason goes to the log.
    eprintln!("PDF support is not installed: {}", reasons.join("; "));
    Err(EngineError::PdfNotInstalled)
}

fn pdf_err(e: PdfiumError) -> EngineError {
    EngineError::Pdf(e.to_string())
}

/// True if `path` has a `.pdf` extension (any case).
pub fn is_pdf(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

fn with_first_page<T>(path: &Path, f: impl FnOnce(&PdfPage) -> Result<T, EngineError>) -> Result<T, EngineError> {
    let doc = pdfium()?.load_pdf_from_file(path, None).map_err(pdf_err)?;
    let pages = doc.pages();
    if pages.is_empty() {
        return Err(EngineError::Pdf("the PDF has no pages".into()));
    }
    let page = pages.get(0).map_err(pdf_err)?;
    f(&page)
}

/// Width and height of the first page in millimetres (crop box, rotation applied).
pub fn page_size_mm(path: &Path) -> Result<(f64, f64), EngineError> {
    with_first_page(path, |p| {
        Ok((p.width().value as f64 * MM_PER_PT, p.height().value as f64 * MM_PER_PT))
    })
}

/// Renders the first page stretched to exactly `w`×`h` pixels on a
/// transparent background (straight RGBA).
pub fn render_page(path: &Path, w: u32, h: u32) -> Result<image::RgbaImage, EngineError> {
    if w == 0 || h == 0 || w > i32::MAX as u32 || h > i32::MAX as u32 {
        return Err(EngineError::Pdf(format!("cannot render at {w}\u{d7}{h} px")));
    }
    with_first_page(path, |p| {
        let cfg = PdfRenderConfig::new()
            .set_fixed_size(w as i32, h as i32)
            .set_clear_color(PdfColor::new(255, 255, 255, 0));
        let bmp = p.render_with_config(&cfg).map_err(pdf_err)?;
        let rgba = bmp.as_rgba_bytes();
        drop(bmp);
        image::RgbaImage::from_raw(w, h, rgba)
            .ok_or_else(|| EngineError::Pdf("unexpected bitmap size from pdfium".into()))
    })
}

#[doc(hidden)]
pub mod testing {
    use super::*;

    /// Folder the fetch script installs pdfium into for this build target.
    pub fn dev_library_dir() -> Option<PathBuf> {
        let t = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "mac-arm64"
        } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
            "mac-x64"
        } else if cfg!(all(windows, target_arch = "x86_64")) {
            "win-x64"
        } else {
            return None;
        };
        Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../pdfium").join(t))
    }

    /// Points the loader at the fetched library and reports whether PDFs work;
    /// prints a note when they do not, so callers can skip. With
    /// `DTF_REQUIRE_PDFIUM` set, a missing library fails the test instead.
    pub fn pdfium_ready() -> bool {
        if let Some(d) = dev_library_dir() {
            set_library_dir(&d);
        }
        let ok = page_size_mm(Path::new("/nonexistent.pdf"))
            .map(|_| true)
            .unwrap_or_else(|e| !matches!(e, EngineError::PdfNotInstalled));
        if !ok && std::env::var_os("DTF_REQUIRE_PDFIUM").is_some() {
            panic!("pdfium is required (DTF_REQUIRE_PDFIUM) but was not found");
        }
        if !ok {
            eprintln!("NOTE: pdfium not found — skipping PDF test (run scripts/fetch-pdfium.sh)");
        }
        ok
    }

    /// A one-page PDF `page_mm` square with a black `square_mm` square
    /// centred on it; the rest of the page is transparent.
    pub fn square_pdf(page_mm: f64, square_mm: f64) -> Vec<u8> {
        let o = pt((page_mm - square_mm) / 2.0);
        let s = pt(square_mm);
        page_pdf(page_mm, &format!("0 0 0 rg {o:.4} {o:.4} {s:.4} {s:.4} re f\n"), "")
    }

    /// A 70 mm page with a red 50 mm square whose outer 10 mm ring is 50 %
    /// transparent (inner 30 mm opaque); the rest of the page is transparent.
    pub fn red_soft_edge_pdf() -> Vec<u8> {
        let (o, s, io, is) = (pt(10.0), pt(50.0), pt(20.0), pt(30.0));
        let content = format!(
            "q /Half gs 1 0 0 rg {o:.4} {o:.4} {s:.4} {s:.4} re {io:.4} {io:.4} {is:.4} {is:.4} re f* Q \
             1 0 0 rg {io:.4} {io:.4} {is:.4} {is:.4} re f\n"
        );
        page_pdf(70.0, &content, "/ExtGState << /Half << /ca 0.5 >> >>")
    }

    fn pt(mm: f64) -> f64 {
        mm / 25.4 * 72.0
    }

    /// A one-page PDF `page_mm` square with the given content stream and resources.
    fn page_pdf(page_mm: f64, content: &str, resources: &str) -> Vec<u8> {
        let p = pt(page_mm);
        let objs = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {p:.4} {p:.4}] /Contents 4 0 R /Resources << {resources} >> >>"),
            format!("<< /Length {} >>\nstream\n{content}endstream", content.len()),
        ];
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (i, o) in objs.iter().enumerate() {
            offsets.push(out.len());
            out.extend(format!("{} 0 obj\n{o}\nendobj\n", i + 1).bytes());
        }
        let xref = out.len();
        out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).bytes());
        for off in offsets {
            out.extend(format!("{off:010} 00000 n \n").bytes());
        }
        out.extend(
            format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1)
                .bytes(),
        );
        out
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    fn fixture(dir: &Path) -> PathBuf {
        let p = dir.join("sq.PDF");
        std::fs::write(&p, square_pdf(70.0, 50.0)).unwrap();
        p
    }

    #[test]
    fn recognises_pdf_extension() {
        assert!(is_pdf(Path::new("a/b.pdf")) && is_pdf(Path::new("x.PDF")));
        assert!(!is_pdf(Path::new("x.png")) && !is_pdf(Path::new("pdf")));
    }

    #[test]
    fn missing_library_message() {
        assert_eq!(EngineError::PdfNotInstalled.to_string(), "PDF support is not installed");
    }

    #[test]
    fn page_size_from_media_box() {
        if !pdfium_ready() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let (w, h) = page_size_mm(&fixture(d.path())).unwrap();
        assert!((w - 70.0).abs() < 0.01 && (h - 70.0).abs() < 0.01, "{w}x{h}");
    }

    #[test]
    fn renders_stretched_with_transparent_background() {
        if !pdfium_ready() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        // 70 mm page at 2 px/mm across, 5 px/mm down: square 20..120 x 50..300.
        let img = render_page(&fixture(d.path()), 140, 350).unwrap();
        assert_eq!(img.dimensions(), (140, 350));
        assert_eq!(img.get_pixel(70, 175).0, [0, 0, 0, 255]);
        assert_eq!(img.get_pixel(5, 5).0[3], 0);
        assert_eq!(img.get_pixel(130, 340).0[3], 0);
        let opaque_cols = (0..140).filter(|&x| img.get_pixel(x, 175).0[3] > 127).count();
        let opaque_rows = (0..350).filter(|&y| img.get_pixel(70, y).0[3] > 127).count();
        assert!(opaque_cols.abs_diff(100) <= 1 && opaque_rows.abs_diff(250) <= 1, "{opaque_cols} {opaque_rows}");
    }

    #[test]
    fn non_pdf_is_a_pdf_error_not_missing_library() {
        if !pdfium_ready() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("bad.pdf");
        std::fs::write(&p, b"not a pdf").unwrap();
        let e = page_size_mm(&p).unwrap_err();
        assert!(matches!(e, EngineError::Pdf(_)), "{e:?}");
    }
}
