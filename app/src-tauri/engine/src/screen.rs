//! 4-level screening (values 0..3) and dot-gain curves.
//!
//! The blue-noise mask is a 256x256 void-and-cluster threshold array stored as
//! little-endian u16 ranks in `assets/bluenoise256.bin`. To regenerate it:
//! `cargo test --release generate_bluenoise_asset -- --ignored`.

const MASK_SIZE: usize = 256;
static MASK_BYTES: &[u8] = include_bytes!("assets/bluenoise256.bin");

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// True when no error is being carried into the next row.
    pub fn is_idle(&self) -> bool {
        !self.cur.iter().any(|e| e.abs() >= CARRY_EPS)
    }

    /// Fast path: only the span holding ink or carried error (plus a margin
    /// for the error to fade along the row) is diffused; the rest is 0.
    /// Carried error below `CARRY_EPS` levels outside that span is dropped.
    pub fn process_row(&mut self, tones: &[u16], out: &mut [u8]) {
        let w = tones.len().min(out.len()).min(self.cur.len() - 2);
        let ltr = self.row.is_multiple_of(2);
        self.row += 1;
        let carried = |e: &f32| e.abs() >= CARRY_EPS;
        let cur = &self.cur[1..w + 1];
        let lo = [tones[..w].iter().position(|&t| t != 0), cur.iter().position(carried)].into_iter().flatten().min();
        let hi = [tones[..w].iter().rposition(|&t| t != 0), cur.iter().rposition(carried)].into_iter().flatten().max();
        let (Some(lo), Some(hi)) = (lo, hi) else {
            // Blank row, no carried error: nothing to diffuse.
            out[..w].fill(0);
            self.cur.fill(0.0);
            return;
        };
        let (lo, hi) = (lo.saturating_sub(SPAN_MARGIN), (hi + SPAN_MARGIN).min(w - 1));
        out[..lo].fill(0);
        out[hi + 1..w].fill(0);
        // Buffers are offset by one so x-1 / x+1 never go out of range.
        for k in 0..=hi - lo {
            let x = if ltr { lo + k } else { hi - k };
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
    }
}

