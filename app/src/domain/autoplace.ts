export interface PlaceInput {
  id: string;
  widthMm: number;
  heightMm: number;
  groupKey?: string;
}
export interface Placement {
  id: string;
  xMm: number;
  yMm: number;
  rotated: boolean;
}
export interface AutoPlaceOptions {
  originXMm: number;
  originYMm: number;
  printableWidthMm: number;
  gapMm: number;
  allowRotate: boolean;
}
export interface AutoPlaceResult {
  placements: Placement[];
  unplaced: string[];
  usedLengthMm: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-9;

function contains(a: Rect, b: Rect): boolean {
  return (
    b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS
  );
}

/** MaxRects (bottom-left rule) strip packing; see Task 4 brief. */
export function autoPlace(items: PlaceInput[], opts: AutoPlaceOptions): AutoPlaceResult {
  const { originXMm, originYMm, printableWidthMm, gapMm, allowRotate } = opts;
  // Items are inflated by the gap on right/bottom, so the strip is one gap wider.
  const stripW = printableWidthMm + gapMm;

  const order = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ga = a.item.groupKey ?? '';
      const gb = b.item.groupKey ?? '';
      if (ga !== gb) return ga < gb ? -1 : 1;
      const ma = Math.max(a.item.widthMm, a.item.heightMm);
      const mb = Math.max(b.item.widthMm, b.item.heightMm);
      if (ma !== mb) return mb - ma;
      return a.index - b.index;
    });

  let free: Rect[] = [{ x: 0, y: 0, w: stripW, h: Infinity }];
  const placements: Placement[] = [];
  const unplaced: string[] = [];
  let usedLength = 0;

  for (const { item } of order) {
    const orientations = [{ w: item.widthMm, h: item.heightMm, rotated: false }];
    if (allowRotate && item.widthMm !== item.heightMm) {
      orientations.push({ w: item.heightMm, h: item.widthMm, rotated: true });
    }

    let best: { x: number; y: number; w: number; h: number; rotated: boolean } | null = null;
    let bestBottom = Infinity;
    let bestX = Infinity;
    for (const o of orientations) {
      const iw = o.w + gapMm;
      const ih = o.h + gapMm;
      for (const f of free) {
        if (iw > f.w + EPS || ih > f.h + EPS) continue;
        const bottom = f.y + ih;
        if (bottom < bestBottom - EPS || (Math.abs(bottom - bestBottom) <= EPS && f.x < bestX - EPS)) {
          best = { x: f.x, y: f.y, w: iw, h: ih, rotated: o.rotated };
          bestBottom = bottom;
          bestX = f.x;
        }
      }
    }

    if (!best) {
      unplaced.push(item.id);
      continue;
    }

    const used: Rect = best;
    const next: Rect[] = [];
    for (const f of free) {
      const intersects =
        used.x < f.x + f.w - EPS && f.x < used.x + used.w - EPS && used.y < f.y + f.h - EPS && f.y < used.y + used.h - EPS;
      if (!intersects) {
        next.push(f);
        continue;
      }
      if (used.x > f.x + EPS) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
      if (used.x + used.w < f.x + f.w - EPS)
        next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - (used.x + used.w), h: f.h });
      if (used.y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
      if (used.y + used.h < f.y + f.h - EPS)
        next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - (used.y + used.h) });
    }
    // Prune free rects fully contained in another.
    free = next.filter((a, i) => !next.some((b, j) => j !== i && contains(b, a) && (!contains(a, b) || j < i)));

    placements.push({ id: item.id, xMm: originXMm + best.x, yMm: originYMm + best.y, rotated: best.rotated });
    usedLength = Math.max(usedLength, best.y + best.h - gapMm);
  }

  return { placements, unplaced, usedLengthMm: usedLength };
}
