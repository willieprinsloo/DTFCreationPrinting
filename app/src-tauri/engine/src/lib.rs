pub mod charts;
pub mod colour;
pub mod compose;
pub mod pdf;
pub mod prn;
pub mod profile;
pub mod screen;
pub mod source;
pub mod spec;
pub mod white;

pub use compose::render_prn;
pub use spec::{EngineSettings, ItemSpec, JobSpec, PrnStats};

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("not a PRN file (bad magic or header too short)")]
    NotAPrn,
    #[error("unusable PRN header: {0}")]
    BadHeader(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("wrote {written} lines but the header declares {expected}")]
    LineCountMismatch { expected: u32, written: u32 },
    #[error("line {line} is outside the file (it has {lines} lines)")]
    LineOutOfRange { line: u32, lines: u32 },
    #[error("bad line data: {0}")]
    BadLine(String),
    #[error("could not read the image: {0}")]
    Decode(String),
    #[error("PDF support is not installed")]
    PdfNotInstalled,
    #[error("could not read the PDF: {0}")]
    Pdf(String),
    #[error("colour profile problem: {0}")]
    Icc(String),
    #[error("there is nothing to print")]
    NothingToPrint,
    #[error("cancelled")]
    Cancelled,
    #[error("invalid print settings: {0}")]
    BadSettings(String),
    #[error("internal error while printing: {0}")]
    Internal(String),
}
