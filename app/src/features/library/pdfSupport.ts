/** Must match `EngineError::PdfNotInstalled` in the engine. */
export const PDF_NOT_INSTALLED = 'PDF support is not installed'

/** True when a backend error says the bundled PDF library is missing (shown to the user verbatim). */
export function isPdfNotInstalled(e: unknown): boolean {
  return (e instanceof Error ? e.message : e) === PDF_NOT_INSTALLED
}
