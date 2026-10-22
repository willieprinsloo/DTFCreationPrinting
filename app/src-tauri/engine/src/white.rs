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

/// Most soft-edge steps; a run needs `10 * steps` pixels to get them all.
pub const MAX_EDGE_STEPS: u8 = 3;

/// Rows of white mask needed above and below a band to mark its edges.
pub fn edge_context_rows(steps: u8) -> usize {
    10 * steps.min(MAX_EDGE_STEPS) as usize
}

/// Soft white edge, as Maintop's 700DTF driver does it (`WhiteInvaginate`), in device pixels.
/// Every run of white (`mask` != 0) along a row or a column fades out at both ends: a run of
/// at least `10 * n` pixels gets `n` (at most `steps`) pixels of fade each side, so thin lines
/// keep their white. Returns one mark per pixel of `mask`: 0 leaves it alone, and at `d` pixels
/// in from an edge with `n` fade pixels the mark is `n - d` (see `soften`).
/// `above` and `below` are the mask rows just outside `mask` (`edge_context_rows(steps)` each,
/// fewer only at the ends of the sheet, where there is no white); all rows are `width` long.
pub fn edge_marks(mask: &[u8], above: &[u8], below: &[u8], width: usize, steps: u8) -> Vec<u8> {
    let steps = steps.min(MAX_EDGE_STEPS) as usize;
    let mut marks = vec![0u8; mask.len()];
    if steps == 0 || width == 0 {
        return marks;
    }
    let fade = |len: usize| (len / 10).min(steps);
    let mark = |m: &mut u8, v: usize| *m = (*m).max(v as u8);
    // Along each row.
    for (row, out) in mask.chunks(width).zip(marks.chunks_mut(width)) {
        let mut x = 0;
        while x < width {
            if row[x] == 0 {
                x += 1;
                continue;
            }
            let start = x;
            while x < width && row[x] != 0 {
                x += 1;
            }
            let n = fade(x - start);
            for d in 0..n {
                mark(&mut out[start + d], n - d);
                mark(&mut out[x - 1 - d], n - d);
            }
        }
    }
    // Down each column, through the context rows.
    let (top, rows) = (above.len() / width, mask.len() / width);
    let all = top + rows + below.len() / width;
    let at = |y: usize, x: usize| {
        if y < top {
            above[y * width + x]
        } else if y < top + rows {
            mask[(y - top) * width + x]
        } else {
            below[(y - top - rows) * width + x]
        }
    };
    for x in 0..width {
        let mut y = 0;
        while y < all {
            if at(y, x) == 0 {
                y += 1;
                continue;
            }
            let start = y;
            while y < all && at(y, x) != 0 {
                y += 1;
            }
            // A run cut off by the context still reaches `10 * steps`, so it fades fully, and
            // its cut end lies in the context, never in `mask`.
            let n = fade(y - start);
            for d in 0..n {
                for yy in [start + d, y - 1 - d] {
                    if (top..top + rows).contains(&yy) {
                        mark(&mut marks[(yy - top) * width + x], n - d);
                    }
                }
            }
        }
    }
    marks
}

/// White drop level (0..=3) after an edge mark: 1 = one size smaller, 2 = smallest drop at most,
/// 3 = no drop (marks from `edge_marks`).
pub fn soften(level: u8, mark: u8) -> u8 {
    match mark {
        0 => level,
        1 => level - u8::from(level > 1),
        2 => level.min(1),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edges_fade_like_maintop_and_thin_lines_keep_their_white() {
        // One row: a 25-pixel run (2 fade pixels each side at steps 2) and a 9-pixel line (none).
        let mut row = vec![0u8; 40];
        row[1..26].fill(1);
        row[30..39].fill(1);
        let m = edge_marks(&row, &[], &[], 40, 2);
        assert_eq!(&m[1..4], &[2, 1, 0]);
        assert_eq!(&m[23..26], &[0, 1, 2]);
        assert!(m[30..39].iter().all(|&v| v == 0));
        // 12 pixels fade one each side; steps 1 caps the 25-pixel run at one too.
        let mut r = vec![1u8; 12];
        assert_eq!(edge_marks(&r, &[], &[], 12, 2)[..2], [1, 0]);
        r = row.clone();
        assert_eq!(edge_marks(&r, &[], &[], 40, 1)[1..3], [1, 0]);
        assert!(edge_marks(&row, &[], &[], 40, 0).iter().all(|&v| v == 0));
    }

    #[test]
    fn columns_fade_at_real_edges_but_not_where_the_context_cuts_the_run() {
        // A 1-pixel-wide column: rows 0..5 are the band, 20 context rows each side.
        let w = 1;
        let above = vec![1u8; 20]; // white continues above the band
        let mut below = vec![0u8; 20];
        below[..3].fill(1); // white ends 3 rows below the band
        let band = vec![1u8; 5];
        let m = edge_marks(&band, &above, &below, w, 2);
        // The run ends 3 rows below the band, so its 2 fade rows lie in `below`.
        assert_eq!(m, vec![0, 0, 0, 0, 0]);
        let below = vec![0u8; 20]; // white ends at the band's last row
        let m = edge_marks(&band, &above, &below, w, 2);
        assert_eq!(m, vec![0, 0, 0, 1, 2]);
        let m = edge_marks(&band, &[], &below, w, 2); // top of the sheet: a 5-row run is too short
        assert_eq!(m, vec![0; 5]);
    }

    #[test]
    fn soften_steps_the_drop_down() {
        assert_eq!([0, 1, 2, 3].map(|l| soften(l, 0)), [0, 1, 2, 3]);
        assert_eq!([0, 1, 2, 3].map(|l| soften(l, 1)), [0, 1, 1, 2]);
        assert_eq!([0, 1, 2, 3].map(|l| soften(l, 2)), [0, 1, 1, 1]);
        assert_eq!([0, 1, 2, 3].map(|l| soften(l, 3)), [0, 0, 0, 0]);
    }

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
