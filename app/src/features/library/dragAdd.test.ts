import { describe, expect, it, vi } from 'vitest'
import { beginLibraryDrag, movedPastThreshold, pointInRect } from './dragAdd'

const rect = { left: 0, top: 0, right: 100, bottom: 50 }

describe('drag hit decision', () => {
  it('detects points inside and outside the canvas rect', () => {
    expect(pointInRect({ x: 10, y: 10 }, rect)).toBe(true)
    expect(pointInRect({ x: 101, y: 10 }, rect)).toBe(false)
    expect(pointInRect({ x: 10, y: 60 }, rect)).toBe(false)
  })
  it('needs a small movement before a press becomes a drag', () => {
    expect(movedPastThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false)
    expect(movedPastThreshold({ x: 0, y: 0 }, { x: 5, y: 3 })).toBe(true)
  })
})

describe('beginLibraryDrag', () => {
  const setup = () => {
    const canvas = document.createElement('div')
    canvas.setAttribute('data-testid', 'canvas-area')
    canvas.getBoundingClientRect = () => ({ ...rect, x: 0, y: 0, width: 100, height: 50, toJSON() {} })
    document.body.appendChild(canvas)
    return canvas
  }
  const ptr = (type: string, x: number, y: number) => window.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y }))

  it('runs the action when released over the canvas after dragging', () => {
    const canvas = setup()
    const action = vi.fn()
    beginLibraryDrag({ clientX: 200, clientY: 200, button: 0 }, 'Lion', action)
    ptr('pointermove', 150, 100)
    expect(document.querySelector('.drag-ghost')).not.toBeNull()
    ptr('pointermove', 50, 20)
    ptr('pointerup', 50, 20)
    expect(action).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.drag-ghost')).toBeNull()
    canvas.remove()
  })

  it('shows a spinner at the drop point until a slow add finishes', async () => {
    const canvas = setup()
    let finish!: () => void
    const pending = new Promise<void>((r) => (finish = r))
    beginLibraryDrag({ clientX: 200, clientY: 200, button: 0 }, 'Lion', () => pending)
    ptr('pointermove', 50, 20)
    ptr('pointerup', 50, 20)
    expect(document.querySelector('.drop-busy')?.textContent).toBe('Adding Lion…')
    finish()
    await pending
    await Promise.resolve()
    expect(document.querySelector('.drop-busy')).toBeNull()
    canvas.remove()
  })

  it('cancels on release elsewhere, on Escape, and on a plain click', () => {
    const canvas = setup()
    const action = vi.fn()
    beginLibraryDrag({ clientX: 200, clientY: 200, button: 0 }, 'x', action)
    ptr('pointermove', 150, 100)
    ptr('pointerup', 150, 100)
    beginLibraryDrag({ clientX: 200, clientY: 200, button: 0 }, 'x', action)
    ptr('pointermove', 150, 100)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    ptr('pointerup', 50, 20)
    beginLibraryDrag({ clientX: 50, clientY: 20, button: 0 }, 'x', action)
    ptr('pointerup', 50, 20)
    expect(action).not.toHaveBeenCalled()
    expect(document.querySelector('.drag-ghost')).toBeNull()
    canvas.remove()
  })
})
