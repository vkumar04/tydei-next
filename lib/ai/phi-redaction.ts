/**
 * Headers that signal Protected Health Information (HIPAA). Values in matching
 * columns are masked before sample rows are sent to the AI column-mapper — the
 * mapper identifies these columns from the HEADER alone, so it never needs the
 * real identifiers (minimum-necessary). Deliberately specific so it doesn't
 * catch "surgeon name" / "vendor name" (not PHI). 2026-06-18 Tier-3 audit.
 */
const PHI_HEADER_RE =
  /\b(patient|mrn|medical[\s_-]*record(?:[\s_-]*(?:no|number|#))?|d\.?o\.?b\.?|date[\s_-]*of[\s_-]*birth|birth[\s_-]*date|ssn|social[\s_-]*security|guarantor)\b|patient[\s_-]*(name|initials|id)/i

/** Shape-preserving mask: letters→X, digits→0; punctuation/length intact. */
function maskPhiValue(value: string): string {
  return value.replace(/[A-Za-z]/g, "X").replace(/[0-9]/g, "0")
}

/**
 * Mask sample values in any column whose header looks like PHI, leaving all
 * other columns' values intact so the mapper still gets useful content hints.
 * Exported for unit testing.
 */
export function redactPhiSampleValues(
  headers: string[],
  rows: Record<string, string>[],
): Record<string, string>[] {
  const phiCols = headers.filter((h) => PHI_HEADER_RE.test(h))
  if (phiCols.length === 0) return rows
  return rows.map((row) => {
    const out: Record<string, string> = { ...row }
    for (const col of phiCols) {
      if (typeof out[col] === "string" && out[col]) {
        out[col] = maskPhiValue(out[col])
      }
    }
    return out
  })
}
