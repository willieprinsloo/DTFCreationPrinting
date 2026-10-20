//! prn-tool: inspect / preview / generate test charts for fyft PRN files.
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use dtf_engine::EngineError;
use dtf_engine::prn::{PrnHeader, PrnWriter};

const HEADER_LEN: u64 = 48;
const CH: usize = 6;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let r = match args.first().map(String::as_str) {
        Some("inspect") if args.len() == 2 => inspect(Path::new(&args[1])),
        Some("preview") if args.len() >= 3 => preview(&args[1..]),
        Some("chart") if args.len() >= 3 && args[1] == "channels" => chart_channels(&args[2..]),
        Some("chart") if args.len() >= 3 && args[1] == "white" => chart_white(&args[2..]),
        Some("chart") if args.len() >= 3 && args[1] == "colour" => chart_colour(&args[2..]),
        _ => Err(USAGE.into()),
    };
    match r {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("prn-tool: {e}");
            ExitCode::FAILURE
        }
    }
}

const USAGE: &str = "usage:\n  prn-tool inspect <file>\n  prn-tool preview <file> <out.png> [--scale 0.1]\n  prn-tool chart channels <out.prn> [--width-mm 600]\n  prn-tool chart white <out.prn> [--width-mm 600]\n  prn-tool chart colour <out.prn> [--png chart.png] [--width-mm 600]";

type R<T> = Result<T, Box<dyn std::error::Error>>;

fn open(path: &Path) -> R<(File, PrnHeader)> {
    let mut f = File::open(path)?;
    let mut hb = [0u8; HEADER_LEN as usize];
    let mut n = 0;
    while n < hb.len() {
        let r = f.read(&mut hb[n..])?;
        if r == 0 {
            break;
        }
        n += r;
    }
    let h = PrnHeader::parse(&hb[..n]).map_err(|e: EngineError| e.to_string())?;
    Ok((f, h))
}

/// Count non-zero 2-bit pixels in packed bytes.
fn nonzero_pixels(bytes: &[u8]) -> u64 {
    bytes.iter().map(|&b| ((b | (b >> 1)) & 0x55).count_ones() as u64).sum()
}

fn inspect(path: &Path) -> R<()> {
    let (f, h) = open(path)?;
    let file_len = f.metadata()?.len();
    let mut rd = BufReader::with_capacity(1 << 20, f);
    rd.seek(SeekFrom::Start(HEADER_LEN))?;
    let bpl = h.bytes_per_line as usize;
    let expected = HEADER_LEN + h.lines as u64 * CH as u64 * bpl as u64;
    let mut buf = vec![0u8; bpl];
    let mut ink = [0u64; CH];
    let (mut first, mut last) = (None::<u32>, 0u32);
    for line in 0..h.lines {
        let mut any = false;
        for (c, total) in ink.iter_mut().enumerate() {
            if rd.read_exact(&mut buf).is_err() {
                return Err(format!("file ends early: line {line} channel {c} is missing (expected {expected} bytes, file has {file_len})").into());
            }
            let n = nonzero_pixels(&buf);
            *total += n;
            any |= n > 0;
        }
        if any {
            first.get_or_insert(line);
            last = line;
        }
    }
    println!("file: {}", path.display());
    println!("size: {file_len} bytes (header says {expected}){}", if file_len == expected { "" } else { "  ** MISMATCH **" });
    println!("resolution: {} x {} dpi", h.x_dpi, h.y_dpi);
    println!("width px: {}  ({:.1} mm; header width {:.6} m)", h.width_px, h.width_px as f64 / h.x_dpi as f64 * 25.4, h.width_m);
    println!("lines: {}  ({:.1} mm)", h.lines, h.lines as f64 / h.y_dpi as f64 * 25.4);
    println!("bytes per line per channel: {}", h.bytes_per_line);
    println!("channels: {}  (flag {}, field {})", h.channels, h.flag_1e, h.field_20);
    let total = h.width_px as f64 * h.lines as f64;
    for (c, n) in ink.iter().enumerate() {
        println!("ch{c} coverage: {:.3}%", *n as f64 / total * 100.0);
    }
    match first {
        Some(f0) => println!("content lines: {f0}..={last} ({} lines, {:.1} mm)", last - f0 + 1, (last - f0 + 1) as f64 / h.y_dpi as f64 * 25.4),
        None => println!("content lines: none (file is blank)"),
    }
    Ok(())
}

