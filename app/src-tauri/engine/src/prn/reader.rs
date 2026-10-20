use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use super::{CHANNELS, HEADER_LEN, PrnHeader, unpack_levels};
use crate::EngineError;

pub struct PrnReader {
    file: File,
    header: PrnHeader,
}

impl PrnReader {
    pub fn open(path: &Path) -> Result<Self, EngineError> {
        let mut file = File::open(path)?;
        let mut hb = [0u8; HEADER_LEN];
        let mut n = 0;
        while n < HEADER_LEN {
            let r = file.read(&mut hb[n..])?;
            if r == 0 {
                break;
            }
            n += r;
        }
        let header = PrnHeader::parse(&hb[..n])?;
        Ok(Self { file, header })
    }

    pub fn header(&self) -> &PrnHeader {
        &self.header
    }

    /// Read line `i` and return the unpacked levels (0..=3) of all six channels.
    pub fn read_line(&mut self, i: u32) -> Result<[Vec<u8>; CHANNELS], EngineError> {
        let h = &self.header;
        if i >= h.lines {
            return Err(EngineError::LineOutOfRange { line: i, lines: h.lines });
        }
        let bpl = h.bytes_per_line as u64;
        let offset = HEADER_LEN as u64 + i as u64 * CHANNELS as u64 * bpl;
        let width = h.width_px as usize;
        self.file.seek(SeekFrom::Start(offset))?;
        let mut buf = vec![0u8; bpl as usize];
        let mut out: [Vec<u8>; CHANNELS] = Default::default();
        for ch in out.iter_mut() {
            self.file.read_exact(&mut buf)?;
            *ch = unpack_levels(&buf, width);
        }
        Ok(out)
    }
}
