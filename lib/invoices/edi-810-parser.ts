/**
 * Minimal pure X12 EDI 810 (Invoice) parser.
 *
 * 2026-06-10 invoices batch: replaces the import dialog's "Coming soon"
 * EDI stub (which previously fabricated success). Deliberately loose:
 * we read the ISA envelope only to pick up non-standard element
 * separators, and we extract just the segments tydei needs to build an
 * `importInvoice` payload:
 *
 *   ST*810      — transaction start (one invoice per ST..SE)
 *   BIG         — invoice date (CCYYMMDD), invoice number, PO number
 *   N1*VN       — vendor (seller) name
 *   IT1         — line item: qty, unit price, product/service id pairs
 *                 (the VN or VP qualifier id becomes vendorItemNo)
 *   PID         — line description, attached to the preceding IT1
 *   TDS         — total invoice amount in cents
 *   SE          — transaction end
 *
 * Pure function — no Prisma, no auth — so it is unit-testable and safe
 * to run client-side in the import dialog.
 */

export interface Edi810LineItem {
  /** Product/service id with VN or VP qualifier (vendor's catalog number). */
  vendorItemNo: string | null
  /** From the PID segment following the IT1, if present. */
  description: string | null
  quantity: number
  unitPrice: number
}

export interface Edi810Invoice {
  invoiceNumber: string
  /** ISO yyyy-mm-dd, or null when BIG01 is missing/malformed. */
  invoiceDate: string | null
  /** From N1*VN, if present. */
  vendorName: string | null
  /** From BIG04, if present. */
  poNumber: string | null
  lineItems: Edi810LineItem[]
  /** From TDS (X12 sends cents), or null when absent/malformed. */
  totalAmount: number | null
}

export interface Edi810ParseResult {
  invoices: Edi810Invoice[]
  /** Human-readable problems. Parsing is best-effort: a malformed
   *  transaction is skipped with an error, not a thrown exception. */
  errors: string[]
}

