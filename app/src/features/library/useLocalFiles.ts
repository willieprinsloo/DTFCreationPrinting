import { useCallback, useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { importLocalFile } from '../../platform/tauri'
import { getSheetStore } from '../../state/sheetStore'
import type { NewItem } from '../../state/sheetStore'

const EXT = /\.(png|jpe?g|tiff?)$/i
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

/** Imports local image files and adds each at native size assuming 300 dpi. */
export function useLocalFiles() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Resolves to the number of files added. */
  const addPaths = useCallback(async (paths: string[]): Promise<number> => {
    const wanted = paths.filter((p) => EXT.test(p))
    if (wanted.length === 0) {
      if (paths.length > 0) setError('Only PNG, JPEG and TIFF files can be added')
      return 0
    }
    setBusy(true)
    setError(null)
    const items: NewItem[] = []
    const failed: string[] = []
    for (const p of wanted) {
      try {
        const asset = await importLocalFile(p)
        items.push({
          asset,
          source: { kind: 'local', id: asset.assetId, label: baseName(p) },
          widthMm: (asset.widthPx / 300) * 25.4,
          heightMm: (asset.heightPx / 300) * 25.4,
          quantity: 1,
        })
      } catch {
        failed.push(baseName(p))
      }
    }
    if (items.length > 0) getSheetStore().getState().addItems(items)
    if (failed.length > 0) setError(`Couldn't open ${failed.join(', ')}`)
    setBusy(false)
    return items.length
  }, [])

  /** Resolves to the number of files added (0 when cancelled or failed). */
  const pick = useCallback(async (): Promise<number> => {
    try {
      const sel = await open({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff'] }],
      })
      if (!sel) return 0
      return await addPaths(Array.isArray(sel) ? sel : [sel])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return 0
    }
  }, [addPaths])

  // Files dropped from Finder/Explorer onto the window.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        const un = await getCurrentWebview().onDragDropEvent((ev) => {
          if (ev.payload.type === 'drop') void addPaths(ev.payload.paths)
        })
        if (disposed) un()
        else unlisten = un
      } catch {
        // Not running inside Tauri (tests, browser preview).
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [addPaths])

  return { error, busy, pick, addPaths }
}
