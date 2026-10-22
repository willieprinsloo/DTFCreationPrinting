use dtf_engine::prn::PrnReader;
use dtf_engine::screen::Screening;
use dtf_engine::{EngineError, EngineSettings, ItemSpec, JobSpec, render_prn};
use image::{ImageBuffer, Rgba};
use std::path::{Path, PathBuf};

const K: usize = 0;
const M: usize = 2;
const W1: usize = 4;
const W2: usize = 5;

fn png(dir: &Path, name: &str, w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> PathBuf {
    let p = dir.join(name);
    ImageBuffer::from_fn(w, h, |x, y| Rgba(f(x, y)))
        .save(&p)
        .unwrap();
    p
}

fn item(path: &Path, x: f64, y: f64, w: f64, h: f64, rot: f64) -> ItemSpec {
    ItemSpec {
        path: path.to_path_buf(),
        x_mm: x,
        y_mm: y,
        width_mm: w,
        height_mm: h,
        rotation_deg: rot,
        white_enabled: false,
    }
}

fn job(items: Vec<ItemSpec>) -> JobSpec {
    JobSpec {
        width_mm: 600.0,
        x_dpi: 720,
        y_dpi: 1800,
        mirror: false,
        white_enabled: false,
        // These tests read black from channel 0; the printer's own order is checked below.
        settings: EngineSettings { channel_order: ["K", "C", "M", "Y", "W", "W"].map(String::from), ..EngineSettings::default() },
        items,
    }
}

fn render(j: &JobSpec, dir: &Path) -> PathBuf {
    let out = dir.join("out.prn");
    render_prn(j, &out, &mut |_| true).unwrap();
    out
}

/// Per channel: (first line, last line, min x, max x) of non-zero levels.
type Extent = Option<(u32, u32, usize, usize)>;
fn extents(prn: &Path) -> (u32, [Extent; 6]) {
    let mut r = PrnReader::open(prn).unwrap();
    let lines = r.header().lines;
    let mut ext: [Extent; 6] = [None; 6];
    for i in 0..lines {
        let l = r.read_line(i).unwrap();
        for (ch, lv) in l.iter().enumerate() {
            let (Some(a), Some(b)) = (
                lv.iter().position(|&v| v != 0),
                lv.iter().rposition(|&v| v != 0),
            ) else {
                continue;
            };
            ext[ch] = Some(match ext[ch] {
                None => (i, i, a, b),
                Some((f, _, mn, mx)) => (f, i, mn.min(a), mx.max(b)),
            });
        }
    }
    (lines, ext)
}

fn close(a: usize, b: usize, tol: usize) -> bool {
    a.abs_diff(b) <= tol
}

const BLACK: [u8; 4] = [0, 0, 0, 255];
const RED: [u8; 4] = [255, 0, 0, 255];

#[test]
fn single_black_square_golden() {
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let (lines, ext) = extents(&render(
        &job(vec![item(&p, 5.0, 5.0, 10.0, 10.0, 0.0)]),
        d.path(),
    ));
    assert_eq!(lines, 709);
    let (f, l, a, b) = ext[K].unwrap();
    assert!(f <= 1 && l >= 707, "K lines {f}..{l}");
    // x range [141, 141+283)
    assert!(close(a, 141, 1) && close(b + 1, 424, 1), "K x {a}..{b}");
    for (ch, e) in ext.iter().enumerate().skip(1) {
        assert!(e.is_none(), "channel {ch} has ink");
    }
}

#[test]
fn mirror_flips_about_sheet_width() {
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let mut j = job(vec![item(&p, 5.0, 5.0, 10.0, 10.0, 0.0)]);
    j.mirror = true;
    let (_, ext) = extents(&render(&j, d.path()));
    let (_, _, a, b) = ext[K].unwrap();
    assert!(
        close(a, 17007 - 424, 1) && close(b + 1, 17007 - 141, 1),
        "K x {a}..{b}"
    );
}

#[test]
fn rotated_90_clockwise_is_10_wide_20_tall_with_left_edge_on_top() {
    let d = tempfile::tempdir().unwrap();
    // 20x10 mm item: left half black, right half red.
    let p = png(d.path(), "r.png", 200, 100, |x, _| {
        if x < 100 { BLACK } else { RED }
    });
    let (lines, ext) = extents(&render(
        &job(vec![item(&p, 50.0, 50.0, 20.0, 10.0, 90.0)]),
        d.path(),
    ));
    assert_eq!(lines, 1419); // ceil(65/dy) - floor(45/dy) = 4607 - 3188
    let (kf, kl, ka, kb) = ext[K].unwrap();
    let (mf, ml, ma, mb) = ext[M].unwrap();
    // footprint 10 mm wide: centre x 60 mm -> 55..65 mm -> px 1559..1842
    assert!(
        close(ka, 1559, 1) && close(kb + 1, 1842, 1),
        "K x {ka}..{kb}"
    );
    assert!(
        close(ma, 1559, 1) && close(mb + 1, 1842, 1),
        "M x {ma}..{mb}"
    );
    // clockwise: the left (black) half goes to the top. The black/red seam is
    // at line ~709; bilinear blends +-0.5 source px (0.05 mm = 3.5 lines) across it.
    assert!(kf <= 1 && close(kl as usize, 709, 4), "K lines {kf}..{kl}");
    assert!(
        close(mf as usize, 709, 4) && ml >= 1416,
        "M lines {mf}..{ml}"
    );
}

#[test]
fn half_turn_puts_the_left_half_on_the_right_and_the_top_at_the_bottom() {
    let d = tempfile::tempdir().unwrap();
    // 20x10 mm item: top-left quarter black, the rest red.
    let p = png(d.path(), "q.png", 200, 100, |x, y| {
        if x < 100 && y < 50 { BLACK } else { RED }
    });
    let (lines, ext) = extents(&render(
        &job(vec![item(&p, 50.0, 50.0, 20.0, 10.0, 180.0)]),
        d.path(),
    ));
    assert_eq!(lines, 709);
    let (kf, kl, ka, kb) = ext[K].unwrap();
    // black lands in the bottom-right quarter: x 60..70 mm -> px 1701..1984, lines ~354..709
    assert!(close(ka, 1701, 4) && close(kb + 1, 1984, 1), "K x {ka}..{kb}");
    assert!(close(kf as usize, 354, 4) && kl >= 707, "K lines {kf}..{kl}");
    let (_, _, ma, mb) = ext[M].unwrap();
    assert!(close(ma, 1417, 1) && close(mb + 1, 1984, 1), "M x {ma}..{mb}");
}

#[test]
fn content_is_trimmed_to_item_span() {
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let j = job(vec![
        item(&p, 0.0, 0.0, 10.0, 10.0, 0.0),
        item(&p, 0.0, 100.0, 10.0, 10.0, 0.0),
    ]);
    let (lines, ext) = extents(&render(&j, d.path()));
    assert_eq!(lines, 7796); // ceil(110/25.4*1800)
    let (f, l, _, _) = ext[K].unwrap();
    assert!(f == 0 && l >= 7794, "K lines {f}..{l}");
}

#[test]
fn lead_in_adds_blank_lines_at_top() {
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let mut j = job(vec![item(&p, 5.0, 5.0, 10.0, 10.0, 0.0)]);
    j.settings.lead_in_mm = 5.0;
    let (lines, ext) = extents(&render(&j, d.path()));
    assert_eq!(lines, 709 + 355);
    let (f, _, _, _) = ext[K].unwrap();
    assert!(close(f as usize, 355, 1), "first ink line {f}");
}

#[test]
fn white_goes_to_both_w_channels_and_is_choked() {
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let mut it = item(&p, 5.0, 5.0, 10.0, 10.0, 0.0);
    it.white_enabled = true;
    let mut j = job(vec![it]);
    j.white_enabled = true;
    j.settings.white_choke_mm = 0.2; // 10 px/mm source -> r = 2 px = 0.2 mm
    let out = render(&j, d.path());
    let (_, ext) = extents(&out);
    let (wf, wl, wa, wb) = ext[W1].unwrap();
    assert_eq!(ext[W1], ext[W2]);
    // white covers 5.2..14.8 mm: px 147..420 at 720 dpi, lines 14..694 at 1800 dpi
    // (bilinear ramps the choked edge over +-0.05 mm, hence the tolerance)
    assert!(close(wa, 147, 3) && close(wb + 1, 420, 3), "W x {wa}..{wb}");
    assert!(
        close(wf as usize, 14, 4) && close(wl as usize, 694, 4),
        "W lines {wf}..{wl}"
    );
    // W channel lines are identical
    let mut r = PrnReader::open(&out).unwrap();
    let l = r.read_line(300).unwrap();
    assert_eq!(l[W1], l[W2]);

    // white disabled on the job disables the item's white
    j.white_enabled = false;
    let (_, ext) = extents(&render(&j, d.path()));
    assert!(ext[W1].is_none() && ext[W2].is_none());
}

#[test]
fn choke_is_per_axis_for_stretched_sources() {
    // 100x100 px source stretched to 10x20 mm: 10 px/mm across, 5 px/mm down.
    // A 0.2 mm choke is rx = 2 px and ry = 1 px, i.e. 0.2 mm on both axes.
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let mut it = item(&p, 5.0, 5.0, 10.0, 20.0, 0.0);
    it.white_enabled = true;
    let mut j = job(vec![it]);
    j.white_enabled = true;
    let (_, ext) = extents(&render(&j, d.path()));
    let (wf, _, wa, _) = ext[W1].unwrap();
    assert!(close(wa, 147, 3), "W x starts at {wa}");
    // The first white dot is where the bilinear ramp starts, half a source
    // pixel (0.1 mm) before the choked edge: 0.2 - 0.1 mm = 7 lines. With
    // ry = 2 px (0.4 mm) it would start at 0.3 mm = 21 lines.
    assert!(close(wf as usize, 7, 3), "W starts at line {wf}");
}

#[test]
fn later_items_are_on_top() {
    let d = tempfile::tempdir().unwrap();
    let b = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let r = png(d.path(), "r.png", 100, 100, |_, _| RED);
    // red 0..20 mm, black 5..15 mm on top: no magenta under black
    let j = job(vec![
        item(&r, 0.0, 0.0, 20.0, 20.0, 0.0),
        item(&b, 5.0, 5.0, 10.0, 10.0, 0.0),
    ]);
    let out = render(&j, d.path());
    let mut rd = PrnReader::open(&out).unwrap();
    let l = rd.read_line(700).unwrap(); // y ~ 9.9 mm
    let (k0, k1) = (
        l[K].iter().position(|&v| v != 0).unwrap(),
        l[K].iter().rposition(|&v| v != 0).unwrap(),
    );
    assert!(close(k0, 141, 1) && close(k1 + 1, 424, 1));
    assert!(
        l[M][k0 + 2..k1 - 1].iter().all(|&v| v == 0),
        "magenta under black"
    );
    assert!(l[M][..k0 - 2].iter().all(|&v| v == 3) && l[M][k1 + 2..560].iter().all(|&v| v == 3));
}

#[test]
fn half_transparent_top_blends_over_below() {
    let d = tempfile::tempdir().unwrap();
    let r = png(d.path(), "r.png", 10, 10, |_, _| RED);
    let b = png(d.path(), "b.png", 10, 10, |_, _| [0, 0, 0, 128]);
    let j = job(vec![
        item(&r, 0.0, 0.0, 10.0, 10.0, 0.0),
        item(&b, 0.0, 0.0, 10.0, 10.0, 0.0),
    ]);
    let out = render(&j, d.path());
    let mut rd = PrnReader::open(&out).unwrap();
    let (mut k, mut m, mut n) = (0u64, 0u64, 0u64);
    for i in 200..456 {
        let l = rd.read_line(i).unwrap();
        k += l[K][20..260].iter().map(|&v| v as u64).sum::<u64>();
        m += l[M][20..260].iter().map(|&v| v as u64).sum::<u64>();
        n += 3 * 240;
    }
    let (k, m) = (k as f64 / n as f64, m as f64 / n as f64);
    assert!(
        (k - 0.5).abs() < 0.02 && (m - 0.5).abs() < 0.02,
        "k {k} m {m}"
    );
}

#[test]
fn black_goes_to_channel_3_by_default() {
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let mut j = job(vec![item(&p, 5.0, 5.0, 10.0, 10.0, 0.0)]);
    j.settings = EngineSettings::default();
    let (_, ext) = extents(&render(&j, d.path()));
    assert!(ext[3].is_some() && [0, 1, 2, 4, 5].iter().all(|&c| ext[c].is_none()));
}

#[test]
fn channel_order_maps_logical_channels() {
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let mut j = job(vec![item(&p, 5.0, 5.0, 10.0, 10.0, 0.0)]);
    j.settings.channel_order = ["W", "W", "Y", "M", "C", "K"].map(String::from);
    let (_, ext) = extents(&render(&j, d.path()));
    assert!(ext[5].is_some() && (0..5).all(|c| ext[c].is_none()));
    j.settings.channel_order[0] = "Q".into();
    let e = render_prn(&j, &d.path().join("x.prn"), &mut |_| true).unwrap_err();
    assert!(matches!(e, EngineError::BadSettings(_)), "{e}");
}

#[test]
fn error_diffusion_renders_the_same_footprint() {
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let mut j = job(vec![item(&p, 5.0, 5.0, 10.0, 10.0, 0.0)]);
    j.settings.screening = Screening::ErrorDiffusion;
    let (lines, ext) = extents(&render(&j, d.path()));
    assert_eq!(lines, 709);
    let (_, _, a, b) = ext[K].unwrap();
    assert!(close(a, 141, 1) && close(b + 1, 424, 1), "K x {a}..{b}");
}

#[test]
fn ink_limit_applies_in_render() {
    // Pure blue = C+M (2.0) under the built-in model; a 150% limit trims it.
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "u.png", 10, 10, |_, _| [0, 0, 255, 255]);
    let mut j = job(vec![item(&p, 0.0, 0.0, 10.0, 10.0, 0.0)]);
    j.settings.ink_limit_pct = 150.0;
    let out = render(&j, d.path());
    let mut rd = PrnReader::open(&out).unwrap();
    let (mut total, mut n) = (0u64, 0u64);
    for i in 200..456 {
        let l = rd.read_line(i).unwrap();
        for ch in &l[..4] {
            total += ch[20..260].iter().map(|&v| v as u64).sum::<u64>();
        }
        n += 3 * 240;
    }
    let t = total as f64 / n as f64;
    assert!((t - 1.5).abs() < 0.03, "total ink {t}");
}

