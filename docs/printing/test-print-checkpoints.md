# Test-print checkpoints

These short test prints check our PRN files against your real printer before we build the rest of the software. Each one takes a few minutes and a small piece of film.

## Checkpoint 1: channel order, file acceptance, short length

### What this tests
1. **Channel order.** The file has six ink channels, numbered 0 to 5. Measured on 2026-10-22: Yellow, Magenta, Cyan, Black, White, White (see the results below). The test shows which colour each channel really prints.
2. **File acceptance.** Does your printing software (Maintop) open and print a file made by our tool without complaining?
3. **Short length.** The file is only 12 cm long, not a full metre. We need to know the printer accepts a short file with no blank lead-in.

### The file
`channels.prn` is 600 mm wide and 120 mm long (about 217 MB). It has six 80 x 80 mm squares in a row, numbered 0 to 5 underneath. Squares are numbered 0 to 5 from the left, as you see them in the printing software's preview (not as the film looks from the back). Each square is printed in only one ink channel, at full strength. The number under each square is printed in that same channel, so the digits under squares 4 and 5 are white and will not show on clear film. Count those two squares from the left instead.

It is not stored in git because of its size. To make it, run this from the project folder:

```
cd app/src-tauri
cargo run --release -p dtf-engine --bin prn-tool -- chart channels ../../docs/printing/out/channels.prn --width-mm 600
```

The file appears at `docs/printing/out/channels.prn`. To check it first, run the same command with `inspect ../../docs/printing/out/channels.prn` in place of `chart channels ...`. It should report 8504 lines, 17007 px wide, 6 channels.

### Steps
1. Copy `channels.prn` to the printer PC (USB stick or network share).
2. Load film as for a normal job.
3. Open the file in the printing software the same way you open a normal PRN.
4. Do not change any settings. Print it.
5. Fill in the results table below. For each numbered square, write the colour you actually see on the film.
6. Take a photo of the print and send it with the table.

If the software shows an error or refuses the file, copy the exact message and tell us. That is a useful result too.

### Results

| Item | Expected | What happened |
|---|---|---|
| File opened in the software without an error | Yes | |
| Error message (if any) | None | |
| Print ran to the end | Yes | |
| Printed length | about 12 cm | |
| Printed width | about 60 cm | |
| Square 0 colour | Black | |
| Square 1 colour | Cyan | |
| Square 2 colour | Magenta | |
| Square 3 colour | Yellow | |
| Square 4 colour | White | |
| Square 5 colour | White | |
| Numbers under squares 0 to 3 match the square colour (white digits under 4 and 5 are invisible) | Yes | |
| Anything else odd (shifted, cut off, extra blank film) | No | |

Squares 4 and 5 and their digits are hard to see on clear film. Looking at them against dark paper or a coloured backing helps. If both show white, tell us. If one is white and the other prints nothing, tell us which.

### What we do with the answers
- If the order differs, we change the printer's default channel order.
- If the file is refused, we compare our header with Maintop's own file and fix it before going further.
- If the length is refused or padded, we adjust how the file is trimmed.

Results recorded here (to be filled in after the print):

**2026-10-22.** A sheet from the app printed and the printer software accepted it, but the colours were wrong.

We then measured the channel order from a Maintop PRN of the colour chart (`colour-test.tif`). We compared each channel's ink in every patch with the patch colour:

| Channel | Matches | Ink |
|---|---|---|
| 0 | yellow (correlation 0.86) | Yellow |
| 1 | magenta (0.72) | Magenta |
| 2 | cyan (0.67) | Cyan |
| 3 | grey / black (0.69) | Black |
| 4, 5 | under every patch | White |

The order is **Y, M, C, K, W, W**, so the default was changed from the guessed K, C, M, Y. Profiles still on the guess are moved over when the app starts.

The same file also showed how Maintop uses ink:
- **White:** about 55 % (40 % small, 55 % medium, 5 % large drops) under every colour. Our 100 % default uses almost only large drops.
- **Greys:** mostly cyan, magenta and yellow, with black only from about 50 % grey upwards. Our built-in model makes greys from black alone.
- **Solid colours:** reach 100 % large drops, as ours do.


## Checkpoint 2: white layer (density and choke)

### What this tests
How much white ink to lay under the colour, and how far to pull it in from the edge of the design. Too little pull-in leaves a white halo around the colour. Too much leaves a thin colour edge with no white behind it.

### The file
`white.prn` is a grid of 12 squares (600 mm wide, about 155 mm long). Each square is 40 mm, with a black outline around a dark blue fill, printed on white. Seen in the software preview:
- **Rows, top to bottom:** white density 60 %, 80 %, 100 %.
- **Columns, left to right:** white choke 0, 0.1, 0.2, 0.4 mm.
- Small black dots above each square count the column (top row of dots: 1 to 4) and the row (second row of dots: 1 to 3), so you can still tell them apart on the film.

Make it with **Create white chart PRN** in Settings, Printer & ink (it uses the settings shown there, except the density and choke, which change per square), or from the project folder:

```
cd app/src-tauri
cargo run --release -p dtf-engine --bin prn-tool -- chart white ../../docs/printing/out/white.prn --width-mm 600
```

### Steps
1. Print `white.prn` the same way as before, with no changes in the printing software.
2. Press the film to a garment or let it cure as you normally would, then look at each square from the colour side.
3. Find the square with no white halo around the black outline and a solid, even white behind the colour. Where two squares look the same, pick the lighter density and the smaller choke.
4. Open Settings, Printer & ink, enter the density and choke of that square and save.

