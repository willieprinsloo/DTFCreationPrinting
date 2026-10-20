# DTF Print Studio — Main Application Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Mac + Windows desktop app where staff log in to DTF Creations, pull catalogue designs and order gang sheets (or local files) into a 60 cm film layout, auto-place and hand-edit them with live DPI warnings, save/open sheets, and run the "Create PRN" pre-flight (the PRN engine itself is Plan 2).

**Architecture:** Tauri 2 shell. All layout logic (units, DPI, geometry, zoom math, auto-place, sheet state with undo) is pure TypeScript, unit-tested with Vitest, and the React UI is a thin layer over it. A small Rust side handles what the webview cannot: downloading/caching artwork with preview generation, reading image dimensions, OS-keychain credentials, and (Plan 2) the PRN engine behind the `create_prn` command.

**Tech Stack:** Tauri 2, React 19, TypeScript, Vite, Zustand 5 + zundo (undo), react-konva (canvas), lucide-react (icons), Vitest + Testing Library; Rust: `reqwest`, `image`, `imagesize`, `sha2`, `keyring`. Tauri plugins: `dialog`, `fs`, `store`, `http`.

**Spec:** `docs/superpowers/specs/2026-10-20-dtf-print-studio-design.md`

**Later plans (not in scope here):** Plan 2 — Rust RIP engine (colour, white, screening, `fyft` PRN writer, test-print checkpoints, ≤15 s/m) wired into `create_prn`, then mark orders `in_production`. Plan 3 — DTF Creations additions (print-source endpoint, print tracking, product-size print-size table) and the app's use of them (size picker on add, hide already-printed).

## Global Constraints

- Runs on **macOS (Apple Silicon + Intel) and Windows**; nothing OS-specific outside Tauri APIs.
- App name **DTF Print Studio**; bundle identifier `za.co.dtfcreations.printstudio`.
- Main window is **Layout B**: top bar · film canvas (centre) · properties panel (right) · library **drawer at the bottom** (resizable, collapsible) · status bar.
- All geometry stored in **millimetres** (float); never in screen pixels.
- Default printer profile: name `DTF 60 cm`, **width 600 mm**, **720 × 1800 dpi**, margins 5 mm on all sides, gap 3 mm. Printer width must be editable in one step from the Sheet tab.
- Margins configurable per sheet: top/right/bottom/left in mm.
- DPI thresholds (configurable): **≥200 fine (blue), 150–199 low (amber), <150 bad (red)**; red items require confirmation before PRN.
- Effective DPI = source pixels ÷ printed inches, per axis, show the lower.
- Sources arrive **un-mirrored**; the app never mirrors on screen (mirror happens in the engine, Plan 2).
- DTF Creations API base default `https://dtfcreations.co.za/api/v1` (editable in Settings); admin login `POST /auth/login {email,password,user_type:"admin"}` → `data.access_token`; responses are `{success, data, meta?}`.
- Works offline once files are cached; no feature blocks on the network except fetching new library items.
- UI copy is plain English, no jargon ("Print quality 180 dpi — low", not "insufficient resolution").

## Review Focus

1. **Huge artwork** (e.g. 20 000 × 20 000 px PNG) — canvas stays smooth because it draws a ≤2048 px preview; full file only used by the engine. Test in Task 7.
2. **Design wider than the printable width** — auto-place rotates it if allowed, otherwise reports it as "doesn't fit" without hanging. Test in Task 4.
3. **Margins/gap leave no printable width** (e.g. 300 + 300 mm on 600 mm) — Sheet tab shows an inline error and the store refuses the change. Tests in Tasks 2 and 9.
4. **Token expires mid-session / offline** — one silent re-login with stored credentials; if that fails, the login dialog appears and already-cached items keep working. Test in Task 10.
5. **Very long sheet** (10 m) and zoom extremes — zoom clamps to 0.02–40 px/mm and Fit still frames the whole sheet. Test in Task 3.

---

## File Structure

```
app/                                   Tauri app (created by Task 1)
  package.json  vite.config.ts  vitest.setup.ts  index.html
  src/
    main.tsx  App.tsx  styles/tokens.css  styles/app.css
    domain/
      types.ts        Sheet, SheetItem, Margins, SheetSettings, PrinterProfile, Asset, SourceRef
      dpi.ts          effectiveDpi, dpiStatus
      geometry.ts     printableArea, itemBounds, sheetLengthMm, findProblems
      viewport.ts     Viewport math: zoomAt, fitSheet, fitWidth, trueSize, clampScale
      autoplace.ts    autoPlace (MaxRects strip packing)
      snapping.ts     snapPosition
      preflight.ts    preflight summary
    state/
      settingsStore.ts   profiles, thresholds, apiBaseUrl, screenPxPerMm (persisted)
      sheetStore.ts      current sheet + selection + undo/redo
      persist.ts         KeyValueStore interface + Tauri store / memory implementations
    api/
      dtfClient.ts       createDtfClient
      types.ts           GalleryDesign, GalleryCategory, Customer, Order, OrderFile, Page<T>
    platform/
      tauri.ts           typed invoke wrappers (cacheAsset, importLocalFile, credentials, createPrn)
    features/
      topbar/TopBar.tsx  topbar/ZoomControl.tsx
      canvas/SheetCanvas.tsx  canvas/ItemNode.tsx  canvas/useViewport.ts  canvas/shortcuts.ts
      properties/PropertiesPanel.tsx  properties/ItemProperties.tsx  properties/SheetProperties.tsx
      library/LibraryDrawer.tsx  library/CatalogueTab.tsx  library/GangSheetsTab.tsx
      library/LocalTab.tsx  library/AddDesignDialog.tsx
      status/StatusBar.tsx
      auth/LoginDialog.tsx
      settings/SettingsDialog.tsx
      prn/PreflightDialog.tsx
      sheets/sheetFiles.ts   save/open/history
  src-tauri/
    Cargo.toml  tauri.conf.json  capabilities/default.json
    src/main.rs  src/lib.rs
    src/assets.rs       cache_asset, import_local_file (+ preview generation)
    src/credentials.rs  save/load/clear credentials (keyring)
    src/prn.rs          create_prn (stub until Plan 2)
```