/// A rotated item active in a band but not covering the current row, while
/// another item does, must not panic (reviewer repro).
fn rotated_beside_tall_item(rot: f64) {
    let d = tempfile::tempdir().unwrap();
    let a = png(d.path(), "a.png", 100, 600, |_, _| BLACK);
    let b = png(d.path(), "b.png", 200, 100, |_, _| RED);
    let j = job(vec![item(&a, 0.0, 0.0, 10.0, 60.0, 0.0), item(&b, 50.0, 20.0, 20.0, 10.0, rot)]);
    let (lines, ext) = extents(&render(&j, d.path()));
    assert_eq!(lines, 4252); // ceil(60/dy)
    let (_, _, ka, kb) = ext[K].unwrap();
    assert!(close(ka, 0, 1) && close(kb + 1, 283, 1), "K x {ka}..{kb}");
    let (mf, ml, ma, mb) = ext[M].unwrap();
    // red item: centre (60, 25) mm, rotated about it
    let r = rot.to_radians();
    let (hw, hh) = ((20.0 * r.cos().abs() + 10.0 * r.sin().abs()) / 2.0, (20.0 * r.sin().abs() + 10.0 * r.cos().abs()) / 2.0);
    let px = |mm: f64| (mm / 25.4 * 720.0) as usize;
    let ln = |mm: f64| (mm / 25.4 * 1800.0) as usize;
    assert!(close(ma, px(60.0 - hw), 2) && close(mb, px(60.0 + hw), 2), "M x {ma}..{mb}");
    assert!(close(mf as usize, ln(25.0 - hh), 2) && close(ml as usize, ln(25.0 + hh), 2), "M lines {mf}..{ml}");
}

