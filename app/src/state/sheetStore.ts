import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { temporal } from 'zundo'
import type { Asset, PrinterProfile, Sheet, SheetItem, SheetSettings, SourceRef } from '../domain/types'
import { heightForWidth, itemBounds, normaliseSheetAspect, printableArea, widthForHeight } from '../domain/geometry'
import { autoPlace, type Placement } from '../domain/autoplace'

export interface NewItem {
  asset: Asset
  source: SourceRef
  widthMm: number
  heightMm: number
  quantity: number
}

export type ItemPatch = Partial<Pick<SheetItem, 'xMm' | 'yMm' | 'widthMm' | 'heightMm' | 'rotationDeg' | 'whiteEnabled'>>

export interface SheetData {
  sheet: Sheet
  selectedIds: string[]
}

export interface SheetActions {
  newSheet(profile: PrinterProfile, name?: string): void
  loadSheet(sheet: Sheet): void
  addItems(items: NewItem[]): void
  updateItem(id: string, patch: ItemPatch): void
  /** Applies several patches as a single undo step. */
  updateItems(patches: Array<{ id: string; patch: ItemPatch }>): void
  /** Sets the print width; height always follows the asset aspect. */
  resizeItem(id: string, widthMm: number): void
  /** Changes a product's garment size: new width (aspect kept, centre fixed), source size and label — one undo step. */
  setItemSize(id: string, size: string | null, widthMm: number): void
  removeItems(ids: string[]): void
  duplicateItems(ids: string[]): void
  /** Throws InvalidSheetError (state unchanged) when the result has no printable width. */
  setSettings(patch: Partial<SheetSettings>): void
  /** Switches the sheet to `profile` (id, width, margins, gap) as one undo step. Throws InvalidSheetError, state unchanged. */
  applyProfile(profile: PrinterProfile): void
  autoPlaceAll(): void
  select(ids: string[]): void
  undo(): void
  redo(): void
}

export type SheetState = SheetData & SheetActions

const DUPLICATE_OFFSET_MM = 10

/** Applies a patch; any size change is normalised so height = heightForWidth(width) (height-only patches derive width). */
function applyPatch(it: SheetItem, patch: ItemPatch): SheetItem {
  const next = { ...it, ...patch }
  if (patch.widthMm !== undefined) next.heightMm = heightForWidth(next, next.widthMm)
  else if (patch.heightMm !== undefined) {
    next.widthMm = widthForHeight(next, next.heightMm)
    next.heightMm = heightForWidth(next, next.widthMm)
  }
  return next
}

function makeSheet(profile: PrinterProfile, name = 'Untitled sheet'): Sheet {
  return {
    id: crypto.randomUUID(),
    name,
    profileId: profile.id,
    settings: {
      widthMm: profile.widthMm,
      margins: { ...profile.defaultMargins },
      gapMm: profile.defaultGapMm,
      lengthMode: 'auto',
      fixedLengthMm: 1000,
      mirror: true,
      whiteEnabled: true,
      allowRotate: true,
    },
    items: [],
  }
}

/** Placement is the top-left of the footprint; items are stored un-rotated and rotate about their centre. */
function applyPlacement(item: SheetItem, p: Placement): SheetItem {
  const w = p.rotated ? item.heightMm : item.widthMm
  const h = p.rotated ? item.widthMm : item.heightMm
  const cx = p.xMm + w / 2
  const cy = p.yMm + h / 2
  return {
    ...item,
    xMm: cx - item.widthMm / 2,
    yMm: cy - item.heightMm / 2,
    rotationDeg: p.rotated ? 90 : 0,
  }
}

function pack(items: SheetItem[], settings: SheetSettings, originYMm: number) {
  return autoPlace(
    items.map((it) => ({
      id: it.id,
      widthMm: it.widthMm,
      heightMm: it.heightMm,
      groupKey: it.source.orderId ?? it.source.id,
    })),
    {
      originXMm: settings.margins.leftMm,
      originYMm,
      printableWidthMm: printableArea(settings).widthMm,
      gapMm: settings.gapMm,
      allowRotate: settings.allowRotate,
    },
  )
}

