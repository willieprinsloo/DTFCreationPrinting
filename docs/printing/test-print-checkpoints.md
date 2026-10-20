# Test-print checkpoints

These short test prints check our PRN files against your real printer before we build the rest of the software. Each one takes a few minutes and a small piece of film.

## Checkpoint 1: channel order, file acceptance, short length

### What this tests
1. **Channel order.** The file has six ink channels, numbered 0 to 5. We expect them to be Black, Cyan, Magenta, Yellow, White, White, but we have not confirmed it. The test shows which colour each channel really prints.
2. **File acceptance.** Does your printing software (Maintop) open and print a file made by our tool without complaining?
3. **Short length.** The file is only 12 cm long, not a full metre. We need to know the printer accepts a short file with no blank lead-in.

### The file
`channels.prn` is 600 mm wide and 120 mm long (about 217 MB). It has six 80 x 80 mm squares in a row, numbered 0 to 5 underneath. Each square is printed in only one ink channel, at full strength. The number under each square is printed in that same channel.

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
| Numbers under squares match the square colour | Yes | |
| Anything else odd (shifted, cut off, extra blank film) | No | |

Squares 4 and 5 are hard to see on clear film. Looking at them against dark paper or a coloured backing helps. If both show white, tell us. If one is white and the other prints nothing, tell us which.

### What we do with the answers
- If the order differs, we change the printer's default channel order.
- If the file is refused, we compare our header with Maintop's own file and fix it before going further.
- If the length is refused or padded, we adjust how the file is trimmed.

Results recorded here (to be filled in after the print):

_Not yet printed._
