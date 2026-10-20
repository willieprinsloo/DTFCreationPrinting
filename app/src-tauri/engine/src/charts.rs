//! Calibration charts (used by `prn-tool chart white|colour`). Both go through the
//! real `render_prn` pipeline, so what is printed is what the app would print.
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use image::{ImageEncoder, Rgb, RgbImage, Rgba, RgbaImage};

use crate::prn::{PrnHeader, PrnReader, PrnWriter};
use crate::{EngineError, EngineSettings, ItemSpec, JobSpec, render_prn};

const X_DPI: u32 = 720;
const Y_DPI: u32 = 1800;
/// Chart artwork resolution: 20 px/mm = 508 dpi.
pub const PX_PER_MM: u32 = 20;

pub const COLOUR_W_MM: f64 = 280.0;
pub const COLOUR_H_MM: f64 = 200.0;

pub const WHITE_DENSITIES: [f32; 3] = [60.0, 80.0, 100.0];
pub const WHITE_CHOKES: [f32; 4] = [0.0, 0.1, 0.2, 0.4];
const CELL_W_MM: f64 = 60.0;
const CELL_H_MM: f64 = 48.0;
/// Cells sit 140 mm apart across (first at 20 mm) and 52 mm apart down.
pub const WHITE_COL_PITCH_MM: f64 = 140.0;
pub const WHITE_COL_X0_MM: f64 = 20.0;
pub const WHITE_ROW_PITCH_MM: f64 = 52.0;

fn io<T>(r: std::io::Result<T>) -> Result<T, EngineError> {
    r.map_err(EngineError::Io)
}

fn work_dir(out: &Path) -> Result<PathBuf, EngineError> {
    let mut s = out.as_os_str().to_owned();
    s.push(".work");
    let d = PathBuf::from(s);
    io(std::fs::create_dir_all(&d))?;
    Ok(d)
}

fn ensure_parent(out: &Path) -> Result<(), EngineError> {
    if let Some(dir) = out.parent().filter(|d| !d.as_os_str().is_empty()) {
        io(std::fs::create_dir_all(dir))?;
    }
    Ok(())
}

fn px(mm: f64) -> i64 {
    (mm * PX_PER_MM as f64).round() as i64
}

fn fill<P: image::Pixel>(img: &mut image::ImageBuffer<P, Vec<P::Subpixel>>, x: f64, y: f64, w: f64, h: f64, c: P) {
    let (x0, y0) = (px(x).max(0), px(y).max(0));
    let (x1, y1) = ((px(x + w)).min(img.width() as i64), (px(y + h)).min(img.height() as i64));
    for yy in y0..y1 {
        for xx in x0..x1 {
            img.put_pixel(xx as u32, yy as u32, c);
        }
    }
}

// ---- white chart ----

fn white_cell_png(path: &Path, col: usize, row: usize) -> Result<(), EngineError> {
    let mut img = RgbaImage::from_pixel((CELL_W_MM as u32) * PX_PER_MM, (CELL_H_MM as u32) * PX_PER_MM, Rgba([0, 0, 0, 0]));
    let black = Rgba([0, 0, 0, 255]);
    // index dots: top row = choke column (1..4), second row = density row (1..3)
    for i in 0..=col {
        fill(&mut img, 10.0 + i as f64 * 4.0, 0.0, 3.0, 3.0, black);
    }
    for i in 0..=row {
        fill(&mut img, 10.0 + i as f64 * 4.0, 4.0, 3.0, 3.0, black);
    }
    // 40 mm square: 1 mm black outline around a mid-blue fill
    fill(&mut img, 10.0, 8.0, 40.0, 40.0, black);
    fill(&mut img, 11.0, 9.0, 38.0, 38.0, Rgba([60, 120, 200, 255]));
    img.save(path).map_err(|e| EngineError::Decode(e.to_string()))
}

