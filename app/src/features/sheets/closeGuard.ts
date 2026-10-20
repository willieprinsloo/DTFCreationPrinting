import { ask } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getSheetStore } from '../../state/sheetStore'
import { isDirty } from './sheetFiles'

export interface CloseDeps {
  isDirty(): boolean
  sheetName(): string
  ask(message: string, opts: { title: string; kind: 'warning' }): Promise<boolean>
  destroy(): Promise<void>
}

/** Blocks the window close while the sheet has unsaved changes, unless the user agrees to discard them. */
export async function handleCloseRequest(event: { preventDefault(): void }, deps: CloseDeps): Promise<void> {
  if (!deps.isDirty()) return
  event.preventDefault()
  const ok = await deps.ask(`Discard unsaved changes to ${deps.sheetName()}?`, { title: 'Unsaved changes', kind: 'warning' })
  if (ok) await deps.destroy()
}

/** Registers the guard on the main window; returns the unlisten function. */
export function installCloseGuard(): Promise<() => void> {
  const win = getCurrentWindow()
  return win.onCloseRequested((event) =>
    handleCloseRequest(event, {
      isDirty,
      sheetName: () => getSheetStore().getState().sheet.name,
      ask,
      destroy: () => win.destroy(),
    }),
  )
}
