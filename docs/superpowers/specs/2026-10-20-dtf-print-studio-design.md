# DTF Print Studio — Design

Date: 2026-10-20 · Status: draft for approval · Repo: `DTFCreationPrinting`

## 1. Intent

DTF Creations (`../dtfsouthafrica`, live at dtfcreations.co.za) currently exports print files
(`tiff_maintop`) that staff open in **Maintop RIP**, lay out by hand, and RIP to a `.prn` file
that the printer's control software prints.

We want our **own** product that replaces Maintop in that chain: a modern, easy desktop app where
staff pull gang sheets and catalogue designs straight from DTF Creations, auto-place them on the
film, adjust by hand, and produce a `.prn` the existing printer software prints.

**Why:** remove the Maintop dependency (licence/dongle, dated Windows UI, manual re-layout),
make layout fast, catch low-resolution artwork before it wastes film, and tie printing back to
orders.

**Success looks like:**
- A staff member goes from "orders ready" to a `.prn` in a couple of minutes, mostly via auto-place.
- Print quality on film is at least as good as Maintop's output for the same artwork.
- Nothing prints at a resolution that would look bad without someone being warned first.

## 2. Goals, non-goals, anti-goals

**Goals**
- Desktop app for **macOS and Windows**.
- Library: browse/filter DTF Creations **catalogue designs** (by customer, type, category, search)
  and **order gang sheets**; download them locally.
