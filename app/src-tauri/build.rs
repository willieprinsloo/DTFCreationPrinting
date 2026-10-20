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
    let src = root.join(dir);
    // Watch only this target's folder, and only when it exists: watching a
    // missing path would rerun this script on every build.
    if !dir.is_empty() && src.is_dir() {
        println!("cargo:rerun-if-changed={}", src.display());
    }
    let mut want: Vec<(&str, Vec<u8>)> = Vec::new();
    if !dir.is_empty() && src.join(lib).is_file() {
        for f in [lib, "LICENSE-pdfium.txt"] {
            if let Ok(b) = fs::read(src.join(f)) {
                want.push((f, b));
            }
        }
    } else {
        println!("cargo:warning=pdfium for {target} not found: PDFs will not open (run scripts/fetch-pdfium.sh, then touch build.rs)");
        want.push(("README.txt", b"PDF support was not bundled in this build.\n".to_vec()));
    }
    // tauri-build watches the bundled resources, so only touch files that
    // actually change (rewriting them would rebuild on every build).
    fs::create_dir_all(&bundle).expect("create pdfium/bundle");
    for e in fs::read_dir(&bundle).expect("read pdfium/bundle").flatten() {
        if !want.iter().any(|(f, _)| e.file_name() == *f) {
            let _ = fs::remove_file(e.path());
        }
    }
    for (f, b) in want {
        if fs::read(bundle.join(f)).ok().as_ref() != Some(&b) {
            fs::write(bundle.join(f), b).expect("stage pdfium");
        }
    }
}
