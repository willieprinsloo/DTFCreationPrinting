//! Source decode and preparation: PNG/JPEG/TIFF -> KCMY ink planes, white, alpha.
use crate::EngineError;
use crate::colour::{ColourSettings, Converter};
use crate::white::white_from_alpha;
use image::ImageReader;
use rayon::prelude::*;
use std::path::Path;

pub const MAX_SIDE: u32 = 30000;
pub const MAX_ALLOC: u64 = 2 * 1024 * 1024 * 1024;

/// One tone plane, 0..=65535, row-major.
#[derive(Debug, Clone, PartialEq)]
pub struct Plane {
    pub w: u32,
    pub h: u32,
    pub data: Vec<u16>,
}

#[derive(Debug, Clone)]
pub struct PreparedSource {
    pub w: u32,
    pub h: u32,
    /// K, C, M, Y
    pub ink: [Plane; 4],
    /// Un-choked white plane (the choke is applied at compose time via `white::erode`).
    pub white: Plane,
    pub alpha: Plane,
}

pub fn decode(path: &Path) -> Result<image::DynamicImage, EngineError> {
    let mut reader = ImageReader::open(path)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_ALLOC);
    reader.limits(limits);
    reader
        .with_guessed_format()?
        .decode()
        .map_err(|e| EngineError::Decode(e.to_string()))
}

/// Bytes per pixel held at once: RGBA16 copy (8) + 4 ink planes, white and alpha (12).
pub const BYTES_PER_PX: u64 = 20;
/// Most pixels one prepared source may have.
pub const MAX_PREPARED_PX: u64 = MAX_ALLOC / BYTES_PER_PX;

/// Decodes and prepares a source. Embedded source ICC profiles are ignored:
/// the pixels are assumed to be sRGB.
pub fn prepare(path: &Path, s: &ColourSettings, white_enabled: bool) -> Result<PreparedSource, EngineError> {
    prepare_with_budget(path, s, white_enabled, MAX_ALLOC)
}

/// Renders the first page of a PDF at exactly `w`×`h` pixels (transparent
/// background) and prepares it like a raster source.
pub fn prepare_pdf(
    path: &Path,
    w: u32,
    h: u32,
    s: &ColourSettings,
    white_enabled: bool,
) -> Result<PreparedSource, EngineError> {
    if w as u64 * h as u64 * BYTES_PER_PX > MAX_ALLOC {
        return Err(EngineError::Pdf(format!("design is too large to prepare ({w}\u{d7}{h} px)")));
    }
    let conv = Converter::from_settings(s)?;
    let img = image::DynamicImage::ImageRgba8(crate::pdf::render_page(path, w, h)?);
    let rgba = img.to_rgba16();
    drop(img);
    prepare_rgba(rgba, true, &conv, s, white_enabled)
}

pub fn prepare_with_budget(
    path: &Path,
    s: &ColourSettings,
    white_enabled: bool,
    budget: u64,
) -> Result<PreparedSource, EngineError> {
    let (dw, dh) = ImageReader::open(path)?
        .with_guessed_format()?
        .into_dimensions()
        .map_err(|e| EngineError::Decode(e.to_string()))?;
    if dw as u64 * dh as u64 * BYTES_PER_PX > budget {
        return Err(EngineError::Decode(format!("Design is too large to prepare ({dw}\u{d7}{dh} px)")));
    }
    let conv = Converter::from_settings(s)?;
    let img = decode(path)?;
    let has_alpha = img.color().has_alpha();
    // 8-bit inputs scale x257 to u16; 16-bit pass through.
    let rgba = img.to_rgba16();
    drop(img);
    prepare_rgba(rgba, has_alpha, &conv, s, white_enabled)
}

