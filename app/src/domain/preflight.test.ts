import { describe, expect, it } from 'vitest'
import { preflight } from './preflight'
import { DEFAULT_THRESHOLDS } from './dpi'
import { DEFAULT_PROFILE } from '../state/settingsStore'
import type { Sheet, SheetItem } from './types'

const item = (id: string, over: Partial<SheetItem> = {}, px = 3000): SheetItem => ({
  id,
  asset: { assetId: id, path: '/a.png', previewPath: '/a.jpg', widthPx: px, heightPx: px },
  source: { kind: 'order-file', id, label: id, orderId: 'o1' },
  xMm: 5, yMm: 5, widthMm: 100, heightMm: 100, rotationDeg: 0, whiteEnabled: true,
  ...over,
})
const sheet = (items: SheetItem[]): Sheet => ({
  id: 's', name: 'S', profileId: 'dtf-60',
  settings: { widthMm: 600, margins: { topMm: 5, rightMm: 5, bottomMm: 5, leftMm: 5 }, gapMm: 3, lengthMode: 'auto', fixedLengthMm: 1000, mirror: true, whiteEnabled: true, allowRotate: true },
  items,
})
const run = (items: SheetItem[]) => preflight(sheet(items), DEFAULT_PROFILE, DEFAULT_THRESHOLDS)

describe('preflight', () => {
  it('lists PDFs the engine prints below full resolution as notes, not as low quality', () => {
    const pdf = { assetId: 'p', path: '/p.pdf', previewPath: '/p.png', widthPx: 7087, heightPx: 11811, kind: 'pdf' as const, widthMm: 600, heightMm: 1000 }
    const big = item('big', { asset: pdf, widthMm: 590, heightMm: 983.3 })
    const small = item('small', { asset: { ...pdf, widthMm: 70, heightMm: 70 }, xMm: 5, yMm: 990, widthMm: 70, heightMm: 70 })
    const r = run([big, small])
    expect(r.pdfNotes.map((n) => n.item.id)).toEqual(['big'])
    expect(Math.abs(r.pdfNotes[0].dpi - 345)).toBeLessThanOrEqual(3)
    expect(r.low).toEqual([])
    expect(r.bad).toEqual([])
  })

  it('estimates the PRN size from content length and full printer width', () => {
    const r = run([item('a')])
    expect(r.estimatedPrnBytes).toBe(180_973_680)
    expect(r.itemCount).toBe(1)
    expect(r.orderIds).toEqual(['o1'])
    expect(r.lengthMm).toBeCloseTo(110)
    expect(r.canCreate).toBe(true)
    expect(r.needsConfirm).toBe(false)
  })

  it('needs confirmation for a 100 dpi item and lists it as bad', () => {
    const r = run([item('a', {}, 394)])
    expect(r.bad.map((i) => i.id)).toEqual(['a'])
    expect(r.needsConfirm).toBe(true)
    expect(r.canCreate).toBe(true)
  })

  it('lists low-quality items without requiring confirmation', () => {
    const r = run([item('a', {}, 600)]) // 152 dpi
    expect(r.low).toHaveLength(1)
    expect(r.needsConfirm).toBe(false)
  })

  it('cannot create with an overlap or an empty sheet', () => {
    const r = run([item('a'), item('b', { xMm: 50 })])
    expect(r.problems.length).toBeGreaterThan(0)
    expect(r.canCreate).toBe(false)
    expect(run([]).canCreate).toBe(false)
  })
})
