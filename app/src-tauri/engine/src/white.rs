//! White-layer helpers. The choke is applied at compose time (it must be in
//! output pixels per axis, which differ at 720 vs 1800 dpi), so `prepare`
//! yields the un-choked white plane and Task 5 calls `erode`.
use crate::source::Plane;

/// White plane from alpha: `w = alpha * density_pct/100`, zero when disabled.
pub fn white_from_alpha(alpha: &Plane, density_pct: f32, enabled: bool) -> Plane {
    let k = if enabled { (density_pct / 100.0).clamp(0.0, 1.0) } else { 0.0 };
    Plane {
        w: alpha.w,
        h: alpha.h,
        data: alpha.data.iter().map(|&a| (a as f32 * k).round() as u16).collect(),
    }
}

/// Separable min-filter: each pixel becomes the minimum within `rx` columns
/// and `ry` rows either side. Out-of-bounds counts as 0, so a full-bleed
/// opaque image is choked at its border too.
pub fn erode(plane: &Plane, rx: u32, ry: u32) -> Plane {
    let (w, h) = (plane.w as usize, plane.h as usize);
    if w == 0 || h == 0 || (rx == 0 && ry == 0) {
        return plane.clone();
    }
    let (rx, ry) = (rx as usize, ry as usize);
    let mut tmp = vec![0u16; w * h];
    for y in 0..h {
        let row = &plane.data[y * w..(y + 1) * w];
        for x in 0..w {
            tmp[y * w + x] = if x < rx || x + rx >= w {
                0
            } else {
                *row[x - rx..=x + rx].iter().min().unwrap()
            };
        }
    }
    let mut out = vec![0u16; w * h];
    for y in 0..h {
        let oob = y < ry || y + ry >= h;
        let (a, b) = (y.saturating_sub(ry), (y + ry).min(h - 1));
        for x in 0..w {
            if oob {
                continue; // stays 0
            }
            let mut m = u16::MAX;
            for yy in a..=b {
                m = m.min(tmp[yy * w + x]);
            }
            out[y * w + x] = m;
        }
    }
    Plane { w: plane.w, h: plane.h, data: out }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plane(w: u32, h: u32, f: impl Fn(u32, u32) -> u16) -> Plane {
        let mut data = Vec::new();
        for y in 0..h {
            for x in 0..w {
                data.push(f(x, y));
            }
        }
        Plane { w, h, data }
    }

    #[test]
    fn erode_shrinks_block_by_radius_per_axis() {
        // 5x5 block of 1s inside 11x11 zeros, eroded by rx=1, ry=2.
        let p = plane(11, 11, |x, y| if (3..8).contains(&x) && (3..8).contains(&y) { 65535 } else { 0 });
        let e = erode(&p, 1, 2);
        for y in 0..11u32 {
            for x in 0..11u32 {
                let inside = (4..7).contains(&x) && (5..6).contains(&y);
                assert_eq!(e.data[(y * 11 + x) as usize] != 0, inside, "({x},{y})");
            }
        }
    }

    #[test]
    fn erode_zero_radius_is_identity_and_full_bleed_border_is_choked() {
        let p = plane(6, 6, |_, _| 65535);
        assert_eq!(erode(&p, 0, 0), p);
        let e = erode(&p, 1, 1);
        for y in 0..6u32 {
            for x in 0..6u32 {
                let inner = (1..5).contains(&x) && (1..5).contains(&y);
                assert_eq!(e.data[(y * 6 + x) as usize] != 0, inner, "({x},{y})");
            }
        }
    }

    #[test]
    fn white_scales_alpha_and_disables() {
        let a = Plane { w: 2, h: 1, data: vec![65535, 32768] };
        let w = white_from_alpha(&a, 80.0, true);
        assert_eq!(w.data, vec![52428, 26214]);
        assert!(white_from_alpha(&a, 80.0, false).data.iter().all(|&v| v == 0));
    }
}
