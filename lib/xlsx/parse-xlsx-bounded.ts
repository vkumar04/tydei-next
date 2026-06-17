/**
 * Memory-bounded `.xlsx` parser (security fix #9, 2026-06-17).
 *
 * `.xlsx` is a ZIP of XML (OOXML). The previous parse path
 * (`workbook.xlsx.load(buffer)`) fully decompresses and materializes the
 * ENTIRE sheet into memory, so a "zip bomb" — a tiny compressed file with
 * an absurd compression ratio — expands to many GB and OOM-kills the
 * container. A compressed-size cap can't stop this because the danger is
 * the RATIO, not the size.
 *
 * Defense: BEFORE decompressing anything, read the ZIP central directory
 * (which declares each entry's uncompressed size — that's exactly the
 * payload a bomb inflates to) and reject if the total uncompressed size or
 * the compression ratio is absurd. This is reliable, dependency-free, and
 * works on every real file (no streaming-parser quirks). Legitimate
 * spreadsheets decompress to a sane multiple of their stored size; bombs
 * declare hundreds of MB / GB. We then parse the validated buffer normally
 * and cap the resulting matrix's rows/cells as a second bound on the
 * downstream pipeline.
 *
 * Callers pass their own `cellToString` so each surface keeps its exact
 * cell-coercion behavior (rich-text / hyperlink / formula handling).
 */
import ExcelJS from "exceljs"

/** Thrown when a workbook trips the memory-safety guards — routes map this to 400. */
export class XlsxLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "XlsxLimitError"
  }
}

export interface ParseXlsxBoundedOptions {
  /** Reject if the declared total uncompressed size exceeds this. Default 400 MB. */
  maxUncompressedBytes?: number
  /** Reject if uncompressed/compressed ratio exceeds this. Default 200. */
  maxRatio?: number
  /** Hard ceiling on emitted rows. Default 1,000,000 (legit files are ~15k). */
  maxRows?: number
  /** Hard ceiling on total cells across all rows. Default 20,000,000. */
  maxCells?: number
}

const DEFAULT_MAX_UNCOMPRESSED = 400 * 1024 * 1024 // 400 MB
const DEFAULT_MAX_RATIO = 200
// Excel's hard per-sheet maximum is 1,048,576 rows (2^20) — a single
// worksheet physically cannot exceed it, so the row cap only protects
// against a pathological dense sheet, never a legit one. Setting it AT the
// max means a full-height sheet is never false-rejected.
const DEFAULT_MAX_ROWS = 1_048_576
const DEFAULT_MAX_CELLS = 20_000_000
// Real-world exports routinely fill one column (e.g. a contract id) all the
// way to the sheet bottom, inflating the used range to the row max with a
// "phantom tail" of near-empty rows. Stop materializing after this many
// consecutive rows with ≤1 non-empty cell — that's the end-of-data signal
// (mirrors the import path's sparse-run trim). Real data with short blank
// gaps (< this) is preserved.
const SPARSE_RUN_STOP = 500

const EOCD_SIG = 0x06054b50 // End Of Central Directory
const CDH_SIG = 0x02014b50 // Central Directory file Header
const ZIP64_SENTINEL = 0xffffffff

/**
 * Walk a ZIP's central directory and sum the declared compressed +
 * uncompressed sizes WITHOUT decompressing anything. Returns null if the
 * buffer isn't a parseable ZIP (caller treats that as "let the real parser
 * produce its normal error"). A ZIP64 sentinel (0xFFFFFFFF) on any entry
 * is treated as "too large to vouch for" — real .xlsx parts are well under
 * 4 GB, so we surface it as an oversized total and let the caller reject.
 */
