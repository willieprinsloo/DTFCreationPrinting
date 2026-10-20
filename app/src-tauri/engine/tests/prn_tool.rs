use std::process::Command;

use dtf_engine::prn::PrnReader;

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/maintop_sample_8lines.prn");

fn tool() -> Command {
    Command::new(env!("CARGO_BIN_EXE_prn-tool"))
}

#[test]
fn chart_channels_has_one_channel_per_square() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("channels.prn");
    let st = tool().args(["chart", "channels"]).arg(&out).args(["--width-mm", "600"]).status().unwrap();
    assert!(st.success());
    assert!(!dir.path().join("channels.prn.part").exists());

    let mut r = PrnReader::open(&out).unwrap();
    let h = r.header().clone();
    assert_eq!((h.lines, h.width_px), (8504, 17007));

    // 80 mm square, ~17.14 mm gaps: square i spans x = gap + i*(80+gap)
    let px_x = |mm: f64| (mm / 25.4 * 720.0).round() as usize;
    let gap = 120.0 / 7.0;
    let y = 2000u32; // inside the squares (0..80 mm)
    let line = r.read_line(y).unwrap();
    for i in 0..6 {
        let x0 = px_x(gap + i as f64 * (80.0 + gap)) + 5;
        let x1 = px_x(gap + i as f64 * (80.0 + gap) + 80.0) - 5;
        for (ch, data) in line.iter().enumerate() {
            let all3 = data[x0..x1].iter().all(|&v| v == 3);
            let none = data[x0..x1].iter().all(|&v| v == 0);
            if ch == i { assert!(all3, "square {i} ch {ch}"); } else { assert!(none, "square {i} ch {ch}"); }
        }
    }
    // label glyphs (below the squares) are drawn in the square's own channel only
    let mut seen = [false; 6];
    for y in (7700..8504).step_by(7) {
        let line = r.read_line(y).unwrap();
        for i in 0..6 {
            let x0 = px_x(gap + i as f64 * (80.0 + gap));
            let x1 = px_x(gap + i as f64 * (80.0 + gap) + 80.0);
            for (ch, data) in line.iter().enumerate() {
                let any = data[x0..x1].iter().any(|&v| v != 0);
                if ch == i { seen[i] |= any } else { assert!(!any, "label {i} leaked into ch {ch}") }
            }
        }
    }
    assert!(seen.iter().all(|&s| s), "every label drawn: {seen:?}");
}

#[test]
fn preview_fixture_dimensions() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("p.png");
    let st = tool().arg("preview").arg(FIXTURE).arg(&out).args(["--scale", "0.1"]).status().unwrap();
    assert!(st.success());
    let img = image::open(&out).unwrap();
    // 17007 px / 10 = 1701 per panel; 8 lines / 25 = 1; two panels + 8 px divider
    assert_eq!((img.width(), img.height()), (1701 * 2 + 8, 1));
}

#[test]
fn inspect_fixture_reports_header_and_coverage() {
    let out = tool().arg("inspect").arg(FIXTURE).output().unwrap();
    assert!(out.status.success());
    let s = String::from_utf8(out.stdout).unwrap();
    assert!(s.contains("17007") && s.contains("4256") && s.contains("lines: 8"), "{s}");
    assert!(s.contains("ch4") && s.contains("content lines"), "{s}");
}

#[test]
fn inspect_rejects_non_prn() {
    let dir = tempfile::tempdir().unwrap();
    let f = dir.path().join("x.prn");
    std::fs::write(&f, b"hello").unwrap();
    let out = tool().arg("inspect").arg(&f).output().unwrap();
    assert!(!out.status.success());
}

#[test]
fn chart_content_is_trimmed_to_full_height() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("c.prn");
    assert!(tool().args(["chart", "channels"]).arg(&out).status().unwrap().success());
    let s = String::from_utf8(tool().arg("inspect").arg(&out).output().unwrap().stdout).unwrap();
    assert!(s.contains("content lines: 0..=8503"), "{s}");
}

use std::hash::Hasher;
use std::io::Read;
use std::path::Path;