export function createSheetStore() {
  const store = createStore<SheetState>()(
    temporal(
      (set, get) => {
        const setSheet = (sheet: Sheet) => set({ sheet })
        const mapItems = (fn: (it: SheetItem) => SheetItem) => {
          const { sheet } = get()
          setSheet({ ...sheet, items: sheet.items.map(fn) })
        }
        return {
          sheet: makeSheet({ id: 'default', name: 'Default', widthMm: 600, xDpi: 720, yDpi: 1800, defaultMargins: { topMm: 5, rightMm: 5, bottomMm: 5, leftMm: 5 }, defaultGapMm: 3 }),
          selectedIds: [],
          newSheet(profile, name) {
            set({ sheet: makeSheet(profile, name), selectedIds: [] })
            store.temporal.getState().clear()
          },
          loadSheet(sheet) {
            set({ sheet: normaliseSheetAspect(sheet), selectedIds: [] })
            store.temporal.getState().clear()
          },
          addItems(newItems) {
            const { sheet } = get()
            const { settings } = sheet
            const created: SheetItem[] = newItems.flatMap((n) =>
              Array.from({ length: n.quantity }, () => ({
                id: crypto.randomUUID(),
                asset: n.asset,
                source: n.source,
                xMm: settings.margins.leftMm,
                yMm: 0,
                widthMm: n.widthMm,
                heightMm: heightForWidth(n, n.widthMm),
                rotationDeg: 0,
                whiteEnabled: settings.whiteEnabled,
              })),
            )
            const originYMm =
              sheet.items.length === 0
                ? settings.margins.topMm
                : Math.max(...sheet.items.map((it) => itemBounds(it).yMm + itemBounds(it).heightMm)) + settings.gapMm
            const result = pack(created, settings, originYMm)
            const byId = new Map(result.placements.map((p) => [p.id, p]))
            const placed = created.map((it) => {
              const p = byId.get(it.id)
              return p ? applyPlacement(it, p) : { ...it, yMm: originYMm }
            })
            setSheet({ ...sheet, items: [...sheet.items, ...placed] })
          },
          updateItem(id, patch) {
            mapItems((it) => (it.id === id ? applyPatch(it, patch) : it))
          },
          updateItems(patches) {
            if (patches.length === 0) return
            const byId = new Map<string, ItemPatch>()
            for (const { id, patch } of patches) byId.set(id, { ...byId.get(id), ...patch })
            mapItems((it) => {
              const patch = byId.get(it.id)
              return patch ? applyPatch(it, patch) : it
            })
          },
          resizeItem(id, widthMm) {
            mapItems((it) => (it.id === id ? applyPatch(it, { widthMm }) : it))
          },
          setItemSize(id, size, widthMm) {
            mapItems((it) => {
              if (it.id !== id) return it
              const heightMm = heightForWidth(it, widthMm)
              const old = it.source.size
              const suffix = old ? ` — ${old}` : ''
              const name = suffix && it.source.label.endsWith(suffix) ? it.source.label.slice(0, -suffix.length) : it.source.label
              return {
                ...it,
                widthMm,
                heightMm,
                xMm: it.xMm + (it.widthMm - widthMm) / 2,
                yMm: it.yMm + (it.heightMm - heightMm) / 2,
                source: { ...it.source, size, label: size ? `${name} — ${size}` : name },
              }
            })
          },
          removeItems(ids) {
            const { sheet, selectedIds } = get()
            const drop = new Set(ids)
            set({
              sheet: { ...sheet, items: sheet.items.filter((it) => !drop.has(it.id)) },
              selectedIds: selectedIds.filter((id) => !drop.has(id)),
            })
          },
          duplicateItems(ids) {
            const { sheet } = get()
            const wanted = new Set(ids)
            const copies = sheet.items
              .filter((it) => wanted.has(it.id))
              .map((it) => ({
                ...it,
                id: crypto.randomUUID(),
                xMm: it.xMm + DUPLICATE_OFFSET_MM,
                yMm: it.yMm + DUPLICATE_OFFSET_MM,
              }))
            if (copies.length === 0) return
            set({
              sheet: { ...sheet, items: [...sheet.items, ...copies] },
              selectedIds: copies.map((c) => c.id),
            })
          },
          setSettings(patch) {
            const { sheet } = get()
            const settings = { ...sheet.settings, ...patch }
            printableArea(settings) // throws InvalidSheetError before any state change
            setSheet({ ...sheet, settings })
          },
          applyProfile(profile) {
            const { sheet } = get()
            const settings = {
              ...sheet.settings,
              widthMm: profile.widthMm,
              margins: { ...profile.defaultMargins },
              gapMm: profile.defaultGapMm,
            }
            printableArea(settings) // throws InvalidSheetError before any state change
            setSheet({ ...sheet, profileId: profile.id, settings })
          },
          autoPlaceAll() {
            const { sheet } = get()
            const { settings } = sheet
            const result = pack(sheet.items, settings, settings.margins.topMm)
            const byId = new Map(result.placements.map((p) => [p.id, p]))
            mapItems((it) => {
              const p = byId.get(it.id)
              return p ? applyPlacement(it, p) : it
            })
          },
          select(ids) {
            set({ selectedIds: ids })
          },
          undo() {
            store.temporal.getState().undo()
            pruneSelection()
          },
          redo() {
            store.temporal.getState().redo()
            pruneSelection()
          },
        }

        function pruneSelection() {
          const { sheet, selectedIds } = get()
          const live = new Set(sheet.items.map((i) => i.id))
          const kept = selectedIds.filter((id) => live.has(id))
          if (kept.length !== selectedIds.length) set({ selectedIds: kept })
        }
      },
      {
        limit: 100,
        partialize: (state) => ({ sheet: state.sheet }),
        // Selection-only changes leave `sheet` identical, so they never create an undo step.
        equality: (past, current) => past.sheet === current.sheet,
      },
    ),
  )
  return store
}

let appStore: ReturnType<typeof createSheetStore> | undefined
export function getSheetStore() {
  appStore ??= createSheetStore()
  return appStore
}

export function useSheet<T>(selector: (s: SheetState) => T): T {
  return useStore(getSheetStore(), selector)
}
