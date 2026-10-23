//! `send_prn`: sends a finished PRN to ATools over the network, so it prints without exporting
//! and opening the file. ATools listens on TCP port 9100 once it is connected to the printer: it
//! takes the 48-byte `fyft` header, then the raster lines, saves them as a job and starts printing
//! while the rest arrives (see the ATools notes in the project memory). Closing the connection
//! ends the job.
//!
//! ATools reads without waiting (non-blocking socket): right after accepting it reads the header
//! once and hangs up if fewer than 48 bytes are there, and it takes the first moment with no data
//! waiting as the end of the job. So the header goes out whole, straight after connecting, and the
//! rest follows in large pieces with nothing slowing the loop.
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
const CHUNK: usize = 8 << 20;
/// The PRN header ATools reads in one go.
const HEADER_LEN: usize = 48;

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
    let mut head = [0u8; HEADER_LEN];
    if file.read_exact(&mut head).is_err() || &head[..4] != b"fyft" {
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
    // Read ahead on another thread, so the socket never waits on the disk; the first piece is
    // ready before connecting, so it follows the header at once.
    let (tx, rx) = std::sync::mpsc::sync_channel::<std::io::Result<Vec<u8>>>(3);
    let reader = std::thread::spawn(move || loop {
        let mut buf = vec![0u8; CHUNK];
        let mut filled = 0;
        let res = loop {
            match file.read(&mut buf[filled..]) {
                Ok(0) => break Ok(()),
                Ok(n) => {
                    filled += n;
                    if filled == CHUNK {
                        break Ok(());
                    }
                }
                Err(e) => break Err(e),
            }
        };
        buf.truncate(filled);
        let end = filled < CHUNK || res.is_err();
        let msg = res.map(|_| buf);
        if tx.send(msg).is_err() || end {
            return;
        }
    });
    let read_err = |e: std::io::Error| format!("Could not read the PRN: {e}");
    let mut next = Some(rx.recv().map_err(|_| "Could not read the PRN".to_string())?.map_err(read_err)?);
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5)).map_err(|e| not_reached(e.to_string()))?;
    let _ = stream.set_write_timeout(Some(Duration::from_secs(120)));
    // One segment for the header, sent at once (see the module notes).
    let _ = stream.set_nodelay(true);
    let lost = |e: std::io::Error| format!("The connection to ATools was lost while sending: {e}");
    stream.write_all(&head).map_err(lost)?;
    let mut sent = head.len() as u64;
    while let Some(chunk) = next.take() {
        if cancel.load(Ordering::Relaxed) {
            // Closing early leaves ATools with a short job, which it reports and does not print in full.
            let _ = stream.shutdown(Shutdown::Both);
            return Err(CANCELLED.into());
        }
        if chunk.is_empty() {
            break;
        }
        stream.write_all(&chunk).map_err(lost)?;
        sent += chunk.len() as u64;
        progress(if total > 0 { (sent as f32 / total as f32).min(0.999) } else { 0.0 });
        if chunk.len() == CHUNK {
            next = Some(rx.recv().map_err(|_| "Could not read the PRN".to_string())?.map_err(read_err)?);
        }
    }
    drop(rx);
    let _ = reader.join();
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
    fn uses_atools_job_port_9100_and_never_4000() {
        // 4000 is the port ATools' own board link once used; the app must not touch it.
        assert_eq!(ATOOLS_PORT, 9100);
    }

    #[test]
    fn refuses_other_files_and_explains_an_unreachable_atools() {
        let d = tempfile::tempdir().unwrap();
        let not_prn = d.path().join("x.png");
        std::fs::write(&not_prn, b"\x89PNG....").unwrap();
        let err = send_file(&not_prn, "127.0.0.1", 9, &AtomicBool::new(false), &mut |_| {}).unwrap_err();
        assert!(err.contains("not a PRN"), "{err}");
        let prn = d.path().join("a.prn");
        std::fs::write(&prn, [b"fyft".as_slice(), &[0u8; 60]].concat()).unwrap();
        // A port nothing listens on.
        let free = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let err = send_file(&prn, "127.0.0.1", free, &AtomicBool::new(false), &mut |_| {}).unwrap_err();
        assert!(err.contains("ATools") && err.contains(&free.to_string()), "{err}");
    }

    #[test]
    fn the_whole_header_is_there_for_atools_single_read() {
        // ATools reads the 48-byte header once, without waiting; a split header made it hang up.
        let d = tempfile::tempdir().unwrap();
        let prn = d.path().join("a.prn");
        let mut body = b"fyft".to_vec();
        body.extend((4..HEADER_LEN as u8).collect::<Vec<u8>>());
        body.extend(vec![7u8; 100_000]);
        std::fs::write(&prn, &body).unwrap();
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let head = body[..HEADER_LEN].to_vec();
        let t = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            std::thread::sleep(Duration::from_millis(50));
            let mut first = [0u8; HEADER_LEN];
            let n = s.read(&mut first).unwrap();
            let mut rest = Vec::new();
            s.read_to_end(&mut rest).unwrap();
            (n, first, rest.len())
        });
        send_file(&prn, "127.0.0.1", port, &AtomicBool::new(false), &mut |_| {}).unwrap();
        let (n, first, rest) = t.join().unwrap();
        assert_eq!(n, HEADER_LEN, "one read gets the whole header");
        assert_eq!(first.to_vec(), head);
        assert_eq!(rest, body.len() - HEADER_LEN);
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
