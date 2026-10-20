use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "za.co.dtfcreations.printstudio";
const USER: &str = "dtf-creations-login";

#[derive(Serialize, Deserialize, PartialEq)]
pub struct Credentials {
    pub email: String,
    pub password: String,
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("email", &self.email)
            .field("password", &"<redacted>")
            .finish()
    }
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USER).map_err(|e| e.to_string())
}

pub(crate) fn save(c: &Credentials) -> Result<(), String> {
    let json = serde_json::to_string(c).map_err(|e| e.to_string())?;
    entry()?.set_password(&json).map_err(|e| e.to_string())
}

pub(crate) fn load() -> Result<Option<Credentials>, String> {
    match entry()?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_credentials(email: String, password: String) -> Result<(), String> {
    save(&Credentials { email, password })
}

#[tauri::command]
pub fn load_credentials() -> Result<Option<Credentials>, String> {
    load()
}

#[tauri::command]
pub fn clear_credentials() -> Result<(), String> {
    clear()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_serialize_round_trip() {
        let c = Credentials { email: "a@b.c".into(), password: "p\"w".into() };
        let back: Credentials = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }

    #[test]
    fn debug_output_redacts_the_password() {
        let c = Credentials { email: "a@b.c".into(), password: "hunter2-secret".into() };
        let out = format!("{:?}", c);
        assert!(!out.contains("hunter2-secret"));
        assert!(out.contains("a@b.c"));
    }

    /// Needs the OS keychain (may prompt); run manually: cargo test -- --ignored
    #[test]
    #[ignore]
    fn keychain_round_trip() {
        let c = Credentials { email: "test@example.com".into(), password: "secret".into() };
        save(&c).unwrap();
        assert_eq!(load().unwrap(), Some(c));
        clear().unwrap();
        assert_eq!(load().unwrap(), None);
    }
}
