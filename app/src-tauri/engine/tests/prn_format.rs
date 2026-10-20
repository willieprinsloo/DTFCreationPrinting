use dtf_engine::EngineError;
use dtf_engine::prn::{PrnHeader, PrnReader, PrnWriter, bytes_per_line};

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/maintop_sample_8lines.prn");

#[test]
fn header_matches_maintop_bytes() {
    let fixture = std::fs::read(FIXTURE).unwrap();
    let h = PrnHeader::for_width(600.0, 720, 1800, 8);
    assert_eq!(&h.to_bytes()[..], &fixture[..48]);
}

#[test]
fn bytes_per_line_values() {
    assert_eq!(bytes_per_line(17007), 4256);
    assert_eq!(bytes_per_line(1), 32);
}

#[test]
fn parse_fixture_header() {
    let fixture = std::fs::read(FIXTURE).unwrap();
    let h = PrnHeader::parse(&fixture).unwrap();
    assert_eq!((h.lines, h.width_px, h.channels), (8, 17007, 6));
    assert_eq!(h.bytes_per_line, 4256);
}

#[test]
fn parse_rejects_bad_magic() {
    let mut b = std::fs::read(FIXTURE).unwrap();
    b[0] = b'x';
    assert!(matches!(PrnHeader::parse(&b), Err(EngineError::NotAPrn)));
    assert!(matches!(PrnHeader::parse(&b[..10]), Err(EngineError::NotAPrn)));
}

fn lcg(seed: &mut u64) -> u8 {
    *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    ((*seed >> 33) & 3) as u8
}

#[test]
fn writer_reader_round_trip_odd_width() {
    let width_px = 37u32; // not a multiple of 4
    let mut h = PrnHeader::for_width(600.0, 720, 1800, 3);
    h.width_px = width_px;
    h.bytes_per_line = bytes_per_line(width_px);
    let mut seed = 42u64;
    let data: Vec<Vec<Vec<u8>>> = (0..3)
        .map(|_| (0..6).map(|_| (0..width_px).map(|_| lcg(&mut seed)).collect()).collect())
        .collect();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.prn");
    let mut w = PrnWriter::new(std::fs::File::create(&path).unwrap(), h.clone()).unwrap();
    for line in &data {
        let refs: [&[u8]; 6] = std::array::from_fn(|c| line[c].as_slice());
        w.write_line(&refs).unwrap();
    }
    w.finish().unwrap();

    assert_eq!(std::fs::metadata(&path).unwrap().len(), 48 + 3 * 6 * h.bytes_per_line as u64);
    let mut r = PrnReader::open(&path).unwrap();
    assert_eq!(r.header(), &h);
    for (i, line) in data.iter().enumerate() {
        let got = r.read_line(i as u32).unwrap();
        for c in 0..6 {
            assert_eq!(got[c], line[c], "line {i} ch {c}");
        }
    }
    assert!(matches!(r.read_line(3), Err(EngineError::LineOutOfRange { .. })));
}

#[test]
fn finish_detects_line_count_mismatch() {
    let h = PrnHeader::for_width(10.0, 720, 1800, 2);
    let w = PrnWriter::new(Vec::new(), h).unwrap();
    assert!(matches!(w.finish(), Err(EngineError::LineCountMismatch { expected: 2, written: 0 })));
}

#[test]
fn fixture_line0_has_white_in_channel_4() {
    let mut r = PrnReader::open(std::path::Path::new(FIXTURE)).unwrap();
    let line = r.read_line(0).unwrap();
    assert_eq!(line[4].len(), 17007);
    assert!(line[4].iter().filter(|&&v| v != 0).count() >= 1000);
}

#[test]
fn parse_rejects_inconsistent_headers() {
    let good = std::fs::read(FIXTURE).unwrap()[..48].to_vec();
    let put32 = |b: &mut Vec<u8>, o: usize, v: u32| b[o..o + 4].copy_from_slice(&v.to_le_bytes());
    // bytes_per_line too small for width_px
    let mut b = good.clone();
    put32(&mut b, 12, 100);
    assert!(matches!(PrnHeader::parse(&b), Err(EngineError::BadHeader(_))));
    // zero width / lines / bytes_per_line / dpi
    for off in [4usize, 8, 12, 16, 20] {
        let mut b = good.clone();
        put32(&mut b, off, 0);
        assert!(matches!(PrnHeader::parse(&b), Err(EngineError::BadHeader(_))), "offset {off}");
    }
    // wrong channel count
    let mut b = good.clone();
    b[28..30].copy_from_slice(&4u16.to_le_bytes());
    assert!(matches!(PrnHeader::parse(&b), Err(EngineError::BadHeader(_))));
    assert!(PrnHeader::parse(&good).is_ok());
}