/// Writes `white.prn`: a grid of squares, rows = white density (60/80/100 %, top to
/// bottom), columns = white choke (0/0.1/0.2/0.4 mm, left to right). Dots above each
/// square count the column (top row of dots) and the row (second row of dots).
pub fn white_chart(out: &Path, width_mm: f64) -> Result<(u32, u32), EngineError> {
    let need = WHITE_COL_X0_MM + 3.0 * WHITE_COL_PITCH_MM + CELL_W_MM + WHITE_COL_X0_MM;
    if width_mm < need {
        return Err(EngineError::BadSettings(format!("--width-mm must be at least {need}")));
    }
    ensure_parent(out)?;
    let dir = work_dir(out)?;
    let mut readers = Vec::new();
    for (r, &density) in WHITE_DENSITIES.iter().enumerate() {
        for (c, &choke) in WHITE_CHOKES.iter().enumerate() {
            let png = dir.join(format!("cell_{r}_{c}.png"));
            white_cell_png(&png, c, r)?;
            let job = JobSpec {
                width_mm: CELL_W_MM,
                x_dpi: X_DPI,
                y_dpi: Y_DPI,
                mirror: false,
                white_enabled: true,
                settings: EngineSettings { white_density_pct: density, white_choke_mm: choke, ..EngineSettings::default() },
                items: vec![ItemSpec {
                    path: png,
                    x_mm: 0.0,
                    y_mm: 0.0,
                    width_mm: CELL_W_MM,
                    height_mm: CELL_H_MM,
                    rotation_deg: 0.0,
                    white_enabled: true,
                }],
            };
            let prn = dir.join(format!("cell_{r}_{c}.prn"));
            render_prn(&job, &prn, &mut |_| true)?;
            readers.push(PrnReader::open(&prn)?);
        }
    }
    let row_line = |r: usize| (r as f64 * WHITE_ROW_PITCH_MM / 25.4 * Y_DPI as f64).round() as u32;
    let cell_lines = readers[0].header().lines;
    let lines = row_line(2) + cell_lines;
    let header = PrnHeader::for_width(width_mm, X_DPI, Y_DPI, lines);
    let w = header.width_px as usize;
    let col_x = |c: usize| (((WHITE_COL_X0_MM + c as f64 * WHITE_COL_PITCH_MM) / 25.4) * X_DPI as f64).round() as usize;

    let mut part = out.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    let result = (|| -> Result<(), EngineError> {
        let mut wr = PrnWriter::new(BufWriter::with_capacity(1 << 20, io(File::create(&part))?), header)?;
        let mut bufs: [Vec<u8>; 6] = std::array::from_fn(|_| vec![0u8; w]);
        for y in 0..lines {
            for b in bufs.iter_mut() {
                b.fill(0);
            }
            for r in 0..3 {
                let y0 = row_line(r);
                if y < y0 || y >= y0 + cell_lines {
                    continue;
                }
                for c in 0..4 {
                    let rd = &mut readers[r * 4 + c];
                    let src = rd.read_line(y - y0)?;
                    let x0 = col_x(c);
                    for (ch, s) in src.iter().enumerate() {
                        let n = s.len().min(w.saturating_sub(x0));
                        bufs[ch][x0..x0 + n].copy_from_slice(&s[..n]);
                    }
                }
            }
            let refs: [&[u8]; 6] = std::array::from_fn(|c| bufs[c].as_slice());
            wr.write_line(&refs)?;
        }
        wr.finish()?;
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&dir);
    match result {
        Ok(()) => io(std::fs::rename(&part, out))?,
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
    }
    Ok((lines, w as u32))
}

// ---- colour chart ----

/// 3x5 digit font.
const DIGITS: [[&str; 5]; 10] = [
    ["###", "#.#", "#.#", "#.#", "###"],
    [".#.", "##.", ".#.", ".#.", "###"],
    ["###", "..#", "###", "#..", "###"],
    ["###", "..#", "###", "..#", "###"],
    ["#.#", "#.#", "###", "..#", "..#"],
    ["###", "#..", "###", "..#", "###"],
    ["###", "#..", "###", "#.#", "###"],
    ["###", "..#", "..#", "..#", "..#"],
    ["###", "#.#", "###", "#.#", "###"],
    ["###", "#.#", "###", "..#", "###"],
];

/// Draws `text` (digits and spaces) in black, `h_mm` tall, top-left at (x, y).
fn draw_digits(img: &mut RgbImage, x: f64, y: f64, h_mm: f64, text: &str) {
    let cell = h_mm / 5.0;
    let mut cx = x;
    for ch in text.chars() {
        if let Some(d) = ch.to_digit(10) {
            for (row, line) in DIGITS[d as usize].iter().enumerate() {
                for (col, c) in line.bytes().enumerate() {
                    if c == b'#' {
                        fill(img, cx + col as f64 * cell, y + row as f64 * cell, cell, cell, Rgb([0, 0, 0]));
                    }
                }
            }
        }
        cx += 4.0 * cell;
    }
}

/// The colour chart artwork, 280 x 200 mm at 20 px/mm.
///
/// Top to bottom: C, M, Y, K ramps; R, G, B ramps (11 patches each, 0 to 100 % in
/// 10 % steps, left to right); eight skin tones; black digits at 6, 8, 10 and 12 pt;
/// black lines 0.1 to 1 mm wide (horizontal, then vertical).
pub fn colour_chart_image() -> RgbImage {
    let mut img = RgbImage::from_pixel((COLOUR_W_MM as u32) * PX_PER_MM, (COLOUR_H_MM as u32) * PX_PER_MM, Rgb([255, 255, 255]));
    type Ramp = fn(f64) -> [u8; 3];
    let cmyk: [Ramp; 4] = [
        |t| [(255.0 * (1.0 - t)).round() as u8, 255, 255],
        |t| [255, (255.0 * (1.0 - t)).round() as u8, 255],
        |t| [255, 255, (255.0 * (1.0 - t)).round() as u8],
        |t| [(255.0 * (1.0 - t)).round() as u8; 3],
    ];
    let rgb: [Ramp; 3] = [
        |t| [(255.0 * t).round() as u8, 0, 0],
        |t| [0, (255.0 * t).round() as u8, 0],
        |t| [0, 0, (255.0 * t).round() as u8],
    ];
    for (i, f) in cmyk.iter().enumerate() {
        for s in 0..=10 {
            let c = f(s as f64 / 10.0);
            fill(&mut img, 8.0 + s as f64 * 24.0, i as f64 * 12.0, 24.0, 11.0, Rgb(c));
        }
    }
    for (i, f) in rgb.iter().enumerate() {
        for s in 0..=10 {
            let c = f(s as f64 / 10.0);
            fill(&mut img, 8.0 + s as f64 * 24.0, 52.0 + i as f64 * 12.0, 24.0, 11.0, Rgb(c));
        }
    }
    const SKIN: [[u8; 3]; 8] = [
        [255, 224, 189],
        [241, 194, 125],
        [234, 192, 134],
        [224, 172, 105],
        [198, 134, 66],
        [160, 100, 60],
        [141, 85, 36],
        [92, 58, 36],
    ];
    for (i, c) in SKIN.iter().enumerate() {
        fill(&mut img, 20.0 + i as f64 * 30.0, 92.0, 30.0, 14.0, Rgb(*c));
    }
    for (i, pt) in [6u32, 8, 10, 12].iter().enumerate() {
        let h = 0.7 * *pt as f64 * 25.4 / 72.0; // digit height ~ 0.7 em
        draw_digits(&mut img, 8.0, 112.0 + i as f64 * 10.0, h, &format!("{pt} 0123456789 0123456789"));
    }
    let widths = [0.1, 0.2, 0.3, 0.5, 0.75, 1.0];
    let black = Rgb([0, 0, 0]);
    for (i, w) in widths.iter().enumerate() {
        let (len, wpx) = (60.0, (w * PX_PER_MM as f64).round().max(1.0) as i64);
        let (x, y) = (px(8.0), px(158.0 + i as f64 * 5.0));
        for yy in y..y + wpx {
            for xx in x..x + px(len) {
                img.put_pixel(xx as u32, yy as u32, black);
            }
        }
        let (x, y) = (px(100.0 + i as f64 * 8.0), px(158.0));
        for xx in x..x + wpx {
            for yy in y..y + px(32.0) {
                img.put_pixel(xx as u32, yy as u32, black);
            }
        }
    }
    img
}

fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    !c
}

