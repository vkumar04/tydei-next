/**
 * LLM-based contract clause extractor.
 *
 * Bridges raw PDF text → `ContractClause[]` for the canonical
 * `analyzePDFContract` (lib/contracts/clause-risk-analyzer.ts).
 *
 * One prompt, one pass, no chunking. Inputs over 50KB are truncated
 * (the analyzer cares about the presence/absence of categories, not
 * exhaustive verbatim quoting — the front matter usually contains the
 * key clauses).
 *
 * Pure on the surface (caller passes plain text), but uses the shared
 * Anthropic-backed `generateStructured` wrapper. Exported as a regular
 * function so it can be called from server actions OR server route
 * handlers — NOT a `"use server"` file (only `extractClauses` would be
 * exportable then; this file also exports the response schema for
 * tests).
 */

import { z } from "zod"
import { generateStructured } from "@/lib/ai/generate-structured"
import { claudeSonnet } from "@/lib/ai/config"
import type {
  ContractClause,
  ClauseCategory,
} from "@/lib/contracts/clause-risk-analyzer"

const MAX_PDF_TEXT_CHARS = 50_000

/** Mirror of the 24 ClauseCategory values from the canonical analyzer. */
const CLAUSE_CATEGORY_VALUES = [
  "PRICING",
  "REBATE",
  "TERM_AND_RENEWAL",
  "TERMINATION",
  "COMPLIANCE",
  "MINIMUM_COMMITMENT",
  "PRICE_PROTECTION",
  "MOST_FAVORED_NATION",
  "AUTO_RENEWAL",
  "INDEMNIFICATION",
  "DISPUTE_RESOLUTION",
  "AUDIT_RIGHTS",
  "DATA_AND_HIPAA",
  "EXCLUSIVITY",
  "ANTI_STEERING",
  "CONFIDENTIALITY",
  "CAPITAL_MAINTENANCE",
  "SLA",
  "FORCE_MAJEURE",
  "GOVERNING_LAW",
  "ANTI_KICKBACK",
  "STARK_LAW",
  "MISSING",
  "OTHER",
] as const satisfies readonly ClauseCategory[]

const RISK_LEVEL_VALUES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const

/**
 * Schema describing the LLM's output. Each entry carries the canonical
 * category, the verbatim/near-verbatim text snippet, and an optional
 * detected risk override. Page numbers are optional — `extractPdfText`
 * does not preserve page boundaries.
 */
export const extractedClauseSchema = z
  .object({
    category: z.enum(CLAUSE_CATEGORY_VALUES),
    text: z.string(),
    detectedRiskLevel: z.enum(RISK_LEVEL_VALUES).optional(),
  })
  .describe(
    "One contract clause extracted verbatim or near-verbatim from the PDF text, tagged with its canonical category.",
  )

export const extractClausesResponseSchema = z
  .object({
    clauses: z.array(extractedClauseSchema),
  })
  .describe(
    "A flat list of contract clauses keyed by canonical ClauseCategory. Emit one entry per category found in the document. If a category appears multiple times, prefer the most operationally significant (longest / most specific) excerpt.",
  )

export type ExtractedClause = z.infer<typeof extractedClauseSchema>
export type ExtractClausesResponse = z.infer<typeof extractClausesResponseSchema>

