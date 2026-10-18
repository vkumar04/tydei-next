import { ocrPdfBuffer } from "@/lib/ai/ocr-pdf"
import type { ContractWarning } from "@/lib/ai/cross-field-warnings"
import type { ExtractedContractData } from "@/lib/ai/schemas"

const ENDPOINT = "https://api.typesafe.ai/v1/systemone"
const NONE = "none"
const MIN_CONFIDENCE = 0.7
const MIN_MONEY_CONFIDENCE = 0.85
const MAX_OCR_PAGES = 10

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]

type Candidate<T> = { id: string; text: string; line: string; value: T }

const pad = (n: number) => String(n).padStart(2, "0")

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

export function findDates(lines: string[]): Candidate<string>[] {
  const out: Candidate<string>[] = []
  const monthRe = MONTHS.join("|")
  const patterns: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [new RegExp(`\\b(${monthRe})\\s+(\\d{1,2}),?\\s+(\\d{4})`, "gi"), (m) => iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2])],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+day\\s+of\\s+(${monthRe}),?\\s+(\\d{4})`, "gi"), (m) => iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1])],
    [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m) => iso(+m[3], +m[1], +m[2])],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => iso(+m[1], +m[2], +m[3])],
  ]
  for (const line of lines) {
    for (const [re, toIso] of patterns) {
      re.lastIndex = 0
      for (let m = re.exec(line); m; m = re.exec(line)) {
        const value = toIso(m)
        if (value) out.push({ id: `d${out.length}`, text: m[0], line, value })
      }
    }
  }
  return out
}

export function findMoney(lines: string[]): Candidate<number>[] {
  const out: Candidate<number>[] = []
  for (const line of lines) {
    for (const m of line.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(million|mm|m|k|thousand)?\b/gi)) {
      const base = Number(m[1].replace(/,/g, ""))
      if (!Number.isFinite(base)) continue
      const unit = (m[2] ?? "").toLowerCase()
      const value = unit === "million" || unit === "mm" || unit === "m" ? base * 1_000_000 : unit === "k" || unit === "thousand" ? base * 1_000 : base
      out.push({ id: `m${out.length}`, text: m[0].trim(), line, value })
    }
  }
  return out
}

export function findIds(lines: string[]): Candidate<string>[] {
  const out: Candidate<string>[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    for (const m of line.matchAll(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g)) {
      if (!/\d/.test(m[0]) || seen.has(m[0])) continue
      seen.add(m[0])
      out.push({ id: `i${out.length}`, text: m[0], line, value: m[0] })
    }
  }
  return out
}

export function findOrgNames(lines: string[]): Candidate<string>[] {
  const out: Candidate<string>[] = []
  const seen = new Set<string>()
  const re = /[A-Z][\w.'&-]*(?:(?:\s|,\s)(?:&|and|of|Inc\.?|LLC|[A-Z][\w.'&-]*))*/g
  for (const line of lines) {
    for (const m of line.matchAll(re)) {
      const text = m[0].replace(/[,.]$/, "").trim()
      if (text.length < 2 || seen.has(text)) continue
      seen.add(text)
      out.push({ id: `o${out.length}`, text, line, value: text })
    }
  }
  return out
}

function choiceOver<T>(question: string, candidates: Candidate<T>[], noneMeaning: string) {
  const criteria: Record<string, string> = {}
  for (const c of candidates) criteria[c.id] = `"${c.text}" in the line: "${c.line}"`
  criteria[NONE] = noneMeaning
  return { type: "choice", instructions: question, criteria }
}

const CONTRACT_TYPES: Record<string, string> = {
  usage: "Spend- or volume-based rebate tiers, and no financed or contributed capital equipment.",
  tie_in: "Capital equipment is financed, placed, or contributed and tied to consumable purchase commitments, even if there are also rebate tiers.",
  capital: "A straight equipment purchase with a payment schedule and no consumable rebate tiers.",
  pricing_only: "Purely a price list with no rebates or performance terms.",
  grouped: "A GPO or multi-vendor group purchasing agreement.",
  service: "A service-level, maintenance, or consulting agreement.",
}

const TYPE_LABELS: Record<string, string> = {
  usage: "usage (rebate tiers)",
  tie_in: "tie-in (capital tied to purchases)",
  capital: "capital purchase",
  pricing_only: "pricing only",
  grouped: "grouped / GPO",
  service: "service",
}

type ChoiceAnswer = { choice: string; confidence: number }

type Pick<T> = { value: T; text: string; line: string; confidence: number } | { value: null; confidence: number } | undefined

export type JevContractSelection = {
  vendor: Pick<string>
  contractNumber: Pick<string>
  contractType: { value: string; confidence: number } | undefined
  effectiveDate: Pick<string>
  expirationDate: Pick<string>
  totalValue: Pick<number>
  capitalCost: Pick<number>
}

export async function selectContractFieldsWithJev(text: string, apiKey: string, signal?: AbortSignal): Promise<JevContractSelection> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const dates = findDates(lines)
  const money = findMoney(lines)
  const ids = findIds(lines)
  const orgs = findOrgNames(lines)

  const questions = {
    vendor: choiceOver("Which name is the vendor, supplier, seller, or manufacturer that is party to this contract? Not the facility, hospital, or buyer.", orgs, "No vendor is named."),
    contractNumber: choiceOver("Which identifier is this contract's own agreement, contract, or reference number? Not a product, item, or catalog number.", ids, "The contract has no agreement or reference number."),
    contractType: { type: "choice", instructions: "What type of contract is `document`?", criteria: CONTRACT_TYPES },
    effectiveDate: choiceOver("Which date is when this contract takes effect or its term starts?", dates, "No effective or start date is stated."),
    expirationDate: choiceOver("Which date is when this contract's term ends or expires? Pick none if the contract is evergreen or continues until terminated.", dates, "No end date: evergreen, auto-renewing, or continues until terminated."),
    totalValue: choiceOver("Which amount is the total committed or expected contract value over the whole term? Not a rebate threshold, tier breakpoint, rebate amount, unit price, or equipment price.", money, "No total contract value is stated."),
    capitalCost: choiceOver("Which amount is the purchase price or cost of capital equipment? Not a down payment, rebate, or total contract value.", money, "No capital equipment cost is stated."),
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state: { document: text }, questions }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`TypeSafe contract check failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  const { answers } = (await res.json()) as { answers: Record<string, ChoiceAnswer | undefined> }

  const pick = <T>(key: keyof typeof questions, candidates: Candidate<T>[]): Pick<T> => {
    const a = answers[key]
    if (!a) return undefined
    if (a.choice === NONE) return { value: null, confidence: a.confidence }
    const c = candidates.find((x) => x.id === a.choice)
    return c ? { value: c.value, text: c.text, line: c.line, confidence: a.confidence } : undefined
  }
  const type = answers.contractType
  return {
    vendor: pick("vendor", orgs),
    contractNumber: pick("contractNumber", ids),
    contractType: type && type.choice in CONTRACT_TYPES ? { value: type.choice, confidence: type.confidence } : undefined,
    effectiveDate: pick("effectiveDate", dates),
    expirationDate: pick("expirationDate", dates),
    totalValue: pick("totalValue", money),
    capitalCost: pick("capitalCost", money),
  }
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")

