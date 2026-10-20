mod header;
mod reader;
mod writer;

pub use header::{PrnHeader, bytes_per_line};
pub use reader::PrnReader;
pub use writer::PrnWriter;

/// Number of ink channels in a line.
pub const CHANNELS: usize = 6;
pub const HEADER_LEN: usize = 48;

/// Pack levels (0..=3) at 2 bits per pixel, MSB first, into `out` (zero padded).
pub(crate) fn pack_levels(levels: &[u8], out: &mut [u8]) {
    out.fill(0);
    for (i, &v) in levels.iter().enumerate() {
        out[i / 4] |= (v & 3) << (6 - 2 * (i % 4));
    }
}

/// Unpack `width_px` levels from packed bytes.
pub(crate) fn unpack_levels(packed: &[u8], width_px: usize) -> Vec<u8> {
    (0..width_px)
        .map(|i| (packed[i / 4] >> (6 - 2 * (i % 4))) & 3)
        .collect()
}
