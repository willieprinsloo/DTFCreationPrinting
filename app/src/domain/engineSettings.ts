import type { DotGain, EngineSettings, InkChannel } from './types'

const INKS: InkChannel[] = ['K', 'C', 'M', 'Y', 'W']

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  channelOrder: ['K', 'C', 'M', 'Y', 'W', 'W'],
  inkLimitPct: 280,
  whiteDensityPct: 100,
  whiteChokeMm: 0.2,
  screening: 'blueNoise',
  dotGain: { K: [], C: [], M: [], Y: [], W: [] },
  leadInMm: 0,
}

const inRange = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback

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
      Array.isArray(order) && order.length === 6 && order.every((c) => INKS.includes(c)) ? [...order] : [...d.channelOrder],
    inkLimitPct: inRange(raw.inkLimitPct, 1, 400, d.inkLimitPct),
    whiteDensityPct: inRange(raw.whiteDensityPct, 0, 200, d.whiteDensityPct),
    whiteChokeMm: inRange(raw.whiteChokeMm, 0, 5, d.whiteChokeMm),
    screening: raw.screening === 'errorDiffusion' || raw.screening === 'blueNoise' ? raw.screening : d.screening,
    dotGain: Object.fromEntries(INKS.map((k) => [k, sanitizeCurve(gain[k])])) as DotGain,
    leadInMm: inRange(raw.leadInMm, 0, 1000, d.leadInMm),
    ...(icc ? { iccProfilePath: icc } : {}),
  }
}
