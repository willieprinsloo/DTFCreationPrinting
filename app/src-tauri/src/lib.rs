mod assets;
mod credentials;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![assets::cache_asset, assets::import_local_file,
            credentials::save_credentials,
            credentials::load_credentials,
            credentials::clear_credentials
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