#[test]
fn rotated_90_item_beside_another_item_does_not_panic() {
    rotated_beside_tall_item(90.0);
}

#[test]
fn rotated_30_item_beside_another_item_does_not_panic() {
    rotated_beside_tall_item(30.0);
}

#[test]
fn bottom_line_is_kept_when_item_straddles_a_line_boundary() {
    // Item 0.9 and 1.0 line tall, starting 0.7 / 0.6 into line 0: only line 1's
    // centre is inside it, so the PRN needs two lines (old formula gave one).
    let dy = 25.4 / 1800.0;
    for (top, h) in [(0.7, 0.9), (0.6, 1.0)] {
        let d = tempfile::tempdir().unwrap();
        let p = png(d.path(), "b.png", 100, 10, |_, _| BLACK);
        let j = job(vec![item(&p, 0.0, top * dy, 10.0, h * dy, 0.0)]);
        let (lines, ext) = extents(&render(&j, d.path()));
        assert_eq!(lines, 2, "top {top} h {h}");
        let (f, l, _, _) = ext[K].expect("ink on line 1");
        assert_eq!((f, l), (1, 1));
    }
}

#[test]
fn ink_is_continuous_across_band_boundaries() {
    // 709 lines cross the band boundaries at 256 and 512.
    for s in [Screening::BlueNoise, Screening::ErrorDiffusion] {
        let d = tempfile::tempdir().unwrap();
        let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
        let mut j = job(vec![item(&p, 5.0, 5.0, 10.0, 10.0, 0.0)]);
        j.settings.screening = s;
        let out = render(&j, d.path());
        let mut r = PrnReader::open(&out).unwrap();
        let first = r.read_line(0).unwrap()[K].clone();
        let n = first.iter().filter(|&&v| v == 3).count();
        assert!(close(n, 283, 1), "{s:?} line 0 has {n} full dots");
        for i in 1..709 {
            let l = r.read_line(i).unwrap();
            assert_eq!(l[K], first, "{s:?} line {i} differs");
        }
    }
}