### Results

| Item | What happened |
|---|---|
| Chosen white density (%) | |
| Chosen white choke (mm) | |
| Halo visible at choke 0? | |
| Colour edge left bare at choke 0.4? | |
| Anything else odd | |

Results recorded here (to be filled in after the print):

_Not yet printed._

## Checkpoint 3: colour match against Maintop

### What this tests
Whether our colours match what Maintop prints from the same artwork, on both a white and a dark garment.

### The files
- **Our chart (PRN):** in the app, open Settings, Printer & ink, and press **Create colour chart PRN**. It is made with the settings shown on that page, with the white underbase as normal.
- **Maintop's chart (PNG):** the same artwork as an ordinary image, 280 x 200 mm. From the project folder:

```
cd app/src-tauri
cargo run --release -p dtf-engine --bin prn-tool -- chart colour ../../docs/printing/out/colour.prn --png ../../docs/printing/out/colour.png --width-mm 600
```

(The same command also makes a PRN like the app's. Add `--profile profile.json` to use a saved printer profile.)

The chart has, from top to bottom: cyan, magenta, yellow and black ramps; red, green and blue ramps (each 0 to 100 % in 10 % steps, left to right); eight skin tones; black digits at 6, 8, 10 and 12 pt; and black lines 0.1 to 1 mm wide, horizontal then vertical.

### Steps
1. Print our chart PRN from the app as it is.
2. Open `colour.png` in Maintop, set it to 280 mm wide, leave Maintop's normal settings (white underbase as normal), and print it on the same film.
3. Press both prints onto the same white garment, and again onto the same dark garment.
4. Compare side by side in good light: the ramps (do the 10 % steps stay apart at both ends?), the skin tones, the small text, the thinnest line that still prints, and how solid the colours look on the dark garment.
5. If ours is too dark or too heavy, lower the ink limit or raise the ink curves; if colours look different, load Maintop's ICC file; if colours look dull on the dark garment, raise the white density. Then press **Create colour chart PRN** again and reprint. Repeat until ours matches or beats Maintop.

### Results

| Item | Ours | Maintop |
|---|---|---|
| Ramps: smallest step you can still see (C, M, Y, K) | | |
| Skin tones look natural | | |
| Dark garment: colours solid and bright | | |
| Smallest readable text (pt) | | |
| Thinnest line that prints (mm) | | |
| Ink limit / curves / ICC / white settings used | | |

Results recorded here (to be filled in after the print):

_Not yet printed._

### Matching Maintop on the 700DTF I3200 (measured 2026-10-22, not yet printed)
The printer's Maintop driver ("700DTF I3200-W-printX_TH3.10 MT Driver") holds the colour profiles `720x1800_6paaas.icm` (and 4- and 8-pass ones) and the `.cma` media files. Maintop prints in two steps: the ICC profile picks the ink mix (greys from C+M+Y, black only from about 50 % grey, a rich black), then the media file's per-ink curves cut the ink a lot in light and mid tones.

**Match Maintop 720×1800 6-pass…** (Settings, Colour profile) asks for that `.icm` and sets an ink limit of 320 %, white at 55 %, and ink curves fitted so that profile plus curves give the ink Maintop's PRN of the colour chart has. The chart rendered that way is within a few percent of Maintop's on the grey ramp, rich black, skin tones and most red, green and blue patches. The darkest reds, greens and blues (10–20 %) still get 10–20 % more total ink. Light cyan and the yellow ramp were not in Maintop's file, so they are not checked. The `.icm` is Maintop's file, so it is not kept in this repository; choose it from the printer PC.

**Closer match (fitted 2026-10-23, not yet printed).** The dark, strong colours were off because Maintop takes cyan, magenta and yellow out under heavy black: from 40 % black up, each is cut by 0.22 × (black − 40 %), so 13 % less at full black. Our engine had no such step, so it was added ("Less colour under black" in Settings). With that step, a 330 % limit (now barely in play) and new 41-point ink curves (every 2.5 %) fitted to the engine's own 16-bit colour conversion, the chart rendered by our engine was measured against Maintop's PRN over 54 patches:

| | Average difference | Patches off by more than 5 % | Worst |
|---|---|---|---|
| Before (320 %, 9-point curves) | 1.75 ink-% | 17 | 19 % (dark red) |
| After | 0.50 ink-% | 1 | 7 % (darkest blue) |

Fitting the curves on two thirds of the patches and testing on the rest gives 0.85 ink-% (1.66 without the new step), so the fit is not just memorising the chart. What was ruled out: Maintop's own `printX.mcm` colour tables (they don't match its PRN), Windows' colour engine (it refuses this version 4 profile, so Maintop can't be using it), the relative and saturation intents, and Adobe RGB as the source. Still off: 90 % grey (yellow 16 % high), which falls on a steep part of the yellow curve. As before, these are ink amounts in the file, not colours on film; a print and scan would confirm them.

## Checkpoint 4: a real job

### What this tests
That a normal customer gang sheet prints as well from our software as from Maintop.

### Steps
1. Pick one real customer gang sheet.
2. Print it from our software (Print to PRN), then print the same artwork through Maintop on the same film.
3. Compare colour, edges, small text and white halos. The sign-off is: ours matches or beats Maintop.

### Results

| Item | Ours | Maintop |
|---|---|---|
| Colour | | |
| Edges and halos | | |
| Small text and fine lines | | |
| Print time | | |
| Signed off (yes / no, date) | | |

Results recorded here (to be filled in after the print):

_Not yet printed._
