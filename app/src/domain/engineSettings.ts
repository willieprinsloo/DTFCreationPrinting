import type { DotGain, EngineSettings, InkChannel } from './types'

const INKS: InkChannel[] = ['K', 'C', 'M', 'Y', 'W']
/** The six PRN channels hold each of these inks once, with white twice. */
const CHANNEL_INKS: InkChannel[] = ['K', 'C', 'M', 'Y', 'W', 'W']

/** The first default, a guess that printed the wrong colours; profiles still holding it get the measured order. */
const GUESSED_ORDER = 'K,C,M,Y,W,W'

/** True when `order` is a permutation of K, C, M, Y, W, W. */
export function isValidChannelOrder(order: unknown): order is InkChannel[] {
  return Array.isArray(order) && order.length === 6 && [...order].sort().join() === [...CHANNEL_INKS].sort().join()
}

/** Measured from a Maintop PRN of the colour chart (2026-10-22): the printer takes yellow, magenta, cyan, black. */
export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  channelOrder: ['Y', 'M', 'C', 'K', 'W', 'W'],
  inkLimitPct: 280,
  ucrStartPct: 40,
  ucrPct: 0,
  whiteDensityPct: 100,
  whiteChokeMm: 0.2,
  whiteEdgeSteps: 0,
  screening: 'blueNoise',
  dotGain: { K: [], C: [], M: [], Y: [], W: [] },
  leadInMm: 0,
  darkness: 0,
  saturationPct: 100,
  renderIntent: 'perceptual',
}

/**
 * Matches Maintop on the 700DTF I3200 at 720 x 1800, 6 pass, used with Maintop's
 * `720x1800_6paaas.icm`. Fitted (2026-10-23) to what Maintop's PRN of the colour chart actually
 * printed: Maintop takes 13 % of the colour out under full black (from 40 % black up) and limits
 * the total before its ink curves; the curves are only right with that profile.
 */
export const MAINTOP_6PASS_PRESET: Pick<EngineSettings, 'inkLimitPct' | 'ucrStartPct' | 'ucrPct' | 'whiteDensityPct' | 'whiteChokeMm' | 'whiteEdgeSteps' | 'dotGain'> = {
  inkLimitPct: 330,
  ucrStartPct: 40,
  ucrPct: 13.2,
  whiteDensityPct: 55,
  // Maintop's PRN keeps the white to the design's edge and fades its outer 2 pixels (driver `WhiteInvaginate`).
  whiteChokeMm: 0,
  whiteEdgeSteps: 2,
  dotGain: {
    K: [[0.025, 0.0022], [0.05, 0.0044], [0.075, 0.0068], [0.1, 0.0091], [0.125, 0.0113], [0.15, 0.0137], [0.175, 0.0162], [0.2, 0.0188], [0.225, 0.0214], [0.25, 0.0244], [0.275, 0.0275], [0.3, 0.0307], [0.325, 0.0339], [0.35, 0.0375], [0.375, 0.0415], [0.4, 0.0461], [0.425, 0.0506], [0.45, 0.055], [0.475, 0.0609], [0.5, 0.0688], [0.525, 0.0779], [0.55, 0.0869], [0.575, 0.0961], [0.6, 0.1074], [0.625, 0.1219], [0.65, 0.1419], [0.675, 0.1684], [0.7, 0.1975], [0.725, 0.2262], [0.75, 0.2521], [0.775, 0.2779], [0.8, 0.3256], [0.825, 0.3995], [0.85, 0.4673], [0.875, 0.5203], [0.9, 0.5706], [0.925, 0.6362], [0.95, 0.7339], [0.975, 0.8581]],
    C: [[0.025, 0.0013], [0.05, 0.003], [0.075, 0.0047], [0.1, 0.0063], [0.125, 0.0082], [0.15, 0.0099], [0.175, 0.0118], [0.2, 0.0139], [0.225, 0.0159], [0.25, 0.018], [0.275, 0.0206], [0.3, 0.0236], [0.325, 0.0266], [0.35, 0.0298], [0.375, 0.033], [0.4, 0.0365], [0.425, 0.0407], [0.45, 0.0454], [0.475, 0.0508], [0.5, 0.0574], [0.525, 0.0655], [0.55, 0.0753], [0.575, 0.0866], [0.6, 0.1022], [0.625, 0.1263], [0.65, 0.1591], [0.675, 0.1977], [0.7, 0.2531], [0.725, 0.3336], [0.75, 0.4217], [0.775, 0.499], [0.8, 0.5608], [0.825, 0.6061], [0.85, 0.6475], [0.875, 0.7145], [0.9, 0.7954], [0.925, 0.8514], [0.95, 0.8934], [0.975, 0.9438]],
    M: [[0.025, 0.0024], [0.05, 0.0044], [0.075, 0.0063], [0.1, 0.0083], [0.125, 0.0108], [0.15, 0.0134], [0.175, 0.016], [0.2, 0.0188], [0.225, 0.0217], [0.25, 0.0247], [0.275, 0.028], [0.3, 0.0316], [0.325, 0.0355], [0.35, 0.0396], [0.375, 0.0444], [0.4, 0.0499], [0.425, 0.0573], [0.45, 0.0657], [0.475, 0.0732], [0.5, 0.0824], [0.525, 0.0944], [0.55, 0.1085], [0.575, 0.1256], [0.6, 0.1428], [0.625, 0.1669], [0.65, 0.2111], [0.675, 0.2688], [0.7, 0.3356], [0.725, 0.4051], [0.75, 0.4771], [0.775, 0.5532], [0.8, 0.6114], [0.825, 0.6545], [0.85, 0.6981], [0.875, 0.7377], [0.9, 0.7813], [0.925, 0.8391], [0.95, 0.8992], [0.975, 0.953]],
    Y: [[0.025, 0.0021], [0.05, 0.0042], [0.075, 0.0064], [0.1, 0.0091], [0.125, 0.0123], [0.15, 0.0154], [0.175, 0.0182], [0.2, 0.021], [0.225, 0.0249], [0.25, 0.0308], [0.275, 0.0374], [0.3, 0.0428], [0.325, 0.0455], [0.35, 0.0478], [0.375, 0.0525], [0.4, 0.0595], [0.425, 0.0671], [0.45, 0.0752], [0.475, 0.085], [0.5, 0.0967], [0.525, 0.1106], [0.55, 0.1348], [0.575, 0.1705], [0.6, 0.2027], [0.625, 0.2354], [0.65, 0.283], [0.675, 0.3392], [0.7, 0.3958], [0.725, 0.4555], [0.75, 0.517], [0.775, 0.5664], [0.8, 0.5982], [0.825, 0.6291], [0.85, 0.6808], [0.875, 0.7465], [0.9, 0.8039], [0.925, 0.8491], [0.95, 0.8895], [0.975, 0.9388]],
    W: [],
  },
}

