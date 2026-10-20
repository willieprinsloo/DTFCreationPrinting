import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

vi.mock('../../platform/tauri', () => ({ cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../../state/persist', async (orig) => {
  const m = await orig<typeof import('../../state/persist')>()
  return { ...m, createTauriStore: () => m.createMemoryStore() }
})
import { LibraryDrawer } from './LibraryDrawer'
import { fakeClient, withClient } from './testUtils'
import { getSettingsStore } from '../../state/settingsStore'

function Harness({ initialCollapsed = false }: { initialCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  return (
    <div className="app-shell" data-testid="shell">
      <LibraryDrawer collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
    </div>
  )
}

beforeEach(async () => {
  await getSettingsStore().getState().setDrawerHeight(200)
})

describe('LibraryDrawer', () => {
  it('switches between tabs', async () => {
    render(<Harness />, { wrapper: withClient(fakeClient()) })
    expect(screen.getByLabelText('Search designs')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Gang sheets' }))
    expect(screen.getByLabelText('Search orders')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Local' }))
    expect(screen.getByRole('button', { name: 'Add files…' })).toBeInTheDocument()
  })

  it('collapse hides the content but keeps the tab bar; a tab click expands again', async () => {
    render(<Harness />, { wrapper: withClient(fakeClient()) })
    await userEvent.click(screen.getByRole('button', { name: 'Collapse library' }))
    expect(screen.queryByLabelText('Search designs')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Local' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Local' }))
    expect(screen.getByRole('button', { name: 'Add files…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse library' })).toBeInTheDocument()
  })

  it('resizes live and persists the clamped height once on release', async () => {
    render(<Harness />, { wrapper: withClient(fakeClient()) })
    const handle = screen.getByRole('separator', { name: 'Resize library' })
    const shell = screen.getByTestId('shell')
    const save = vi.spyOn(getSettingsStore().getState(), 'setDrawerHeight')
    fireEvent.pointerDown(handle, { clientY: 500 })
    fireEvent.pointerMove(handle, { clientY: 400 })
    expect(shell.style.getPropertyValue('--drawer-h')).toBe('300px')
    expect(getSettingsStore().getState().drawerHeightPx).toBe(200)
    fireEvent.pointerMove(handle, { clientY: -2000 })
    expect(shell.style.getPropertyValue('--drawer-h')).toBe('480px')
    fireEvent.pointerUp(handle)
    await waitFor(() => expect(getSettingsStore().getState().drawerHeightPx).toBe(480))
    expect(save).toHaveBeenCalledTimes(1)
  })
})