/// Saves `img` as a PNG that declares its resolution (pHYs), so print software
/// places it at its real size.
pub fn write_png_with_dpi(img: &RgbImage, path: &Path, px_per_m: u32) -> Result<(), EngineError> {
    let mut buf = Vec::new();
    image::codecs::png::PngEncoder::new(&mut buf)
        .write_image(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| EngineError::Decode(e.to_string()))?;
    let mut data = Vec::with_capacity(13);
    data.extend_from_slice(b"pHYs");
    data.extend_from_slice(&px_per_m.to_be_bytes());
    data.extend_from_slice(&px_per_m.to_be_bytes());
    data.push(1);
    let mut chunk = (9u32).to_be_bytes().to_vec();
    chunk.extend_from_slice(&data);
    chunk.extend_from_slice(&crc32(&data).to_be_bytes());
    const AFTER_IHDR: usize = 8 + 25;
    buf.splice(AFTER_IHDR..AFTER_IHDR, chunk);
    let mut f = io(File::create(path))?;
    io(f.write_all(&buf))
}

/// Writes `colour.prn` (rendered by the real pipeline, white layer off) and, when
/// `png` is given, the same artwork as a PNG for printing through Maintop.
pub fn colour_chart(out: &Path, png: Option<&Path>, width_mm: f64) -> Result<(u32, u32), EngineError> {
    if width_mm < COLOUR_W_MM {
        return Err(EngineError::BadSettings(format!("--width-mm must be at least {COLOUR_W_MM}")));
    }
    ensure_parent(out)?;
    let img = colour_chart_image();
    let dir = work_dir(out)?;
    let tmp_png = dir.join("colour.png");
    let result = (|| {
        write_png_with_dpi(&img, &tmp_png, PX_PER_MM * 1000)?;
        if let Some(p) = png {
            ensure_parent(p)?;
            io(std::fs::copy(&tmp_png, p))?;
        }
        let job = JobSpec {
            width_mm,
            x_dpi: X_DPI,
            y_dpi: Y_DPI,
            mirror: false,
            white_enabled: false,
            settings: EngineSettings::default(),
            items: vec![ItemSpec {
                path: tmp_png.clone(),
                x_mm: (width_mm - COLOUR_W_MM) / 2.0,
                y_mm: 0.0,
                width_mm: COLOUR_W_MM,
                height_mm: COLOUR_H_MM,
                rotation_deg: 0.0,
                white_enabled: false,
            }],
        };
        let st = render_prn(&job, out, &mut |_| true)?;
        Ok((st.lines, PrnHeader::for_width(width_mm, X_DPI, Y_DPI, 1).width_px))
    })();
    let _ = std::fs::remove_dir_all(&dir);
    result
}
