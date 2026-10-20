//! Band compositor: places items on the sheet, ink-limits, applies curves,
//! screens and streams PRN lines to disk in bands.
use crate::EngineError;
use crate::colour::ColourSettings;
use crate::prn::{CHANNELS, PrnHeader, PrnWriter, pack_levels};
use crate::screen::{ErrorDiffuser, Screening, apply_curve, screen_row_blue_noise};
use crate::source::{Plane, PreparedSource, prepare};
use crate::spec::{JobSpec, PrnStats};
use crate::white::erode;
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::mpsc::sync_channel;
use std::time::Instant;

/// Lines composited per band.
pub const BAND_LINES: usize = 256;
/// Logical channels K, C, M, Y, W.
const LOGICAL: usize = 5;
const NAMES: [&str; LOGICAL] = ["K", "C", "M", "Y", "W"];

/// Ink limit on K,C,M,Y tones (0..1): if the total exceeds `limit`, C, M and Y
/// are scaled down proportionally; K is kept.
pub fn ink_limit(t: [f32; 4], limit: f32) -> [f32; 4] {
    let [k, c, m, y] = t;
    let cmy = c + m + y;
    if k + cmy <= limit || cmy <= 0.0 {
        return t;
    }
    let s = ((limit - k).max(0.0) / cmy).min(1.0);
    [k, c * s, m * s, y * s]
}

/// Per logical channel (K, C, M, Y, W) blue-noise mask offset (x, y): steps
/// of (73, 151) mod 256, so equal tones in different inks do not print
/// dot-on-dot (R7).
const BN_OFFSET: [(u32, u32); LOGICAL] = [(0, 0), (73, 151), (146, 46), (219, 197), (36, 92)];

/// Screen one row of logical channel `ch` with blue noise.
fn screen_bn(ch: usize, tones: &[u16], row: u32, out: &mut [u8]) {
    let (ox, oy) = BN_OFFSET[ch];
    screen_row_blue_noise(tones, row.wrapping_add(oy), ox, out);
}

/// Runs `f`, turning a panic into `EngineError::Internal`.
fn guarded<T>(f: impl FnOnce() -> Result<T, EngineError>) -> Result<T, EngineError> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or_else(|p| Err(panic_error(p)))
}

fn panic_error(p: Box<dyn std::any::Any + Send>) -> EngineError {
    let msg = p
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into());
    EngineError::Internal(msg)
}

/// PRN channel index -> logical channel index.
fn channel_map(order: &[String; CHANNELS]) -> Result<[usize; CHANNELS], EngineError> {
    let mut map = [0; CHANNELS];
    for (m, name) in map.iter_mut().zip(order) {
        *m = NAMES
            .iter()
            .position(|n| n.eq_ignore_ascii_case(name.trim()))
            .ok_or_else(|| EngineError::BadSettings(format!("unknown ink channel \"{name}\"")))?;
    }
    Ok(map)
}

/// Item placement in sheet millimetres. Maps an output position to the
/// item's un-rotated frame: `u_mm = a + cos*x + sin*y`, `v_mm = b - sin*x + cos*y`.
struct Geom {
    width_mm: f64,
    height_mm: f64,
    cos: f64,
    sin: f64,
    a: f64,
    b: f64,
    top_mm: f64,
    bottom_mm: f64,
}

impl Geom {
    fn new(x: f64, y: f64, w: f64, h: f64, rot_deg: f64) -> Self {
        let (mut sin, mut cos) = rot_deg.to_radians().sin_cos();
        if rot_deg.rem_euclid(90.0) == 0.0 {
            (sin, cos) = (sin.round(), cos.round());
        }
        let (cx, cy) = (x + w / 2.0, y + h / 2.0);
        let half_h = (w * sin.abs() + h * cos.abs()) / 2.0;
        Geom {
            width_mm: w,
            height_mm: h,
            cos,
            sin,
            // q = c + R(-θ)(p - c), relative to the item's top-left
            a: cx - x - cos * cx - sin * cy,
            b: cy - y + sin * cx - cos * cy,
            top_mm: cy - half_h,
            bottom_mm: cy + half_h,
        }
    }
}

/// An item ready to sample during one band.
struct View<'a> {
    g: &'a Geom,
    w: usize,
    h: usize,
    /// K, C, M, Y, W (choked), alpha — all premultiplied by alpha.
    planes: [&'a [u16]; 6],
}

struct Ctx {
    width: usize,
    dx: f64,
    dy: f64,
    mirror: bool,
    limit: f32,
    luts: Option<Vec<Vec<u16>>>,
}

