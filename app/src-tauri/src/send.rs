//! `send_prn`: sends a finished PRN to ATools over the network, so it prints without exporting
//! and opening the file. ATools listens on TCP port 9100 while it is open: it takes the 48-byte
//! `fyft` header, then the raster lines, saves them as a job and starts printing while the rest
//! arrives (see the ATools notes in the project memory). The connection is closed to end the job.
use crate::prn::{PrnJobs, CANCELLED};
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// The port ATools takes print jobs on.
pub const ATOOLS_PORT: u16 = 9100;
const CHUNK: usize = 1 << 20;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SendProgress<'a> {
    job_id: &'a str,
    fraction: f32,
}

/// Streams the PRN at `path` to `host`:`port`; `progress` gets the fraction sent, `cancel` stops it.
pub fn send_file(path: &Path, host: &str, port: u16, cancel: &AtomicBool, progress: &mut dyn FnMut(f32)) -> Result<u64, String> {
    let mut file = File::open(path).map_err(|e| format!("Could not open the PRN: {e}"))?;
    let total = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut head = [0u8; 4];
    if file.read_exact(&mut head).is_err() || &head != b"fyft" {
        return Err("This file is not a PRN made for the printer".into());
    }
    let host = host.trim();
    let not_reached = |why: String| {
        format!("Could not reach the printing software (ATools) at {host}, port {port}: {why}. Check that ATools is open on that computer and that Windows Firewall lets it accept connections.")
    };
    let addr = (host, port)
        .to_socket_addrs()
        .map_err(|e| not_reached(e.to_string()))?
        .next()
        .ok_or_else(|| not_reached("unknown address".into()))?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5)).map_err(|e| not_reached(e.to_string()))?;
    let _ = stream.set_write_timeout(Some(Duration::from_secs(120)));
    let _ = stream.set_nodelay(true);
    let lost = |e: std::io::Error| format!("The connection to ATools was lost while sending: {e}");
    stream.write_all(&head).map_err(lost)?;
    let mut sent = head.len() as u64;
    let mut buf = vec![0u8; CHUNK];
    loop {
        if cancel.load(Ordering::Relaxed) {
            // Closing early leaves ATools with a short job, which it reports and does not print in full.
            let _ = stream.shutdown(Shutdown::Both);
            return Err(CANCELLED.into());
        }
        let n = file.read(&mut buf).map_err(|e| format!("Could not read the PRN: {e}"))?;
        if n == 0 {
            break;
        }
        stream.write_all(&buf[..n]).map_err(lost)?;
        sent += n as u64;
        progress(if total > 0 { sent as f32 / total as f32 } else { 0.0 });
    }
    stream.flush().map_err(lost)?;
    // Closing our side tells ATools the job is complete.
    let _ = stream.shutdown(Shutdown::Write);
    progress(1.0);
    Ok(sent)
}

#[tauri::command]
pub async fn send_prn(app: AppHandle, jobs: State<'_, Arc<PrnJobs>>, path: String, host: String, job_id: String) -> Result<u64, String> {
    let jobs = jobs.inner().clone();
    let flag = jobs.start(&job_id);
    let id = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut last = -1.0f32;
        send_file(Path::new(&path), &host, ATOOLS_PORT, &flag, &mut |fraction| {
            if fraction >= 1.0 || fraction - last >= 0.01 {
                last = fraction;
                let _ = app.emit("send-progress", SendProgress { job_id: &id, fraction });
            }
        })
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()));
    jobs.finish(&job_id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn sends_the_whole_prn_and_closes_so_atools_knows_it_is_complete() {
        let d = tempfile::tempdir().unwrap();
        let prn = d.path().join("a.prn");
        let mut body = b"fyft".to_vec();
        body.extend((0..3_000_000u32).map(|i| (i % 251) as u8));
        std::fs::write(&prn, &body).unwrap();
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let got = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut all = Vec::new();
            s.read_to_end(&mut all).unwrap(); // returns once the sender closes
            all
        });
        let mut seen = Vec::new();
        let n = send_file(&prn, "127.0.0.1", port, &AtomicBool::new(false), &mut |f| seen.push(f)).unwrap();
        assert_eq!(n, body.len() as u64);
        assert_eq!(got.join().unwrap(), body);
        assert_eq!(seen.last(), Some(&1.0));
    }

    #[test]
    fn refuses_other_files_and_explains_an_unreachable_atools() {
        let d = tempfile::tempdir().unwrap();
        let not_prn = d.path().join("x.png");
        std::fs::write(&not_prn, b"\x89PNG....").unwrap();
        let err = send_file(&not_prn, "127.0.0.1", 9, &AtomicBool::new(false), &mut |_| {}).unwrap_err();
        assert!(err.contains("not a PRN"), "{err}");
        let prn = d.path().join("a.prn");
        std::fs::write(&prn, b"fyft rest").unwrap();
        // A port nothing listens on.
        let free = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let err = send_file(&prn, "127.0.0.1", free, &AtomicBool::new(false), &mut |_| {}).unwrap_err();
        assert!(err.contains("ATools") && err.contains(&free.to_string()), "{err}");
    }

    #[test]
    fn cancel_stops_sending() {
        let d = tempfile::tempdir().unwrap();
        let prn = d.path().join("a.prn");
        std::fs::write(&prn, [b"fyft".as_slice(), &vec![0u8; 5_000_000]].concat()).unwrap();
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let t = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut sink = Vec::new();
            let _ = s.read_to_end(&mut sink);
        });
        let err = send_file(&prn, "127.0.0.1", port, &AtomicBool::new(true), &mut |_| {}).unwrap_err();
        assert_eq!(err, CANCELLED);
        t.join().unwrap();
    }
}
