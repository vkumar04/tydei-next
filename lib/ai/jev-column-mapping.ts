import { redactPhiSampleValues } from "@/lib/ai/phi-redaction"

const ENDPOINT = "https://api.typesafe.ai/v1/systemone"
const MODEL = "jev-latest"
const TIMEOUT_MS = 15_000
const NONE = "(none)"
const MIN_FALLBACK_PROBABILITY = 0.3
const MIN_SHARED_PROBABILITY = 0.9

const FIELD_DEFINITIONS: Record<string, string> = {
  vendorItemNo:
    "The selling vendor's own catalog or item number for the product (often headed Catalog No, Cat #, Vendor Item #, Ref, Reference, SKU, Item No). This is not the manufacturer's part number when the sheet has both.",
  manufacturerNo:
    "The manufacturer's part number (often headed Mfg Part #, Mfr No, MFG Catalog, Manufacturer Item). Distinct from the vendor's catalog number when the sheet has both.",
  inventoryNumber:
    "The product's item or catalog number used to identify what was purchased (often headed Catalog No, Vendor Item Number, Item #, Product Ref, SKU).",
}

export type JevTargetField = { key: string; label: string; required: boolean }

type ChoiceAnswer = {
  type: "choice"
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

type SystemOneResponse = {
  answers: Record<string, ChoiceAnswer | undefined>
}

export class JevNotConfiguredError extends Error {
  constructor() {
    super("TYPESAFE_API_KEY is not set")
    this.name = "JevNotConfiguredError"
  }
}

export function buildColumnMappingQuestions(
  sourceHeaders: string[],
  targetFields: JevTargetField[],
): Record<string, unknown> {
  const criteria: Record<string, string | null> = {}
  for (const h of sourceHeaders) criteria[h] = null
  criteria[NONE] =
    "No column in `headers` holds this data. Pick this rather than a column that only loosely relates."
  const questions: Record<string, unknown> = {}
  for (const field of targetFields) {
    questions[field.key] = {
      type: "choice",
      instructions: {
        target_field: {
          key: field.key,
          description: field.label,
          ...(FIELD_DEFINITIONS[field.key] ? { definition: FIELD_DEFINITIONS[field.key] } : {}),
        },
        question:
          "A spreadsheet has the columns in `headers`, with example values in `sample_rows`. Which column holds the data described by `target_field`? Headers may be abbreviated, misspelled, or in another language.",
      },
      criteria,
    }
  }
  return questions
}

export function resolveColumnMapping(
  sourceHeaders: string[],
  targetFields: JevTargetField[],
  answers: SystemOneResponse["answers"],
): Record<string, string> {
  const headerSet = new Set(sourceHeaders)
  const claims = targetFields
    .map((field) => {
      const answer = answers[field.key]
      const ranked = Object.entries(answer?.probabilities ?? {})
        .filter(([option]) => option === NONE || headerSet.has(option))
        .sort((a, b) => b[1] - a[1])
      return { key: field.key, required: field.required, ranked }
    })
    .filter((c) => c.ranked.length > 0)
    .sort((a, b) => Number(b.required) - Number(a.required) || b.ranked[0][1] - a.ranked[0][1])

  const taken = new Set<string>()
  const mapping: Record<string, string> = {}
  for (const claim of claims) {
    const pick = claim.ranked.find(([option, probability], i) => {
      if (option === NONE) return true
      if (taken.has(option)) return i === 0 && probability >= MIN_SHARED_PROBABILITY
      return i === 0 || probability >= MIN_FALLBACK_PROBABILITY
    })
    if (!pick || pick[0] === NONE) continue
    taken.add(pick[0])
    mapping[claim.key] = pick[0]
  }
  return mapping
}

export async function mapColumnsWithJev(
  sourceHeaders: string[],
  targetFields: JevTargetField[],
  sampleRows: Record<string, string>[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) throw new JevNotConfiguredError()
  if (sourceHeaders.length === 0 || targetFields.length === 0) return {}

  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      state: {
        headers: sourceHeaders,
        sample_rows: redactPhiSampleValues(sourceHeaders, sampleRows.slice(0, 3)),
      },
      questions: buildColumnMappingQuestions(sourceHeaders, targetFields),
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200)
    throw new Error(`TypeSafe column mapping failed: HTTP ${res.status} ${detail}`)
  }
  const body = (await res.json()) as SystemOneResponse
  return resolveColumnMapping(sourceHeaders, targetFields, body.answers ?? {})
}