/// Composite sheet line `line` into `tones` (LOGICAL planes of `width`, in
/// output order, i.e. mirrored when asked). Returns false if nothing touched it.
fn composite_row(
    views: &[View],
    ctx: &Ctx,
    line: i64,
    acc: &mut [[f32; LOGICAL]],
    tones: &mut [u16],
) -> bool {
    tones.fill(0);
    let py = (line as f64 + 0.5) * ctx.dy;
    let x0 = 0.5 * ctx.dx;
    // Per view: (u at px 0, du, v at px 0, dv, px range).
    let mut spans: Vec<(f64, f64, f64, f64, usize, usize)> = Vec::with_capacity(views.len());
    let (mut lo, mut hi) = (usize::MAX, 0usize);
    for v in views {
        let g = v.g;
        let (sx, sy) = (v.w as f64 / g.width_mm, v.h as f64 / g.height_mm);
        let u0 = sx * (g.a + g.cos * x0 + g.sin * py);
        let du = sx * g.cos * ctx.dx;
        let v0 = sy * (g.b - g.sin * x0 + g.cos * py);
        let dv = -sy * g.sin * ctx.dx;
        let (mut s, mut e) = (0.0f64, ctx.width as f64);
        for (c, d, len) in [(u0, du, v.w as f64), (v0, dv, v.h as f64)] {
            if d.abs() < 1e-12 {
                if c < 0.0 || c >= len {
                    e = s;
                }
            } else {
                let (t0, t1) = ((0.0 - c) / d, (len - c) / d);
                s = s.max(t0.min(t1).floor());
                e = e.min(t0.max(t1).ceil() + 1.0);
            }
        }
        let s = s.clamp(0.0, ctx.width as f64) as usize;
        let e = (e.clamp(0.0, ctx.width as f64) as usize).max(s); // empty when the row misses the item
        if s < e {
            lo = lo.min(s);
            hi = hi.max(e);
        }
        spans.push((u0, du, v0, dv, s, e));
    }
    if lo >= hi {
        return false;
    }
    acc[lo..hi].fill([0.0; LOGICAL]);
    for (v, &(u0, du, v0, dv, s, e)) in views.iter().zip(&spans) {
        let (w, h) = (v.w, v.h);
        let (wf, hf) = (w as f64, h as f64);
        for (i, o) in acc[s..e].iter_mut().enumerate() {
            let px = s + i;
            let (u, vv) = (u0 + du * px as f64, v0 + dv * px as f64);
            if !(u >= 0.0 && u < wf && vv >= 0.0 && vv < hf) {
                continue;
            }
            // Bilinear between pixel centres, clamped inside the image.
            let fx = (u - 0.5).max(0.0);
            let fy = (vv - 0.5).max(0.0);
            let (xa, ya) = ((fx as usize).min(w - 1), (fy as usize).min(h - 1));
            let (tx, ty) = ((fx - xa as f64) as f32, (fy - ya as f64) as f32);
            let (xb, yb) = ((xa + 1).min(w - 1), (ya + 1).min(h - 1));
            let (i00, i01, i10, i11) = (ya * w + xa, ya * w + xb, yb * w + xa, yb * w + xb);
            let k = 1.0 / 65535.0;
            let (w00, w01) = ((1.0 - tx) * (1.0 - ty) * k, tx * (1.0 - ty) * k);
            let (w10, w11) = ((1.0 - tx) * ty * k, tx * ty * k);
            let smp = |p: &[u16]| {
                p[i00] as f32 * w00
                    + p[i01] as f32 * w01
                    + p[i10] as f32 * w10
                    + p[i11] as f32 * w11
            };
            let a = smp(v.planes[5]);
            if a <= 0.0 {
                continue;
            }
            for (c, oc) in o.iter_mut().enumerate() {
                *oc = smp(v.planes[c]) + *oc * (1.0 - a);
            }
        }
    }
    let w = ctx.width;
    for (px, t) in acc[lo..hi].iter().enumerate().map(|(i, t)| (i + lo, t)) {
        let [k, c, m, y] = ink_limit([t[0], t[1], t[2], t[3]], ctx.limit);
        let mut q = [k, c, m, y, t[4]].map(|v| (v.clamp(0.0, 1.0) * 65535.0).round() as u16);
        if let Some(l) = &ctx.luts {
            for (ch, v) in q.iter_mut().enumerate() {
                *v = l[ch][*v as usize];
            }
        }
        let ox = if ctx.mirror { w - 1 - px } else { px };
        for (ch, v) in q.into_iter().enumerate() {
            tones[ch * w + ox] = v;
        }
    }
    true
}

