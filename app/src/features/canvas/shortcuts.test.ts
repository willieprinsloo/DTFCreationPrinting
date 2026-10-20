import { describe, expect, it } from 'vitest'
import { shortcutFor, type ShortcutAction } from './shortcuts'

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...mods,
})

const cases: [string, ReturnType<typeof key>, ShortcutAction][] = [
  ['0', key('0'), 'fit'],
  ['1', key('1'), 'trueSize'],
  ['2', key('2'), 'fitWidth'],
  ['+', key('+', { shiftKey: true }), 'zoomIn'],
  ['=', key('='), 'zoomIn'],
  ['-', key('-'), 'zoomOut'],
  ['Cmd+Z', key('z', { metaKey: true }), 'undo'],
  ['Ctrl+Z', key('z', { ctrlKey: true }), 'undo'],
  ['Cmd+Shift+Z', key('z', { metaKey: true, shiftKey: true }), 'redo'],
  ['Cmd+Shift+Z (uppercase key)', key('Z', { metaKey: true, shiftKey: true }), 'redo'],
  ['Ctrl+Shift+Z', key('Z', { ctrlKey: true, shiftKey: true }), 'redo'],
  ['Ctrl+Y', key('y', { ctrlKey: true }), 'redo'],
  ['Delete', key('Delete'), 'delete'],
  ['Backspace', key('Backspace'), 'delete'],
  ['Cmd+D', key('d', { metaKey: true }), 'duplicate'],
  ['Ctrl+D', key('d', { ctrlKey: true }), 'duplicate'],
  ['[', key('['), 'sizePrev'],
  [']', key(']'), 'sizeNext'],
  ['Cmd+A', key('a', { metaKey: true }), 'selectAll'],
  ['Ctrl+A', key('a', { ctrlKey: true }), 'selectAll'],
]

describe('shortcutFor', () => {
  it.each(cases)('%s → %s', (_label, e, action) => {
    expect(shortcutFor(e)).toBe(action)
  })

  it('returns null for z without a modifier', () => {
    expect(shortcutFor(key('z'))).toBeNull()
  })

  it('returns null for unmapped keys', () => {
    expect(shortcutFor(key('q'))).toBeNull()
    expect(shortcutFor(key('d'))).toBeNull()
    expect(shortcutFor(key('a'))).toBeNull()
  })
})
