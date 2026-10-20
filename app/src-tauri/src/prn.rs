/// Plan 1 stub: the PRN engine arrives in the next release.
#[tauri::command]
pub fn create_prn(sheet_json: String, out_path: String) -> Result<(), String> {
    let _ = (sheet_json, out_path);
    Err("The PRN engine is not installed yet (coming in the next release)".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stub_reports_engine_missing() {
        assert_eq!(
            create_prn("{}".into(), "/tmp/x.prn".into()),
            Err("The PRN engine is not installed yet (coming in the next release)".to_string())
        );
    }
}