const SYSTEM_PROMPT = `You are a contract-clause classifier for healthcare procurement contracts (medical-device, GPO, capital-equipment, services).

You will be given the plain-text body of a single vendor contract (or a 50KB excerpt). Identify each substantive clause and tag it with one of the canonical categories below. Emit ONE entry per category that is actually present. Do NOT invent clauses that are not in the text.

Canonical categories (use the exact uppercase value):
- PRICING — unit prices, fees, surcharges, escalators
- REBATE — back-end rebates, tiered rebates, growth bonuses
- TERM_AND_RENEWAL — initial term length, renewal options
- TERMINATION — termination rights, notice periods, cure periods, fees
- COMPLIANCE — regulatory-change handling, OIG/CMS/state-licensure reps
- MINIMUM_COMMITMENT — volume / spend minimums, shortfall fees
- PRICE_PROTECTION — caps on price escalation, CPI links
- MOST_FAVORED_NATION — MFN, "best pricing" clauses
- AUTO_RENEWAL — automatic renewal, evergreen language
- INDEMNIFICATION — indemnity, hold-harmless, defense obligations
- DISPUTE_RESOLUTION — arbitration, mediation, jurisdiction-of-suit
- AUDIT_RIGHTS — facility audit rights, books-and-records access
- DATA_AND_HIPAA — PHI, BAA, data ownership, de-identified data use
- EXCLUSIVITY — sole-source, exclusive-purchase commitments
- ANTI_STEERING — restrictions on recommending alternatives
- CONFIDENTIALITY — NDA, pricing-confidentiality
- CAPITAL_MAINTENANCE — service / maintenance for capital equipment
- SLA — service-level agreements, uptime, response time
- FORCE_MAJEURE — force majeure, acts-of-God
- GOVERNING_LAW — governing law, choice of law, venue
- ANTI_KICKBACK — Anti-Kickback Statute reps, Safe Harbor
- STARK_LAW — Stark / physician self-referral exception
- OTHER — substantive clauses that don't fit any category above

Rules:
- For each category, set "text" to the verbatim or lightly-trimmed clause text from the document (max 800 chars per clause). Do not paraphrase. If the clause spans many sentences, take the most operative sentence or two.
- Do not emit MISSING — only emit categories that ARE present in the text.
- If the document is silent on a category, simply do not emit an entry for it.
- detectedRiskLevel is OPTIONAL. Only set it when the clause language itself is unusually one-sided (e.g., uncapped indemnity, evergreen auto-renewal with 5-day non-renewal window). Use CRITICAL sparingly.
- Output strict JSON matching the provided schema. Do not include explanatory prose outside the JSON.`

export interface ExtractClausesInput {
  pdfText: string
  /** Free-form contract name / file name — included in the prompt so the
   *  LLM has weak grounding for ambiguous excerpts. */
  contractName?: string
}

export interface ExtractClausesResult {
  clauses: ContractClause[]
  truncated: boolean
  modelUsed: "primary" | "fallback"
}

/**
 * Run a single LLM pass over `pdfText` and return a list of canonical
 * `ContractClause` objects ready to feed `analyzePDFContract`.
 *
 * Defaults to Sonnet (fast + cheap; this is a one-shot classification,
 * not a multi-step reasoning task). Falls back to Sonnet on transient
 * failure as well — `generateStructured`'s fallback ladder is Opus →
 * Sonnet by default but classification doesn't need Opus quality.
 */
export async function extractClauses(
  input: ExtractClausesInput,
): Promise<ExtractClausesResult> {
  const trimmed = input.pdfText.trim()
  if (!trimmed) {
    return { clauses: [], truncated: false, modelUsed: "primary" }
  }

  const truncated = trimmed.length > MAX_PDF_TEXT_CHARS
  const body = truncated ? trimmed.slice(0, MAX_PDF_TEXT_CHARS) : trimmed

  const userPrompt = [
    input.contractName ? `Contract name: ${input.contractName}` : null,
    "Contract text:",
    "----",
    body,
    "----",
    truncated
      ? "(Text was truncated to the first 50KB; classify what is visible.)"
      : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  const { output, modelUsed } = await generateStructured({
    schema: extractClausesResponseSchema,
    actionName: "clause-extractor",
    primary: claudeSonnet,
    fallback: claudeSonnet,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  })

  const clauses: ContractClause[] = output.clauses
    // Drop MISSING — analyzer treats absence as missing on its own.
    .filter((c) => c.category !== "MISSING")
    .map((c) => ({
      category: c.category,
      text: c.text,
      ...(c.detectedRiskLevel ? { detectedRiskLevel: c.detectedRiskLevel } : {}),
    }))

  return { clauses, truncated, modelUsed }
}