fn flag_value(args: &[String], name: &str) -> R<Option<f64>> {
    match args.iter().position(|a| a == name) {
        None => Ok(None),
        Some(i) => Ok(Some(args.get(i + 1).ok_or(format!("{name} needs a value"))?.parse()?)),
    }
}

fn preview(args: &[String]) -> R<()> {
    let (src, out) = (Path::new(&args[0]), Path::new(&args[1]));
    let scale = flag_value(args, "--scale")?.unwrap_or(0.1);
    if !(scale > 0.0 && scale <= 1.0) {
        return Err("--scale must be between 0 and 1".into());
    }
    let (f, h) = open(src)?;
    let mut rd = BufReader::new(f);
    let step_x = ((1.0 / scale).round() as u32).max(1);
    let step_y = ((step_x as f64 * h.y_dpi as f64 / h.x_dpi as f64).round() as u32).max(1);
    let w = h.width_px.div_ceil(step_x);
    let ht = h.lines.div_ceil(step_y);
    const DIVIDER: u32 = 8;
    let mut img = image::RgbImage::from_pixel(w * 2 + DIVIDER, ht, image::Rgb([128, 128, 128]));
    let bpl = h.bytes_per_line as usize;
    let mut buf = vec![0u8; bpl * CH];
    let level = |ch: usize, x: u32, buf: &[u8]| -> f32 {
        let i = (x * step_x) as usize;
        ((buf[ch * bpl + i / 4] >> (6 - 2 * (i % 4))) & 3) as f32 / 3.0
    };
    for row in 0..ht {
        let line = row * step_y;
        rd.seek(SeekFrom::Start(HEADER_LEN + line as u64 * (CH * bpl) as u64))?;
        rd.read_exact(&mut buf)?;
        for x in 0..w {
            // default channel order K C M Y W W (unconfirmed until Checkpoint 1)
            let (k, c, m, y) = (level(0, x, &buf), level(1, x, &buf), level(2, x, &buf), level(3, x, &buf));
            let px = |v: f32, ink: f32| (255.0 * (1.0 - ink) * (1.0 - v) + 0.5) as u8;
            img.put_pixel(x, row, image::Rgb([px(c, k), px(m, k), px(y, k)]));
            let white = level(4, x, &buf).max(level(5, x, &buf));
            let g = (128.0 + 127.0 * white) as u8;
            img.put_pixel(w + DIVIDER + x, row, image::Rgb([g, g, g]));
        }
    }
    img.save(out)?;
    println!("wrote {} ({}x{})", out.display(), img.width(), img.height());
    Ok(())
}

// ---- chart channels ----

const SQUARE_MM: f64 = 80.0;
const CHART_H_MM: f64 = 120.0;
const TOP_MM: f64 = 0.0;
const LABEL_TOP_MM: f64 = 110.0; // glyphs end at the 120 mm bottom, so the file is trimmed
const GLYPH_H_MM: f64 = 10.0;
const CELL_MM: f64 = 2.0; // 3x5 glyph grid, 2 mm cells -> 6 x 10 mm

const DIGITS: [[&str; 5]; 6] = [
    ["###", "#.#", "#.#", "#.#", "###"],
    [".#.", "##.", ".#.", ".#.", "###"],
    ["###", "..#", "###", "#..", "###"],
    ["###", "..#", "###", "..#", "###"],
    ["#.#", "#.#", "###", "..#", "..#"],
    ["###", "#..", "###", "..#", "###"],
];

