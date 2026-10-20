pub mod prn;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("not a PRN file (bad magic or header too short)")]
    NotAPrn,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("wrote {written} lines but the header declares {expected}")]
    LineCountMismatch { expected: u32, written: u32 },
    #[error("line {line} is outside the file (it has {lines} lines)")]
    LineOutOfRange { line: u32, lines: u32 },
    #[error("bad line data: {0}")]
    BadLine(String),
}
