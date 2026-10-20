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
