import { describe, expect, it } from 'vitest'
import { TRANSFORMER_ANCHORS } from './SheetCanvas'

describe('transformer anchors', () => {
  it('are corners only so a drag never stretches', () => {
    expect([...TRANSFORMER_ANCHORS].sort()).toEqual(['bottom-left', 'bottom-right', 'top-left', 'top-right'])
  })
})
