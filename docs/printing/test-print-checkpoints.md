# Test-print checkpoints

These short test prints check our PRN files against your real printer before we build the rest of the software. Each one takes a few minutes and a small piece of film.

## Checkpoint 1: channel order, file acceptance, short length

### What this tests
1. **Channel order.** The file has six ink channels, numbered 0 to 5. We expect them to be Black, Cyan, Magenta, Yellow, White, White, but we have not confirmed it. The test shows which colour each channel really prints.
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

_Not yet printed._


## Checkpoint 2: white layer (density and choke)

### What this tests
How much white ink to lay under the colour, and how far to pull it in from the edge of the design. Too little pull-in leaves a white halo around the colour. Too much leaves a thin colour edge with no white behind it.

### The file
`white.prn` is a grid of 12 squares (600 mm wide, about 155 mm long). Each square is 40 mm, with a black outline around a blue fill, printed on white. Seen in the software preview:
- **Rows, top to bottom:** white density 60 %, 80 %, 100 %.
- **Columns, left to right:** white choke 0, 0.1, 0.2, 0.4 mm.
- Small black dots above each square count the column (top row of dots: 1 to 4) and the row (second row of dots: 1 to 3), so you can still tell them apart on the film.

Make it from the project folder:

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
Whether our colours match what Maintop prints from the same artwork.

### The files
- `colour.prn`: made by our software's engine, 280 x 200 mm, white layer off.
- `colour.png`: the same chart as an ordinary image, made by the same command, to print through Maintop at 100 % size (280 mm wide).

The chart has, from top to bottom: cyan, magenta, yellow and black ramps; red, green and blue ramps (each 0 to 100 % in 10 % steps, left to right); eight skin tones; black digits at 6, 8, 10 and 12 pt; and black lines 0.1 to 1 mm wide, horizontal then vertical.

```
cd app/src-tauri
cargo run --release -p dtf-engine --bin prn-tool -- chart colour ../../docs/printing/out/colour.prn --png ../../docs/printing/out/colour.png --width-mm 600
```

### Steps
1. Print `colour.prn` as it is.
2. Open `colour.png` in Maintop, set it to 280 mm wide with its usual colour settings, and print it on the same film.
3. Lay the two prints side by side in good light and compare: the ramps (do the 10 % steps stay apart at both ends?), the skin tones, the small text and the thinnest lines that still print.
4. If ours is too dark or too heavy, lower the ink limit or raise the ink curves in Settings, Printer & ink. If the colours look different, load Maintop's ICC file there.
5. Reprint `colour.prn` after each change until it matches or beats Maintop.

### Results

| Item | Ours | Maintop |
|---|---|---|
| Ramps: smallest step you can still see (C, M, Y, K) | | |
| Skin tones look natural | | |
| Smallest readable text (pt) | | |
| Thinnest line that prints (mm) | | |
| Ink limit / curves / ICC settings used | | |

Results recorded here (to be filled in after the print):

_Not yet printed._

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
