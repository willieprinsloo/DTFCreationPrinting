# DTF Print Studio

Desktop app (macOS + Windows) for DTF Creations: pull gang sheets and catalogue designs from
DTF Creations, lay them out on the film (auto-place, aspect-locked sizing, print-size table), and
create a Maintop-compatible `.prn` file for the printer software (ATools 3200).

- Design: `docs/superpowers/specs/2026-10-20-dtf-print-studio-design.md`
- Plans: `docs/superpowers/plans/`
- **Windows setup & first test print:** [`docs/WINDOWS-SETUP.md`](docs/WINDOWS-SETUP.md)
- Test-print checkpoints: `docs/printing/test-print-checkpoints.md`

## Quick start (macOS)

```bash
cd app
npm ci
bash src-tauri/scripts/fetch-pdfium.sh mac-arm64   # or mac-x64
bash src-tauri/scripts/fetch-realesrgan.sh mac      # upscaler for Enhance
npm run tauri dev
```