Tests live next to the code as `*.test.ts(x)`; Rust tests in `#[cfg(test)]` modules.

---

### Task 1: Scaffold the app with the Layout B shell

**Files:**
- Create: `app/` via `npm create tauri-app@latest`, then `app/src/App.tsx`, `app/src/styles/tokens.css`, `app/src/styles/app.css`, `app/vitest.setup.ts`, `app/vite.config.ts` (add `test` block)
- Test: `app/src/App.test.tsx`

**Interfaces:**
- Produces: `<App/>` rendering regions with `data-testid` = `topbar`, `canvas-area`, `properties-panel`, `library-drawer`, `status-bar`. Later tasks replace the placeholder contents of each region.

- [ ] **Step 1: Scaffold.** From repo root: `npm create tauri-app@latest app -- --template react-ts --manager npm --identifier za.co.dtfcreations.printstudio --yes` (if a flag is unsupported, answer the prompts with the same values). In `app/src-tauri/tauri.conf.json` set `productName` `DTF Print Studio`, window title `DTF Print Studio`, size 1440×900, minWidth 1100, minHeight 700. Add dev deps: `vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom`; deps: `zustand zundo react-konva konva lucide-react`. Add `"test": "vitest run"` script; `vite.config.ts` `test: { environment: 'jsdom', setupFiles: './vitest.setup.ts' }`.
- [ ] **Step 2: Write the failing test** `App.test.tsx` → `it('renders the five Layout B regions')`: render `<App/>`, `expect(screen.getByTestId(id)).toBeInTheDocument()` for each of the five ids, and that `library-drawer` comes after `canvas-area` in document order.
- [ ] **Step 3: Run** `cd app && npm test` — Expected: FAIL (ids missing).
- [ ] **Step 4: Implement** `App.tsx` as a CSS grid: rows `auto 1fr var(--drawer-h) auto`, columns `1fr 280px`; topbar and drawer and status span both columns. `tokens.css` defines colours (light + `prefers-color-scheme: dark`), including `--dpi-fine #3b82f6`, `--dpi-low #f59e0b`, `--dpi-bad #ef4444`, spacing and font tokens. Delete the scaffold's demo code.
- [ ] **Step 5: Run** `npm test` → PASS; `npm run tauri dev` opens a window showing the five regions.
- [ ] **Step 6: Commit** `git add app && git commit -m "feat: scaffold Tauri app with Layout B shell"`

---

### Task 2: Domain types, DPI and sheet geometry

**Files:**
- Create: `app/src/domain/types.ts`, `app/src/domain/dpi.ts`, `app/src/domain/geometry.ts`
- Test: `app/src/domain/dpi.test.ts`, `app/src/domain/geometry.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export interface Margins { topMm: number; rightMm: number; bottomMm: number; leftMm: number }
  export interface PrinterProfile { id: string; name: string; widthMm: number; xDpi: number; yDpi: number; defaultMargins: Margins; defaultGapMm: number }
  export interface SheetSettings { widthMm: number; margins: Margins; gapMm: number; lengthMode: 'auto' | 'fixed'; fixedLengthMm: number; mirror: boolean; whiteEnabled: boolean; allowRotate: boolean }
  export interface Asset { assetId: string; path: string; previewPath: string; widthPx: number; heightPx: number }
  export interface SourceRef { kind: 'gallery' | 'order-file' | 'local'; id: string; label: string; customerName?: string; orderId?: string; orderNumber?: string }
  export interface SheetItem { id: string; asset: Asset; source: SourceRef; xMm: number; yMm: number; widthMm: number; heightMm: number; rotationDeg: number; whiteEnabled: boolean }
  export interface Sheet { id: string; name: string; profileId: string; settings: SheetSettings; items: SheetItem[] }
  export interface Rect { xMm: number; yMm: number; widthMm: number; heightMm: number }
  export type DpiStatus = 'fine' | 'low' | 'bad'
  export interface DpiThresholds { fine: number; low: number }   // defaults { fine: 200, low: 150 }
  export type Problem = { kind: 'overlap'; itemIds: [string, string] } | { kind: 'outside'; itemId: string }
  ```
  `xMm/yMm` = top-left of the un-rotated item; rotation is about the item centre.