function sumZipEntrySizes(
  buf: Buffer,
): { compressed: number; uncompressed: number } | null {
  // Find the EOCD record by scanning backwards (it may be followed by a
  // comment of up to 65535 bytes).
  const minEocd = 22
  if (buf.length < minEocd) return null
  let eocd = -1
  const scanStart = Math.max(0, buf.length - (minEocd + 0xffff))
  for (let i = buf.length - minEocd; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null

  const totalEntries = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (cdOffset >= buf.length) return null

  let compressed = 0
  let uncompressed = 0
  let p = cdOffset
  for (let n = 0; n < totalEntries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) return null
    const cSize = buf.readUInt32LE(p + 20)
    const uSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    // ZIP64 sentinel → real value lives in the extra field; rather than
    // parse ZIP64 we treat it as oversized so the caller rejects.
    uncompressed += uSize === ZIP64_SENTINEL ? DEFAULT_MAX_UNCOMPRESSED : uSize
    compressed += cSize === ZIP64_SENTINEL ? 0 : cSize
    p += 46 + nameLen + extraLen + commentLen
  }
  return { compressed, uncompressed }
}

/**
 * Validate that an `.xlsx` buffer won't decompress into a memory bomb, then
 * parse its FIRST worksheet into a dense `string[][]` matrix (mirrors the
 * prior `worksheets[0]` + `eachRow` behavior). Throws {@link XlsxLimitError}
 * if the workbook trips the size/ratio or row/cell caps.
 *
 * @param buffer        the raw `.xlsx` bytes
 * @param cellToString  per-surface cell coercer (also do any trimming here)
 */
export async function parseXlsxMatrixBounded(
  buffer: Buffer,
  cellToString: (value: unknown) => string,
  options: ParseXlsxBoundedOptions = {},
): Promise<string[][]> {
  const maxUncompressed = options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED
  const maxRatio = options.maxRatio ?? DEFAULT_MAX_RATIO
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const maxCells = options.maxCells ?? DEFAULT_MAX_CELLS

  // ── Gate 1: pre-decompression size/ratio check on the ZIP directory ──
  const sizes = sumZipEntrySizes(buffer)
  if (sizes) {
    if (sizes.uncompressed > maxUncompressed) {
      throw new XlsxLimitError(
        `Spreadsheet decompresses to ${Math.round(sizes.uncompressed / (1024 * 1024))} MB (max ${Math.round(maxUncompressed / (1024 * 1024))} MB). Split it into smaller files.`,
      )
    }
    const ratio = sizes.compressed > 0 ? sizes.uncompressed / sizes.compressed : 0
    if (ratio > maxRatio) {
      throw new XlsxLimitError(
        "Spreadsheet has an abnormal compression ratio and was rejected as a potential decompression bomb.",
      )
    }
  }

  // ── Gate 2: parse the validated buffer, capping the materialized matrix ──
  const workbook = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []

  const matrix: string[][] = []
  let cellCount = 0
  let tripped: XlsxLimitError | null = null
  let stopped = false
  // Buffer near-empty rows so a trailing phantom tail is dropped, but an
  // internal short gap (followed by more data) is still committed.
  let sparsePending: string[][] = []
  let sparseRun = 0

  const commit = (cells: string[]): void => {
    if (matrix.length >= maxRows) {
      tripped = new XlsxLimitError(
        `Spreadsheet exceeds the ${maxRows.toLocaleString()}-row limit. Split it into smaller files.`,
      )
      stopped = true
      return
    }
    cellCount += cells.length
    if (cellCount > maxCells) {
      tripped = new XlsxLimitError(
        `Spreadsheet exceeds the ${maxCells.toLocaleString()}-cell limit. Split it into smaller files.`,
      )
      stopped = true
      return
    }
    matrix.push(cells)
  }

  sheet.eachRow((row) => {
    if (stopped) return
    // ExcelJS rows are 1-indexed; index 0 is always undefined.
    const values = row.values
    const raw = Array.isArray(values) ? values.slice(1) : []
    const cells = raw.map((v) => cellToString(v))
    const nonEmpty = cells.reduce((a, c) => a + (c.trim() !== "" ? 1 : 0), 0)

    if (nonEmpty <= 1) {
      // Near-empty: hold it; a long run means we've hit the phantom tail.
      sparseRun += 1
      if (sparseRun >= SPARSE_RUN_STOP) {
        stopped = true // drop the trailing sparse tail entirely
        return
      }
      sparsePending.push(cells)
      return
    }

    // Real row: flush any held (internal-gap) sparse rows, then commit.
    sparseRun = 0
    for (const p of sparsePending) {
      commit(p)
      if (stopped) return
    }
    sparsePending = []
    commit(cells)
  })
  if (tripped) throw tripped

  return matrix
}