/** CCYYMMDD → yyyy-mm-dd, or null if it doesn't look like a date. */
function parseBigDate(raw: string | undefined): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null
  const year = Number(raw.slice(0, 4))
  const month = Number(raw.slice(4, 6))
  const day = Number(raw.slice(6, 8))
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function parseEdi810(content: string): Edi810ParseResult {
  const errors: string[] = []
  const invoices: Edi810Invoice[] = []

  if (!content || !content.trim()) {
    return { invoices, errors: ["File is empty."] }
  }

  // Element separator: standard is `*`, but ISA is fixed-position —
  // the character immediately after "ISA" is authoritative when present.
  let elementSep = "*"
  const trimmedContent = content.trimStart()
  if (trimmedContent.startsWith("ISA") && trimmedContent.length > 3) {
    const candidate = trimmedContent[3]
    if (candidate && candidate !== "~" && !/[A-Za-z0-9\s]/.test(candidate)) {
      elementSep = candidate
    }
  }

  // Segments terminate on `~` (trailing newlines/whitespace tolerated).
  const segments = content
    .split("~")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.split(elementSep).map((el) => el.trim()))

  if (segments.length === 0) {
    return { invoices, errors: ["No X12 segments found (expected `~`-terminated segments)."] }
  }

  const segmentIds = new Set(segments.map((s) => s[0]))
  if (!segmentIds.has("ST")) {
    errors.push(
      "No ST (transaction set header) segment found — this does not look like an X12 810 file."
    )
    return { invoices, errors }
  }

  let current: Edi810Invoice | null = null
  let currentStControl: string | null = null
  let currentSegmentCount = 0
  let sawBig = false

  const finalize = () => {
    if (!current) return
    if (!sawBig) {
      errors.push(
        `Transaction ${currentStControl ?? "(unknown)"}: missing BIG segment — skipped (no invoice number/date).`
      )
    } else if (current.lineItems.length === 0) {
      errors.push(
        `Invoice ${current.invoiceNumber}: no IT1 line items found — skipped.`
      )
    } else {
      invoices.push(current)
    }
    current = null
    currentStControl = null
    currentSegmentCount = 0
    sawBig = false
  }

  for (const seg of segments) {
    const id = seg[0]
    if (current) currentSegmentCount++

    switch (id) {
      case "ISA":
      case "GS":
      case "GE":
      case "IEA":
        // Envelope segments — read loosely, nothing extracted.
        break

      case "ST": {
        if (current) {
          errors.push(
            `Transaction ${currentStControl ?? "(unknown)"}: missing SE before next ST — closing implicitly.`
          )
          finalize()
        }
        if (seg[1] !== "810") {
          errors.push(
            `Skipping ST*${seg[1] ?? ""} transaction — only 810 (Invoice) is supported.`
          )
          break
        }
        current = {
          invoiceNumber: "",
          invoiceDate: null,
          vendorName: null,
          poNumber: null,
          lineItems: [],
          totalAmount: null,
        }
        currentStControl = seg[2] ?? null
        currentSegmentCount = 1
        sawBig = false
        break
      }

      case "BIG": {
        if (!current) break
        // BIG01 invoice date (CCYYMMDD), BIG02 invoice number, BIG04 PO number.
        current.invoiceDate = parseBigDate(seg[1])
        const invoiceNumber = seg[2]?.trim()
        if (!invoiceNumber) {
          errors.push(
            `Transaction ${currentStControl ?? "(unknown)"}: BIG segment has no invoice number (BIG02).`
          )
        } else {
          current.invoiceNumber = invoiceNumber
          sawBig = true
        }
        if (seg[1] && current.invoiceDate === null) {
          errors.push(
            `Invoice ${invoiceNumber ?? "(unknown)"}: unparseable BIG date "${seg[1]}" (expected CCYYMMDD).`
          )
        }
        current.poNumber = seg[4]?.trim() || null
        break
      }

      case "N1": {
        // N1*VN*<vendor name> — seller/vendor party.
        if (!current) break
        if (seg[1] === "VN" && seg[2]) {
          current.vendorName = seg[2]
        }
        break
      }

      case "IT1": {
        if (!current) break
        // IT102 qty, IT103 UOM, IT104 unit price, IT105 basis, then
        // qualifier/id pairs from IT106 onward.
        const quantity = parseNumber(seg[2])
        const unitPrice = parseNumber(seg[4])
        if (quantity === null || unitPrice === null) {
          errors.push(
            `Invoice ${current.invoiceNumber || currentStControl || "(unknown)"}: IT1 line "${seg.slice(0, 6).join("*")}" has a non-numeric quantity or unit price — line skipped.`
          )
          break
        }
        let vendorItemNo: string | null = null
        for (let i = 6; i + 1 < seg.length; i += 2) {
          const qualifier = seg[i]
          const value = seg[i + 1]
          if ((qualifier === "VN" || qualifier === "VP") && value) {
            vendorItemNo = value
            break
          }
        }
        current.lineItems.push({
          vendorItemNo,
          description: null,
          quantity,
          unitPrice,
        })
        break
      }

      case "PID": {
        // PID*F****<description> — attach to the preceding IT1.
        if (!current || current.lineItems.length === 0) break
        const description = seg[5]?.trim()
        if (description) {
          const last = current.lineItems[current.lineItems.length - 1]
          if (last.description === null) last.description = description
        }
        break
      }

      case "TDS": {
        if (!current) break
        // TDS01 is the total invoice amount in CENTS per X12.
        const cents = parseNumber(seg[1])
        if (cents === null) {
          errors.push(
            `Invoice ${current.invoiceNumber || "(unknown)"}: unparseable TDS amount "${seg[1] ?? ""}".`
          )
        } else {
          current.totalAmount = Math.round(cents) / 100
        }
        break
      }

      case "SE": {
        if (!current) {
          errors.push("SE segment found outside a transaction — ignored.")
          break
        }
        // SE01 segment count + SE02 control number sanity checks (loose).
        const declared = parseNumber(seg[1])
        if (declared !== null && declared !== currentSegmentCount) {
          errors.push(
            `Invoice ${current.invoiceNumber || currentStControl || "(unknown)"}: SE declares ${declared} segments but ${currentSegmentCount} were read (continuing anyway).`
          )
        }
        if (currentStControl && seg[2] && seg[2] !== currentStControl) {
          errors.push(
            `Invoice ${current.invoiceNumber || "(unknown)"}: SE control number ${seg[2]} does not match ST control number ${currentStControl} (continuing anyway).`
          )
        }
        finalize()
        break
      }

      default:
        // Unknown/unneeded segments (CUR, REF, DTM, ITD, SAC, CTT, …)
        // are tolerated silently — the 810 spec has dozens of them.
        break
    }
  }

  if (current) {
    errors.push(
      `Transaction ${currentStControl ?? "(unknown)"}: file ended before SE — closing implicitly.`
    )
    finalize()
  }

  if (invoices.length === 0 && errors.length === 0) {
    errors.push("No 810 invoice transactions found in file.")
  }

  return { invoices, errors }
}