#[test]
fn no_items_is_nothing_to_print() {
    let d = tempfile::tempdir().unwrap();
    let e = render_prn(&job(vec![]), &d.path().join("o.prn"), &mut |_| true).unwrap_err();
    assert!(matches!(e, EngineError::NothingToPrint), "{e}");
}

#[test]
fn cancel_removes_part_file() {
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let j = job(vec![item(&p, 0.0, 0.0, 10.0, 50.0, 0.0)]); // several bands
    let out = d.path().join("o.prn");
    let mut calls = 0;
    let e = render_prn(&j, &out, &mut |_| {
        calls += 1;
        calls < 2
    })
    .unwrap_err();
    assert!(matches!(e, EngineError::Cancelled), "{e}");
    assert_eq!(calls, 2);
    assert!(!out.exists() && !d.path().join("o.prn.part").exists());
}

#[test]
fn progress_reaches_one_and_stats_match_file() {
    let d = tempfile::tempdir().unwrap();
    let p = png(d.path(), "b.png", 100, 100, |_, _| BLACK);
    let j = job(vec![item(&p, 0.0, 0.0, 10.0, 50.0, 0.0)]);
    let out = d.path().join("o.prn");
    let mut seen = Vec::new();
    let s = render_prn(&j, &out, &mut |f| {
        seen.push(f);
        true
    })
    .unwrap();
    assert!(
        seen.windows(2).all(|w| w[0] < w[1]) && *seen.last().unwrap() == 1.0,
        "{seen:?}"
    );
    assert_eq!(s.lines, 3544); // ceil(50/25.4*1800)
    assert_eq!(s.bytes, std::fs::metadata(&out).unwrap().len());
    assert_eq!(s.bytes, 48 + 3544 * 6 * 4256);
    assert!(!d.path().join("o.prn.part").exists());
}

