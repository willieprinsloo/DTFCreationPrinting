import { describe, expect, it } from 'vitest'
import { snapPosition } from './snapping'
import type { Rect } from './types'

const printable: Rect = { xMm: 5, yMm: 5, widthMm: 590, heightMm: Infinity }
const rect = (xMm: number, yMm: number, widthMm = 50, heightMm = 50): Rect => ({ xMm, yMm, widthMm, heightMm })

describe('snapPosition', () => {
  it('snaps the left edge to the printable left edge within threshold', () => {
    expect(snapPosition(rect(6.5, 100), [], printable, 2)).toEqual({ xMm: 5, yMm: 100 })
  })

  it('leaves the position unchanged when nothing is within threshold', () => {
    expect(snapPosition(rect(9, 100), [], printable, 2)).toEqual({ xMm: 9, yMm: 100 })
  })

  it('snaps the right edge to the printable right edge', () => {
    expect(snapPosition(rect(544, 100), [], printable, 2)).toEqual({ xMm: 545, yMm: 100 })
  })

  it('snaps the top edge to the printable top edge', () => {
    expect(snapPosition(rect(100, 6), [], printable, 2)).toEqual({ xMm: 100, yMm: 5 })
  })

  it("aligns the left edge to another rect's right edge plus the gap", () => {
    const other = rect(100, 100) // right edge at 150
    expect(snapPosition(rect(154, 100.5), [other], printable, 2, 3)).toEqual({ xMm: 153, yMm: 100 })
  })

  it("aligns the left edge flush to another rect's right edge", () => {
    const other = rect(100, 100)
    expect(snapPosition(rect(151, 300), [other], printable, 2, 3)).toEqual({ xMm: 150, yMm: 300 })
  })

  it("aligns the top edge below another rect plus the gap", () => {
    const other = rect(100, 100) // bottom at 150
    expect(snapPosition(rect(300, 152), [other], printable, 2, 3)).toEqual({ xMm: 300, yMm: 153 })
  })

  it('picks the nearest candidate when several are within threshold', () => {
    const other = rect(100, 300) // right edge 150, + gap 3 = 153
    expect(snapPosition(rect(152.5, 500), [other], printable, 2, 3)).toEqual({ xMm: 153, yMm: 500 })
  })
})
