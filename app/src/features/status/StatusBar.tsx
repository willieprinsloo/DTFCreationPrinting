import { useSheet } from '../../state/sheetStore'
import { useSettings } from '../../state/settingsStore'
import { dpiStatus, effectiveDpi } from '../../domain/dpi'
import { findProblems, InvalidSheetError, sheetLengthMm } from '../../domain/geometry'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function StatusBar() {
  const sheet = useSheet((s) => s.sheet)
  const thresholds = useSettings((s) => s.thresholds)
  const { settings, items } = sheet

  const lengthMm = sheetLengthMm(sheet)
  const printableW = settings.widthMm - settings.margins.leftMm - settings.margins.rightMm
  const usableH = lengthMm - settings.margins.topMm - settings.margins.bottomMm
  const itemArea = items.reduce((sum, it) => sum + it.widthMm * it.heightMm, 0)
  const used = printableW > 0 && usableH > 0 ? Math.min(100, Math.round((itemArea / (printableW * usableH)) * 100)) : 0
  const orders = new Set(items.map((i) => i.source.orderId).filter(Boolean)).size
  const lowRes = items.filter((i) => dpiStatus(effectiveDpi(i), thresholds) !== 'fine').length
  let problems = 0
  try {
    problems = findProblems(sheet).length
  } catch (e) {
    if (!(e instanceof InvalidSheetError)) throw e
  }

  return (
    <div className="status-inner">
      <span>
        Film {Math.round(settings.widthMm / 10)} × {Math.round(lengthMm / 10)} cm
      </span>
      <span>Used {used}%</span>
      <span>{plural(items.length, 'design', 'designs')}</span>
      <span>{plural(orders, 'order', 'orders')}</span>
      {lowRes > 0 && <span className="warn">⚠ {lowRes} low-res</span>}
      {problems > 0 && <span className="bad">⛔ {problems} problems</span>}
    </div>
  )
}