#[test]
fn job_spec_deserialises() {
    let j: JobSpec = serde_json::from_str(
        r#"{"width_mm":600,"x_dpi":720,"y_dpi":1800,"mirror":true,"white_enabled":true,
        "settings":{"channel_order":["K","C","M","Y","W","W"],"ink_limit_pct":280,"white_density_pct":100,
        "white_choke_mm":0.2,"screening":"errorDiffusion","curves":[[[0.5,0.6]],[],[],[],[]],"lead_in_mm":0,
        "icc_profile_path":null},
        "items":[{"path":"/a.png","x_mm":1,"y_mm":2,"width_mm":3,"height_mm":4,"rotation_deg":90,"white_enabled":true}]}"#,
    )
    .unwrap();
    assert_eq!(j.settings.screening, Screening::ErrorDiffusion);
    assert_eq!(j.settings.curves.unwrap()[0], vec![(0.5, 0.6)]);
    assert_eq!(j.items[0].rotation_deg, 90.0);
}

/// Benchmark: 60 x 100 cm sheet filled with 12 random-colour 3000x3000 designs.
/// Run: `cargo test -p dtf-engine --release -- --ignored bench`
#[test]
#[ignore]
fn bench_render_one_metre() {
    let d = tempfile::tempdir().unwrap();
    let mut seed = 0x1234_5678_9abc_def0u64;
    let mut rnd = move || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (seed >> 33) as u32
    };
    let mut items = Vec::new();
    for i in 0..12 {
        let (r, g, b) = (
            (rnd() % 256) as u8,
            (rnd() % 256) as u8,
            (rnd() % 256) as u8,
        );
        let p = png(d.path(), &format!("d{i}.png"), 3000, 3000, |x, y| {
            let t = ((x / 100 + y / 100) % 4) as u8 * 40;
            [
                r.wrapping_add(t),
                g.wrapping_add((x / 12) as u8),
                b.wrapping_add((y / 12) as u8),
                255,
            ]
        });
        let (col, row) = ((i % 3) as f64, (i / 3) as f64);
        let mut it = item(&p, col * 200.0, row * 250.0, 200.0, 250.0, 0.0);
        it.white_enabled = true;
        items.push(it);
    }
    let mut j = job(items);
    j.white_enabled = true;
    j.mirror = true;
    for s in [Screening::BlueNoise, Screening::ErrorDiffusion] {
        j.settings.screening = s;
        let out = d.path().join("bench.prn");
        let st = render_prn(&j, &out, &mut |_| true).unwrap();
        println!(
            "{s:?}: {} lines, {} bytes in {} ms",
            st.lines, st.bytes, st.millis
        );
        if s == Screening::BlueNoise {
            assert!(st.millis < 15_000, "took {} ms", st.millis);
        }
        std::fs::remove_file(&out).unwrap();
    }
}

