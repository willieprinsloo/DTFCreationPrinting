# DTF Print Studio — PRN Engine Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `create_prn` stub with a fast Rust engine that turns a laid-out sheet into a `fyft` PRN the existing printing software accepts — mirrored, colour-converted, white underbase, ink-limited, screened to 4 dot levels, trimmed to content — with test-print checkpoints against Maintop.

**Architecture:** A standalone Rust library crate `dtf-engine` (path dependency of the Tauri crate) with pure, unit-testable stages: source preparation (decode → per-design CMYK+W planes at source resolution, cached) → band compositor (place/rotate/scale/mirror into 720×1800 dpi output bands) → ink limit → multi-level screening → `fyft` writer streaming bands to disk. A `prn-tool` CLI binary in the crate renders test charts and inspects/previews PRNs (ours and Maintop's). The Tauri `create_prn` command runs the engine on a background thread with progress events and cancellation.

**Tech Stack:** Rust (edition 2024), `image` 0.25, `rayon`, `lcms2` (optional ICC), `pdfium-render` (Task 8), `serde`/`serde_json`; Tauri 2 events; React/TS for the progress UI and profile settings.

**Spec:** `docs/superpowers/specs/2026-10-20-dtf-print-studio-design.md` (§5 parity table, §6 PRN format, §9 quality bar incl. ≤15 s per metre).

## Global Constraints

- Output format exactly as decoded from Maintop's `willie.prn` (spec §6): 48-byte little-endian header, magic `fyft`, X dpi 720, Y dpi 1800, bytes-per-line-per-channel, line count, width px, f32 width in metres, u16 channel count 6, u16 `1`, u32 `12`, zero padding to 48; body line-interleaved (line → channel 0..5 → bytes), 2 bits/pixel MSB-first, values 0 none / 1 small / 2 medium / 3 large, line padded to a multiple of 32 bytes.
- Header f32 at 0x18 = `widthPx / xDpi × 0.0254` (verified: 17007 px → bytes `94 97 19 3f`). Width px = `floor(widthMm / 25.4 × xDpi)` (600 mm → 17007). Bytes per line = `ceil(ceil(widthPx×2/8)/32)×32` (→ 4256).
- Default channel map (configurable per printer profile): ch0 K, ch1 C, ch2 M, ch3 Y, ch4 W, ch5 W — **unconfirmed until Checkpoint 1**.
- Sources are un-mirrored PNG/JPEG/TIFF (and PDF after Task 8); the engine mirrors once (horizontal flip of the whole sheet) when `mirror` is on. Never use DTF Creations' `format=tiff` downloads.
- PRN is trimmed to content: first line = top of the highest item bbox minus `leadInMm` (default 0), last line = bottom of the lowest item bbox.
- Never hold the full output sheet in memory; process in bands (default 256 lines) and stream to disk; write to `<out>.part` then rename.
- Performance target: ≤15 s per metre of 60 cm film on a recent 8-core machine (release build), measured by a benchmark test.
- Engine settings live on the printer profile (extend `PrinterProfile`): `channelOrder`, `inkLimitPct` (default 280), `whiteDensityPct` (default 100), `whiteChokeMm` (default 0.2), `screening` ('blueNoise' | 'errorDiffusion', default 'blueNoise'), `dotGain` curve points per channel (default linear), `leadInMm` (default 0), optional `iccProfilePath`.
- Plain-English UI copy; Mac + Windows.

## Review Focus

1. **Item partly outside the band / rotated 90°/arbitrary angle** — compositor samples correctly at band edges and for rotation; covered by golden tests in Task 5.
2. **Transparent edges (anti-aliased alpha)** — colour and white respect fractional alpha; no white halo beyond the choke; Task 3 tests.
3. **Huge or 16-bit sources** — decode limits respected, 16-bit TIFF converted correctly; Task 3 tests.
4. **Cancel mid-render / disk full** — `.part` file removed, no partial `.prn` left; Task 6 tests.
5. **Empty sheet / item exactly on margin / zero-length content** — engine refuses with a clear error instead of writing a 0-line PRN; Task 5 tests.

---

## File Structure

```
app/src-tauri/engine/                 new crate `dtf-engine`
  Cargo.toml
  src/lib.rs                          pub API: JobSpec, render_prn, PrnStats, EngineError
  src/spec.rs                         JobSpec / ItemSpec / EngineSettings (serde, from the app's Sheet JSON)
  src/prn/header.rs                   PrnHeader write/read
  src/prn/writer.rs                   streaming line writer (pack 2bpp, padding)
  src/prn/reader.rs                   decoder for tests + CLI (any fyft file, incl. Maintop's)
  src/source.rs                       decode sources → PreparedSource {cmyk: [Plane;4], white: Plane, w, h} (cached)
  src/colour.rs                       RGB(A)→CMYK (built-in GCR model; optional lcms2 ICC)
  src/white.rs                        white mask from alpha, density, choke (anisotropic erosion)
  src/screen.rs                       blue-noise multi-level + error diffusion; dot-gain curves
  src/compose.rs                      band compositor (placement, rotation, scale, mirror, ink limit)
  src/bin/prn-tool.rs                 CLI: inspect / preview / chart
  tests/fixtures/maintop_sample_8lines.prn   (exists: 8 real lines from willie.prn, header lines=8)
  tests/*.rs                          integration + golden tests
app/src-tauri/src/prn.rs              create_prn command → engine (thread, progress, cancel)
app/src/features/prn/PreflightDialog.tsx   progress bar, cancel, mark orders in production
app/src/features/settings/EngineSettings.tsx   printer-profile engine settings
docs/printing/test-print-checkpoints.md    instructions + results log for Checkpoints 1–4
```

---

### Task 1: Engine crate, `fyft` header/writer/reader

**Files:** Create `app/src-tauri/engine/{Cargo.toml,src/lib.rs,src/prn/{mod,header,writer,reader}.rs}`, `tests/prn_format.rs`; Modify `app/src-tauri/Cargo.toml` (path dep `dtf-engine = { path = "engine" }`, workspace members).

**Interfaces — Produces:**
```rust
pub struct PrnHeader { pub x_dpi: u32, pub y_dpi: u32, pub bytes_per_line: u32, pub lines: u32, pub width_px: u32, pub width_m: f32, pub channels: u16, pub flag_1e: u16, pub field_20: u32 }
impl PrnHeader {
  pub fn for_width(width_mm: f64, x_dpi: u32, y_dpi: u32, lines: u32) -> Self // channels 6, flag_1e 1, field_20 12
  pub fn to_bytes(&self) -> [u8; 48]; pub fn parse(b: &[u8]) -> Result<Self, EngineError>
}
pub fn bytes_per_line(width_px: u32) -> u32
pub struct PrnWriter<W: Write> { .. } // new(w, header) writes header; write_line(&[&[u8]; 6]) where each slice = levels 0..3 per pixel (len width_px); finish() verifies line count
pub struct PrnReader { .. } // open(path); header(); read_line(i) -> [Vec<u8>; 6] unpacked levels
```
- [ ] **Step 1: Failing tests:** `for_width(600.0,720,1800,8).to_bytes()` equals the first 48 bytes of `tests/fixtures/maintop_sample_8lines.prn` **exactly**; `bytes_per_line(17007)==4256`, `bytes_per_line(1)==32`; parse(fixture) → lines 8, width_px 17007, channels 6; writer round-trip: write 3 lines of known levels (incl. width not multiple of 4) → reader returns the same levels and file size == 48+3×6×bpl; reader on the fixture: line 0 channel 4 has ≥1000 non-zero pixels (white present), and unpack(pack(x))==x for random levels; parse rejects wrong magic with `EngineError::NotAPrn`.
- [ ] **Step 2: Run** `cd app/src-tauri && cargo test -p dtf-engine` → FAIL. **Step 3: Implement.** **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(engine): fyft PRN header, writer and reader`

### Task 2: `prn-tool` CLI + Checkpoint 1 (channel order, header acceptance, trimmed length)

**Files:** Create `src/bin/prn-tool.rs`, `docs/printing/test-print-checkpoints.md`.

**Interfaces:** `prn-tool inspect <file>` (prints header + per-channel coverage % + content line range); `prn-tool preview <file> <out.png> [--scale 0.1]` (composite preview: CMYK over white-on-grey, white shown separately as a side panel); `prn-tool chart channels <out.prn> --width-mm 600` (writes a 600 × 120 mm PRN: six 80×80 mm squares in a row, square i filled ONLY in channel i at level 3, plus a 2 mm black-ink label strip under each square drawn in that square's own channel with the digit 0–5 as 10 mm high blocky glyphs; trimmed, no lead-in).
- [ ] **Step 1: Failing tests:** `chart channels` output parses, has lines = ceil(120/25.4×1800)=8504, and square i region has non-zero pixels only in channel i; `preview` of the fixture produces a PNG of expected dimensions.
- [ ] **Step 2–4:** implement, pass.
- [ ] **Step 5:** Write `docs/printing/test-print-checkpoints.md` with **Checkpoint 1** instructions for the user: copy `channels.prn` to the printer PC, open it in the printing software, print; record which physical colour each numbered square printed (expected K C M Y W W), whether the software accepted the file (header), and whether it printed only 12 cm (trimmed length accepted). Include a results table to fill in.
- [ ] **Step 6: Commit** `feat(engine): prn-tool inspect/preview/chart and checkpoint 1 guide`
- [ ] **Step 7: STOP for Checkpoint 1** — controller asks the user to print `channels.prn` and report; record results in the doc; update default `channelOrder` / header constants per results before Task 5 (if the software rejects the file, compare our header with Maintop's for that run and fix before continuing).

### Task 3: Source preparation — decode, colour, white

**Files:** `src/source.rs`, `src/colour.rs`, `src/white.rs`, tests.

**Interfaces:**
```rust
pub struct Plane { pub w: u32, pub h: u32, pub data: Vec<u16> } // 0..=65535 tone
pub struct PreparedSource { pub w: u32, pub h: u32, pub ink: [Plane; 4] /* K,C,M,Y */, pub white: Plane, pub alpha: Plane }
pub fn prepare(path: &Path, s: &EngineSettings, white_enabled: bool) -> Result<PreparedSource, EngineError>
pub fn rgb_to_kcmy(r: f32, g: f32, b: f32) -> [f32; 4] // built-in model, 0..1
```
- Colour model (built-in, until an ICC is supplied): `c=1-r, m=1-g, y=1-b; k=min(c,m,y)*gcr` with `gcr=1.0`, then `c-=k, m-=k, y-=k`; then apply fractional alpha (`ink×alpha`). With `iccProfilePath`, use lcms2 sRGB→profile (perceptual intent) instead.
- White: `w = alpha × whiteDensityPct/100`; then **choke**: erode the mask by `whiteChokeMm` converted to source pixels per axis using the item's printed scale (pass `px_per_mm_x/y` into `prepare` or apply at compose time — choose compose time if simpler; document the choice); no white where `white_enabled` is false.
- Decode limits as in `assets.rs` (≤30000 px, 2 GiB); 16-bit inputs scaled to u16 tone directly.
- [ ] **Step 1: Failing tests:** pure white RGB → all ink 0; pure black → K=1, C=M=Y=0; (1,0,0) red → M=Y=1, C=K=0; 50% grey → K≈0.5 only; alpha 0 pixel → no ink, no white; alpha 0.5 → ink and white halved; white density 80% → white 0.8 at alpha 1; 16-bit TIFF grey 32768 → K≈0.5; white disabled → white plane all 0.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(engine): source decode, colour model and white layer`

### Task 4: Screening (4 levels) + dot-gain curves

**Files:** `src/screen.rs` (+ embedded 256×256 blue-noise mask generated at build time by void-and-cluster or loaded from an `include_bytes!` asset committed to the repo), tests.

**Interfaces:**
```rust
pub enum Screening { BlueNoise, ErrorDiffusion }
pub fn apply_curve(tone: u16, curve: &[(f32, f32)]) -> u16 // piecewise-linear, endpoints (0,0) (1,1) implied
pub fn screen_row_blue_noise(tones: &[u16], y: u32, x0: u32, out: &mut [u8]) // levels 0..3
pub struct ErrorDiffuser { .. } // per channel, carries error between rows within a band and across bands
```
- Multi-level blue-noise: `v = tone/65535 × 3; base = floor(v); out = base + (frac(v) > mask(x,y)) as u8`, clamped 0..3.
- [ ] **Step 1: Failing tests:** tone 0 → all 0; tone max → all 3; for constant tones t ∈ {0.1,0.33,0.5,0.9} over a 512×512 tile the mean output/3 is within ±1% of t for both methods; blue-noise output for tone 0.5 has no row with >60% identical consecutive levels (no banding); `apply_curve` linear identity and a midpoint curve (0.5→0.4).
- [ ] **Step 2–4.** **Step 5: Commit** `feat(engine): multi-level blue-noise and error-diffusion screening`

### Task 5: Band compositor + `render_prn` (+ benchmark)

**Files:** `src/spec.rs`, `src/compose.rs`, `src/lib.rs`, `tests/render.rs`, `benches` as an `#[ignore]` test.

**Interfaces:**
```rust
#[derive(Deserialize)] pub struct JobSpec { pub width_mm: f64, pub x_dpi: u32, pub y_dpi: u32, pub mirror: bool, pub white_enabled: bool, pub settings: EngineSettings, pub items: Vec<ItemSpec> }
#[derive(Deserialize)] pub struct ItemSpec { pub path: PathBuf, pub x_mm: f64, pub y_mm: f64, pub width_mm: f64, pub height_mm: f64, pub rotation_deg: f64, pub white_enabled: bool }
#[derive(Deserialize)] pub struct EngineSettings { pub channel_order: [String; 6], pub ink_limit_pct: f32, pub white_density_pct: f32, pub white_choke_mm: f32, pub screening: Screening, pub curves: Option<[Vec<(f32,f32)>; 5]>, pub lead_in_mm: f32, pub icc_profile_path: Option<PathBuf> }
pub struct PrnStats { pub lines: u32, pub bytes: u64, pub millis: u64 }
pub fn render_prn(job: &JobSpec, out: &Path, progress: &mut dyn FnMut(f32) -> bool /* false = cancel */) -> Result<PrnStats, EngineError>
```
- Items are placed as in the app: `x_mm/y_mm` top-left of the un-rotated item, rotation about its centre. For each output band, for each pixel, inverse-map to source pixel (bilinear on tone planes), sum over overlapping items (later items on top: replace where its alpha>0, blend by alpha), mirror = output x → `width_px-1-x`.
- Ink limit: if `K+C+M+Y > inkLimitPct/100`, scale C,M,Y down proportionally (keep K). Curves per channel applied after ink limit; then screening; then channel_order maps logical {K,C,M,Y,W} to PRN channel indices (W duplicated into both W channels).
- Bands of 256 lines processed in parallel with rayon (error diffusion: rows sequential per channel, channels in parallel), written in order.
- [ ] **Step 1: Failing tests (golden):** single 10×10 mm pure-black PNG at (5,5) on 600 mm sheet, mirror off → PRN lines = ceil(10/25.4×1800)=709, black pixels only in K channel at x range [floor(5/25.4×720), +floor(10/25.4×720)) ±1; mirror on → same range mirrored about width; rotated 90° 20×10 mm item → printed footprint 10 wide × 20 tall; two items at y=0 and y=100 → lines = content span; lead-in 5 mm adds ceil(5/25.4×1800) blank lines at top; ink limit 200% on a (C,M,Y,K)=(1,1,1,1)-ish dark brown keeps total ≤2.0; empty items → `EngineError::NothingToPrint`; `.part` cleaned on cancel (progress returns false).
- [ ] **Step 2–4.**
- [ ] **Step 5: Benchmark** (`#[ignore]`, run in release): synthetic 60×100 cm sheet filled with 12 random-colour 3000×3000 PNG designs → assert < 15 s on the dev machine; print timing.
- [ ] **Step 6: Commit** `feat(engine): band compositor and render_prn`

### Task 6: Wire into the app — progress, cancel, mark orders

**Files:** Modify `app/src-tauri/src/prn.rs`, `lib.rs`; `app/src/platform/tauri.ts`; `app/src/features/prn/PreflightDialog.tsx` (+tests); `app/src/domain/types.ts` (PrinterProfile engine fields with defaults; settings sanitize).

**Interfaces:**
- Rust: `#[tauri::command] async fn create_prn(app, sheet_json: String, profile_json: String, out_path: String, job_id: String) -> Result<PrnStatsDto, String>`; builds `JobSpec` from the Sheet (asset paths from `item.asset.path`, mm geometry, profile engine settings, sheet mirror/white), runs `render_prn` on `spawn_blocking`, emits `prn-progress` events `{jobId, fraction}`, cancellation via `cancel_prn(job_id)` (AtomicBool map). Old stub test replaced.
- TS: `createPrn(sheet, profile, outPath, onProgress) → { promise, cancel }`.
- PreflightDialog: after Save as…, shows a progress bar with %, **Cancel**, then "Saved <file name> (1.2 GB, 9 s)" + **Show in folder**. A checkbox (default **on**) "Mark N orders as In production in DTF Creations" → after success calls `client.setOrderStatus(orderId, 'in_production')` for each distinct `source.orderId`; failures listed, PRN still counts as created.
- [ ] **Step 1: Failing tests:** Rust command builds JobSpec from a sample sheet JSON (unit test of the mapping fn `job_from_sheet`); TS: progress events update the bar; Cancel calls cancel_prn; success with checkbox on calls setOrderStatus once per order; checkbox off → not called; status failure shown without hiding success.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(prn): render PRNs from the app with progress, cancel and order status`

### Task 7: Engine settings UI + Checkpoints 2–4

**Files:** `app/src/features/settings/EngineSettings.tsx` (+test) as a tab "Printer & ink" in SettingsDialog; extend `docs/printing/test-print-checkpoints.md`; `prn-tool chart` gains `white` and `colour` charts.

- UI fields (per printer profile): channel order (6 selects K/C/M/Y/W), ink limit %, white density %, white choke mm, screening method, lead-in mm, ICC profile file (optional, file picker), per-channel curve as 3 editable points (25/50/75%). Plain help text per field.
- Charts: `chart white` (white squares at density 60/80/100% and chokes 0/0.1/0.2/0.4 mm with black outlines — to pick choke/density); `chart colour` (CMYK + RGB ramps 0–100% in 10% steps, skin tones, black text 6/8/10/12 pt, fine lines 0.1–1 mm).
- Checkpoint 2 (white): print `white.prn`, pick the density/choke with no halo → enter in settings. Checkpoint 3 (colour): print `colour.prn` from our app AND the same chart (exported as PNG via `prn-tool chart colour --png`) through Maintop; compare; adjust ink limit/curves or load Maintop's ICC. Checkpoint 4 (real job): one real customer gang sheet through both; sign-off when ours matches or beats Maintop (spec §9).
- [ ] **Step 1: Failing tests:** settings persist/validate (ink limit 100–400, density 0–100, choke 0–2 mm, channel order is a permutation of K,C,M,Y,W,W); charts generate with expected dimensions.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(prn): printer & ink settings and calibration charts`
- [ ] **Step 6: STOP for Checkpoints 2–4** with the user; record results; tune defaults.

### Task 8: PDF sources

**Files:** engine `src/source.rs` (PDF branch via `pdfium-render`), app `assets.rs` (accept `.pdf`: dimensions from the PDF page size at 300 dpi for layout; preview rendered at ≤2048 px), bundling of the pdfium dynamic library for macOS arm64/x64 and Windows x64 (Tauri `bundle.resources`), tests with a small vector PDF fixture.

- Engine renders a PDF item at its exact print resolution (`width_mm/25.4×720` × `height_mm/25.4×1800` px) with transparency, then prepares it like a PNG; vector sources never trigger low-DPI warnings (app: `effectiveDpi` returns Infinity for PDFs).
- [ ] **Step 1: Failing tests:** `.pdf` cache_asset returns size from MediaBox; preview generated; engine renders a 50×50 mm black square PDF to the right footprint; DPI badge for a PDF item shows "Vector".
- [ ] **Step 2–4.** **Step 5: Commit** `feat: PDF gang sheets and designs`

---

**Inputs needed from the user (not blocking Tasks 1, 3–6):** results of Checkpoint 1 (Task 2), Maintop's ICC/ink-limit/white settings (export or screenshots) and a Maintop PRN of the colour chart for Checkpoint 3.
