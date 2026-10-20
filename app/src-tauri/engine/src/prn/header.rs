use super::HEADER_LEN;
use crate::EngineError;

const MAGIC: &[u8; 4] = b"fyft";

#[derive(Debug, Clone, PartialEq)]
pub struct PrnHeader {
    pub x_dpi: u32,
    pub y_dpi: u32,
    pub bytes_per_line: u32,
    pub lines: u32,
    pub width_px: u32,
    pub width_m: f32,
    pub channels: u16,
    pub flag_1e: u16,
    pub field_20: u32,
}

/// Bytes per channel per line: 2 bits/pixel, padded to a multiple of 32 bytes.
pub fn bytes_per_line(width_px: u32) -> u32 {
    (width_px * 2).div_ceil(8).div_ceil(32) * 32
}

impl PrnHeader {
    pub fn for_width(width_mm: f64, x_dpi: u32, y_dpi: u32, lines: u32) -> Self {
        let width_px = (width_mm / 25.4 * x_dpi as f64).floor() as u32;
        PrnHeader {
            x_dpi,
            y_dpi,
            bytes_per_line: bytes_per_line(width_px),
            lines,
            width_px,
            width_m: (width_px as f64 / x_dpi as f64 * 0.0254) as f32,
            channels: 6,
            flag_1e: 1,
            field_20: 12,
        }
    }

    pub fn to_bytes(&self) -> [u8; HEADER_LEN] {
        let mut b = [0u8; HEADER_LEN];
        b[0..4].copy_from_slice(MAGIC);
        b[4..8].copy_from_slice(&self.x_dpi.to_le_bytes());
        b[8..12].copy_from_slice(&self.y_dpi.to_le_bytes());
        b[12..16].copy_from_slice(&self.bytes_per_line.to_le_bytes());
        b[16..20].copy_from_slice(&self.lines.to_le_bytes());
        b[20..24].copy_from_slice(&self.width_px.to_le_bytes());
        b[24..28].copy_from_slice(&self.width_m.to_le_bytes());
        b[28..30].copy_from_slice(&self.channels.to_le_bytes());
        b[30..32].copy_from_slice(&self.flag_1e.to_le_bytes());
        b[32..36].copy_from_slice(&self.field_20.to_le_bytes());
        b
    }

    pub fn parse(b: &[u8]) -> Result<Self, EngineError> {
        if b.len() < HEADER_LEN || &b[0..4] != MAGIC {
            return Err(EngineError::NotAPrn);
        }
        let u32_at = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
        let u16_at = |o: usize| u16::from_le_bytes(b[o..o + 2].try_into().unwrap());
        Ok(PrnHeader {
            x_dpi: u32_at(4),
            y_dpi: u32_at(8),
            bytes_per_line: u32_at(12),
            lines: u32_at(16),
            width_px: u32_at(20),
            width_m: f32::from_le_bytes(b[24..28].try_into().unwrap()),
            channels: u16_at(28),
            flag_1e: u16_at(30),
            field_20: u32_at(32),
        })
    }
}