#[test]
fn pdf_square_prints_its_exact_footprint_with_transparent_margins() {
    if !dtf_engine::pdf::testing::pdfium_ready() {
        return;
    }
    let d = tempfile::tempdir().unwrap();
    // 70 mm page, 50 mm black square in the middle (10 mm transparent margin).
    let p = d.path().join("square.pdf");
    std::fs::write(&p, dtf_engine::pdf::testing::square_pdf(70.0, 50.0)).unwrap();
    let mut it = item(&p, 20.0, 30.0, 70.0, 70.0, 0.0);
    it.white_enabled = true;
    let mut j = job(vec![it]);
    j.width_mm = 120.0; // keeps the debug-build test quick
    j.white_enabled = true;
    j.settings.white_choke_mm = 0.0;
    let (lines, ext) = extents(&render(&j, d.path()));
    // the PRN spans the whole item (30..100 mm): ceil(100/dy) - floor(30/dy)
    assert_eq!(lines, 7087 - 2125);
    // ink and white only on the square: 30..80 mm across, 40..90 mm down
    let (x0, x1) = (30.0f64 / 25.4 * 720.0, 80.0f64 / 25.4 * 720.0); // 850.4 .. 2267.7
    let (y0, y1) = ((40.0f64 - 30.0) / 25.4 * 1800.0, (90.0f64 - 30.0) / 25.4 * 1800.0); // 708.7 .. 4251.97 (rel.)
    for ch in [K, W1, W2] {
        let (f, l, a, b) = ext[ch].unwrap_or_else(|| panic!("channel {ch} empty"));
        assert!(close(a, x0.round() as usize, 1) && close(b + 1, x1.round() as usize, 1), "ch {ch} x {a}..{b}");
        assert!(
            close(f as usize, (y0 - 0.5).round() as usize, 2) && close(l as usize + 1, y1.round() as usize, 2),
            "ch {ch} lines {f}..{l}"
        );
    }
    for ch in [1, M, 3] {
        assert!(ext[ch].is_none(), "channel {ch} has ink");
    }
}

