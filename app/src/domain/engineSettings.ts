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
  iccGridPoints: 0,
}

/**
 * Matches Maintop on the 700DTF I3200 at 720 x 1800, 6 pass, used with Maintop's
 * `720x1800_6paaas.icm`. Fitted (2026-10-23) to what Maintop's PRN of the colour chart actually
 * printed: Maintop converts through a 26-point table of the profile (its `printX.mcm` holds the
 * same numbers), takes up to 14 % of the colour out under black (from 42 % black up) and limits
 * the total before its ink curves; the curves are only right with that profile.
 */
export const MAINTOP_6PASS_PRESET: Pick<EngineSettings, 'inkLimitPct' | 'ucrStartPct' | 'ucrPct' | 'iccGridPoints' | 'whiteDensityPct' | 'whiteChokeMm' | 'whiteEdgeSteps' | 'dotGain'> = {
  inkLimitPct: 330,
  ucrStartPct: 42,
  ucrPct: 13.9,
  iccGridPoints: 26,
  whiteDensityPct: 55,
  // Maintop's PRN keeps the white to the design's edge and fades its outer 2 pixels (driver `WhiteInvaginate`).
  whiteChokeMm: 0,
  whiteEdgeSteps: 2,
  dotGain: {
    K: [[0.025, 0.0024], [0.05, 0.0043], [0.075, 0.0069], [0.1, 0.009], [0.125, 0.0113], [0.15, 0.0137], [0.175, 0.0159], [0.2, 0.019], [0.225, 0.0213], [0.25, 0.0246], [0.275, 0.0278], [0.3, 0.0308], [0.325, 0.0339], [0.35, 0.0373], [0.375, 0.0412], [0.4, 0.0457], [0.425, 0.0503], [0.45, 0.0549], [0.475, 0.0603], [0.5, 0.0686], [0.525, 0.0779], [0.55, 0.0873], [0.575, 0.0951], [0.6, 0.1069], [0.625, 0.1206], [0.65, 0.1392], [0.675, 0.1683], [0.7, 0.1974], [0.725, 0.2265], [0.75, 0.2577], [0.775, 0.3045], [0.8, 0.3654], [0.825, 0.425], [0.85, 0.4755], [0.875, 0.5279], [0.9, 0.5803], [0.925, 0.641], [0.95, 0.7494], [0.975, 0.8579]],
    C: [[0.025, 0.0011], [0.05, 0.003], [0.075, 0.0048], [0.1, 0.0065], [0.125, 0.0085], [0.15, 0.0097], [0.175, 0.0116], [0.2, 0.0138], [0.225, 0.016], [0.25, 0.0175], [0.275, 0.0207], [0.3, 0.0235], [0.325, 0.0266], [0.35, 0.0298], [0.375, 0.0331], [0.4, 0.0363], [0.425, 0.0405], [0.45, 0.0456], [0.475, 0.0507], [0.5, 0.0573], [0.525, 0.0651], [0.55, 0.075], [0.575, 0.086], [0.6, 0.1003], [0.625, 0.1413], [0.65, 0.1583], [0.675, 0.1944], [0.7, 0.237], [0.725, 0.3345], [0.75, 0.4178], [0.775, 0.5], [0.8, 0.5592], [0.825, 0.6105], [0.85, 0.6496], [0.875, 0.7432], [0.9, 0.8285], [0.925, 0.8528], [0.95, 0.8877], [0.975, 0.9439]],
    M: [[0.025, 0.0024], [0.05, 0.0044], [0.075, 0.0062], [0.1, 0.0082], [0.125, 0.0107], [0.15, 0.0135], [0.175, 0.016], [0.2, 0.0188], [0.225, 0.0217], [0.25, 0.0246], [0.275, 0.0278], [0.3, 0.0315], [0.325, 0.0354], [0.35, 0.0394], [0.375, 0.044], [0.4, 0.0499], [0.425, 0.0559], [0.45, 0.0621], [0.475, 0.0711], [0.5, 0.0817], [0.525, 0.0927], [0.55, 0.1081], [0.575, 0.1235], [0.6, 0.1469], [0.625, 0.1537], [0.65, 0.2128], [0.675, 0.2643], [0.7, 0.3273], [0.725, 0.3927], [0.75, 0.4927], [0.775, 0.5586], [0.8, 0.6066], [0.825, 0.653], [0.85, 0.6973], [0.875, 0.7416], [0.9, 0.7744], [0.925, 0.8452], [0.95, 0.8964], [0.975, 0.9561]],
    Y: [[0.025, 0.002], [0.05, 0.0041], [0.075, 0.0061], [0.1, 0.0091], [0.125, 0.0122], [0.15, 0.0155], [0.175, 0.0181], [0.2, 0.0207], [0.225, 0.0239], [0.25, 0.0296], [0.275, 0.0342], [0.3, 0.0389], [0.325, 0.0435], [0.35, 0.0463], [0.375, 0.052], [0.4, 0.0598], [0.425, 0.0675], [0.45, 0.0753], [0.475, 0.0853], [0.5, 0.0964], [0.525, 0.1097], [0.55, 0.1269], [0.575, 0.1526], [0.6, 0.1816], [0.625, 0.2267], [0.65, 0.2833], [0.675, 0.339], [0.7, 0.3939], [0.725, 0.4488], [0.75, 0.506], [0.775, 0.567], [0.8, 0.605], [0.825, 0.6359], [0.85, 0.7167], [0.875, 0.7591], [0.9, 0.8019], [0.925, 0.8449], [0.95, 0.886], [0.975, 0.9441]],
    W: [],
  },
}