const quote = (p: { text: string; line: string }) => (p.line.length <= 100 ? `"${p.line}"` : `"${p.text}"`)

export function compareContractSelection(extracted: ExtractedContractData, jev: JevContractSelection): ContractWarning[] {
  const warnings: ContractWarning[] = []
  const warn = (path: string[], message: string) => warnings.push({ path, severity: "warning", message })

  const v = jev.vendor
  if (v && v.value !== null && v.confidence >= MIN_CONFIDENCE) {
    const a = norm(extracted.vendorName)
    const b = norm(v.value)
    if (a && b && !a.includes(b) && !b.includes(a)) {
      warn(["vendorName"], `Vendor: the extractor read "${extracted.vendorName}", but a second check of the document points to "${v.value}" (${quote(v)}). Confirm which party is the vendor.`)
    }
  }

  const n = jev.contractNumber
  if (n && n.value !== null && n.confidence >= MIN_CONFIDENCE) {
    const current = norm(extracted.contractNumber)
    if (!current) warn(["contractNumber"], `Contract number: the extractor left this blank, but the document appears to state "${n.value}" (${quote(n)}).`)
    else if (current !== norm(n.value)) warn(["contractNumber"], `Contract number: the extractor read "${extracted.contractNumber}", but a second check points to "${n.value}" (${quote(n)}).`)
  }

  const t = jev.contractType
  if (t && t.confidence >= MIN_CONFIDENCE && t.value !== extracted.contractType) {
    warn(["contractType"], `Contract type: the extractor chose ${TYPE_LABELS[extracted.contractType] ?? extracted.contractType}, but a second check reads this as ${TYPE_LABELS[t.value] ?? t.value}. The type decides how rebates and capital are tracked.`)
  }

  const dateCheck = (key: "effectiveDate" | "expirationDate", label: string, pick: Pick<string>) => {
    if (!pick || pick.confidence < MIN_CONFIDENCE) return
    const current = extracted[key] ?? null
    if (pick.value === null) {
      if (key === "expirationDate" && current) warn([key], `${label}: the extractor read ${current}, but a second check found no end date, which suggests an evergreen contract. Confirm the term.`)
      return
    }
    if (!current) warn([key], `${label}: the extractor left this blank, but the document appears to state ${pick.value} (${quote(pick)}).`)
    else if (current !== pick.value) warn([key], `${label}: the extractor read ${current}, but a second check of the document points to ${pick.value} (${quote(pick)}).`)
  }
  dateCheck("effectiveDate", "Effective date", jev.effectiveDate)
  dateCheck("expirationDate", "Expiration date", jev.expirationDate)

  const moneyCheck = (key: "totalValue" | "capitalCost", label: string, pick: Pick<number>) => {
    if (!pick || pick.value === null || pick.confidence < MIN_MONEY_CONFIDENCE) return
    const current = extracted[key]
    if (current == null) warn([key], `${label}: the extractor left this blank, but the document appears to state ${pick.text} (${quote(pick)}).`)
    else if (Math.abs(current - pick.value) > 0.5) warn([key], `${label}: the extractor read $${current.toLocaleString("en-US")}, but a second check points to ${pick.text} (${quote(pick)}).`)
  }
  moneyCheck("totalValue", "Total value", jev.totalValue)
  moneyCheck("capitalCost", "Capital cost", jev.capitalCost)

  return warnings
}

export async function checkContractExtractWithJev(opts: {
  extracted: ExtractedContractData
  text: string | null
  fileData?: Uint8Array
  pageCount?: number
  signal?: AbortSignal
  logPrefix: string
}): Promise<ContractWarning[]> {
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) return []
  try {
    let text = opts.text
    if (!text && opts.fileData && (opts.pageCount ?? Infinity) <= MAX_OCR_PAGES) {
      text = await ocrPdfBuffer(opts.fileData, { maxPages: MAX_OCR_PAGES, signal: opts.signal, logPrefix: opts.logPrefix })
    }
    if (!text?.trim()) return []
    const selection = await selectContractFieldsWithJev(text, apiKey, opts.signal)
    return compareContractSelection(opts.extracted, selection)
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err
    console.warn(`${opts.logPrefix} Jev cross-check skipped:`, err)
    return []
  }
}
