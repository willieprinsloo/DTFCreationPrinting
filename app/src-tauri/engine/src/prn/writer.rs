use std::io::Write;

use super::{CHANNELS, PrnHeader, pack_levels};
use crate::EngineError;

pub struct PrnWriter<W: Write> {
    w: W,
    header: PrnHeader,
    written: u32,
    buf: Vec<u8>,
}

impl<W: Write> PrnWriter<W> {
    pub fn new(mut w: W, header: PrnHeader) -> Result<Self, EngineError> {
        w.write_all(&header.to_bytes())?;
        let buf = vec![0u8; header.bytes_per_line as usize];
        Ok(Self { w, header, written: 0, buf })
    }

    /// Write one line: six channel slices of levels 0..=3, one entry per pixel.
    pub fn write_line(&mut self, channels: &[&[u8]; CHANNELS]) -> Result<(), EngineError> {
        for ch in channels {
            if ch.len() != self.header.width_px as usize {
                return Err(EngineError::BadLine(format!(
                    "expected {} pixels, got {}",
                    self.header.width_px,
                    ch.len()
                )));
            }
            pack_levels(ch, &mut self.buf);
            self.w.write_all(&self.buf)?;
        }
        self.written += 1;
        Ok(())
    }

    /// Write whole lines that are already packed: each line is six channels of
    /// `bytes_per_line` bytes, in channel order.
    pub fn write_packed_lines(&mut self, data: &[u8]) -> Result<(), EngineError> {
        let line = self.header.bytes_per_line as usize * CHANNELS;
        if !data.len().is_multiple_of(line) {
            return Err(EngineError::BadLine(format!("{} bytes is not a whole number of lines", data.len())));
        }
        self.w.write_all(data)?;
        self.written += (data.len() / line) as u32;
        Ok(())
    }

    /// Verify the declared line count was written, flush, and return the sink.
    pub fn finish(mut self) -> Result<W, EngineError> {
        if self.written != self.header.lines {
            return Err(EngineError::LineCountMismatch {
                expected: self.header.lines,
                written: self.written,
            });
        }
        self.w.flush()?;
        Ok(self.w)
    }
}