/** A colour profile shipped with the app is stored as `bundled:<file name>`. */
export const BUNDLED_PROFILE_PREFIX = 'bundled:'
/** Maintop's 700DTF profile for 720 x 1800, 6 pass, shipped with the app. */
export const MAINTOP_BUNDLED_ICC = `${BUNDLED_PROFILE_PREFIX}720x1800_6paaas.icm`

/** What a new printer starts with: the Maintop 6-pass match, with the profile shipped with the app. */
export const MAINTOP_DEFAULTS: Partial<EngineSettings> = { ...MAINTOP_6PASS_PRESET, iccProfilePath: MAINTOP_BUNDLED_ICC }

/** The colour profile as people see it: the file name, or what the shipped one is. */
export function profileName(path: string | undefined): string | undefined {
  if (!path) return undefined
  if (path === MAINTOP_BUNDLED_ICC) return 'Maintop 720×1800 6-pass (built into the app)'
  if (path.startsWith(BUNDLED_PROFILE_PREFIX)) return `${path.slice(BUNDLED_PROFILE_PREFIX.length)} (built into the app)`
  return path.split(/[\\/]/).pop()
}

/**
 * True for printer settings nobody has changed from the old plain defaults (no colour profile,
 * no curves): those are moved to the Maintop defaults once.
 */
export function isUntouchedPlain(s: EngineSettings): boolean {
  const d = DEFAULT_ENGINE_SETTINGS
  return (
    !s.iccProfilePath &&
    INKS.every((k) => (s.dotGain[k] ?? []).length === 0) &&
    s.inkLimitPct === d.inkLimitPct &&
    s.ucrPct === d.ucrPct &&
    s.whiteDensityPct === d.whiteDensityPct &&
    s.whiteChokeMm === d.whiteChokeMm &&
    s.whiteEdgeSteps === d.whiteEdgeSteps &&
    s.iccGridPoints === d.iccGridPoints
  )
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
  iccGridPoints: [9, 65],
} as const

const within = (v: number, [lo, hi]: readonly [number, number]) => Number.isFinite(v) && v >= lo && v <= hi

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
    iccGridPoints:
      Number.isInteger(raw.iccGridPoints) && within(raw.iccGridPoints as number, LIMITS.iccGridPoints) ? (raw.iccGridPoints as number) : 0,
    ...(icc ? { iccProfilePath: icc } : {}),
  }
}

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
  if (s.iccGridPoints !== 0 && !(Number.isInteger(s.iccGridPoints) && within(s.iccGridPoints, L.iccGridPoints))) return 'Colour table must be off or 9 to 65 points'
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

/** The colour settings a print will use, in plain words, and a warning when the ink will be much heavier than Maintop's. */
export function describeColour(s: EngineSettings): { text: string; warning: string | null } {
  const icc = profileName(s.iccProfilePath)
  const curves = (['K', 'C', 'M', 'Y'] as const).some((k) => (s.dotGain[k] ?? []).length > 0)
  const parts = [
    icc ? `colour profile ${icc}${s.iccGridPoints === 26 ? ', converted like Maintop' : ''}` : 'built-in colour model (no colour profile)',
    curves ? 'ink curves set' : 'no ink curves',
    `ink limit ${s.inkLimitPct} %`,
  ]
  const warning = curves
    ? null
    : 'No ink curves are set, so this prints with much more ink (darker) than Maintop. Use Settings › Ink & colour › Match Maintop to set them.'
  return { text: parts.join(' · '), warning }
}
