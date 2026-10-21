import { useEffect } from 'react'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  clampPan,
  fitSheet,
  fitWidth as fitWidthVp,
  homeView,
  trueSize as trueSizeVp,
  zoomAt,
  type Viewport,
} from '../../domain/viewport'
import { getSettingsStore } from '../../state/settingsStore'

/** Wheel delta → zoom factor; pinch sends small ctrlKey deltas, mouse wheels larger ones. */
const WHEEL_ZOOM_SPEED = 0.01
const MAX_WHEEL_STEP = 0.5
/** Zoom a sheet opens at, relative to true size (100% = 1:1 on screen). */
export const DEFAULT_ZOOM = 0.3

/** Zoom factor between two successive WebKit gesture scales (cumulative since gesturestart). */
export function pinchFactor(prevScale: number, nextScale: number): number {
  if (!(prevScale > 0) || !(nextScale > 0) || !Number.isFinite(prevScale) || !Number.isFinite(nextScale)) return 1
  return nextScale / prevScale
}

export interface FitInputs {
  widthMm: number
  lengthMm: number
  viewW: number
  viewH: number
}

/** True when the view should be re-fitted: auto-fit is on, the view has a size, and something relevant changed. */
export function shouldAutoFit(prev: FitInputs | null, next: FitInputs, autoFit: boolean): boolean {
  if (!autoFit || !(next.viewW > 0) || !(next.viewH > 0)) return false
  if (!prev) return true
  return (
    prev.widthMm !== next.widthMm ||
    prev.lengthMm !== next.lengthMm ||
    prev.viewW !== next.viewW ||
    prev.viewH !== next.viewH
  )
}

export interface ViewportState {
  /** True until the user zooms/pans manually; fit() turns it back on. */
  autoFit: boolean
  /** What the automatic view keeps re-applying: the 30% home view, or fit-all (after Fit). */
  autoMode: 'home' | 'fit'
  setAutoFit(on: boolean): void
  vp: Viewport
  viewW: number
  viewH: number
  sheetW: number
  sheetH: number
  setVp(vp: Viewport): void
  setView(viewW: number, viewH: number): void
  setSheetSize(sheetW: number, sheetH: number): void
  fit(): void
  /** DEFAULT_ZOOM, film centred across, top of the film in view. */
  home(): void
  /** Re-applies whichever automatic view is active. */
  autoView(): void
  fitWidth(): void
  trueSize(): void
  /** Zooms around the centre of the view. */
  zoomBy(factor: number): void
  /** Zooms by `factor`, keeping the sheet point under (screenX, screenY) fixed. */
  zoomAtPoint(factor: number, screenX: number, screenY: number): void
  /** ⌘/Ctrl wheel (incl. trackpad pinch) zooms at the cursor; plain wheel scrolls; Shift scrolls sideways. */
  onWheel(e: { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, screenX: number, screenY: number): void
}

export function createViewportStore() {
  return createStore<ViewportState>((set, get) => {
    /** Manual navigation never takes the film out of view. */
    const clamp = (vp: Viewport) => {
      const { sheetW, sheetH, viewW, viewH } = get()
      return clampPan(vp, sheetW, sheetH, viewW, viewH)
    }
    return {
      vp: { scale: 1, offsetX: 0, offsetY: 0 },
      autoFit: true,
      autoMode: 'home',
      setAutoFit: (autoFit) => set({ autoFit }),
      viewW: 0,
      viewH: 0,
      sheetW: 600,
      sheetH: 10,
      // setVp is the manual-navigation entry point (pan); fit() bypasses it.
      setVp: (vp) => set({ vp: clamp(vp), autoFit: false }),
      // A shorter film or a bigger window may leave the view past the film's end.
      setView: (viewW, viewH) => set({ viewW, viewH, vp: clampPan(get().vp, get().sheetW, get().sheetH, viewW, viewH) }),
      setSheetSize: (sheetW, sheetH) => set({ sheetW, sheetH, vp: clampPan(get().vp, sheetW, sheetH, get().viewW, get().viewH) }),
      fit() {
        const { sheetW, sheetH, viewW, viewH } = get()
        set({ vp: fitSheet(sheetW, sheetH, viewW, viewH), autoFit: true, autoMode: 'fit' })
      },
      home() {
        const { sheetW, viewW } = get()
        const scale = DEFAULT_ZOOM * getSettingsStore().getState().screenPxPerMm
        set({ vp: homeView(sheetW, viewW, scale), autoFit: true, autoMode: 'home' })
      },
      autoView() {
        if (get().autoMode === 'fit') get().fit()
        else get().home()
      },
      fitWidth() {
        const { sheetW, viewW } = get()
        set({ vp: fitWidthVp(sheetW, viewW), autoFit: false })
      },
      trueSize() {
        const { vp, viewW, viewH } = get()
        set({ vp: clamp(trueSizeVp(vp, getSettingsStore().getState().screenPxPerMm, viewW, viewH)), autoFit: false })
      },
      zoomBy(factor) {
        const { vp, viewW, viewH } = get()
        set({ vp: clamp(zoomAt(vp, factor, viewW / 2, viewH / 2)), autoFit: false })
      },
      zoomAtPoint(factor, screenX, screenY) {
        set({ vp: clamp(zoomAt(get().vp, factor, screenX, screenY)), autoFit: false })
      },
      onWheel(e, screenX, screenY) {
        const { vp } = get()
        if (e.ctrlKey || e.metaKey) {
          const step = Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, -e.deltaY * WHEEL_ZOOM_SPEED))
          set({ vp: clamp(zoomAt(vp, Math.exp(step), screenX, screenY)), autoFit: false })
        } else if (e.shiftKey) {
          set({ vp: clamp({ ...vp, offsetX: vp.offsetX - (e.deltaX || e.deltaY) }), autoFit: false })
        } else {
          set({ vp: clamp({ ...vp, offsetX: vp.offsetX - e.deltaX, offsetY: vp.offsetY - e.deltaY }), autoFit: false })
        }
      },
    }
  })
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