fn chart_channels(args: &[String]) -> R<()> {
    let out = PathBuf::from(&args[0]);
    let width_mm = flag_value(args, "--width-mm")?.unwrap_or(600.0);
    let gap = (width_mm - 6.0 * SQUARE_MM) / 7.0;
    if gap < 1.0 {
        return Err("--width-mm must be at least 490".into());
    }
    let (xd, yd) = (720u32, 1800u32);
    let px_x = |mm: f64| (mm / 25.4 * xd as f64).round() as usize;
    let px_y = |mm: f64| (mm / 25.4 * yd as f64).round() as u32;
    let lines = (CHART_H_MM / 25.4 * yd as f64).ceil() as u32;
    let header = PrnHeader::for_width(width_mm, xd, yd, lines);
    let w = header.width_px as usize;

    let (sq_y0, sq_y1) = (px_y(TOP_MM), px_y(TOP_MM + SQUARE_MM));
    let (gl_y0, gl_y1) = (px_y(LABEL_TOP_MM), px_y(LABEL_TOP_MM + GLYPH_H_MM));
    let sq_x: Vec<(usize, usize)> = (0..6)
        .map(|i| {
            let x = gap + i as f64 * (SQUARE_MM + gap);
            (px_x(x), px_x(x + SQUARE_MM))
        })
        .collect();

    let part = PathBuf::from(format!("{}.part", out.display()));
    if let Some(dir) = out.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir)?;
    }
    let file = std::io::BufWriter::with_capacity(1 << 20, File::create(&part)?);
    let mut wr = PrnWriter::new(file, header).map_err(|e| e.to_string())?;
    let mut bufs: [Vec<u8>; CH] = std::array::from_fn(|_| vec![0u8; w]);
    for y in 0..lines {
        for b in bufs.iter_mut() {
            b.fill(0);
        }
        if (sq_y0..sq_y1).contains(&y) {
            for (i, &(x0, x1)) in sq_x.iter().enumerate() {
                bufs[i][x0..x1].fill(3);
            }
        }
        if (gl_y0..gl_y1).contains(&y) {
            let row = (((y - gl_y0) as f64 * 25.4 / yd as f64) / CELL_MM) as usize;
            let row = row.min(4);
            for (i, &(x0, _)) in sq_x.iter().enumerate() {
                let gx = x0 + px_x((SQUARE_MM - 3.0 * CELL_MM) / 2.0);
                for (cx, c) in DIGITS[i][row].bytes().enumerate() {
                    if c == b'#' {
                        bufs[i][gx + px_x(cx as f64 * CELL_MM)..gx + px_x((cx + 1) as f64 * CELL_MM)].fill(3);
                    }
                }
            }
        }
        let refs: [&[u8]; CH] = std::array::from_fn(|c| bufs[c].as_slice());
        wr.write_line(&refs).map_err(|e| e.to_string())?;
    }
    wr.finish().map_err(|e| e.to_string())?;
    std::fs::rename(&part, &out)?;
    println!("wrote {} ({} lines x {} px)", out.display(), lines, w);
    Ok(())
}

fn str_flag<'a>(args: &'a [String], name: &str) -> R<Option<&'a str>> {
    match args.iter().position(|a| a == name) {
        None => Ok(None),
        Some(i) => Ok(Some(args.get(i + 1).ok_or(format!("{name} needs a value"))?.as_str())),
    }
}

fn chart_white(args: &[String]) -> R<()> {
    let out = PathBuf::from(&args[0]);
    let width_mm = flag_value(args, "--width-mm")?.unwrap_or(600.0);
    let (lines, w) = dtf_engine::charts::white_chart(&out, width_mm).map_err(|e| e.to_string())?;
    println!("wrote {} ({} lines x {} px)", out.display(), lines, w);
    println!("rows (top to bottom): white density 60, 80, 100 %; columns (left to right): choke 0, 0.1, 0.2, 0.4 mm");
    Ok(())
}

fn chart_colour(args: &[String]) -> R<()> {
    let out = PathBuf::from(&args[0]);
    let width_mm = flag_value(args, "--width-mm")?.unwrap_or(600.0);
    let png = str_flag(args, "--png")?.map(PathBuf::from);
    let (lines, w) = dtf_engine::charts::colour_chart(&out, png.as_deref(), width_mm).map_err(|e| e.to_string())?;
    println!("wrote {} ({} lines x {} px)", out.display(), lines, w);
    if let Some(p) = png {
        println!("wrote {} (280 x 200 mm at 508 dpi; print at 100 % size)", p.display());
    }
    Ok(())
}
