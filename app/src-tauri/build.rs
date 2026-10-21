use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    stage_pdfium();
    stage_realesrgan();
    tauri_build::build()
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
}

/// Copies the pdfium library fetched by `scripts/fetch-pdfium.sh` for the
/// build target into `pdfium/bundle/`, which `tauri.conf.json` ships as the
/// `pdfium/` resource folder. Without it the folder only holds a note and the
/// app reports "PDF support is not installed" when a PDF is opened.
fn stage_pdfium() {
    let root = manifest_dir().join("pdfium");
    let target = std::env::var("TARGET").unwrap_or_default();
    let (dir, lib) = match target.as_str() {
        "aarch64-apple-darwin" => ("mac-arm64", "libpdfium.dylib"),
        "x86_64-apple-darwin" => ("mac-x64", "libpdfium.dylib"),
        "x86_64-pc-windows-msvc" => ("win-x64", "pdfium.dll"),
        _ => ("", ""),
    };
    let src = root.join(dir);
    let mut want: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    if !dir.is_empty() && src.join(lib).is_file() {
        watch(&src);
        for f in [lib, "LICENSE-pdfium.txt"] {
            if let Ok(b) = fs::read(src.join(f)) {
                want.push((f.into(), b));
            }
        }
    } else {
        println!("cargo:warning=pdfium for {target} not found: PDFs will not open (run scripts/fetch-pdfium.sh, then touch build.rs)");
        want.push(("README.txt".into(), b"PDF support was not bundled in this build.\n".to_vec()));
    }
    sync(&root.join("bundle"), want);
}

/// Copies the Real-ESRGAN upscaler fetched by `scripts/fetch-realesrgan.sh` (program,
/// models, licences) into `realesrgan/bundle/`, shipped as the `realesrgan/` resource
/// folder. Without it "Enhance" reports that it is not installed.
fn stage_realesrgan() {
    let root = manifest_dir().join("realesrgan");
    let target = std::env::var("TARGET").unwrap_or_default();
    let (dir, exe) = match target.as_str() {
        "aarch64-apple-darwin" | "x86_64-apple-darwin" => ("mac", "realesrgan-ncnn-vulkan"),
        "x86_64-pc-windows-msvc" => ("win", "realesrgan-ncnn-vulkan.exe"),
        _ => ("", ""),
    };
    let src = root.join(dir);
    let mut want: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    if !dir.is_empty() && src.join(exe).is_file() {
        watch(&src);
        for sub in ["", "models"] {
            for e in fs::read_dir(src.join(sub)).expect("read realesrgan").flatten() {
                if e.path().is_file() {
                    let rel = Path::new(sub).join(e.file_name());
                    want.push((rel, fs::read(e.path()).expect("read realesrgan file")));
                }
            }
        }
    } else {
        println!("cargo:warning=Real-ESRGAN for {target} not found: Enhance will not work (run scripts/fetch-realesrgan.sh, then touch build.rs)");
        want.push(("README.txt".into(), b"The Real-ESRGAN upscaler was not bundled in this build.\n".to_vec()));
    }
    sync(&root.join("bundle"), want);
}

/// Reruns this script when a fetched folder changes. Only existing folders are
/// watched: watching a missing path would rerun it on every build.
fn watch(dir: &Path) {
    println!("cargo:rerun-if-changed={}", dir.display());
}

/// Makes `bundle` hold exactly `want` (paths relative to it). tauri-build
/// watches the bundled resources, so only files that actually change are
/// touched (rewriting them would rebuild on every build).
fn sync(bundle: &Path, want: Vec<(PathBuf, Vec<u8>)>) {
    fs::create_dir_all(bundle).expect("create bundle folder");
    for sub in ["", "models"] {
        let Ok(entries) = fs::read_dir(bundle.join(sub)) else { continue };
        for e in entries.flatten() {
            let rel = Path::new(sub).join(e.file_name());
            if e.path().is_file() && !want.iter().any(|(f, _)| *f == rel) {
                let _ = fs::remove_file(e.path());
            }
        }
    }
    for (f, b) in want {
        let dst = bundle.join(&f);
        if fs::read(&dst).ok().as_ref() != Some(&b) {
            fs::create_dir_all(dst.parent().unwrap()).expect("create bundle folder");
            fs::write(&dst, b).expect("stage bundled file");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&dst, fs::Permissions::from_mode(0o755));
            }
        }
    }
}
