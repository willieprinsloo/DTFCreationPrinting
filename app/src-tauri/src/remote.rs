//! Keeping cached downloads up to date with the server.
//!
//! Each cached download keeps the server's fingerprint of the file (its `ETag`, and its
//! `Last-Modified` date) in `<file>.etag`. Before a cached file is used again the server is asked
//! "has it changed since this fingerprint?"; it answers 304 (not changed, a few hundred bytes) or
//! sends the new file. Each address is asked at most once per `RECHECK_AFTER`, and when the
//! server can't be reached the cached file is used as it is.
use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_LENGTH, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// How long a file the server said is unchanged is used without asking again.
pub const RECHECK_AFTER: Duration = Duration::from_secs(10 * 60);

/// The server's fingerprint of a file.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct Fingerprint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
}

impl Fingerprint {
    pub fn of(resp: &Response) -> Self {
        let get = |h| resp.headers().get(h).and_then(|v| v.to_str().ok()).map(str::to_string);
        Self { etag: get(ETAG), last_modified: get(LAST_MODIFIED) }
    }

    fn is_empty(&self) -> bool {
        self.etag.is_none() && self.last_modified.is_none()
    }
}

/// Where the fingerprint of `file` is kept.
pub fn fingerprint_path(file: &Path) -> PathBuf {
    let mut name = file.file_name().unwrap_or_default().to_os_string();
    name.push(".etag");
    file.with_file_name(name)
}

pub fn read_fingerprint(file: &Path) -> Option<Fingerprint> {
    let f: Fingerprint = serde_json::from_slice(&fs::read(fingerprint_path(file)).ok()?).ok()?;
    (!f.is_empty()).then_some(f)
}

/// Saves the fingerprint (or removes a stale one when the server sent none).
pub fn write_fingerprint(file: &Path, f: &Fingerprint) {
    let path = fingerprint_path(file);
    if f.is_empty() {
        let _ = fs::remove_file(path);
    } else if let Ok(json) = serde_json::to_vec(f) {
        let _ = fs::write(path, json);
    }
}

static CHECKED: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Default::default);

/// Whether the server confirmed `url` within the last `RECHECK_AFTER`.
pub fn recently_checked(url: &str) -> bool {
    let checked = CHECKED.lock().unwrap_or_else(|e| e.into_inner());
    checked.get(url).is_some_and(|t| t.elapsed() < RECHECK_AFTER)
}

pub fn mark_checked(url: &str) {
    CHECKED.lock().unwrap_or_else(|e| e.into_inner()).insert(url.to_string(), Instant::now());
}

/// What the server said about a cached file.
pub enum Check {
    /// Not changed: keep using the cached file.
    Unchanged,
    /// Changed: the new file is in this response (status 200).
    Changed(Response),
    /// No answer (offline, server error, file gone): keep using the cached file for now.
    Unknown,
}