/// Splits straight-alpha RGBA into premultiplied ink planes, white and alpha.
fn prepare_rgba(
    rgba: image::ImageBuffer<image::Rgba<u16>, Vec<u16>>,
    has_alpha: bool,
    conv: &Converter,
    s: &ColourSettings,
    white_enabled: bool,
) -> Result<PreparedSource, EngineError> {
    let (w, h) = rgba.dimensions();
    let wu = w as usize;
    let n = wu * h as usize;
    let mut ink: Vec<Vec<u16>> = (0..4).map(|_| vec![0u16; n]).collect();
    let mut alpha = vec![65535u16; n];
    let [k, c, m, y] = &mut ink[..] else { unreachable!() };
    let tone = s.tone.adjuster();
    k.par_chunks_mut(wu)
        .zip(c.par_chunks_mut(wu))
        .zip(m.par_chunks_mut(wu))
        .zip(y.par_chunks_mut(wu))
        .zip(alpha.par_chunks_mut(wu))
        .zip(rgba.as_raw().par_chunks(wu * 4))
        .try_for_each_init(
            || (conv.instance(), Vec::new(), Vec::new()),
            |(inst, rgb, out), (((((kr, cr), mr), yr), ar), src)| -> Result<(), EngineError> {
                let inst = inst.as_ref().map_err(|e| EngineError::Icc(e.to_string()))?;
                rgb.clear();
                for p in src.chunks_exact(4) {
                    match &tone {
                        Some(t) => rgb.extend_from_slice(&t.apply([p[0], p[1], p[2]])),
                        None => rgb.extend_from_slice(&p[..3]),
                    }
                }
                out.resize(wu, [0u16; 4]);
                inst.convert(rgb, out);
                for (i, p) in src.chunks_exact(4).enumerate() {
                    let a = if has_alpha { p[3] } else { 65535 };
                    ar[i] = a;
                    let af = a as f32 / 65535.0;
                    let v = out[i].map(|t| (t as f32 * af).round() as u16);
                    kr[i] = v[0];
                    cr[i] = v[1];
                    mr[i] = v[2];
                    yr[i] = v[3];
                }
                Ok(())
            },
        )?;
    let mk = |data| Plane { w, h, data };
    let alpha = mk(alpha);
    let white = white_from_alpha(&alpha, s.white_density_pct, white_enabled);
    let mut it = ink.into_iter().map(mk);
    let ink = [it.next().unwrap(), it.next().unwrap(), it.next().unwrap(), it.next().unwrap()];
    Ok(PreparedSource { w, h, ink, white, alpha })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::colour::rgb_to_kcmy;
    use image::{ImageBuffer, Luma, Rgba};

    fn rgba_png(dir: &Path, px: [u8; 4]) -> std::path::PathBuf {
        let p = dir.join("a.png");
        ImageBuffer::from_pixel(2, 2, Rgba(px)).save(&p).unwrap();
        p
    }
    fn prep(px: [u8; 4], dens: f32, white: bool) -> PreparedSource {
        let d = tempfile::tempdir().unwrap();
        let s = ColourSettings { white_density_pct: dens, ..Default::default() };
        prepare(&rgba_png(d.path(), px), &s, white).unwrap()
    }
    fn near(v: u16, want: f32) -> bool {
        (v as f32 / 65535.0 - want).abs() < 0.005
    }
    fn inks(p: &PreparedSource) -> [u16; 4] {
        [p.ink[0].data[0], p.ink[1].data[0], p.ink[2].data[0], p.ink[3].data[0]]
    }

    #[test]
    fn model_primaries() {
        assert_eq!(rgb_to_kcmy(1.0, 1.0, 1.0), [0.0; 4]);
        assert_eq!(rgb_to_kcmy(0.0, 0.0, 0.0), [1.0, 0.0, 0.0, 0.0]);
        assert_eq!(rgb_to_kcmy(1.0, 0.0, 0.0), [0.0, 0.0, 1.0, 1.0]);
        let g = rgb_to_kcmy(0.5, 0.5, 0.5);
        assert_eq!(g, [0.5, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn white_pixel_has_no_ink() {
        assert_eq!(inks(&prep([255, 255, 255, 255], 100.0, true)), [0; 4]);
    }
    #[test]
    fn black_is_k_only() {
        assert_eq!(inks(&prep([0, 0, 0, 255], 100.0, true)), [65535, 0, 0, 0]);
    }
    #[test]
    fn red_is_magenta_yellow() {
        assert_eq!(inks(&prep([255, 0, 0, 255], 100.0, true)), [0, 0, 65535, 65535]);
    }
    #[test]
    fn grey_is_k_only() {
        let i = inks(&prep([128, 128, 128, 255], 100.0, true));
        assert!(near(i[0], 0.498) && i[1..] == [0, 0, 0]);
    }
    #[test]
    fn transparent_pixel_no_ink_no_white() {
        let p = prep([0, 0, 0, 0], 100.0, true);
        assert_eq!(inks(&p), [0; 4]);
        assert_eq!(p.white.data[0], 0);
    }
    #[test]
    fn half_alpha_halves_ink_and_white() {
        let p = prep([0, 0, 0, 128], 100.0, true);
        assert!(near(inks(&p)[0], 0.502));
        assert!(near(p.white.data[0], 0.502));
    }
    #[test]
    fn white_density_applies() {
        assert!(near(prep([0, 0, 0, 255], 80.0, true).white.data[0], 0.8));
    }
    #[test]
    fn white_disabled_is_zero() {
        assert!(prep([0, 0, 0, 255], 100.0, false).white.data.iter().all(|&v| v == 0));
    }
    #[test]
    fn sixteen_bit_tiff_grey_scales_directly() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("g.tif");
        ImageBuffer::from_pixel(3, 2, Luma([32768u16])).save(&p).unwrap();
        let s = prepare(&p, &ColourSettings::default(), true).unwrap();
        assert_eq!((s.w, s.h), (3, 2));
        assert!(near(s.ink[0].data[0], 0.5) && s.ink[1].data[0] == 0);
        assert_eq!(s.alpha.data[0], 65535);
    }
    #[test]
    fn too_large_for_budget_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let p = rgba_png(d.path(), [0, 0, 0, 255]); // 2x2 = 80 bytes planned
        let s = ColourSettings::default();
        let e = prepare_with_budget(&p, &s, true, 79).unwrap_err();
        assert!(e.to_string().contains("Design is too large to prepare (2\u{d7}2 px)"), "{e}");
        assert!(prepare_with_budget(&p, &s, true, 80).is_ok());
    }

    #[test]
    fn pixels_land_at_their_own_positions() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("w.png");
        let px: [[u8; 4]; 6] = [
            [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255],
            [0, 0, 0, 255], [255, 255, 255, 255], [10, 20, 30, 0],
        ];
        let mut img = ImageBuffer::new(3, 2);
        for (i, v) in px.iter().enumerate() {
            img.put_pixel((i % 3) as u32, (i / 3) as u32, Rgba(*v));
        }
        img.save(&p).unwrap();
        let s = prepare(&p, &ColourSettings { white_density_pct: 50.0, ..Default::default() }, true).unwrap();
        let (f, h) = (65535u16, 32768u16);
        // [K, C, M, Y, W] per pixel in row-major order
        let want: [[u16; 5]; 6] = [
            [0, 0, f, f, h], // red
            [0, f, 0, f, h], // green
            [0, f, f, 0, h], // blue
            [f, 0, 0, 0, h], // black
            [0, 0, 0, 0, h], // white
            [0, 0, 0, 0, 0], // transparent
        ];
        for (i, w) in want.iter().enumerate() {
            let got = [
                s.ink[0].data[i], s.ink[1].data[i], s.ink[2].data[i], s.ink[3].data[i], s.white.data[i],
            ];
            assert_eq!(&got, w, "pixel {i}");
        }
        assert_eq!(s.alpha.data[5], 0);
    }

    #[test]
    fn pdf_is_rendered_at_the_requested_size_and_prepared() {
        if !crate::pdf::testing::pdfium_ready() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("sq.pdf");
        std::fs::write(&p, crate::pdf::testing::square_pdf(70.0, 50.0)).unwrap();
        let s = prepare_pdf(&p, 70, 140, &ColourSettings::default(), true).unwrap();
        assert_eq!((s.w, s.h), (70, 140));
        let at = |x: usize, y: usize| y * 70 + x;
        // centre: black, opaque, full white underbase
        assert_eq!(s.ink[0].data[at(35, 70)], 65535);
        assert_eq!(s.ink[1].data[at(35, 70)], 0);
        assert_eq!(s.alpha.data[at(35, 70)], 65535);
        assert_eq!(s.white.data[at(35, 70)], 65535);
        // margin: transparent, no ink, no white
        assert_eq!(s.alpha.data[at(2, 2)], 0);
        assert_eq!(s.ink[0].data[at(2, 2)], 0);
        assert_eq!(s.white.data[at(2, 2)], 0);
    }

    #[test]
    fn pdf_colours_are_rgba_with_straight_alpha() {
        if !crate::pdf::testing::pdfium_ready() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("red.pdf");
        std::fs::write(&p, crate::pdf::testing::red_soft_edge_pdf()).unwrap();
        // 1 px per mm: inner opaque red 20..50, half-transparent ring 10..20 and 50..60
        let s = prepare_pdf(&p, 70, 70, &ColourSettings::default(), true).unwrap();
        let px = |x: usize, y: usize| {
            let i = y * 70 + x;
            [s.ink[0].data[i], s.ink[1].data[i], s.ink[2].data[i], s.ink[3].data[i], s.alpha.data[i]]
        };
        // red = magenta + yellow, no cyan (a BGRA/RGBA swap would give blue = cyan + magenta)
        assert_eq!(px(35, 35), [0, 0, 65535, 65535, 65535]);
        // ring: alpha ~0.5; ink planes are tone x alpha, so a straight-alpha
        // red gives ~0.5 M/Y (pdfium premultiplied output would give ~0.25)
        let [k, c, m, y, a] = px(15, 35);
        assert!(near(a, 0.5) && near(m, 0.5) && near(y, 0.5) && k == 0 && c == 0, "{:?}", px(15, 35));
        assert_eq!(px(3, 3), [0; 5]);
    }

    #[test]
    fn bad_file_is_decode_error() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("x.png");
        std::fs::write(&p, b"nope").unwrap();
        assert!(matches!(prepare(&p, &ColourSettings::default(), true), Err(EngineError::Decode(_))));
    }
    #[test]
    fn bad_icc_profile_errors() {
        let d = tempfile::tempdir().unwrap();
        let bad = d.path().join("p.icc");
        std::fs::write(&bad, b"not a profile").unwrap();
        let s = ColourSettings { icc_profile_path: Some(bad), ..Default::default() };
        let r = prepare(&rgba_png(d.path(), [0, 0, 0, 255]), &s, true);
        assert!(matches!(r, Err(EngineError::Icc(_))));
    }
}
