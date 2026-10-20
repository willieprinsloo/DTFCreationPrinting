import { useRef, useState } from 'react'
import { getSettingsStore, useSettings } from '../../state/settingsStore'

const BANK_CARD_MM = 85.6

export function ScreenCalibration() {
  const pxPerMm = useSettings((s) => s.screenPxPerMm)
  const boxRef = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState<string | null>(null)

  const save = async () => {
    const width = boxRef.current?.offsetWidth ?? 0
    if (!(width > 0)) {
      setMessage('Drag the box wider first')
      return
    }
    try {
      await getSettingsStore().getState().setScreenPxPerMm(width / BANK_CARD_MM)
      setMessage('Saved')
    } catch (e) {
      setMessage(`Could not save: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <section className="settings-section">
      <h3>Screen size</h3>
      <p className="muted">Hold a bank card against the screen and drag the corner of the box until it is exactly as wide as the card.</p>
      <div
        ref={boxRef}
        className="calibration-box"
        data-testid="calibration-box"
        style={{ width: BANK_CARD_MM * pxPerMm }}
      />
      <div className="button-row">
        <button type="button" onClick={() => void save()}>
          Save screen size
        </button>
        {message && <span role="status">{message}</span>}
      </div>
    </section>
  )
}