type SrcKey = (PathBuf, bool);
/// Source key plus choke radii (rx, ry) in source pixels.
type ChokeKey = (SrcKey, (u32, u32));

struct Placed {
    g: Geom,
    key: SrcKey,
    first_band: usize,
    last_band: usize,
}

/// Renders `job` to a PRN at `out` (written to `<out>.part`, renamed when
/// complete). `progress` is called after each band with the fraction done
/// (the last call is exactly 1.0); returning `false` cancels — including on
/// that final call, which still deletes the file — and yields
/// `EngineError::Cancelled`. Any error or panic removes the `.part` file.
pub fn render_prn(
    job: &JobSpec,
    out: &Path,
    progress: &mut dyn FnMut(f32) -> bool,
) -> Result<PrnStats, EngineError> {
    let started = Instant::now();
    if job.items.is_empty() {
        return Err(EngineError::NothingToPrint);
    }
    let bad = |m: &str| Err(EngineError::BadSettings(m.into()));
    if !(job.width_mm.is_finite() && job.width_mm > 0.0) || job.x_dpi == 0 || job.y_dpi == 0 {
        return bad("sheet width and resolution must be positive");
    }
    if job
        .items
        .iter()
        .any(|i| !(i.width_mm > 0.0 && i.height_mm > 0.0))
    {
        return bad("every design needs a positive width and height");
    }
    let s = &job.settings;
    let map = channel_map(&s.channel_order)?;
    let (dx, dy) = (25.4 / job.x_dpi as f64, 25.4 / job.y_dpi as f64);

    let geoms: Vec<Geom> = job
        .items
        .iter()
        .map(|i| Geom::new(i.x_mm, i.y_mm, i.width_mm, i.height_mm, i.rotation_deg))
        .collect();
    let top = geoms.iter().map(|g| g.top_mm).fold(f64::INFINITY, f64::min);
    let bottom = geoms
        .iter()
        .map(|g| g.bottom_mm)
        .fold(f64::NEG_INFINITY, f64::max);
    let lead = (s.lead_in_mm.max(0.0) as f64 / dy).ceil() as i64;
    let first_line = (top / dy).floor() as i64 - lead;
    let lines = (bottom / dy).ceil() as i64 - (top / dy).floor() as i64 + lead;
    if lines <= 0 || lines > u32::MAX as i64 {
        return bad("the print length is out of range");
    }
    let header = PrnHeader::for_width(job.width_mm, job.x_dpi, job.y_dpi, lines as u32);
    let width = header.width_px as usize;
    if width == 0 {
        return bad("the sheet is narrower than one pixel");
    }
    let bpl = header.bytes_per_line as usize;
    let n_bands = (lines as usize).div_ceil(BAND_LINES);
    let bytes = 48 + lines as u64 * CHANNELS as u64 * bpl as u64;

    let band_of =
        |mm: f64| ((mm / dy).floor() as i64 - first_line).clamp(0, lines - 1) as usize / BAND_LINES;
    let placed: Vec<Placed> = job
        .items
        .iter()
        .zip(geoms)
        .map(|(i, g)| Placed {
            key: (i.path.clone(), job.white_enabled && i.white_enabled),
            first_band: band_of(g.top_mm),
            last_band: band_of(g.bottom_mm),
            g,
        })
        .collect();
    let mut last_use: HashMap<SrcKey, usize> = HashMap::new();
    for p in &placed {
        let e = last_use.entry(p.key.clone()).or_insert(0);
        *e = (*e).max(p.last_band);
    }

    let ctx = Ctx {
        width,
        dx,
        dy,
        mirror: job.mirror,
        limit: s.ink_limit_pct / 100.0,
        luts: s.curves.as_ref().map(|cs| {
            cs.iter()
                .map(|c| (0..=65535u16).map(|t| apply_curve(t, c)).collect())
                .collect()
        }),
    };
    let colour = ColourSettings::from(s);
    let choke_mm = s.white_choke_mm.max(0.0) as f64;

    let mut part = out.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    let file = File::create(&part)?;

    let result: Result<(), EngineError> = guarded(|| std::thread::scope(|scope| {
        let (tx, rx) = sync_channel::<Vec<u8>>(1);
        let writer = scope.spawn(move || -> Result<(), EngineError> {
            let mut w = PrnWriter::new(BufWriter::with_capacity(1 << 20, file), header)?;
            for buf in rx {
                w.write_packed_lines(&buf)?;
            }
            w.finish()?;
            Ok(())
        });

        let produce = || -> Result<(), EngineError> {
            let tx = tx; // dropped when production ends, which ends the writer
            let mut sources: HashMap<SrcKey, PreparedSource> = HashMap::new();
            let mut choked: HashMap<ChokeKey, Plane> = HashMap::new();
            let mut diffusers: Vec<ErrorDiffuser> = match s.screening {
                Screening::ErrorDiffusion => {
                    (0..LOGICAL).map(|_| ErrorDiffuser::new(width)).collect()
                }
                Screening::BlueNoise => Vec::new(),
            };
            let mut tones: Vec<u16> = Vec::new();
            let mut levels: Vec<Vec<u8>> = Vec::new();
            for band in 0..n_bands {
                let active: Vec<&Placed> = placed
                    .iter()
                    .filter(|p| p.first_band <= band && band <= p.last_band)
                    .collect();
                // Decode sources first needed in this band (in parallel).
                let mut missing: Vec<&SrcKey> = active
                    .iter()
                    .map(|p| &p.key)
                    .filter(|k| !sources.contains_key(*k))
                    .collect();
                missing.sort();
                missing.dedup();
                let loaded: Vec<(SrcKey, PreparedSource)> = missing
                    .par_iter()
                    .map(|k| Ok(((*k).clone(), prepare(&k.0, &colour, k.1)?)))
                    .collect::<Result<_, EngineError>>()?;
                sources.extend(loaded);
                // Choke (R6): radii in source pixels, per item size (x from width, y from height).
                let radius = |p: &Placed| -> (u32, u32) {
                    let src = &sources[&p.key];
                    if !p.key.1 || choke_mm <= 0.0 {
                        return (0, 0);
                    }
                    let r = |px: u32, mm: f64| (choke_mm * px as f64 / mm).round() as u32;
                    (r(src.w, p.g.width_mm), r(src.h, p.g.height_mm))
                };
                let mut need: Vec<ChokeKey> = active
                    .iter()
                    .map(|p| (p.key.clone(), radius(p)))
                    .filter(|k| k.1 != (0, 0) && !choked.contains_key(k))
                    .collect();
                need.sort();
                need.dedup();
                let eroded: Vec<(ChokeKey, Plane)> = need
                    .into_par_iter()
                    .map(|k| {
                        let e = erode(&sources[&k.0].white, k.1.0, k.1.1);
                        (k, e)
                    })
                    .collect();
                choked.extend(eroded);

                let views: Vec<View> = active
                    .iter()
                    .map(|p| {
                        let src = &sources[&p.key];
                        let r = radius(p);
                        let white = if r != (0, 0) {
                            &choked[&(p.key.clone(), r)]
                        } else {
                            &src.white
                        };
                        View {
                            g: &p.g,
                            w: src.w as usize,
                            h: src.h as usize,
                            planes: [
                                &src.ink[0].data,
                                &src.ink[1].data,
                                &src.ink[2].data,
                                &src.ink[3].data,
                                &white.data,
                                &src.alpha.data,
                            ],
                        }
                    })
                    .collect();
                let views: Vec<View> = views.into_iter().filter(|v| v.w > 0 && v.h > 0).collect();

                let row0 = band * BAND_LINES;
                let bh = BAND_LINES.min(lines as usize - row0);
                let line_bytes = CHANNELS * bpl;
                let mut buf = vec![0u8; bh * line_bytes];
                let scratch = || {
                    (
                        vec![[0.0f32; LOGICAL]; width],
                        vec![0u16; LOGICAL * width],
                        vec![0u8; LOGICAL * width],
                    )
                };
                match s.screening {
                    Screening::BlueNoise => {
                        buf.par_chunks_mut(line_bytes).enumerate().for_each_init(
                            scratch,
                            |(acc, t, lv), (r, line)| {
                                let row = row0 + r;
                                if !composite_row(&views, &ctx, first_line + row as i64, acc, t) {
                                    return; // blank line stays zero
                                }
                                for ch in 0..LOGICAL {
                                    let span = ch * width..(ch + 1) * width;
                                    screen_bn(ch, &t[span.clone()], row as u32, &mut lv[span]);
                                }
                                for (pc, &l) in map.iter().enumerate() {
                                    pack_levels(
                                        &lv[l * width..(l + 1) * width],
                                        &mut line[pc * bpl..(pc + 1) * bpl],
                                    );
                                }
                            },
                        );
                    }
                    Screening::ErrorDiffusion => {
                        tones.resize(bh * LOGICAL * width, 0);
                        tones
                            .par_chunks_mut(LOGICAL * width)
                            .enumerate()
                            .for_each_init(
                                || vec![[0.0f32; LOGICAL]; width],
                                |acc, (r, t)| {
                                    composite_row(
                                        &views,
                                        &ctx,
                                        first_line + (row0 + r) as i64,
                                        acc,
                                        t,
                                    );
                                },
                            );
                        levels.resize_with(LOGICAL, Vec::new);
                        let tones = &tones;
                        diffusers
                            .par_iter_mut()
                            .zip(levels.par_iter_mut())
                            .enumerate()
                            .for_each(|(ch, (d, lv))| {
                                lv.resize(bh * width, 0);
                                for r in 0..bh {
                                    let t = &tones[(r * LOGICAL + ch) * width..][..width];
                                    d.process_row(t, &mut lv[r * width..(r + 1) * width]);
                                }
                            });
                        let levels = &levels;
                        buf.par_chunks_mut(line_bytes)
                            .enumerate()
                            .for_each(|(r, line)| {
                                for (pc, &l) in map.iter().enumerate() {
                                    pack_levels(
                                        &levels[l][r * width..(r + 1) * width],
                                        &mut line[pc * bpl..(pc + 1) * bpl],
                                    );
                                }
                            });
                    }
                }
                drop(views);
                if tx.send(buf).is_err() {
                    return Ok(()); // the writer failed; its error is reported on join
                }
                sources.retain(|k, _| last_use[k] > band);
                choked.retain(|k, _| sources.contains_key(&k.0));
                if !progress((band + 1) as f32 / n_bands as f32) {
                    return Err(EngineError::Cancelled);
                }
            }
            Ok(())
        };
        let produced = guarded(produce);
        let written = writer.join().unwrap_or_else(|p| Err(panic_error(p)));
        match produced {
            Err(e) => Err(e),
            Ok(()) => written,
        }
    }));

    if let Err(e) = result {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    std::fs::rename(&part, out)?;
    Ok(PrnStats {
        lines: lines as u32,
        bytes,
        millis: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ink_limit_scales_cmy_and_keeps_k() {
        let t = ink_limit([1.0, 1.0, 1.0, 1.0], 2.0);
        assert!((t.iter().sum::<f32>() - 2.0).abs() < 1e-5, "{t:?}");
        assert_eq!(t[0], 1.0);
        assert!((t[1] - 1.0 / 3.0).abs() < 1e-5 && t[1] == t[2] && t[2] == t[3]);
        // dark brown, uneven CMY: proportions kept
        let t = ink_limit([0.6, 0.5, 0.9, 1.0], 2.0);
        assert!(t.iter().sum::<f32>() <= 2.0 + 1e-5, "{t:?}");
        assert!((t[2] / t[1] - 1.8).abs() < 1e-4 && (t[3] / t[1] - 2.0).abs() < 1e-4);
        // under the limit: unchanged
        assert_eq!(ink_limit([0.2, 0.3, 0.4, 0.5], 2.0), [0.2, 0.3, 0.4, 0.5]);
    }

    #[test]
    fn blue_noise_channels_do_not_stack_dot_on_dot() {
        let n = 256usize;
        for tone in [16384u16, 32768, 49152] {
            let t = vec![tone; n];
            let want = tone as f64 / 65535.0;
            let mut outs = vec![vec![0u8; n]; LOGICAL];
            let mut sums = [0u64; LOGICAL];
            let mut differ = [0usize; LOGICAL];
            for row in 0..n as u32 {
                for (ch, o) in outs.iter_mut().enumerate() {
                    screen_bn(ch, &t, row, o);
                    sums[ch] += o.iter().map(|&v| v as u64).sum::<u64>();
                }
                for ch in 1..LOGICAL {
                    differ[ch] += outs[0].iter().zip(&outs[ch]).filter(|(a, b)| a != b).count();
                }
            }
            for (ch, sum) in sums.iter().enumerate() {
                let mean = *sum as f64 / (n * n * 3) as f64;
                assert!((mean - want).abs() < 0.01, "ch {ch} tone {tone}: mean {mean}");
            }
            for (ch, d) in differ.iter().enumerate().skip(1) {
                assert!(*d > n * n / 4, "ch {ch} tone {tone}: only {d} pixels differ from K");
            }
        }
    }

    #[test]
    fn panics_become_internal_errors() {
        let r: Result<(), EngineError> = guarded(|| panic!("boom"));
        assert!(matches!(&r, Err(EngineError::Internal(m)) if m.contains("boom")), "{r:?}");
        assert!(matches!(guarded(|| Ok(7)), Ok(7)));
    }
}
