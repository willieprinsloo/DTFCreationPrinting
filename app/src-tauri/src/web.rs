//! `open_website`: opens a DTF Creations page (e.g. a design's edit page) in the default browser.
//! Only the shop's own site is opened, the same hosts the app loads images from.
use std::process::Command;

/// Hosts the app may open, as (scheme, host, port).
const ALLOWED: [(&str, &str, Option<u16>); 2] = [("https", "dtfcreations.co.za", None), ("http", "localhost", Some(8000))];

/// `url` normalised, if it is a page on the shop's own site.
pub fn allowed_url(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    ALLOWED
        .iter()
        .any(|(s, h, p)| u.scheme() == *s && u.host_str() == Some(*h) && u.port() == *p)
        .then(|| u.to_string())
}

#[tauri::command]
pub fn open_website(url: String) -> Result<(), String> {
    let url = allowed_url(&url).ok_or("Only DTF Creations pages can be opened")?;
    let fail = |e: std::io::Error| format!("Could not open the browser: {e}");
    #[cfg(target_os = "windows")]
    Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn().map_err(fail)?;
    #[cfg(target_os = "macos")]
    Command::new("open").arg(&url).spawn().map_err(fail)?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Command::new("xdg-open").arg(&url).spawn().map_err(fail)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_shop_s_own_pages_open() {
        assert_eq!(
            allowed_url("https://dtfcreations.co.za/admin/gallery?edit=d1").as_deref(),
            Some("https://dtfcreations.co.za/admin/gallery?edit=d1")
        );
        assert!(allowed_url("http://localhost:8000/admin/orders/o1").is_some());
        assert!(allowed_url("https://evil.example/admin").is_none());
        assert!(allowed_url("http://dtfcreations.co.za/admin").is_none());
        assert!(allowed_url("file:///C:/Windows/system32/calc.exe").is_none());
        assert!(allowed_url("not a url").is_none());
    }
}
