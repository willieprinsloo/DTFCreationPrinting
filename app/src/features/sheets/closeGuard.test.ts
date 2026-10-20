import { describe, expect, it, vi } from 'vitest'
import { handleCloseRequest } from './closeGuard'

const mk = (dirty: boolean, answer = true) => ({
  event: { preventDefault: vi.fn() },
  deps: { isDirty: () => dirty, sheetName: () => 'Job', ask: vi.fn(async () => answer), destroy: vi.fn(async () => {}) },
})

describe('handleCloseRequest', () => {
  it('lets a clean window close without asking', async () => {
    const { event, deps } = mk(false)
    await handleCloseRequest(event, deps)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(deps.ask).not.toHaveBeenCalled()
    expect(deps.destroy).not.toHaveBeenCalled()
  })
  it('blocks and asks when dirty; destroys on yes', async () => {
    const { event, deps } = mk(true, true)
    await handleCloseRequest(event, deps)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(deps.ask).toHaveBeenCalledWith('Discard unsaved changes to Job?', expect.anything())
    expect(deps.destroy).toHaveBeenCalled()
  })
  it('keeps the window open on no', async () => {
    const { event, deps } = mk(true, false)
    await handleCloseRequest(event, deps)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(deps.destroy).not.toHaveBeenCalled()
  })
})