- Film canvas: auto-place (nesting), then free move / resize / rotate / duplicate.
- Live **effective-DPI** check per design with warnings.
- Produce a byte-exact-compatible **`fyft` PRN** (see §6) for the existing printer software.
- Report back to DTF Creations (which items were sent to print).
- Everything Maintop does for our DTF workflow, done in a more modern way (see §5 "Maintop parity
  and beyond").

**Non-goals**
- **Driving the printer directly.** The app writes a `.prn` file; the existing printer software
  prints it. (MetaDTF/ThinkFilm's direct-transport idea is dropped.)
- A general-purpose RIP for other printers/inks/formats in v1 (architecture allows more PRN
  "printer profiles" later).
- A design/art editor (no drawing, text tools, colour editing of artwork beyond print settings).
- Customer-facing features — this is a staff tool.

**Anti-goals** (would be failure even if it "works")
- Prints that look worse than Maintop (colour shifts, white halo/fringe, banding).
- A UI as dense and confusing as Maintop's — every common action must be obvious.
- Silent problems: low-DPI art, art off the printable area, or overlaps going to print unnoticed.
- Needing a fast, always-on internet connection to lay out or RIP a sheet.

## 3. Decisions taken (with the user)

| Decision | Choice | By |
|---|---|---|
| Delivery | Installed desktop app, **Mac + Windows** | user |
| Output | `.prn` file for the existing printer software, **no direct printing** | user |
| Integration | Talks to DTF Creations through its **API** | user |
| Main layout | **Layout B**: large film canvas, properties panel on the right, library as a **bottom drawer** | user |
| Placement | Auto-place, then user can move/resize | user |
| DPI warnings | Warn when artwork resolution is low | user |
| Zoom | Must be **easy** | user |
| Printer width | Easy to set, **default 600 mm** | user |
| Margins | **Configurable** | user |
| MetaDTF | Discontinued; reuse ideas/docs, not code | user |
| Stack | **Tauri 2** shell, **React + TypeScript** UI, **Rust** imaging/RIP engine | Claude's call |
| Thresholds | DPI ≥200 fine, 150–199 amber, <150 red + confirm before PRN | Claude's call (configurable) |

## 4. The user experience

### 4.1 Main window (Layout B)

```
┌ Top bar ────────────────────────────────────────────────────────────────────┐
│ Sheet name ▾ │ Printer profile ▾ │ Auto-place │ Undo Redo │ Zoom − 100% + Fit │ Create PRN │
├──────────────────────────────────────────────────────────────┬──────────────┤
│  cm rulers                                                   │ Properties   │
│  ┌──────── film (printer width, e.g. 600 mm) ────────┐       │ (selection)  │
│  │ margins shown as shaded bands                      │       │ size, rot,   │
│  │ designs coloured by DPI status                     │       │ copies, DPI, │
│  │ sheet grows downward as content is added           │       │ order/cust.  │
│  └────────────────────────────────────────────────────┘       │ Sheet tab    │
├──────────────────────────────────────────────────────────────┴──────────────┤
│ Library drawer: [Catalogue | Gang sheets | Recent] search · filter chips · thumbnail strip │
├─────────────────────────────────────────────────────────────────────────────┤
│ Status: film 60 × 64 cm · used 87% · 6 designs · 3 orders · ⚠ 2 low-res · est. ink │
└─────────────────────────────────────────────────────────────────────────────┘
```

- Drawer is resizable/collapsible; drag a thumbnail onto the film, or select many and "Add".
- **Zoom made easy:** trackpad pinch and Ctrl/⌘+scroll zoom to the cursor; space-drag or
  middle-drag to pan; keys `0` fit sheet, `1` 100% (true size on screen), `2` fit width,
  `+`/`−`; zoom % box in the top bar; minimap is a builder nice-to-have.
- **Properties panel**: with a design selected — width/height in cm (locked aspect by default),
  rotation (90° steps + free), copies, mirror override, white on/off for this item, DPI badge,
  source order/customer. With nothing selected — **Sheet** tab (§4.3).

### 4.2 Library

- **Catalogue tab:** DTF Creations catalogue/gallery designs. Search box; filter chips for
  **customer**, **type** (e.g. front/back/pocket/sleeve, garment type), **category**, status.
  Thumbnails come from the existing `thumbnail_url`s; the print-quality original is downloaded
  only when the design is put on a sheet.
- **Gang sheets tab:** order items ready to print (default filter: orders confirmed / in
  production and not yet printed). Shows order no., customer, sheet size, thumbnail. Adding one
  places the whole customer gang sheet as a single item.
- **Recent / Local tab:** designs already downloaded, plus files dragged in from disk
  (PNG/TIFF/PDF) for ad-hoc jobs.
- Downloaded files are cached locally so layout and RIP work offline.

### 4.3 Sheet & printer settings (easy, not buried)

- **Printer profile** dropdown in the top bar; each profile holds: name, **printable width
  (default 600 mm)**, resolution (720 × 1800), channel map, ink/colour settings.
- **Sheet tab** (properties panel, nothing selected): width (pre-filled from the profile, editable
  per sheet), **margins: left / right / top / bottom in mm** (linked or separate), **gap between
  designs** (mm), sheet length mode (auto-grow to content / fixed length), mirror on output
  (default on), white layer on/off for the sheet.
- Margins and non-printable areas are drawn on the canvas so users can see them.

### 4.4 Auto-place

- One click packs all unplaced (or all) items into the printable area: respects margins and gap,
  may rotate 90° to save film (toggle), keeps a customer's copies together where practical
  (builder may choose the heuristic), minimises sheet length.
- Packs by **bounding box** in v1. Packing by artwork outline is a "beyond Maintop" option for
  later.
- After auto-place everything stays freely editable; snapping to margins/other designs/grid,
  with Alt to disable snapping.
- Overlaps and items outside the printable area are highlighted red.

### 4.5 Low-DPI warnings

- Effective DPI = source pixels ÷ printed inches (per axis; show the lower).
- Badge on each design and colour on the canvas: **≥200 fine, 150–199 amber, <150 red**
  (thresholds configurable in Settings).
- Live while resizing. "Create PRN" with any red item shows a confirm listing them.
- Vector/PDF sources are rendered at output resolution and never warn.

### 4.6 Create PRN

- Pre-flight summary: sheet size, items, warnings, estimated ink / file size → **Create**.
- Runs in the background with progress; UI stays usable. Ends in a **Save as…** dialog
  (default name `YYYYMMDD-HHMM_<sheet-name>.prn`, last folder remembered). The user then loads the
  file into the printing software by hand — the app never sends it to the printer.
- On success: marks the included order items as sent to print in DTF Creations (§7) and saves
  the sheet in history (re-openable, re-RIP-able).

### 4.7 Default print sizes per product size (user decision)

- The user sets up a **default print size for every product size**, e.g. T-shirt **S, M, L, XL,
  2XL** each with its own size; products such as **bags have a single size**.
- When a catalogue design is added, the user picks the product size (and quantity per size, e.g.
  3×M, 2×L); the app places each copy at that size's default. Still resizable on the canvas
  (DPI warning updates).
- *Claude's call:* the size table lives in **DTF Creations** (admin screen + API) so every
  station uses the same sizes. It is keyed by product type + product size + print position
  (front / back / pocket / sleeve), with width in cm (height follows the artwork's aspect).
  A missing entry falls back to the artwork's own size and is flagged.

## 5. Maintop parity and beyond

What we use Maintop for, and how this app covers it:

| Maintop capability | In this app |
|---|---|
| Import artwork (TIFF/PNG/PDF) | Library (API) + drag-in local files |
| Page / media width setup | Printer profile width (default 600 mm) + per-sheet override |
| Margins | Configurable per sheet, defaults per profile |
| Manual layout, step & repeat | Canvas + **copies** field + duplicate; auto-place lays out copies |
| Nesting | **Auto-place** |
| Mirror | On by default at output |
| Colour management (ICC) | Rust engine with LittleCMS; per-profile output ICC + rendering intent |
| Ink limit / linearisation | Per-profile total ink limit and per-channel curves |
| White underbase (spot channels, choke, density) | Generated from artwork alpha; choke (mm/px), density %, both white channels |
| Screening into dot sizes | Error-diffusion with 4 levels (none/small/medium/large) per channel |
| Output `.prn` | `fyft` writer (§6), trimmed to content |

**Beyond Maintop (v1 unless marked later):** library linked to orders/customers; live DPI
warnings; one-click auto-place; sheet history tied to orders; content-trimmed PRN (sample file
was 5.8 GB for ~25 cm of content — trimming shrinks it by more than 10×); preview of what the
white layer will look like; per-sheet ink/film estimate; modern zoom/pan; later: outline nesting,
auto-update.

## 6. The PRN format (`fyft`) — as decoded from Maintop output

Source: `willie.prn` (5,790,824,304 bytes), produced by Maintop for our printer.

**Header (48 bytes, little-endian):**

| Offset | Type | Sample value | Meaning |
|---|---|---|---|
| 0x00 | char[4] | `fyft` | magic |
| 0x04 | u32 | 720 | X resolution (dpi) |
| 0x08 | u32 | 1800 | Y resolution (dpi) |
| 0x0C | u32 | 4256 | bytes per line per channel |
| 0x10 | u32 | 226771 | number of lines |
| 0x14 | u32 | 17007 | width in pixels (= 600 mm @ 720 dpi) |
| 0x18 | f32 | 0.6 | probably width in metres (unconfirmed) |
| 0x1C | u16 | 6 | channel count |
| 0x1E | u16 | 1 | unknown (mode flag?) |
| 0x20 | u32 | 12 | unknown (pass/mode?) |
| 0x24–0x2F | — | 0 | padding |

**Body:** uncompressed. For each line: channel 0…5, each `bytes_per_line` bytes. Total size =
`48 + lines × channels × bytes_per_line` (verified exactly).

- **2 bits per pixel**, MSB-first (pixel 0 = bits 7–6). Values 0 = no dot, 1/2/3 = small /
  medium / large drop.
- Line padded to a multiple of 32 bytes (17007 px → 4251.75 B → 4256 B) — padding rule to be
  confirmed with a second sample.
- **Channels 4 & 5 = white** (96% identical, full-shape underbase).
- **Channels 0–3 = colour**, most likely **K, C, M, Y** (channel 0 carries the bulk of a
  grey/black design). **Must be confirmed** with a test print.
- Data is already **mirrored**; screening is stochastic (error-diffusion-like); white appears
  slightly choked; colour edges slightly darkened.

**Open format facts (resolve during build):** meaning of `0x18`, `0x1E`, `0x20`; whether the
printer software accepts arbitrary line counts (content-trimmed); channel order. Approach:
produce test PRNs that vary one thing at a time and compare against new Maintop exports of the
same artwork.

## 7. DTF Creations integration

The app is an API client of DTF Creations (FastAPI, JWT; admin routes guarded by
`get_current_admin`). Pattern already proven by `dtfsouthafrica/mcp_server/server.py`.

**Use as-is:** admin login + refresh; list orders by status; `GET /orders/{id}/files`;
`GET /orders/{id}/print-files.zip`; catalogue/gallery listing and `/uploads` files + thumbnails;
order status update to `in_production`.

**To add to DTF Creations (small, in that repo):**
1. A **print-source** endpoint per order item / catalogue design returning the best available
   artwork (uploaded original PNG-with-alpha/PDF, or a server-side composite of designer
   `canvas_data` — see §11), its intended print size in cm, its effective DPI, and a checksum.
2. **Print tracking:** record that an item was included in a printed sheet (sheet id, time,
   station), so the Gang-sheets tab can hide/flag already-printed items.
3. Catalogue **filter support** the drawer needs (by customer, type, category, search) if the
   current endpoints don't already offer it.
4. Optional: a **"print station" service account / API key** so the app isn't tied to one
   person's login.

Mirroring rule from the existing `maintop_tiff.py` applies: sources arrive **un-mirrored**; the
app mirrors once, at output.

## 8. Architecture (high level)

- **Tauri 2 shell** — Mac (Apple Silicon + Intel) and Windows installers, auto-update.
- **UI: React + TypeScript** (same family as DTF Creations frontend). Canvas library is the
  builder's call (Fabric.js matches DTF Creations' designer; Konva/Pixi also fine) — must stay
  smooth with ~100 items and zoom from fit-to-sheet to 1:1.
- **Rust core** (separate crate, testable without UI): artwork loading (PNG/TIFF/JPEG, PDF via
  pdfium), colour (lcms2), white generation, ink limit, screening, PRN writer, nesting. Processes
  the sheet **in bands** and streams to disk — never holds the full 720×1800-dpi sheet in memory.
  Uses all CPU cores.
- **Local storage:** SQLite for settings, printer profiles, sheet history, file cache index; file
  cache folder for downloaded originals.
- **Sheet document:** JSON (items, positions in mm, rotation, source ids, settings) — saved,
  re-openable, and exactly reproducible to a PRN.

## 9. Quality bar & verification

- PRN writer validated by **round-trip**: our decoder renders our own PRNs and Maintop's into
  previews; header/size rules checked against the sample.
- **Print-quality acceptance:** the same test artwork (colour ramps, skin tones, black text, fine
  lines, white-on-dark) printed from Maintop and from this app; ours must match or beat it on
  colour, white edge (no halo/fringe), and banding. Profile settings tuned until it does.
- Engine has automated tests (golden images for screening/white/PRN layout); UI has tests on the
  critical flows (add → auto-place → create PRN).
- **Performance target: ≤15 s per metre** of 60 cm film on a recent 8-core machine (PRN is
  ~1.8 GB per metre, uncompressible). How:
  - Colour-convert + white-generate each design **at its own resolution, once per design (not
    per copy), as soon as it is added** — not at "Create PRN".
  - **Blue-noise threshold screening** (fully parallel, SIMD-friendly) as the fast default
    candidate; **error diffusion** kept as the alternative. Default chosen by test print — fast
    one only if film output is equal.
  - Band-wise compositing + screening streamed straight to disk; blank areas skipped.
  - Engine benchmarked in CI on a fixed 60 × 100 cm test sheet.
- The user chose to **start with the main application**; no separate speed spike.

## 10. Left to the builder

- Canvas library, state management, UI component kit (follow DTF Creations' look where
  sensible).
- Nesting algorithm and heuristics (within §4.4).
- Screening algorithm details (must produce 4-level output and match/beat Maintop visually).
- File-naming details, cache eviction, logging, crash reporting.
- Exact shape of the new DTF Creations endpoints (§7), following that repo's conventions.

## 11. Calls made by Claude (for the user to check)

- **Gang-sheet source:** for designer-built gang sheets (`canvas_data` layers), DTF Creations
  renders the composite **on the server** using its existing `rip_service`, at a configurable DPI
  (default 300, raised when sources allow). The app never re-renders Fabric layers itself.
  Uploaded print-ready gang sheets (PDF/PNG) are passed through as the original file. The
  composite's DPI feeds the low-DPI warning.
- **Phasing across repos:** v1 of the app first runs on **existing endpoints** (300 dpi print
  files, status `in_production` as "sent to print"). The DTF Creations additions in §7 follow as
  the next phase; the app switches to them when present. Claude builds both sides.
- **Safe output:** PRNs are written to a temporary name and renamed when complete, so the printer
  software never picks up a half-written file.
- **Stack, DPI thresholds:** see §3.

## 12. Open questions (to confirm with the user)

1. ~~Delivery of the PRN~~ — answered: the app **only creates the PRN**; the user saves it and
   loads it into the printing software by hand. "Create PRN" therefore ends in a **Save as…**
   dialog (remembering the last folder; default name `YYYYMMDD-HHMM_<sheet-name>.prn`) — no
   output-folder setting needed in the printer profile. *Claude's call:* "already printed"
   tracking lives in DTF Creations (§7) so any number of computers can run the app; sheet
   history stays local per computer.
2. ~~Test access~~ — answered **yes**: regular side-by-side test prints (Maintop vs this app)
   on the real printer are available during the build, and Maintop's current settings (ICC,
   ink limit, curves, white choke/density) will be exported/screenshotted as the starting
   profile. The build plan should schedule test-print checkpoints for: channel order + header
   fields, content-trimmed PRN acceptance, white layer, and colour match.
3. ~~Catalogue print size~~ — answered, see §4.7.