- Produces (`dpi.ts`): `effectiveDpi(item: Pick<SheetItem,'asset'|'widthMm'|'heightMm'>): number`, `dpiStatus(dpi: number, t?: DpiThresholds): DpiStatus`, `DEFAULT_THRESHOLDS`.
- Produces (`geometry.ts`): `printableArea(s: SheetSettings): Rect` (x = left margin, y = top margin, width = widthMm − left − right, height = Infinity for auto; throws `InvalidSheetError` when width ≤ 0); `itemBounds(item): Rect` (axis-aligned bbox after rotation); `sheetLengthMm(sheet): number` (auto: max item bottom + bottom margin, minimum top + bottom margin; fixed: `fixedLengthMm`); `findProblems(sheet): Problem[]` (overlap = bboxes intersect by > 0.01 mm; outside = bbox exceeds printable width or above top margin).

- [ ] **Step 1: Write failing tests.**
  - `dpi.test.ts`: asset 3000×3000 px at 254×254 mm → `effectiveDpi` = 300 and `dpiStatus` `fine`; 1800 px over 254 mm → 180, `low`; 1000 px → 100, `bad`; asset 3000×1000 px at 254×254 mm → 100 (lower axis); boundaries `dpiStatus(200)`=`fine`, `dpiStatus(150)`=`low`, `dpiStatus(149.9)`=`bad`; custom thresholds `{fine:300, low:200}` → `dpiStatus(250)`=`low`.
  - `geometry.test.ts`: default settings (600, margins 5) → `printableArea` = `{xMm:5, yMm:5, widthMm:590, heightMm:Infinity}`; margins left 300 + right 300 → throws `InvalidSheetError`; 100×50 item rotated 90 at (0,0) → bounds `{xMm:25, yMm:-25, widthMm:50, heightMm:100}`; `sheetLengthMm` with items bottoms at 120 and 300 and bottom margin 5 → 305, empty sheet → 10, fixed mode 1000 → 1000; `findProblems`: two touching items (edges equal) → none; overlapping by 1 mm → one `overlap`; item at x=560 width 40 on 600 sheet with margin 5 → `outside`.
- [ ] **Step 2: Run** `npm test -- domain` → FAIL.
- [ ] **Step 3: Implement** the three files to the signatures above.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(domain): sheet types, effective DPI and geometry`

---

### Task 3: Viewport (zoom/pan) math

**Files:**
- Create: `app/src/domain/viewport.ts`
- Test: `app/src/domain/viewport.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Viewport { scale: number /* screen px per mm */; offsetX: number; offsetY: number /* screen px of sheet origin */ }
  export const MIN_SCALE = 0.02, MAX_SCALE = 40
  export function clampScale(s: number): number
  export function zoomAt(vp: Viewport, factor: number, screenX: number, screenY: number): Viewport  // keeps the sheet point under (screenX,screenY) fixed
  export function fitSheet(sheetW: number, sheetH: number, viewW: number, viewH: number, paddingPx?: number /*24*/): Viewport  // centred
  export function fitWidth(sheetW: number, viewW: number, paddingPx?: number): Viewport            // offsetY = paddingPx
  export function trueSize(vp: Viewport, screenPxPerMm: number, viewW: number, viewH: number): Viewport // 1:1 physical, keeps view centre
  export function screenToSheet(vp: Viewport, x: number, y: number): { xMm: number; yMm: number }
  ```

- [ ] **Step 1: Write failing tests:** `zoomAt({scale:1,offsetX:0,offsetY:0}, 2, 100, 100)` → scale 2 and `screenToSheet(result,100,100)` equals `screenToSheet(before,100,100)`; zooming by 1000× clamps to 40, by 0.00001 clamps to 0.02; `fitSheet(600, 10000, 1200, 800)` (10 m sheet) → scale = (800−48)/10000 = 0.0752 and the sheet is horizontally centred; `fitWidth(600, 1224)` → scale 2, offsetY 24; `trueSize` with `screenPxPerMm` 3.78 → scale 3.78.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(domain): viewport zoom and fit math`

---

### Task 4: Auto-place (strip packing)

**Files:**
- Create: `app/src/domain/autoplace.ts`
- Test: `app/src/domain/autoplace.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PlaceInput { id: string; widthMm: number; heightMm: number; groupKey?: string }
  export interface Placement { id: string; xMm: number; yMm: number; rotated: boolean }
  export interface AutoPlaceOptions { originXMm: number; originYMm: number; printableWidthMm: number; gapMm: number; allowRotate: boolean }
  export interface AutoPlaceResult { placements: Placement[]; unplaced: string[]; usedLengthMm: number }
  export function autoPlace(items: PlaceInput[], opts: AutoPlaceOptions): AutoPlaceResult
  ```
  `rotated` means a 90° turn (width/height swapped); `xMm/yMm` are the top-left of the placed (possibly rotated) footprint. Callers convert to `SheetItem` (Task 6).
