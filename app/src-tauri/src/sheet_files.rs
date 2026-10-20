use std::fs;

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Could not save {path}: {e}"))
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Could not open {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_reports_missing() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.dtfsheet").to_string_lossy().to_string();
        write_text_file(p.clone(), "hello".into()).unwrap();
        assert_eq!(read_text_file(p).unwrap(), "hello");
        assert!(read_text_file(dir.path().join("nope").to_string_lossy().to_string()).is_err());
    }
}
