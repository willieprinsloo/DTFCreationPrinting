import type { DotGain, EngineSettings, InkChannel } from './types'

const INKS: InkChannel[] = ['K', 'C', 'M', 'Y', 'W']
/** The six PRN channels hold each of these inks once, with white twice. */
const CHANNEL_INKS: InkChannel[] = ['K', 'C', 'M', 'Y', 'W', 'W']

/** True when `order` is a permutation of K, C, M, Y, W, W. */
export function isValidChannelOrder(order: unknown): order is InkChannel[] {
  return Array.isArray(order) && order.length === 6 && [...order].sort().join() === [...CHANNEL_INKS].sort().join()
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  channelOrder: ['K', 'C', 'M', 'Y', 'W', 'W'],
  inkLimitPct: 280,
  whiteDensityPct: 100,
  whiteChokeMm: 0.2,
  screening: 'blueNoise',
  dotGain: { K: [], C: [], M: [], Y: [], W: [] },
  leadInMm: 0,
  darkness: 0,
  saturationPct: 100,
}

export const LIMITS = {
  inkLimitPct: [100, 400],
  whiteDensityPct: [0, 100],
  whiteChokeMm: [0, 2],
  leadInMm: [0, 1000],
  darkness: [-100, 100],
  saturationPct: [50, 150],
} as const

/** Out-of-range numbers are clamped to the nearest bound; non-numbers get the fallback. */
const inRange = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

const isUnit = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1

function sanitizeCurve(v: unknown): [number, number][] {
  if (!Array.isArray(v)) return []
  const ok = v.every((p) => Array.isArray(p) && p.length === 2 && isUnit(p[0]) && isUnit(p[1]))
  return ok ? v.map(([x, y]) => [x, y] as [number, number]).sort((a, b) => a[0] - b[0]) : []
}

/** Picks the engine settings out of a (possibly old or hand-edited) saved profile, repairing bad values. */
export function sanitizeEngineSettings(raw: Partial<Record<keyof EngineSettings, unknown>>): EngineSettings {
  const d = DEFAULT_ENGINE_SETTINGS
  const order = raw.channelOrder
  const gain = (raw.dotGain ?? {}) as Partial<Record<InkChannel, unknown>>
  const icc = typeof raw.iccProfilePath === 'string' && raw.iccProfilePath.trim() ? raw.iccProfilePath : undefined
  return {
    channelOrder:
      isValidChannelOrder(order) ? [...order] : [...d.channelOrder],
    inkLimitPct: inRange(raw.inkLimitPct, LIMITS.inkLimitPct[0], LIMITS.inkLimitPct[1], d.inkLimitPct),
    whiteDensityPct: inRange(raw.whiteDensityPct, LIMITS.whiteDensityPct[0], LIMITS.whiteDensityPct[1], d.whiteDensityPct),
    whiteChokeMm: inRange(raw.whiteChokeMm, LIMITS.whiteChokeMm[0], LIMITS.whiteChokeMm[1], d.whiteChokeMm),
    screening: raw.screening === 'errorDiffusion' || raw.screening === 'blueNoise' ? raw.screening : d.screening,
    dotGain: Object.fromEntries(INKS.map((k) => [k, sanitizeCurve(gain[k])])) as DotGain,
    leadInMm: inRange(raw.leadInMm, LIMITS.leadInMm[0], LIMITS.leadInMm[1], d.leadInMm),
    darkness: inRange(raw.darkness, LIMITS.darkness[0], LIMITS.darkness[1], d.darkness),
    saturationPct: inRange(raw.saturationPct, LIMITS.saturationPct[0], LIMITS.saturationPct[1], d.saturationPct),
    ...(icc ? { iccProfilePath: icc } : {}),
  }
}

const within = (v: number, [lo, hi]: readonly [number, number]) => Number.isFinite(v) && v >= lo && v <= hi

/** Plain-English reason the settings can't be used, or null when they are fine. */
export function validateEngineSettings(s: EngineSettings): string | null {
  const L = LIMITS
  if (!isValidChannelOrder(s.channelOrder)) return 'Use each ink once (black, cyan, magenta, yellow) and white twice across the six channels'
  if (!within(s.inkLimitPct, L.inkLimitPct)) return 'Ink limit must be between 100 and 400 %'
  if (!within(s.whiteDensityPct, L.whiteDensityPct)) return 'White density must be between 0 and 100 %'
  if (!within(s.whiteChokeMm, L.whiteChokeMm)) return 'White choke must be between 0 and 2 mm'
  if (!within(s.leadInMm, L.leadInMm)) return 'Blank film before the first design must be between 0 and 1000 mm'
  if (!within(s.darkness, L.darkness)) return 'Lighter / darker must be between -100 and 100'
  if (!within(s.saturationPct, L.saturationPct)) return 'Colour must be between 50 and 150 %'
  for (const ink of INKS) {
    const pts = s.dotGain[ink] ?? []
    const ok = pts.every(([x, y], i) => within(x, [0, 1]) && within(y, [0, 1]) && (i === 0 || (x > pts[i - 1][0] && y >= pts[i - 1][1])))
    if (!ok) return `${ink} curve must stay between 0 and 100 % and never go down`
  }
  return null
}

const CURVE_X = [0.25, 0.5, 0.75] as const

/** The curve's output (as %) at 25, 50 and 75 % input; an empty curve is linear. */
export function curveToThree(points: [number, number][]): [number, number, number] {
  const pts: [number, number][] = [[0, 0], ...[...points].sort((a, b) => a[0] - b[0]), [1, 1]]
  const at = (x: number) => {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
    return 1
  }
  return CURVE_X.map((x) => Math.round(at(x) * 1e6) / 1e4) as [number, number, number]
}

/** Three output percentages (at 25, 50, 75 %) to curve points; straight-through is stored as empty. */
export function curveFromThree(pct: [number, number, number]): [number, number][] {
  if (pct.every((v, i) => Math.abs(v - CURVE_X[i] * 100) < 1e-9)) return []
  return CURVE_X.map((x, i) => [x, Math.round(pct[i] * 100) / 10000] as [number, number])
}