#[test]
fn soft_white_edge_fades_the_outer_pixels_on_every_side_and_only_there() {
    let dir = tempfile::tempdir().unwrap();
    let p = png(dir.path(), "solid.png", 40, 60, |_, _| [255, 255, 255, 255]);
    let mut i = item(&p, 10.0, 10.0, 20.0, 30.0, 0.0);
    i.white_enabled = true;
    let mut j = job(vec![i]);
    j.white_enabled = true;
    j.settings.white_density_pct = 100.0;
    j.settings.white_choke_mm = 0.0;
    j.settings.white_edge_steps = 2;
    let out = render(&j, dir.path());
    let (_, ext) = extents(&out);
    let (top, bottom, left, right) = ext[W1].unwrap();
    let mut r = PrnReader::open(&out).unwrap();
    let mid = (left + right) / 2;
    // Down the middle column: 1, 2, then full drops through every band, then 2, 1.
    let col: Vec<u8> = (top..=bottom).map(|y| r.read_line(y).unwrap()[W1][mid]).collect();
    assert_eq!(&col[..3], &[1, 2, 3]);
    assert_eq!(&col[col.len() - 3..], &[3, 2, 1]);
    assert!(col[2..col.len() - 2].iter().all(|&v| v == 3), "only the edges fade");
    // Across the middle row, on both white channels.
    let line = r.read_line((top + bottom) / 2).unwrap();
    for ch in [W1, W2] {
        assert_eq!(&line[ch][left..left + 3], &[1, 2, 3]);
        assert_eq!(&line[ch][right - 2..=right], &[3, 2, 1]);
    }
    // Off, the edge keeps full drops.
    j.settings.white_edge_steps = 0;
    let out = render(&j, dir.path());
    let mut r = PrnReader::open(&out).unwrap();
    assert_eq!(r.read_line(top).unwrap()[W1][mid], 3);
}