export const LIMITS = {
  inkLimitPct: [100, 400],
  ucrStartPct: [0, 95],
  ucrPct: [0, 50],
  whiteDensityPct: [0, 100],
  whiteChokeMm: [0, 2],
  whiteEdgeSteps: [0, 3],
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
      isValidChannelOrder(order) && order.join() !== GUESSED_ORDER ? [...order] : [...d.channelOrder],
    inkLimitPct: inRange(raw.inkLimitPct, LIMITS.inkLimitPct[0], LIMITS.inkLimitPct[1], d.inkLimitPct),
    ucrStartPct: inRange(raw.ucrStartPct, LIMITS.ucrStartPct[0], LIMITS.ucrStartPct[1], d.ucrStartPct),
    ucrPct: inRange(raw.ucrPct, LIMITS.ucrPct[0], LIMITS.ucrPct[1], d.ucrPct),
    whiteDensityPct: inRange(raw.whiteDensityPct, LIMITS.whiteDensityPct[0], LIMITS.whiteDensityPct[1], d.whiteDensityPct),
    whiteChokeMm: inRange(raw.whiteChokeMm, LIMITS.whiteChokeMm[0], LIMITS.whiteChokeMm[1], d.whiteChokeMm),
    whiteEdgeSteps: Math.round(inRange(raw.whiteEdgeSteps, LIMITS.whiteEdgeSteps[0], LIMITS.whiteEdgeSteps[1], d.whiteEdgeSteps)),
    screening: raw.screening === 'errorDiffusion' || raw.screening === 'blueNoise' ? raw.screening : d.screening,
    dotGain: Object.fromEntries(INKS.map((k) => [k, sanitizeCurve(gain[k])])) as DotGain,
    leadInMm: inRange(raw.leadInMm, LIMITS.leadInMm[0], LIMITS.leadInMm[1], d.leadInMm),
    darkness: inRange(raw.darkness, LIMITS.darkness[0], LIMITS.darkness[1], d.darkness),
    saturationPct: inRange(raw.saturationPct, LIMITS.saturationPct[0], LIMITS.saturationPct[1], d.saturationPct),
    renderIntent: raw.renderIntent === 'relativeColorimetric' ? 'relativeColorimetric' : d.renderIntent,
    ...(icc ? { iccProfilePath: icc } : {}),
  }
}

const within = (v: number, [lo, hi]: readonly [number, number]) => Number.isFinite(v) && v >= lo && v <= hi

/** Plain-English reason the settings can't be used, or null when they are fine. */
export function validateEngineSettings(s: EngineSettings): string | null {
  const L = LIMITS
  if (!isValidChannelOrder(s.channelOrder)) return 'Use each ink once (black, cyan, magenta, yellow) and white twice across the six channels'
  if (!within(s.inkLimitPct, L.inkLimitPct)) return 'Ink limit must be between 100 and 400 %'
  if (!within(s.ucrPct, L.ucrPct)) return 'Less colour under black must be between 0 and 50 %'
  if (!within(s.ucrStartPct, L.ucrStartPct)) return 'Less colour under black must start between 0 and 95 % black'
  if (!within(s.whiteDensityPct, L.whiteDensityPct)) return 'White density must be between 0 and 100 %'
  if (!within(s.whiteChokeMm, L.whiteChokeMm)) return 'White choke must be between 0 and 2 mm'
  if (!Number.isInteger(s.whiteEdgeSteps) || !within(s.whiteEdgeSteps, L.whiteEdgeSteps)) return 'Soft white edge must be 0 to 3 pixels'
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

/** True when the curve has points the three 25/50/75 % boxes can't show, so editing them would lose detail. */
export const isDetailedCurve = (points: [number, number][]) =>
  points.length > 0 && (points.length !== 3 || points.some(([x], i) => x !== CURVE_X[i]))

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