- Algorithm (not determined by the tests): **MaxRects, bottom-left rule** in a strip `printableWidthMm + gapMm` wide and unbounded height. Inflate each item by `gapMm` on right and bottom so gaps appear only between items. Sort by `groupKey` (keeps an order's items together), then by max side descending. For each item try both orientations when `allowRotate`; pick the free rect giving the smallest resulting `y + h`, tie-break smallest `x`. Items wider than the strip in every allowed orientation go to `unplaced`.

- [ ] **Step 1: Write failing tests:** four 100×100 with gap 0, width 600 → all y = 0, `usedLengthMm` 100; same with gap 5 → x = 0, 105, 210, 315 (relative to origin); item 590×50 with gap 5 on width 590 → placed (gap not needed at the edge); item 700×100, width 600, `allowRotate` true → placed, `rotated: true`; same with `allowRotate` false → `unplaced: [id]` and returns (no hang); origin (5,5) offsets every placement by 5; property test: 60 random items 20–300 mm, width 590, gap 3 → no two placed footprints overlap, all within `[origin, origin+width]`, and every id appears once in placements or unplaced.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(domain): MaxRects auto-place`

---

### Task 5: Settings store and persistence

**Files:**
- Create: `app/src/state/persist.ts`, `app/src/state/settingsStore.ts`
- Test: `app/src/state/settingsStore.test.ts`

**Interfaces:**
- Produces (`persist.ts`): `interface KeyValueStore { get<T>(key: string): Promise<T | undefined>; set<T>(key: string, value: T): Promise<void> }`; `createMemoryStore(): KeyValueStore`; `createTauriStore(file = 'settings.json'): KeyValueStore` (wraps `@tauri-apps/plugin-store`; add the plugin in Rust + capabilities).
- Produces (`settingsStore.ts`): `DEFAULT_PROFILE: PrinterProfile` (id `dtf-60`, values from Global Constraints); `createSettingsStore(kv: KeyValueStore)` returning a Zustand store with state `{ profiles: PrinterProfile[]; activeProfileId: string; thresholds: DpiThresholds; apiBaseUrl: string; screenPxPerMm: number /* default 96/25.4 */; loaded: boolean }` and actions `load(): Promise<void>`, `upsertProfile(p)`, `removeProfile(id)` (refuses to remove the last), `setActiveProfile(id)`, `setThresholds(t)` (rejects `low >= fine`), `setApiBaseUrl(url)`, `setScreenPxPerMm(v)`. Every action persists under key `settings`. `useSettings` = the store bound to `createTauriStore()` (exported from the same file).

- [ ] **Step 1: Write failing tests** (memory store): fresh load → one profile `DTF 60 cm`, widthMm 600, xDpi 720, yDpi 1800, margins 5, gap 3, thresholds `{fine:200, low:150}`, apiBaseUrl `https://dtfcreations.co.za/api/v1`; `upsertProfile` then a new store over the same memory kv `load()` → profile persisted; `removeProfile` of last profile → still one; `setThresholds({fine:150, low:200})` → throws, state unchanged.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (register `tauri-plugin-store` in `src-tauri/src/lib.rs` and `capabilities/default.json`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(state): persisted settings and printer profiles`

---

### Task 6: Sheet store with selection and undo/redo

**Files:**
- Create: `app/src/state/sheetStore.ts`
- Test: `app/src/state/sheetStore.test.ts`

**Interfaces:**
- Consumes: Task 2 types/geometry, Task 4 `autoPlace`, Task 5 `PrinterProfile`.
- Produces: `createSheetStore()` / `useSheet` (Zustand + `zundo` temporal, limit 100) with state `{ sheet: Sheet; selectedIds: string[] }` and actions:
  - `newSheet(profile: PrinterProfile, name?: string)` — settings from profile: widthMm, defaultMargins, defaultGapMm, lengthMode `auto`, fixedLengthMm 1000, mirror true, whiteEnabled true, allowRotate true.
  - `loadSheet(sheet: Sheet)` (clears undo history)
  - `addItems(items: NewItem[])` where `NewItem = { asset: Asset; source: SourceRef; widthMm: number; heightMm: number; quantity: number }` — creates `quantity` items each; places the new ones only, with `autoPlace` starting below the current content (`originYMm = sheetLengthMm(sheet) - bottomMargin + gap`, or top margin when empty), existing items untouched. Unplaceable items are still added at the left margin and show as `outside`.
  - `updateItem(id, patch: Partial<Pick<SheetItem,'xMm'|'yMm'|'widthMm'|'heightMm'|'rotationDeg'|'whiteEnabled'>>)`
  - `resizeItem(id, widthMm, keepAspect = true)`
  - `removeItems(ids)`, `duplicateItems(ids)` (copies offset +10 mm, new ids, selection moves to copies)
  - `setSettings(patch: Partial<SheetSettings>)` — validates with `printableArea`; throws `InvalidSheetError` and leaves state unchanged when invalid.
  - `autoPlaceAll()` — re-packs every item from the top margin; sets `rotationDeg` to 90 for `rotated`, else 0; groupKey = `source.orderId ?? source.id`.
  - `select(ids)`, `undo()`, `redo()` (selection changes are not undo steps).

- [ ] **Step 1: Write failing tests:** `newSheet(DEFAULT_PROFILE)` → widthMm 600, margins 5; `addItems` with quantity 3 → 3 items, none overlapping (`findProblems` empty); second `addItems` → new items all below previous content; `resizeItem(id, 200)` on 100×50 → 200×100; `setSettings({margins:{...m, leftMm:300, rightMm:300}})` throws and settings unchanged; `autoPlaceAll` on 4 items → `findProblems` empty; `updateItem` then `undo()` restores position, `redo()` reapplies; `select` does not create an undo step.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(state): sheet store with auto-place and undo`

---

### Task 7: Rust asset cache, local import and previews

**Files:**
- Create: `app/src-tauri/src/assets.rs`; Modify: `app/src-tauri/src/lib.rs`, `app/src-tauri/Cargo.toml`, `app/src-tauri/tauri.conf.json` (enable `assetProtocol` scoped to `$APPCACHE/assets/**`)
- Create: `app/src/platform/tauri.ts`
- Test: Rust `#[cfg(test)] mod tests` in `assets.rs`; `app/src/platform/tauri.test.ts`

**Interfaces:**
- Produces (Rust, `#[tauri::command]`):
  - `cache_asset(url: String, bearer: Option<String>) -> Result<AssetInfo, String>` — file name `sha256(url)` + original extension under `<app_cache>/assets/`; skip download if present.
  - `import_local_file(path: String) -> Result<AssetInfo, String>` — copies into the cache as `sha256(contents)` + extension.
  - `AssetInfo { asset_id: String, path: String, preview_path: String, width_px: u32, height_px: u32 }` (serde `camelCase` → matches TS `Asset`).
  - Pure helpers tested without Tauri: `fn cache_file_name(key: &[u8], ext: &str) -> String`, `fn ensure_preview(src: &Path, dst: &Path, max_side: u32) -> Result<(), String>` (writes PNG ≤ 2048 px longest side; images already ≤ 2048 are copied), `fn read_dimensions(path: &Path) -> Result<(u32,u32), String>` (header-only via `imagesize`).
  - Supported: PNG, JPEG, TIFF. Anything else → `Err("Unsupported file type: .<ext> (use PNG, JPEG or TIFF)")`.
- Produces (TS `platform/tauri.ts`): `cacheAsset(url: string, bearer?: string): Promise<Asset>`, `importLocalFile(path: string): Promise<Asset>`, `assetSrc(path: string): string` (wraps `convertFileSrc`), plus credential and PRN wrappers added in Tasks 10 and 12.

- [ ] **Step 1: Write failing Rust tests:** `cache_file_name(b"https://x/a.png", "png")` is 64 hex chars + `.png` and stable; `read_dimensions` on a generated 3000×1000 PNG (create in a tempdir with `image`) → (3000, 1000); `ensure_preview` on a 20000×200 PNG → preview longest side 2048, aspect kept (2048×20); on a 500×500 PNG → preview 500×500; `.gif` → unsupported error text exactly as above.
- [ ] **Step 2: Run** `cd app/src-tauri && cargo test assets` → FAIL.
- [ ] **Step 3: Implement** helpers and commands (`reqwest` with `rustls`, `image`, `imagesize`, `sha2`, `tempfile` dev-dep); register commands in `lib.rs`.
- [ ] **Step 4: Run** `cargo test assets` → PASS.
- [ ] **Step 5: TS wrapper test:** mock `@tauri-apps/api/core` `invoke`; `cacheAsset('u','t')` calls `invoke('cache_asset', {url:'u', bearer:'t'})` and returns its value. Run `npm test -- platform` → PASS.
- [ ] **Step 6: Commit** `feat(assets): cached downloads, local import and previews`

---

### Task 8: Film canvas with zoom, selection and editing

**Files:**
- Create: `app/src/domain/snapping.ts`, `app/src/features/canvas/SheetCanvas.tsx`, `ItemNode.tsx`, `useViewport.ts`, `shortcuts.ts`
- Test: `app/src/domain/snapping.test.ts`, `app/src/features/canvas/shortcuts.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 6, 7 (`assetSrc(item.asset.previewPath)`).
- Produces:
  - `snapPosition(moving: Rect, others: Rect[], printable: Rect, thresholdMm: number): { xMm: number; yMm: number }` — snaps the moving rect's left/right/top edges to printable left/right/top and to other rects' edges (incl. gap-aligned) when within threshold; otherwise unchanged.
  - `shortcutFor(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): ShortcutAction | null` where `ShortcutAction = 'fit' | 'trueSize' | 'fitWidth' | 'zoomIn' | 'zoomOut' | 'undo' | 'redo' | 'delete' | 'duplicate' | 'selectAll'`. Map: `0` fit, `1` trueSize, `2` fitWidth, `+`/`=` zoomIn, `-` zoomOut, ⌘/Ctrl+Z undo, ⌘/Ctrl+Shift+Z and Ctrl+Y redo, Delete/Backspace delete, ⌘/Ctrl+D duplicate, ⌘/Ctrl+A selectAll. Ignored while focus is in an input (handled by caller).
  - `useViewport(sheetW, sheetH)` → `{ vp, setVp, onWheel, fit, fitWidth, trueSize, zoomBy }` exposed via a small Zustand slice so `ZoomControl` (Task 9) can drive it.
- Canvas behaviour (react-konva): film rectangle at printer width with grid every 10 mm; margins as shaded bands; items drawn from preview images, outline colour by `dpiStatus` (CSS tokens), red dashed outline for `findProblems` entries; click/shift-click/marquee select; drag moves (snap threshold 2 mm, hold Alt to disable); Konva `Transformer` resizes with aspect locked (Shift to free) and rotates (snaps to 90° within 5°); **wheel with ⌘/Ctrl or trackpad pinch (`ctrlKey` wheel) zooms at cursor**, plain wheel scrolls vertically, Shift+wheel horizontally, Space+drag or middle-drag pans. Fit on first load.

- [ ] **Step 1: Write failing tests:** `snapPosition` moving rect at x 6.5 with printable x 5, threshold 2 → x 5; at x 9 → unchanged; aligns left edge to another rect's right edge + gap; `shortcutFor` table-driven over every mapping above, plus `{key:'z'}` without modifier → null.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `snapping.ts`, `shortcuts.ts`, then the canvas components (thin; logic stays in domain).
- [ ] **Step 4: Run** `npm test` → PASS. Manual check in `npm run tauri dev` with two local test PNGs added through a temporary dev button (remove before commit): pinch/⌘-scroll zooms at cursor, `0`/`1`/`2` work, drag snaps to margin, low-DPI item shows amber.
- [ ] **Step 5: Commit** `feat(canvas): film canvas with zoom, snapping and transforms`

---

### Task 9: Top bar, properties panel (item + sheet), status bar

**Files:**
- Create: `app/src/features/topbar/TopBar.tsx`, `ZoomControl.tsx`, `app/src/features/properties/PropertiesPanel.tsx`, `ItemProperties.tsx`, `SheetProperties.tsx`, `app/src/features/status/StatusBar.tsx`
- Test: `app/src/features/properties/SheetProperties.test.tsx`, `ItemProperties.test.tsx`, `app/src/features/status/StatusBar.test.tsx`

**Interfaces:**
- Consumes: sheet store (Task 6), settings store (Task 5), viewport slice (Task 8), `effectiveDpi`/`dpiStatus`/`findProblems`/`sheetLengthMm`.
- UI contract:
  - **TopBar:** sheet name (editable), printer profile select, **Auto-place** button (`autoPlaceAll`), Undo/Redo, `ZoomControl` (− / percentage input / + / Fit / 1:1), **Create PRN** (opens Task 12 dialog), settings gear.
  - **SheetProperties** (shown when nothing selected): Printer width input (mm) with preset chips **300** and **600**; margins top/right/bottom/left with a link toggle (linked = editing one sets all); gap (mm); length mode auto/fixed (+ length); toggles mirror, white layer, allow rotate in auto-place. Invalid values show an inline message `Margins leave no printable width` and do not reach the store.
  - **ItemProperties** (selection of 1): width/height cm (1 decimal, aspect lock toggle), rotation (buttons ⟲ 90 / ⟳ 90 and numeric), white on/off, **Duplicate**, **Delete**, print quality badge `NNN dpi` with label `Good` / `Low` / `Too low`, source label + customer/order. Multi-select shows count + Duplicate/Delete only.
  - **StatusBar:** `Film 60 × 64 cm` (width × `sheetLengthMm`, in cm, 0 decimals), `Used NN%` (sum of item areas ÷ printable width × used length), item count, distinct order count, `⚠ N low-res` when any low/bad, `⛔ N problems` when `findProblems` non-empty.

- [ ] **Step 1: Write failing tests:** clicking chip `300` sets `sheet.settings.widthMm` 300; typing left margin 300 and right 300 on 600 shows `Margins leave no printable width` and store keeps old margins; with link on, setting top to 8 sets all four to 8; ItemProperties on a 3000 px / 254 mm item shows `300 dpi` and `Good`; changing width to 50.8 cm (keep aspect) updates height proportionally; StatusBar for a 600 mm sheet with one 100×100 item at top margin 5 shows `Film 60 × 11 cm` and `1 design`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ui): top bar, properties and status bar`

---

### Task 10: DTF Creations API client, login and stored credentials

**Files:**
- Create: `app/src/api/types.ts`, `app/src/api/dtfClient.ts`, `app/src-tauri/src/credentials.rs`, `app/src/features/auth/LoginDialog.tsx`, `app/src/features/settings/SettingsDialog.tsx`; Modify: `app/src/platform/tauri.ts`, `app/src-tauri/src/lib.rs`, capabilities (http plugin, scope `https://dtfcreations.co.za/*` and `http://localhost:8000/*`)
- Test: `app/src/api/dtfClient.test.ts`, Rust test in `credentials.rs`

**Interfaces:**
- Produces (`types.ts`): `Page<T> = { items: T[]; total: number; page: number; hasNext: boolean }`; `GalleryDesign { id; name; imageUrl; thumbnailUrl?; designType; galleryCategoryId; tags }`; `GalleryCategory { id; name; customerId? }`; `Customer { id; name; email }`; `OrderSummary { id; orderNumber; status; customerName; createdAt }`; `OrderFile { itemId; printFileUrl; productType; sizeLabel }`. The client maps the API's snake_case to these.
- Produces (`dtfClient.ts`):
  ```ts
  export class AuthRequiredError extends Error {}
  export interface Credentials { email: string; password: string }
  export function createDtfClient(o: { baseUrl: string; fetch: typeof fetch; loadCredentials: () => Promise<Credentials | null> }): DtfClient
  interface DtfClient {
    login(c: Credentials): Promise<void>
    listGalleryDesigns(q: { page?: number; limit?: number; search?: string; categoryId?: string; designType?: string; owner?: 'public' | string }): Promise<Page<GalleryDesign>>
    listGalleryCategories(): Promise<GalleryCategory[]>
    listCustomers(search?: string): Promise<Customer[]>
    listOrders(q: { status?: string; search?: string; page?: number }): Promise<Page<OrderSummary>>
    getOrderFiles(orderId: string): Promise<OrderFile[]>
    setOrderStatus(orderId: string, status: string): Promise<void>
    absoluteUrl(pathOrUrl: string): string   // resolves '/uploads/...' against the site origin
    token(): string | null
  }
  ```
  Routes: `POST /auth/login` body `{email,password,user_type:'admin'}`; `GET /gallery-designs` (`page, limit, search, gallery_category_id, design_type, category_owner`); `GET /gallery-categories`; `GET /customers?search=`; `GET /orders?status=&search=&page=`; `GET /orders/{id}/files`; `PATCH /orders/{id}/status` body `{status}`. On HTTP 401: call `loadCredentials()`, `login`, retry once; if no credentials or second 401 → throw `AuthRequiredError`. Network failure → throws `Error('Can't reach DTF Creations — working offline')`.
- Produces (Rust): commands `save_credentials(email, password)`, `load_credentials() -> Option<{email,password}>`, `clear_credentials()` using `keyring` service `za.co.dtfcreations.printstudio`; TS wrappers in `platform/tauri.ts`.
- UI: `LoginDialog` (email, password, "Remember me" → save_credentials) shown on start when no credentials or on `AuthRequiredError`; `SettingsDialog` edits API base URL, DPI thresholds, printer profiles (name, width, dpi, margins, gap), and screen calibration (drag a box to match a bank card's 85.6 mm width → `setScreenPxPerMm`).

- [ ] **Step 1: Write failing tests** with a fake `fetch`: `login` posts `user_type: 'admin'` and later requests carry `Authorization: Bearer <token>`; `listGalleryDesigns({owner:'c1', designType:'sticker'})` hits `/gallery-designs?...category_owner=c1&design_type=sticker` and maps `image_url`→`imageUrl`, `meta.has_next_page`→`hasNext`; first call 401 then login 200 then retry 200 → returns data, exactly one login; 401 with `loadCredentials` → null → rejects `AuthRequiredError`; fetch throws `TypeError` → rejects with the offline message; `absoluteUrl('/uploads/a.png')` with base `https://dtfcreations.co.za/api/v1` → `https://dtfcreations.co.za/uploads/a.png`. Rust: keyring round-trip test marked `#[ignore]` (needs OS keychain), run manually once.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (use `@tauri-apps/plugin-http` `fetch` in production, injected). **Step 4: Run** → PASS.
- [ ] **Step 5: Manual check** against a local DTF Creations (`http://localhost:8000/api/v1`): log in with an admin account, restart app → logged in silently.
- [ ] **Step 6: Commit** `feat(api): DTF Creations client with login and keychain credentials`

---

### Task 11: Library drawer — Catalogue, Gang sheets, Local

**Files:**
- Create: `app/src/features/library/LibraryDrawer.tsx`, `CatalogueTab.tsx`, `GangSheetsTab.tsx`, `LocalTab.tsx`, `AddDesignDialog.tsx`
- Test: `CatalogueTab.test.tsx`, `GangSheetsTab.test.tsx`, `AddDesignDialog.test.tsx`

**Interfaces:**
- Consumes: `DtfClient` (Task 10, provided via React context `DtfClientContext`), `cacheAsset`/`importLocalFile`/`assetSrc` (Task 7), `addItems` (Task 6).
- Behaviour:
  - **Drawer:** tabs Catalogue / Gang sheets / Local; height draggable 120–480 px (remembered in settings store), collapse toggle; horizontal thumbnail strip with multi-select; drag a thumbnail onto the canvas or press **Add** for the selection.
  - **Catalogue:** search (debounced 300 ms), filter chips **Customer** (searchable, uses `listCustomers`, maps to `owner`), **Type** (`design_type`), **Category**; infinite scroll by page (limit 50). Thumbnails from `thumbnailUrl` via `absoluteUrl` (not cached to disk).
  - **Gang sheets:** orders with status `confirmed` (toggle to include `in_production`), searchable; expanding an order lists `getOrderFiles`; adding a file adds it at **native size assuming 300 dpi** (`px / 300 * 25.4` mm) as one item with `source.kind 'order-file'`, `orderId`, `orderNumber`, `customerName`.
  - **Local:** "Add files…" (dialog plugin, PNG/JPEG/TIFF) and drop from Finder/Explorer; adds at native size assuming 300 dpi.
  - **AddDesignDialog** (catalogue): quantity (default 1) and print width in cm (default = native size at 300 dpi, capped to printable width); shows resulting dpi badge live. Calls `cacheAsset` (with bearer) on confirm, then `addItems`. Download failure shows `Couldn't download "<name>" — try again`; nothing added.

- [ ] **Step 1: Write failing tests** (fake client + mocked `platform/tauri`): typing `lion` calls `listGalleryDesigns` with `search:'lion'` once after debounce; choosing customer chip "Acme" passes `owner: <acme id>`; GangSheetsTab expanding order `#1042` shows its files and Add calls `addItems` with `source.orderNumber '#1042'` and width 3543 px → `widthMm` ≈ 299.97 (`toBeCloseTo(300, 0)`); AddDesignDialog with 3000 px asset and width 50.8 cm shows `150 dpi` + `Low`, quantity 3 → `addItems` quantity 3; `cacheAsset` rejecting → error text shown and `addItems` not called.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(library): catalogue, gang sheet and local drawer`

---

### Task 12: Save/open sheets and Create PRN pre-flight

**Files:**
- Create: `app/src/domain/preflight.ts`, `app/src/features/sheets/sheetFiles.ts`, `app/src/features/prn/PreflightDialog.tsx`, `app/src-tauri/src/prn.rs`; Modify: `platform/tauri.ts`, `TopBar.tsx` (File menu: New, Open…, Save, Save as…, Recent)
- Test: `app/src/domain/preflight.test.ts`, `app/src/features/sheets/sheetFiles.test.ts`, `app/src/features/prn/PreflightDialog.test.tsx`

**Interfaces:**
- Produces:
  - `preflight(sheet: Sheet, profile: PrinterProfile, t: DpiThresholds): { lengthMm: number; itemCount: number; orderIds: string[]; low: SheetItem[]; bad: SheetItem[]; problems: Problem[]; estimatedPrnBytes: number; canCreate: boolean; needsConfirm: boolean }` — `estimatedPrnBytes = 48 + lines × 6 × bytesPerLine` where `contentLengthMm` = top of highest item bbox to bottom of lowest (PRN is trimmed to content), `lines = ceil(contentLengthMm / 25.4 × yDpi)`, `widthPx = floor(sheet.settings.widthMm / 25.4 × xDpi)` (full printer width — margins are blank columns, as in Maintop's sample: 600 mm → 17007 px), `bytesPerLine = ceil(ceil(widthPx × 2 / 8) / 32) × 32` (600 mm → 4256); `canCreate` false when `problems` non-empty or no items; `needsConfirm` when `bad` non-empty.
  - Sheet file format `.dtfsheet` = JSON `{ format: 'dtf-print-studio-sheet', version: 1, sheet: Sheet }`; `serializeSheet(sheet): string`, `parseSheet(text): Sheet` (throws `Error('Not a DTF Print Studio sheet')` on wrong format/version); history = last 20 saved paths in settings store.
  - Rust `create_prn(sheet_json: String, out_path: String) -> Result<(), String>` — Plan 1 returns `Err("The PRN engine is not installed yet (coming in the next release)")`. TS `createPrn(sheet, outPath)`.
- PreflightDialog: shows length (cm), items, orders, estimated file size (`1.8 GB`), lists low (amber) and too-low (red) designs and problems; **Create** disabled when `!canCreate`; when `needsConfirm`, Create requires ticking `Print anyway — I've checked the low-quality designs`; Create opens Save as… (default `YYYYMMDD-HHMM_<sheet-name>.prn`, last folder remembered) and calls `createPrn`; errors shown in the dialog.

- [ ] **Step 1: Write failing tests:** preflight on a 600 mm sheet, margins 5, one item 100 mm tall at y 5 → lines = ceil(100/25.4×1800) = 7087, bytesPerLine = 4256, so `estimatedPrnBytes` = 48 + 7087×6×4256 = 180 973 680; with one 100 dpi item → `needsConfirm` true; with an overlap → `canCreate` false; `serializeSheet`→`parseSheet` round-trips deep-equal; `parseSheet('{"format":"x"}')` throws the message above; PreflightDialog with a bad item has Create disabled until the checkbox is ticked.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Full verification:** `cd app && npm test && npx tsc --noEmit && (cd src-tauri && cargo test && cargo clippy -- -D warnings) && npm run tauri build` — all succeed; the built app opens, logs in, adds a catalogue design and a gang sheet, auto-places, saves, re-opens, and pre-flight shows the stub engine message.
- [ ] **Step 6: Commit** `feat(prn): sheet files and Create PRN pre-flight`
