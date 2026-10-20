//! 4-level screening (values 0..3) and dot-gain curves.
//!
//! The blue-noise mask is a 256x256 void-and-cluster threshold array stored as
//! little-endian u16 ranks in `assets/bluenoise256.bin`. To regenerate it:
//! `cargo test --release generate_bluenoise_asset -- --ignored`.

const MASK_SIZE: usize = 256;
static MASK_BYTES: &[u8] = include_bytes!("assets/bluenoise256.bin");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screening {
    BlueNoise,
    ErrorDiffusion,
}

/// Piecewise-linear dot-gain curve; points are (input, output) in 0..=1,
/// sorted by input. Endpoints (0,0) and (1,1) are implied.
pub fn apply_curve(tone: u16, curve: &[(f32, f32)]) -> u16 {
    let x = tone as f32 / 65535.0;
    let (mut px, mut py) = (0.0f32, 0.0f32);
    let mut y = 1.0f32;
    let mut found = false;
    for &(cx, cy) in curve.iter().chain(std::iter::once(&(1.0f32, 1.0f32))) {
        if cx <= px {
            // Skip points that do not advance (e.g. an explicit (0,0)).
            if cx == px {
                py = cy;
            }
            continue;
        }
        if x <= cx {
            y = py + (cy - py) * (x - px) / (cx - px);
            found = true;
            break;
        }
        px = cx;
        py = cy;
    }
    if !found {
        y = py;
    }
    (y.clamp(0.0, 1.0) * 65535.0).round() as u16
}

/// Screen one row of 16-bit tones into levels 0..3 using the blue-noise mask.
/// `y` is the absolute row, `x0` the absolute column of `tones[0]`.
pub fn screen_row_blue_noise(tones: &[u16], y: u32, x0: u32, out: &mut [u8]) {
    let ranks = mask_ranks();
    let row = (y as usize & (MASK_SIZE - 1)) * MASK_SIZE;
    for (i, (&t, o)) in tones.iter().zip(out.iter_mut()).enumerate() {
        let v = t as u32 * 3;
        let base = v / 65535;
        let rem = (v % 65535) as u64;
        let c = ranks[row + ((x0 as usize + i) & (MASK_SIZE - 1))];
        let rank = u16::from_le_bytes(c) as u64;
        // frac = rem/65535 > (rank+0.5)/65536
        let up = (rem * 131072 > (2 * rank + 1) * 65535) as u32;
        *o = (base + up).min(3) as u8;
    }
}

#[inline]
fn mask_ranks() -> &'static [[u8; 2]] {
    // Little-endian u16 pairs, decoded at the call site.
    MASK_BYTES.as_chunks::<2>().0
}

/// Serpentine multi-level Floyd-Steinberg state for one channel. Error is
/// carried between rows and between bands, so feed rows strictly in order.
pub struct ErrorDiffuser {
    cur: Vec<f32>,
    next: Vec<f32>,
    row: u32,
}