/// Streaming hash of a (large) file.
fn digest(p: &Path) -> u64 {
    let mut f = std::io::BufReader::new(std::fs::File::open(p).unwrap());
    let mut h = std::collections::hash_map::DefaultHasher::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).unwrap();
        if n == 0 { break }
        h.write(&buf[..n]);
    }
    h.finish()
}

fn chart_digest(kind: &str, profile: Option<&str>, extra: &[&str]) -> (u64, std::path::PathBuf, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join(format!("{kind}.prn"));
    let mut c = tool();
    c.args(["chart", kind]).arg(&out).args(["--width-mm", "600"]).args(extra);
    if let Some(j) = profile {
        let pf = dir.path().join("profile.json");
        std::fs::write(&pf, j).unwrap();
        c.arg("--profile").arg(&pf);
    }
    assert!(c.status().unwrap().success(), "{kind} {profile:?} {extra:?}");
    (digest(&out), out, dir)
}

const PROFILE: &str = r#"{"xDpi":720,"yDpi":1800"#;

#[test]
fn colour_chart_follows_the_profile_settings() {
    let (base, _, _d0) = chart_digest("colour", None, &[]);
    let ink = format!(r#"{PROFILE},"inkLimitPct":150}}"#);
    let (a, _, _d1) = chart_digest("colour", Some(&ink), &[]);
    assert_ne!(base, a, "ink limit must change the chart");
    let scr = format!(r#"{PROFILE},"screening":"errorDiffusion"}}"#);
    let (b, _, _d2) = chart_digest("colour", Some(&scr), &[]);
    assert_ne!(base, b, "screening must change the chart");
    let curve = format!(r#"{PROFILE},"dotGain":{{"C":[[0.5,0.7]]}}}}"#);
    let (c, _, _d3) = chart_digest("colour", Some(&curve), &[]);
    assert_ne!(base, c, "curves must change the chart");
    // the same profile twice gives the same chart
    let (a2, _, _d4) = chart_digest("colour", Some(&ink), &[]);
    assert_eq!(a, a2);
}

#[test]
fn colour_chart_always_has_a_white_underbase() {
    let (_, on, _d) = chart_digest("colour", None, &[]);
    let mut r = PrnReader::open(&on).unwrap();
    let n = r.header().lines;
    assert!((0..n).step_by(50).any(|y| r.read_line(y).unwrap()[4].iter().any(|&v| v != 0)));
}

#[test]
fn white_chart_follows_the_profile_settings() {
    let (base, _, _d0) = chart_digest("white", None, &[]);
    let ink = format!(r#"{PROFILE},"inkLimitPct":100}}"#);
    let (a, _, _d1) = chart_digest("white", Some(&ink), &[]);
    assert_ne!(base, a);
}

#[test]
fn charts_reject_a_bad_profile_and_leave_no_work_folder() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("c.prn");
    let pf = dir.path().join("p.json");
    std::fs::write(&pf, "not json").unwrap();
    let st = tool().args(["chart", "white"]).arg(&out).arg("--profile").arg(&pf).status().unwrap();
    assert!(!st.success());
    let bad = dir.path().join("bad.json");
    std::fs::write(&bad, format!(r#"{PROFILE},"channelOrder":["X","C","M","Y","W","W"]}}"#)).unwrap();
    let st = tool().args(["chart", "colour"]).arg(&out).arg("--profile").arg(&bad).status().unwrap();
    assert!(!st.success());
    let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names.len(), 2, "no leftovers: {names:?}");
}

fn px_x(mm: f64) -> usize {
    (mm / 25.4 * 720.0).round() as usize
}

#[test]
fn chart_white_has_a_cell_per_density_and_choke() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("white.prn");
    let st = tool().args(["chart", "white"]).arg(&out).args(["--width-mm", "600"]).status().unwrap();
    assert!(st.success());
    assert!(!dir.path().join("white.prn.part").exists());
    let mut r = PrnReader::open(&out).unwrap();
    let h = r.header().clone();
    assert_eq!((h.width_px, h.x_dpi, h.y_dpi), (17007, 720, 1800));
    assert!((h.lines as i64 - (3.0 * 52.0_f64 / 25.4 * 1800.0).round() as i64).abs() < 400, "lines {}", h.lines);

    // white is on channels 4/5; white extent per cell shrinks as the choke grows (columns), and
    // a lower density gives fewer white dots (rows).
    let mut white_in = |row: usize, col: usize| -> u64 {
        let y0 = (row as f64 * 52.0 / 25.4 * 1800.0) as u32 + 400;
        let x0 = px_x(20.0 + col as f64 * 140.0);
        let x1 = px_x(20.0 + col as f64 * 140.0 + 60.0);
        let mut n = 0u64;
        for y in (y0..y0 + 600).step_by(3) {
            let l = r.read_line(y).unwrap();
            n += l[4][x0..x1].iter().filter(|&&v| v > 0).count() as u64;
        }
        n
    };
    let dense = white_in(2, 0);
    let light = white_in(0, 0);
    assert!(dense > 0 && light > 0, "{dense} {light}");
    // choke pulls white in from the edge: the white run on a mid-square line is narrower at 0.4 mm than 0 mm
    let mut run = |col: usize| -> usize {
        let y = (2.0 * 52.0 / 25.4 * 1800.0) as u32 + (28.0 / 25.4 * 1800.0) as u32;
        let l = r.read_line(y).unwrap();
        let x0 = px_x(20.0 + col as f64 * 140.0);
        l[4][x0..x0 + px_x(60.0)].iter().filter(|&&v| v > 0).count()
    };
    let (r0, r3) = (run(0), run(3));
    assert!(r0 > r3 + 15, "0.4 mm choke should shrink the white run by ~22 px: {r0} vs {r3}");
    assert!(light < dense, "60% density should be lighter than 100%: {light} vs {dense}");
}

#[test]
fn chart_colour_writes_prn_and_printable_png() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("colour.prn");
    let png = dir.path().join("colour.png");
    let st = tool().args(["chart", "colour"]).arg(&out).arg("--png").arg(&png).args(["--width-mm", "600"]).status().unwrap();
    assert!(st.success());
    let mut r = PrnReader::open(&out).unwrap();
    let h = r.header().clone();
    assert_eq!((h.width_px, h.x_dpi, h.y_dpi), (17007, 720, 1800));
    let expect_lines = (200.0_f64 / 25.4 * 1800.0).ceil() as i64;
    assert!((h.lines as i64 - expect_lines).abs() <= 2, "lines {} vs {}", h.lines, expect_lines);

    let img = image::open(&png).unwrap();
    assert_eq!((img.width(), img.height()), (5600, 4000)); // 280 x 200 mm at 20 px/mm
    // the PNG carries its print size (pHYs, 20000 px/m) so Maintop prints it at 280 mm
    let bytes = std::fs::read(&png).unwrap();
    let pos = bytes.windows(4).position(|w| w == b"pHYs").expect("pHYs chunk");
    assert_eq!(&bytes[pos + 4..pos + 8], &20000u32.to_be_bytes());
    // the chart really has ink in K, C, M and Y
    let mut seen = [false; 4];
    for y in (0..h.lines).step_by(5) {
        let l = r.read_line(y).unwrap();
        for c in 0..4 {
            seen[c] |= l[c].iter().any(|&v| v != 0);
        }
    }
    assert_eq!(seen, [true; 4]);
}

#[test]
fn colour_png_is_not_left_behind_without_flag() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("c.prn");
    assert!(tool().args(["chart", "colour"]).arg(&out).status().unwrap().success());
    let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names.len(), 1, "{names:?}");
}

#[test]
fn charts_use_the_profile_resolution() {
    let prof = r#"{"xDpi":360,"yDpi":900}"#;
    for kind in ["white", "colour", "channels"] {
        let (_, out, _d) = chart_digest(kind, Some(prof), &[]);
        let h = PrnReader::open(&out).unwrap().header().clone();
        assert_eq!((h.x_dpi, h.y_dpi), (360, 900), "{kind} chart header");
        assert_eq!(h.width_px, (600.0f64 / 25.4 * 360.0).floor() as u32, "{kind} chart width");
    }
}
