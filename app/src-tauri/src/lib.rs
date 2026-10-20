use tauri::Manager;

mod assets;
mod credentials;
// "prn" is a reserved device name on Windows, so the file can't be prn.rs.
#[path = "prn_jobs.rs"]
mod prn;
mod sheet_files;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(std::sync::Arc::new(prn::PrnJobs::default()))
        .setup(|app| {
            // The bundled pdfium (see build.rs); DTF_PDFIUM_PATH overrides it.
            if let Ok(dir) = app.path().resource_dir() {
                dtf_engine::pdf::set_library_dir(&dir.join("pdfium"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![assets::cache_asset, assets::import_local_file,
            credentials::save_credentials,
            credentials::load_credentials,
            credentials::clear_credentials,
            prn::create_prn,
            prn::create_chart_prn,
            prn::cancel_prn,
            prn::reveal_in_folder,
            sheet_files::write_sheet_file,
            sheet_files::read_sheet_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
