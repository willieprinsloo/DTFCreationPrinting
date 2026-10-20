mod assets;
mod credentials;
mod prn;
mod sheet_files;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(std::sync::Arc::new(prn::PrnJobs::default()))
        .invoke_handler(tauri::generate_handler![assets::cache_asset, assets::import_local_file,
            credentials::save_credentials,
            credentials::load_credentials,
            credentials::clear_credentials,
            prn::create_prn,
            prn::cancel_prn,
            prn::reveal_in_folder,
            sheet_files::write_sheet_file,
            sheet_files::read_sheet_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
