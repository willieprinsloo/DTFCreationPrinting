# DTF Print Studio — Windows setup

How to build, test and run DTF Print Studio on a Windows PC (for example the printer PC that runs
**ATools 3200**), and how to print the first test file (Checkpoint 1).

Tested target: Windows 10/11, 64-bit.

> The Windows build has not been compiled yet — this machine is the first one. If any step fails,
> copy the full error text back to the developer.

---

## 1. Install the tools (once)

Install these, accepting the defaults unless noted:

| Tool | Where | Notes |
|---|---|---|
| **Git for Windows** | https://git-scm.com/download/win | |
| **Node.js 22 LTS** (x64) | https://nodejs.org | Includes `npm`. |
| **Visual Studio 2022 Build Tools** | https://visualstudio.microsoft.com/visual-cpp-build-tools/ | In the installer tick **"Desktop development with C++"** (MSVC compiler + Windows SDK). Needed by Rust, Tauri and the colour library. |
| **Rust** | https://rustup.rs → run `rustup-init.exe` | Choose the default **x86_64-pc-windows-msvc** toolchain. |
| **WebView2 Runtime** | Already in Windows 11. On Windows 10: https://developer.microsoft.com/microsoft-edge/webview2/ (Evergreen) | |

Close and reopen **PowerShell** after installing, then check:

```powershell
git --version
node -v        # v22.x
npm -v
rustc -V       # 1.88 or newer
cargo -V
```

## 2. Get the code

```powershell
cd $HOME\Documents
git clone https://github.com/willieprinsloo/DTFCreationPrinting.git DTFCreationPrinting
cd DTFCreationPrinting
git checkout feat/prn-engine    # PRN engine branch (until it is merged into main)
```

## 3. PDF support (pdfium library)

Downloads the pinned, checksum-verified pdfium library for Windows into `app\src-tauri\pdfium\`:

```powershell
powershell -ExecutionPolicy Bypass -File app\src-tauri\scripts\fetch-pdfium.ps1 win-x64
```

It must end without a red "checksum mismatch" error. Without this step everything works except PDF
files, which show "PDF support is not installed".

## 4. Install, test and run

```powershell
cd app
npm ci                         # install JavaScript packages
npx vitest run                 # app tests — all must pass
npx tsc --noEmit               # type check — no output means OK

cd src-tauri
$env:DTF_REQUIRE_PDFIUM = "1"
cargo test --workspace         # Rust tests incl. the PRN engine and PDF support
Remove-Item Env:DTF_REQUIRE_PDFIUM
cd ..

npm run tauri dev              # start the app in development mode
```

## 5. Build the installer

```powershell
cd app
npm run tauri build
```

The installers appear in:

- `app\src-tauri\target\release\bundle\msi\DTF Print Studio_0.1.0_x64_en-US.msi`
- `app\src-tauri\target\release\bundle\nsis\DTF Print Studio_0.1.0_x64-setup.exe`

The installer is not code-signed yet, so Windows SmartScreen may warn: click **More info → Run anyway**.

## 6. Checkpoint 1 — channel test print (on the printer PC)

This checks that ATools accepts our PRN files and which ink each PRN channel prints.

```powershell
cd app\src-tauri
cargo build --release -p dtf-engine --bin prn-tool
.\target\release\prn-tool.exe chart channels $HOME\Desktop\channels.prn --width-mm 600
.\target\release\prn-tool.exe inspect $HOME\Desktop\channels.prn
```

Then in **ATools 3200**: load `channels.prn` from the Desktop the same way you load a Maintop PRN and
print it. Keep your normal ATools settings (Bidi, High, Two head, WC_Seq C_W).

What prints: six 8 × 8 cm squares in a row, numbered **0–5 from the left as seen in the ATools
preview**. Each square uses only one PRN channel. Squares 4 and 5 should be white (their number labels
are white too, so they are invisible on clear film).

Report back:

1. Did ATools accept the file (any error message)?
2. Which colour printed for each square 0–5 (expected: 0 black, 1 cyan, 2 magenta, 3 yellow, 4 white, 5 white)?
3. Did it print about 12 cm of film, or a longer length?

Full guide and later checkpoints: `docs\printing\test-print-checkpoints.md`.

## 7. Windows-only things to check in the app

Please try these on Windows and report anything that doesn't work:

- [ ] **Create PRN** → save to a folder whose path contains spaces (e.g. `C:\Users\<you>\My PRNs\`) → **Show in folder** opens Explorer with the file selected.
- [ ] Drag PNG / PDF files from Explorer onto the library drawer.
- [ ] Drag a catalogue thumbnail and a gang-sheet order card onto the film.
- [ ] Add a **PDF** gang sheet; its badge shows "Vector".
- [ ] Log in to DTF Creations, close the app, reopen — it logs in by itself (password kept in Windows Credential Manager).
- [ ] Create a PRN of a real sheet and load it in ATools (print only after Checkpoint 1 is confirmed).

## Troubleshooting

| Problem | Fix |
|---|---|
| `link.exe not found` / MSVC errors | Install VS 2022 Build Tools with **Desktop development with C++**, then reopen PowerShell. |
| `cargo` / `rustc` not recognised | Reopen PowerShell after installing Rust, or run `rustup default stable-x86_64-pc-windows-msvc`. |
| "PDF support is not installed" in the app | Run step 3 again, then rebuild. |
| `npm ci` fails | Make sure Node.js is version 22 (`node -v`); delete `app\node_modules` and retry. |
| Script blocked ("running scripts is disabled") | Use the `powershell -ExecutionPolicy Bypass -File …` form shown in step 3. |
| PRN files are large | ~1.8 GB per metre of 60 cm film. Keep plenty of free disk space; an SSD helps. |