/// Carried error (in levels, 0..3) below this is treated as none.
const CARRY_EPS: f32 = 1e-4;
/// Pixels diffused beyond the ink/error span so error fades along the row.
const SPAN_MARGIN: usize = 32;

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

    /// The pre-fast-path diffuser, kept as the reference.
    fn reference_rows(img: &[Vec<u16>]) -> Vec<Vec<u8>> {
        let w = img[0].len();
        let (mut cur, mut next) = (vec![0.0f32; w + 2], vec![0.0f32; w + 2]);
        let mut res = Vec::new();
        for (row, tones) in img.iter().enumerate() {
            let mut out = vec![0u8; w];
            let ltr = row % 2 == 0;
            for k in 0..w {
                let x = if ltr { k } else { w - 1 - k };
                let v = tones[x] as f32 * (3.0 / 65535.0) + cur[x + 1];
                let q = v.round().clamp(0.0, 3.0);
                out[x] = q as u8;
                let e = (v - q).clamp(-1.0, 1.0);
                let (fwd, back) = if ltr { (x + 2, x) } else { (x, x + 2) };
                cur[fwd] += e * (7.0 / 16.0);
                next[back] += e * (3.0 / 16.0);
                next[x + 1] += e * (5.0 / 16.0);
                next[fwd] += e * (1.0 / 16.0);
            }
            std::mem::swap(&mut cur, &mut next);
            next.fill(0.0);
            res.push(out);
        }
        res
    }

    #[test]
    fn diffuser_fast_path_matches_reference_on_sparse_ink() {
        // 2000 px wide; ink only in a 100 px wide block in rows 20..60, blank elsewhere.
        let (w, h) = (2000usize, 120usize);
        let img: Vec<Vec<u16>> = (0..h)
            .map(|y| {
                (0..w)
                    .map(|x| if (20..60).contains(&y) && (900..1000).contains(&x) { ((x * 331 + y * 97) % 50000 + 5000) as u16 } else { 0 })
                    .collect()
            })
            .collect();
        let want = reference_rows(&img);
        let mut d = ErrorDiffuser::new(w);
        let mut out = vec![9u8; w];
        let mut mismatches = 0;
        for (y, row) in img.iter().enumerate() {
            d.process_row(row, &mut out);
            mismatches += out.iter().zip(&want[y]).filter(|(a, b)| a != b).count();
        }
        assert_eq!(mismatches, 0);
        // Error diffusion conserves error, so the residual left by the ink is
        // never exactly zero; it must stay confined to a narrow span (the only
        // part still diffused) and never print a stray dot.
        let blank = vec![0u16; w];
        for _ in 0..1000 {
            d.process_row(&blank, &mut out);
            assert!(out.iter().all(|&v| v == 0), "stray dot below the ink");
        }
        let span = d.cur.iter().filter(|e| e.abs() >= CARRY_EPS).count();
        assert!(span < w / 4, "carried error spread over {span} px");
        // Before any ink the diffuser is idle and blank rows cost nothing.
        let mut fresh = ErrorDiffuser::new(w);
        fresh.process_row(&blank, &mut out);
        assert!(fresh.is_idle() && out.iter().all(|&v| v == 0));
    }

    #[test]
    fn diffuser_state_carries_across_bands() {
        let n = 64usize;
        let img: Vec<Vec<u16>> = (0..64)
            .map(|y| (0..n).map(|x| ((x * 700 + y * 311) % 60000 + 2000) as u16).collect())
            .collect();
        let mut one = ErrorDiffuser::new(n);
        let mut a = Vec::new();
        let mut o = vec![0u8; n];
        for r in &img { one.process_row(r, &mut o); a.extend_from_slice(&o); }
        // four bands of 16 rows on the SAME diffuser
        let mut same = ErrorDiffuser::new(n);
        let mut b = Vec::new();
        for band in img.chunks(16) {
            for r in band { same.process_row(r, &mut o); b.extend_from_slice(&o); }
        }
        // four bands, a fresh diffuser per band
        let mut c = Vec::new();
        for band in img.chunks(16) {
            let mut fresh = ErrorDiffuser::new(n);
            for r in band { fresh.process_row(r, &mut o); c.extend_from_slice(&o); }
        }
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    fn tile_variance(thr: &dyn Fn(usize, usize) -> u16, t: f64) -> f64 {
        let tones = vec![tone(t); 256];
        let mut out = vec![0u8; 256];
        let mut sums = vec![0f64; 256];
        for y in 0..256usize {
            // Evaluate with the production comparison against an arbitrary rank source.
            for x in 0..256usize {
                let v = tones[x] as u32 * 3;
                let rem = (v % 65535) as u64;
                let up = (rem * 131072 > (2 * thr(x, y) as u64 + 1) * 65535) as u32;
                out[x] = ((v / 65535 + up).min(3)) as u8;
            }
            for x in 0..256 { sums[(y / 16) * 16 + x / 16] += out[x] as f64; }
        }
        let means: Vec<f64> = sums.iter().map(|s| s / 256.0).collect();
        let m = means.iter().sum::<f64>() / means.len() as f64;
        means.iter().map(|v| (v - m).powi(2)).sum::<f64>() / means.len() as f64
    }

    #[test]
    fn high_tone_uniformity_beats_white_noise() {
        let mask = |x: usize, y: usize| {
            let i = (y * MASK_SIZE + x) * 2;
            u16::from_le_bytes([MASK_BYTES[i], MASK_BYTES[i + 1]])
        };
        // Deterministic white-noise threshold array (hash), same value range.
        let white = |x: usize, y: usize| {
            let mut h = (x as u64).wrapping_mul(0x9E3779B97F4A7C15) ^ (y as u64).wrapping_mul(0xC2B2AE3D27D4EB4F);
            h ^= h >> 29; h = h.wrapping_mul(0xBF58476D1CE4E5B9); h ^= h >> 32;
            (h & 0xFFFF) as u16
        };
        for t in [0.75, 0.9] {
            let vm = tile_variance(&mask, t);
            let vw = tile_variance(&white, t);
            eprintln!("t={t} mask var {vm:.6} white var {vw:.6} ratio {:.1}", vw / vm);
            assert!(vm * 3.0 < vw, "t={t}: mask var {vm} vs white {vw}");
        }
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
        // Phases 2 and 3. Ulichney's phase 3 ("tightest cluster of zeros in the
        // complemented pattern") selects the zero pixel with the highest zero-density,
        // i.e. the lowest ones-energy, which is exactly the largest-void rule used
        // here; so one loop covers both. Verified by high_tone_uniformity test.
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
        for c in MASK_BYTES.as_chunks::<2>().0 {
            let r = u16::from_le_bytes([c[0], c[1]]) as usize;
            assert!(!seen[r], "duplicate rank {r}");
            seen[r] = true;
        }
    }
}
