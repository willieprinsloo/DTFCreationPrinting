interface Props {
  busy: boolean
  error: string | null
  onPick(): void
}

export function LocalTab({ busy, error, onPick }: Props) {
  return (
    <div className="library-local">
      <button type="button" className="primary" onClick={onPick} disabled={busy}>
        {busy ? 'Adding…' : 'Add files…'}
      </button>
      <p className="muted">Or drop PNG, JPEG, TIFF or PDF files here from Finder or Explorer. Images are added at native size assuming 300 dpi, PDFs at their page size.</p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
