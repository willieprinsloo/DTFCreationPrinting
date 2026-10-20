use std::fs;
use std::io::Read;
use std::path::Path;

const WRONG_TYPE: &str = "Only .dtfsheet files can be opened or saved here";
const MAX_READ_BYTES: u64 = 50 * 1024 * 1024;

fn check_ext(path: &str) -> Result<(), String> {
    let ok = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("dtfsheet"));
    if ok { Ok(()) } else { Err(WRONG_TYPE.to_string()) }
}

fn read_capped(path: &str, cap: u64) -> Result<String, String> {
    check_ext(path)?;
    let file = fs::File::open(path).map_err(|e| format!("Could not open {path}: {e}"))?;
    let mut buf = String::new();
    file.take(cap + 1)
        .read_to_string(&mut buf)
        .map_err(|e| format!("Could not open {path}: {e}"))?;
    if buf.len() as u64 > cap {
        return Err("That file is too large to be a sheet".to_string());
    }
    Ok(buf)
}

fn write_atomic(path: &str, contents: &str) -> Result<(), String> {
    check_ext(path)?;
    let tmp = format!("{path}.tmp");
    let fail = |e: std::io::Error| format!("Could not save {path}: {e}");
    fs::write(&tmp, contents).map_err(fail)?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        fail(e)
    })
}

#[tauri::command]
pub fn write_sheet_file(path: String, contents: String) -> Result<(), String> {
    write_atomic(&path, &contents)
}

#[tauri::command]
pub fn read_sheet_file(path: String) -> Result<String, String> {
    read_capped(&path, MAX_READ_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(dir: &tempfile::TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().to_string()
    }

    #[test]
    fn round_trips_atomically_and_reports_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = p(&dir, "a.DTFSHEET");
        write_sheet_file(path.clone(), "hello".into()).unwrap();
        write_sheet_file(path.clone(), "again".into()).unwrap();
        assert_eq!(read_sheet_file(path).unwrap(), "again");
        assert!(!dir.path().join("a.DTFSHEET.tmp").exists());
        assert!(read_sheet_file(p(&dir, "nope.dtfsheet")).is_err());
    }

    #[test]
    fn rejects_other_extensions() {
        let dir = tempfile::tempdir().unwrap();
        let bad = p(&dir, "x.txt");
        assert_eq!(write_sheet_file(bad.clone(), "x".into()), Err(WRONG_TYPE.to_string()));
        assert_eq!(read_sheet_file(bad), Err(WRONG_TYPE.to_string()));
        assert_eq!(read_sheet_file(p(&dir, "noext")), Err(WRONG_TYPE.to_string()));
    }

    #[test]
    fn rejects_oversized_reads() {
        let dir = tempfile::tempdir().unwrap();
        let path = p(&dir, "big.dtfsheet");
        write_sheet_file(path.clone(), "0123456789".into()).unwrap();
        assert!(read_capped(&path, 10).is_ok());
        assert!(read_capped(&path, 9).is_err());
    }
}
