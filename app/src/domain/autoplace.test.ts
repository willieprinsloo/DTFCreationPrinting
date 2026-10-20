import { describe, it, expect } from 'vitest';
import { autoPlace, type AutoPlaceOptions, type PlaceInput } from './autoplace';

const base: AutoPlaceOptions = {
  originXMm: 0,
  originYMm: 0,
  printableWidthMm: 600,
  gapMm: 0,
  allowRotate: false,
};

const sq = (id: string, s = 100): PlaceInput => ({ id, widthMm: s, heightMm: s });

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('autoPlace', () => {
  it('places four squares in one row with gap 0', () => {
    const r = autoPlace([sq('a'), sq('b'), sq('c'), sq('d')], base);
    expect(r.unplaced).toEqual([]);
    expect(r.placements.map((p) => p.yMm)).toEqual([0, 0, 0, 0]);
    expect(r.usedLengthMm).toBe(100);
  });

  it('puts gaps only between items', () => {
    const r = autoPlace([sq('a'), sq('b'), sq('c'), sq('d')], { ...base, gapMm: 5 });
    expect(r.placements.map((p) => p.xMm).sort((a, b) => a - b)).toEqual([0, 105, 210, 315]);
    expect(r.placements.every((p) => p.yMm === 0)).toBe(true);
    expect(r.usedLengthMm).toBe(100);
  });

  it('does not need a gap at the right edge', () => {
    const r = autoPlace([{ id: 'w', widthMm: 590, heightMm: 50 }], {
      ...base,
      printableWidthMm: 590,
      gapMm: 5,
    });
    expect(r.unplaced).toEqual([]);
    expect(r.placements).toEqual([{ id: 'w', xMm: 0, yMm: 0, rotated: false }]);
  });

  it('rotates an over-wide item when allowed', () => {
    const r = autoPlace([{ id: 'x', widthMm: 700, heightMm: 100 }], { ...base, allowRotate: true });
    expect(r.unplaced).toEqual([]);
    expect(r.placements[0].rotated).toBe(true);
    expect(r.usedLengthMm).toBe(700);
  });

  it('reports over-wide item as unplaced when rotation is disallowed', () => {
    const r = autoPlace([{ id: 'x', widthMm: 700, heightMm: 100 }], base);
    expect(r.unplaced).toEqual(['x']);
    expect(r.placements).toEqual([]);
    expect(r.usedLengthMm).toBe(0);
  });

  it('offsets every placement by the origin', () => {
    const r = autoPlace([sq('a'), sq('b')], { ...base, originXMm: 5, originYMm: 5 });
    expect(r.placements.map((p) => [p.xMm, p.yMm])).toEqual([
      [5, 5],
      [105, 5],
    ]);
    expect(r.usedLengthMm).toBe(100);
  });

  it('keeps groups together (sorted by groupKey)', () => {
    const r = autoPlace(
      [
        { id: 'b1', widthMm: 100, heightMm: 100, groupKey: 'B' },
        { id: 'a1', widthMm: 50, heightMm: 50, groupKey: 'A' },
      ],
      base,
    );
    expect(r.placements.map((p) => p.id)).toEqual(['a1', 'b1']);
  });

  it('places random items without overlap, inside the strip, each id once', () => {
    const rnd = mulberry32(12345);
    const gap = 3;
    const width = 590;
    const items: PlaceInput[] = Array.from({ length: 60 }, (_, i) => ({
      id: `i${i}`,
      widthMm: 20 + rnd() * 280,
      heightMm: 20 + rnd() * 280,
    }));
    const origin = { originXMm: 7, originYMm: 11 };
    const r = autoPlace(items, {
      ...origin,
      printableWidthMm: width,
      gapMm: gap,
      allowRotate: true,
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    const rects = r.placements.map((p) => {
      const it = byId.get(p.id)!;
      const w = p.rotated ? it.heightMm : it.widthMm;
      const h = p.rotated ? it.widthMm : it.heightMm;
      return { x: p.xMm, y: p.yMm, w, h };
    });
    const eps = 1e-6;
    for (const q of rects) {
      expect(q.x).toBeGreaterThanOrEqual(origin.originXMm - eps);
      expect(q.y).toBeGreaterThanOrEqual(origin.originYMm - eps);
      expect(q.x + q.w).toBeLessThanOrEqual(origin.originXMm + width + eps);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap =
          a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
        expect(overlap).toBe(false);
      }
    }
    const ids = [...r.placements.map((p) => p.id), ...r.unplaced].sort();
    expect(ids).toEqual(items.map((i) => i.id).sort());
    expect(new Set(ids).size).toBe(60);
  });

  it('handles ~500 items quickly', () => {
    const rnd = mulberry32(7);
    const items: PlaceInput[] = Array.from({ length: 500 }, (_, i) => ({
      id: `n${i}`,
      widthMm: 20 + rnd() * 100,
      heightMm: 20 + rnd() * 100,
    }));
    const t = Date.now();
    const r = autoPlace(items, { ...base, printableWidthMm: 590, gapMm: 3, allowRotate: true });
    expect(r.placements.length + r.unplaced.length).toBe(500);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});
