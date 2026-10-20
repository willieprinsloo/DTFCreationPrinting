import { useEffect } from 'react'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  fitSheet,
  fitWidth as fitWidthVp,
  trueSize as trueSizeVp,
  zoomAt,
  type Viewport,
} from '../../domain/viewport'
import { getSettingsStore } from '../../state/settingsStore'

/** Wheel delta → zoom factor; pinch sends small ctrlKey deltas, mouse wheels larger ones. */
const WHEEL_ZOOM_SPEED = 0.01
const MAX_WHEEL_STEP = 0.5

export interface ViewportState {
  vp: Viewport
  viewW: number
  viewH: number
  sheetW: number
  sheetH: number
  setVp(vp: Viewport): void
  setView(viewW: number, viewH: number): void
  setSheetSize(sheetW: number, sheetH: number): void
  fit(): void
  fitWidth(): void
  trueSize(): void
  /** Zooms around the centre of the view. */
  zoomBy(factor: number): void
  /** ⌘/Ctrl wheel (incl. trackpad pinch) zooms at the cursor; plain wheel scrolls; Shift scrolls sideways. */
  onWheel(e: { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, screenX: number, screenY: number): void
}

export function createViewportStore() {
  return createStore<ViewportState>((set, get) => ({
    vp: { scale: 1, offsetX: 0, offsetY: 0 },
    viewW: 0,
    viewH: 0,
    sheetW: 600,
    sheetH: 10,
    setVp: (vp) => set({ vp }),
    setView: (viewW, viewH) => set({ viewW, viewH }),
    setSheetSize: (sheetW, sheetH) => set({ sheetW, sheetH }),
    fit() {
      const { sheetW, sheetH, viewW, viewH } = get()
      set({ vp: fitSheet(sheetW, sheetH, viewW, viewH) })
    },
    fitWidth() {
      const { sheetW, viewW } = get()
      set({ vp: fitWidthVp(sheetW, viewW) })
    },
    trueSize() {
      const { vp, viewW, viewH } = get()
      set({ vp: trueSizeVp(vp, getSettingsStore().getState().screenPxPerMm, viewW, viewH) })
    },
    zoomBy(factor) {
      const { vp, viewW, viewH } = get()
      set({ vp: zoomAt(vp, factor, viewW / 2, viewH / 2) })
    },
    onWheel(e, screenX, screenY) {
      const { vp } = get()
      if (e.ctrlKey || e.metaKey) {
        const step = Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, -e.deltaY * WHEEL_ZOOM_SPEED))
        set({ vp: zoomAt(vp, Math.exp(step), screenX, screenY) })
      } else if (e.shiftKey) {
        set({ vp: { ...vp, offsetX: vp.offsetX - (e.deltaX || e.deltaY) } })
      } else {
        set({ vp: { ...vp, offsetX: vp.offsetX - e.deltaX, offsetY: vp.offsetY - e.deltaY } })
      }
    },
  }))
}

let viewportStore: ReturnType<typeof createViewportStore> | undefined
export function getViewportStore() {
  viewportStore ??= createViewportStore()
  return viewportStore
}

/**
 * Shared viewport. Pass the sheet size (mm) from the canvas so fit/fitWidth use it;
 * other consumers (e.g. ZoomControl) may call it without arguments.
 */
export function useViewport(sheetW?: number, sheetH?: number) {
  const store = getViewportStore()
  useEffect(() => {
    if (sheetW !== undefined && sheetH !== undefined) store.getState().setSheetSize(sheetW, sheetH)
  }, [store, sheetW, sheetH])
  const vp = useStore(store, (s) => s.vp)
  const { setVp, onWheel, fit, fitWidth, trueSize, zoomBy } = store.getState()
  return { vp, setVp, onWheel, fit, fitWidth, trueSize, zoomBy }
}