impl ErrorDiffuser {
    pub fn new(width: usize) -> Self {
        ErrorDiffuser { cur: vec![0.0; width + 2], next: vec![0.0; width + 2], row: 0 }
    }
    pub fn process_row(&mut self, tones: &[u16], out: &mut [u8]) {
        let w = tones.len().min(out.len()).min(self.cur.len() - 2);
        let ltr = self.row % 2 == 0;
        // Buffers are offset by one so x-1 / x+1 never go out of range.
        for k in 0..w {
            let x = if ltr { k } else { w - 1 - k };
            let v = tones[x] as f32 * (3.0 / 65535.0) + self.cur[x + 1];
            let q = v.round().clamp(0.0, 3.0);
            out[x] = q as u8;
            let e = (v - q).clamp(-1.0, 1.0);
            let (fwd, back) = if ltr { (x + 2, x) } else { (x, x + 2) };
            self.cur[fwd] += e * (7.0 / 16.0);
            self.next[back] += e * (3.0 / 16.0);
            self.next[x + 1] += e * (5.0 / 16.0);
            self.next[fwd] += e * (1.0 / 16.0);
        }
        std::mem::swap(&mut self.cur, &mut self.next);
        self.next.fill(0.0);
        self.row += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(t: f64) -> u16 {
        (t * 65535.0).round() as u16
    }

    #[test]
    fn extremes() {
        let n = 512;
        let mut out = vec![9u8; n];
        screen_row_blue_noise(&vec![0; n], 7, 0, &mut out);
        assert!(out.iter().all(|&v| v == 0));
        screen_row_blue_noise(&vec![65535; n], 7, 0, &mut out);
        assert!(out.iter().all(|&v| v == 3));
        let mut d = ErrorDiffuser::new(n);
        d.process_row(&vec![0; n], &mut out);
        assert!(out.iter().all(|&v| v == 0));
        let mut d = ErrorDiffuser::new(n);
        d.process_row(&vec![65535; n], &mut out);
        assert!(out.iter().all(|&v| v == 3));
    }

    #[test]
    fn mean_preserved() {
        let n = 512usize;
        for &t in &[0.1, 0.33, 0.5, 0.9] {
            let row = vec![tone(t); n];
            let mut out = vec![0u8; n];
            let mut d = ErrorDiffuser::new(n);
            let (mut sb, mut se) = (0u64, 0u64);
            for y in 0..n as u32 {
                screen_row_blue_noise(&row, y, 0, &mut out);
                assert!(out.iter().all(|&v| v <= 3));
                sb += out.iter().map(|&v| v as u64).sum::<u64>();
                d.process_row(&row, &mut out);
                assert!(out.iter().all(|&v| v <= 3));
                se += out.iter().map(|&v| v as u64).sum::<u64>();
            }
            let total = (n * n) as f64 * 3.0;
            assert!((sb as f64 / total - t).abs() < 0.01, "blue noise t={t}: {}", sb as f64 / total);
            assert!((se as f64 / total - t).abs() < 0.01, "diffusion t={t}: {}", se as f64 / total);
        }
    }

    #[test]
    fn blue_noise_no_banding() {
        let n = 512usize;
        let row = vec![tone(0.5); n];
        let mut out = vec![0u8; n];
        for y in 0..n as u32 {
            screen_row_blue_noise(&row, y, 0, &mut out);
            let same = out.windows(2).filter(|w| w[0] == w[1]).count();
            assert!((same as f64) / ((n - 1) as f64) <= 0.6, "row {y} banded");
        }
    }

    #[test]
    fn blue_noise_is_position_stable_across_x0() {
        let row = vec![tone(0.4); 300];
        let mut full = vec![0u8; 300];
        screen_row_blue_noise(&row, 5, 0, &mut full);
        let mut part = vec![0u8; 100];
        screen_row_blue_noise(&row[200..], 5, 200, &mut part);
        assert_eq!(&full[200..], &part[..]);
    }

    #[test]
    fn diffuser_bands_equal_one_pass() {
        let n = 64usize;
        let row: Vec<u16> = (0..n).map(|x| (x * 1000) as u16).collect();
        let mut a = ErrorDiffuser::new(n);
        let mut b = ErrorDiffuser::new(n);
        let mut o1 = vec![0u8; n];
        let mut o2 = vec![0u8; n];
        for _ in 0..10 {
            a.process_row(&row, &mut o1);
        }
        for _ in 0..4 { b.process_row(&row, &mut o2); }
        for _ in 0..6 { b.process_row(&row, &mut o2); }
        assert_eq!(o1, o2);
    }

    #[test]
    fn curve_identity_and_midpoint() {
        for t in [0u16, 1, 1000, 32768, 65535] {
            assert_eq!(apply_curve(t, &[]), t);
            assert_eq!(apply_curve(t, &[(0.0, 0.0), (1.0, 1.0)]), t);
        }
        let c = [(0.5f32, 0.4f32)];
        assert_eq!(apply_curve(0, &c), 0);
        assert_eq!(apply_curve(65535, &c), 65535);
        let mid = apply_curve(tone(0.5), &c) as f64 / 65535.0;
        assert!((mid - 0.4).abs() < 1e-3, "{mid}");
        let q = apply_curve(tone(0.25), &c) as f64 / 65535.0;
        assert!((q - 0.2).abs() < 1e-3, "{q}");
    }

    /// Void-and-cluster (Ulichney) generator; run with
    /// `cargo test --release generate_bluenoise_asset -- --ignored`.
    #[test]
    #[ignore]
    fn generate_bluenoise_asset() {
        const N: usize = MASK_SIZE;
        const R: i32 = 7; // kernel radius, sigma 1.5
        let kern: Vec<f32> = (-R..=R)
            .flat_map(|dy| (-R..=R).map(move |dx| (-((dx * dx + dy * dy) as f32) / (2.0 * 1.5 * 1.5)).exp()))
            .collect();
        let mut energy = vec![0f32; N * N];
        let mut ones = vec![false; N * N];
        let splat = |energy: &mut Vec<f32>, p: usize, sign: f32| {
            let (px, py) = ((p % N) as i32, (p / N) as i32);
            let mut k = 0;
            for dy in -R..=R {
                for dx in -R..=R {
                    let q = (py + dy).rem_euclid(N as i32) as usize * N + (px + dx).rem_euclid(N as i32) as usize;
                    energy[q] += sign * kern[k];
                    k += 1;
                }
            }
        };
        let tightest = |e: &Vec<f32>, ones: &Vec<bool>| {
            (0..N * N).filter(|&i| ones[i]).max_by(|&a, &b| e[a].total_cmp(&e[b])).unwrap()
        };
        let largest_void = |e: &Vec<f32>, ones: &Vec<bool>| {
            (0..N * N).filter(|&i| !ones[i]).min_by(|&a, &b| e[a].total_cmp(&e[b])).unwrap()
        };
        // Deterministic xorshift initial pattern, ~10% ones.
        let mut s = 0x2545F4914F6CDD1Du64;
        let initial = N * N / 10;
        let mut placed = 0;
        while placed < initial {
            s ^= s << 13; s ^= s >> 7; s ^= s << 17;
            let p = (s % (N * N) as u64) as usize;
            if !ones[p] { ones[p] = true; splat(&mut energy, p, 1.0); placed += 1; }
        }
        loop {
            let c = tightest(&energy, &ones);
            ones[c] = false; splat(&mut energy, c, -1.0);
            let v = largest_void(&energy, &ones);
            ones[v] = true; splat(&mut energy, v, 1.0);
            if v == c { break; }
        }
        let mut rank = vec![0u16; N * N];
        // Phase 1: peel the initial pattern, highest rank first.
        let (mut e1, mut o1) = (energy.clone(), ones.clone());
        for r in (0..initial).rev() {
            let c = tightest(&e1, &o1);
            o1[c] = false; splat(&mut e1, c, -1.0);
            rank[c] = r as u16;
        }
        // Phases 2/3: fill voids from the initial pattern.
        for r in initial..N * N {
            let v = largest_void(&energy, &ones);
            ones[v] = true; splat(&mut energy, v, 1.0);
            rank[v] = r as u16;
        }
        let bytes: Vec<u8> = rank.iter().flat_map(|r| r.to_le_bytes()).collect();
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/assets/bluenoise256.bin");
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn mask_is_a_permutation() {
        assert_eq!(MASK_BYTES.len(), MASK_SIZE * MASK_SIZE * 2);
        let mut seen = vec![false; MASK_SIZE * MASK_SIZE];
        for c in MASK_BYTES.chunks_exact(2) {
            let r = u16::from_le_bytes([c[0], c[1]]) as usize;
            assert!(!seen[r], "duplicate rank {r}");
            seen[r] = true;
        }
    }
}
