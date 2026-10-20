use std::fs;
use std::path::Path;

fn main() {
    stage_pdfium();
    tauri_build::build()
}

/// Copies the pdfium library fetched by `scripts/fetch-pdfium.sh` for the
/// build target into `pdfium/bundle/`, which `tauri.conf.json` ships as the
/// `pdfium/` resource folder. Without it the folder only holds a note and the
/// app reports "PDF support is not installed" when a PDF is opened.
fn stage_pdfium() {
    let root = Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("pdfium");
    let target = std::env::var("TARGET").unwrap_or_default();
    let (dir, lib) = match target.as_str() {
        "aarch64-apple-darwin" => ("mac-arm64", "libpdfium.dylib"),
        "x86_64-apple-darwin" => ("mac-x64", "libpdfium.dylib"),
        "x86_64-pc-windows-msvc" => ("win-x64", "pdfium.dll"),
        _ => ("", ""),
    };
    let bundle = root.join("bundle");
    let _ = fs::remove_dir_all(&bundle);
    fs::create_dir_all(&bundle).expect("create pdfium/bundle");
    let src = root.join(dir);
    println!("cargo:rerun-if-changed={}", src.display());
    if !dir.is_empty() && src.join(lib).is_file() {
        for f in [lib, "LICENSE-pdfium.txt"] {
            if src.join(f).is_file() {
                fs::copy(src.join(f), bundle.join(f)).expect("copy pdfium");
            }
        }
    } else {
        println!("cargo:warning=pdfium for {target} not found: PDFs will not open (run scripts/fetch-pdfium.sh)");
        fs::write(bundle.join("README.txt"), "PDF support was not bundled in this build.\n")
            .expect("write pdfium note");
    }
}