/// Asks the server whether `url` changed since `cached` was saved. A file cached before
/// fingerprints were kept is compared by size when it is the server's file itself (`whole`), and
/// its fingerprint saved if the size matches; something made from it (a thumbnail) just takes
/// the server's current fingerprint.
pub fn check(client: &Client, url: &str, bearer: Option<&str>, cached: &Path, whole: bool) -> Check {
    let auth = |r: reqwest::blocking::RequestBuilder| match bearer {
        Some(t) => r.bearer_auth(t),
        None => r,
    };
    let Some(known) = read_fingerprint(cached) else {
        let Ok(head) = auth(client.head(url)).send() else { return Check::Unknown };
        if !head.status().is_success() {
            return Check::Unknown;
        }
        let len = head.headers().get(CONTENT_LENGTH).and_then(|v| v.to_str().ok()?.parse::<u64>().ok());
        let have = fs::metadata(cached).map(|m| m.len()).ok();
        if !whole || (len.is_some() && len == have) {
            write_fingerprint(cached, &Fingerprint::of(&head));
            return Check::Unchanged;
        }
        return match auth(client.get(url)).send() {
            Ok(r) if r.status().is_success() => Check::Changed(r),
            _ => Check::Unknown,
        };
    };
    let mut req = auth(client.get(url));
    if let Some(e) = &known.etag {
        req = req.header(IF_NONE_MATCH, e);
    }
    if let Some(d) = &known.last_modified {
        req = req.header(IF_MODIFIED_SINCE, d);
    }
    match req.send() {
        Ok(r) if r.status() == StatusCode::NOT_MODIFIED => Check::Unchanged,
        Ok(r) if r.status().is_success() => {
            // A server that ignores the question sends the file again; same fingerprint, same file.
            if Fingerprint::of(&r).etag.is_some_and(|e| known.etag.as_ref() == Some(&e)) {
                Check::Unchanged
            } else {
                Check::Changed(r)
            }
        }
        _ => Check::Unknown,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::Arc;

    /// A tiny server for `path`: answers 304 when asked with `etag`, else sends `body()` with
    /// `etag`. Counts the full downloads it sent.
    pub fn serve(body: Arc<Mutex<Vec<u8>>>, etag: Arc<Mutex<String>>) -> (String, Arc<Mutex<usize>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/f.png", l.local_addr().unwrap());
        let sent = Arc::new(Mutex::new(0));
        let n = sent.clone();
        std::thread::spawn(move || {
            for s in l.incoming().flatten() {
                let mut r = BufReader::new(s.try_clone().unwrap());
                let (mut head, mut asked) = (String::new(), None);
                loop {
                    let mut line = String::new();
                    if r.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if head.is_empty() {
                        head = line.clone();
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("if-none-match: ") {
                        asked = Some(v.trim().to_string());
                    }
                }
                let (body, tag) = (body.lock().unwrap().clone(), etag.lock().unwrap().clone());
                let mut s = s;
                if asked.as_deref() == Some(tag.to_ascii_lowercase().as_str()) {
                    let _ = write!(s, "HTTP/1.1 304 Not Modified\r\nETag: {tag}\r\nContent-Length: 0\r\n\r\n");
                    continue;
                }
                let _ = write!(s, "HTTP/1.1 200 OK\r\nETag: {tag}\r\nContent-Length: {}\r\n\r\n", body.len());
                if !head.starts_with("HEAD") {
                    *n.lock().unwrap() += 1;
                    let _ = s.write_all(&body);
                }
            }
        });
        (url, sent)
    }

    /// Makes `url` due for a check again.
    pub fn forget_check(url: &str) {
        CHECKED.lock().unwrap().remove(url);
    }

    #[test]
    fn fingerprints_round_trip_and_an_empty_one_is_not_kept() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.png");
        let fp = Fingerprint { etag: Some("\"1-2\"".into()), last_modified: None };
        write_fingerprint(&f, &fp);
        assert_eq!(fingerprint_path(&f), d.path().join("a.png.etag"));
        assert_eq!(read_fingerprint(&f), Some(fp));
        write_fingerprint(&f, &Fingerprint::default());
        assert_eq!(read_fingerprint(&f), None);
    }

    #[test]
    fn the_server_is_asked_once_and_a_changed_file_comes_back() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.png");
        fs::write(&f, b"old!").unwrap();
        let (body, tag) = (Arc::new(Mutex::new(b"old!".to_vec())), Arc::new(Mutex::new("\"v1\"".to_string())));
        let (url, sent) = serve(body.clone(), tag.clone());
        let c = Client::new();
        // Cached before fingerprints were kept: same size, so it is kept and fingerprinted.
        assert!(matches!(check(&c, &url, None, &f, true), Check::Unchanged));
        assert_eq!(read_fingerprint(&f).unwrap().etag.as_deref(), Some("\"v1\""));
        assert!(matches!(check(&c, &url, None, &f, true), Check::Unchanged));
        assert_eq!(*sent.lock().unwrap(), 0, "nothing downloaded while unchanged");
        *body.lock().unwrap() = b"new file".to_vec();
        *tag.lock().unwrap() = "\"v2\"".into();
        match check(&c, &url, None, &f, true) {
            Check::Changed(r) => assert_eq!(r.bytes().unwrap().as_ref(), b"new file"),
            _ => panic!("expected the new file"),
        }
        // No server: keep the cached file.
        assert!(matches!(check(&c, "http://127.0.0.1:9/f.png", None, &f, true), Check::Unknown));
    }

    #[test]
    fn an_old_file_of_another_size_is_downloaded_again_unless_it_was_made_from_the_server_s() {
        let d = tempfile::tempdir().unwrap();
        let (f, t) = (d.path().join("a.png"), d.path().join("t.png"));
        fs::write(&f, b"x").unwrap();
        fs::write(&t, b"x").unwrap();
        let (url, _) = serve(Arc::new(Mutex::new(b"server".to_vec())), Arc::new(Mutex::new("\"v\"".into())));
        assert!(matches!(check(&Client::new(), &url, None, &f, true), Check::Changed(_)));
        assert!(matches!(check(&Client::new(), &url, None, &t, false), Check::Unchanged));
    }

    #[test]
    fn recent_checks_are_remembered_per_address() {
        assert!(!recently_checked("https://x/remembered.png"));
        mark_checked("https://x/remembered.png");
        assert!(recently_checked("https://x/remembered.png"));
        assert!(!recently_checked("https://x/other.png"));
    }
}
