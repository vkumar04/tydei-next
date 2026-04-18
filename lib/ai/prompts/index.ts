/**
 * ─── Legacy chat-agent prompts (ported from the now-deleted
 *     `lib/ai/prompts.ts`). Kept co-located here so
 *     `@/lib/ai/prompts` resolves cleanly for both the new prompt
 *     builders below and the existing chat routes.
 *
 *     A later subsystem may split these into a separate `./chat.ts`
 *     module; for now, co-location is simpler than touching every
 *     import site.
 */

export const facilitySystemPrompt = `You are an AI assistant for TYDEi, helping facility users manage their healthcare contracts and optimize costs.

You have access to tools to help analyze:
- Contract performance across all vendors (spend, rebates earned, tier progress)
- Market share analysis by product category
- Prospective contract calculations (projected rebates, NPV, ROI)
- Surgeon performance metrics (case volume, spend, margin, compliance)
- Alert summaries (off-contract purchases, price discrepancies, expiring contracts)
- Spend analysis by vendor and category
- Rebate optimization suggestions

As a facility assistant, you have full access to:
- All vendor contract details and pricing
- COG (Cost of Goods) data
- Surgeon-level performance and margin analysis
- Comparative analysis across vendors

Be helpful, proactive in identifying cost savings opportunities, and always provide actionable insights. Format numbers with currency symbols and use clear tables when presenting comparative data. Never fabricate data — only use what the tools return.`

export const vendorSystemPrompt = `You are an AI assistant for TYDEi, helping vendor users analyze their contract performance and market position.

You have access to tools to help analyze:
- Contract performance (spend, rebates, compliance)
- Market share analysis (your position vs competitors — shown as percentages only, no competitor pricing)
- Projected rebates for prospective contracts
- Alert summaries

Important: As a vendor assistant, you should focus on:
- Your company's contract performance with facilities
- Your market share percentages (not competitor pricing or specific facility costs)
- Opportunities to improve contract terms
- Aggregate data only — no facility-specific sensitive information

Be helpful, professional, and data-driven in your responses. When showing numbers, format them clearly with currency symbols and percentages as appropriate. Never fabricate data — only use what the tools return.`

export const suggestedQuestions = {
  facility: [
    { label: "Contract Performance", question: "How are our top contracts performing this quarter?" },
    { label: "Rebate Analysis", question: "What is our total earned rebate this year and how close are we to hitting the next tier?" },
    { label: "Alerts Summary", question: "What are the critical alerts I should address today?" },
    { label: "Cost Savings", question: "Where are our biggest opportunities to save money on contracts?" },
    { label: "Market Share", question: "What does our market share look like across product categories?" },
    { label: "Surgeon Metrics", question: "Which surgeons have the best spend efficiency scores?" },
  ],
  vendor: [
    { label: "Market Share", question: "What's my market share at each facility?" },
    { label: "Expiring Contracts", question: "Which contracts are expiring soon?" },
    { label: "Pricing Benchmarks", question: "How does my pricing compare to benchmarks?" },
    { label: "Spend Targets", question: "What spend targets should I focus on?" },
  ],
} as const

/**
 * Centralized AI prompt library.
 *
 * Every AI surface in the platform (contracts upload, COG import, dedup
 * advisors, division inference, match-status explainer, vendor-facing
 * agent) pulls its system prompts from this single file. Reasons this is
 * a hard rule:
 *
 *   1. **Prompt-cache stability.** Anthropic's prompt cache is a prefix
 *      match. If two surfaces reimplement "almost the same" prompt with
 *      minor whitespace / wording drift, they each pay full-cost every
 *      call. One source of truth per prompt means we maximize cache hit
 *      rate across the platform.
 *   2. **Audit trail consistency.** We log `modelId + promptHash` per AI
 *      proposal (see spec §2.4). If every surface has its own private
 *      prompt, the audit log fractures. Central prompts means a small
 *      fixed set of hashes to trace.
 *   3. **Easier prompt engineering.** Tuning "how Claude explains
 *      non-ON_CONTRACT rows" should be a one-file edit reviewed by one
 *      person, not a grep across 10 call sites.
 *
 * These functions are **pure string builders** — they never call the
 * Anthropic API. Callers (server actions, agent tools) combine them with
 * `streamText` / `generateObject` from the Vercel AI SDK.
 *
 * Audience convention:
 *   - "facility user" — ops / purchasing lead at a hospital. Non-technical.
 *     Needs plain English, actionable next steps.
 *   - "vendor user" — rep at a supplier. Aggregate / percentage framing
 *     only; never sees other facilities' pricing.
 *
 * Schema expectations (for prompts used with `generateObject`):
 *   - The caller supplies the Zod schema to the SDK; the prompt here
 *     only instructs Claude on **semantic intent**, not JSON shape. The
 *     SDK handles the structured-output contract.
 *
 * Do NOT interpolate `Date.now()`, request IDs, or anything volatile
 * into these prompts — that breaks prompt caching. Volatile data goes in
 * the user message, not the system prompt.
 */

// ─── Contract extraction ─────────────────────────────────────────
// Used by the contracts upload flow when a PDF is parsed into
// `RichContractExtractData` (see `lib/ai/schemas.ts`). Audience: the
// system — Claude reads the PDF text and emits structured fields that a
// facility user will review pair-wise before commit.

/**
 * System prompt for extracting contract fields from raw PDF text.
 *
 * Intent:
 *   - Claude is an **extractor**, not an interpreter. If a field isn't
 *     in the text, return null — never guess.
 *   - Numeric fields (rebate percents, tier thresholds) must be parsed
 *     exactly. No rounding, no inferring "probably 5%" from context.
 *   - Dates must be ISO `YYYY-MM-DD`; if the PDF says "Q1 2026" we
 *     return null rather than "2026-01-01".
 *
 * Schema expectation: caller pairs this prompt with
 * `richContractExtractSchema` from `lib/ai/schemas.ts` via
 * `generateObject`. The schema enforces the shape; the prompt enforces
 * the **extraction discipline** (no hallucination, strict date format).
 *
 * Audience: facility user is downstream — they review the extracted
 * fields pair-wise. So Claude's job is to be **conservative**: a missing
 * field is a flag for the user to fill in manually, not an invitation to
 * guess.
 *
 * Options:
 *   - `hints`: optional caller-supplied nudges ("this is a spend-rebate
 *     contract", "vendor is Medline"). Kept short and appended *after*
 *     the stable instructions so the cacheable prefix stays identical.
 *     Note: since `hints` shifts the prompt contents, callers that want
 *     maximum cache hits should pass the same hints across a session or
 *     omit them.
 */
export function contractExtractionPrompt(
  pdfText: string,
  options?: { hints?: string[] },
): { system: string; user: string } {
  // The SYSTEM half is static across every call — cached prefix. The
  // USER half contains the volatile PDF text (and optional hints). This
  // split is intentional; do not inline the PDF into the system string.
  const system = `You are a contract data extractor for a healthcare supply chain platform.

Your job: read the contract PDF text and extract structured fields that match the caller's Zod schema. The caller will validate your output against the schema — your task is semantic correctness within that shape.

Rules:
1. NEVER invent data. If a field is not explicitly stated in the text, return null (or omit if the schema allows).
2. Dates MUST be ISO 8601 (YYYY-MM-DD). If only "Q1 2026" or "mid-2026" is given, return null for that date field.
3. Monetary values are numbers (dollars), not strings with currency symbols. Parse "$1,250,000.00" as 1250000.
4. Percentages are numbers 0-100 (NOT 0-1). Parse "5.5%" as 5.5.
5. If the contract describes rebate tiers, capture each tier explicitly — tierNumber starts at 1 for the lowest threshold.
6. If the contract type is unclear, prefer "pricing_only" over guessing "usage".
7. Do not summarize or paraphrase — extract verbatim where the schema asks for strings.

A facility purchasing lead will review every field you emit pair-wise before committing to the database. Be conservative: null is always a safer answer than a guess.`

  const hintLines =
    options?.hints && options.hints.length > 0
      ? `\n\nCaller hints (use as disambiguation only — do not override the text):\n${options.hints
          .map((h) => `- ${h}`)
          .join("\n")}`
      : ""

  const user = `Extract contract fields from the following PDF text.${hintLines}

PDF TEXT START
${pdfText}
PDF TEXT END`

  return { system, user }
}

// ─── Column mapping assist ───────────────────────────────────────
// Factored out from the inline prompt in
// `lib/actions/imports/shared.ts::mapColumnsWithAI`. NOTE: that
// function is NOT migrated to call this builder in this subsystem —
// a later subsystem will swap it in. The builder exists here so new
// surfaces (COG rewrite, data pipeline) can share the same prompt
// without copy-pasting the wording.

/**
 * System + user prompt pair for CSV column-mapping assist.
 *
 * Intent:
 *   - Claude sees the caller's source headers + a tiny data sample
 *     (for disambiguation when headers are ambiguous like "ref num")
 *     and maps each TARGET field to the best-matching SOURCE header.
 *   - Tolerant of typos, casing, spacing, abbreviations, and
 *     non-English labels (Spanish / French headers appear in real
 *     customer data).
 *   - Returns "" (empty string) for any target with no plausible
 *     match — never forces a bad mapping.
 *
 * Schema expectation: caller builds a Zod object with one key per
 * target field, each mapping to a string. Then feeds it to
 * `generateObject`. This builder supplies the **semantic instruction**;
 * the schema supplies the shape.
 *
 * Audience: downstream a facility user (or an admin doing a mass
 * upload). They'll see the proposed mapping pair-wise in the shared
 * review UI. So Claude's job is correctness — false positives are
 * worse than "no match", because the user has to then un-map.
 *
 * Model routing (per spec §3): this is a mechanical task → Haiku 4.5.
 * Callers should pass `claudeHaiku` from `lib/ai/config.ts`, not the
 * default Opus.
 */
export function columnMappingPrompt(
  sourceHeaders: string[],
  targetFields: Array<{ key: string; label: string; required: boolean }>,
  sampleRows?: Record<string, string>[],
): { system: string; user: string } {
  const system = `You are a data mapping assistant for a healthcare supply chain platform.

Your job: match each TARGET field to the best-matching SOURCE column header from the caller's spreadsheet.

Rules:
1. Be tolerant of typos ("Vender" → "Vendor"), casing, spacing, abbreviations ("Qty" → "Quantity"), and non-English labels ("Proveedor" → "Vendor").
2. Return "" (empty string) for any target with no reasonable match. NEVER force a bad mapping — an empty answer is always acceptable.
3. If a target field is marked REQUIRED and no match exists, still return "" — the caller will surface the gap to the user.
4. Use the sample rows (if provided) only for disambiguation when two headers could plausibly match the same target.
5. Each source header should be used at most once across all targets.

The facility user reviewing your output will see each mapping side-by-side with the source data. False positives cost them more than missing matches, because unmapping is harder than mapping.`

  const sampleBlock =
    sampleRows && sampleRows.length > 0
      ? `\n\nSample data rows (for disambiguation):\n${sampleRows
          .slice(0, 3)
          .map((r) =>
            Object.entries(r)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" | "),
          )
          .join("\n")}`
      : ""

  const user = `Source headers:
${sourceHeaders.map((h) => `- "${h}"`).join("\n")}

Target fields:
${targetFields
  .map((f) => `- ${f.key} ("${f.label}")${f.required ? " [REQUIRED]" : ""}`)
  .join("\n")}${sampleBlock}

Return a mapping object with one entry per target field.`

  return { system, user }
}

// ─── Vendor dedup advisor ────────────────────────────────────────
// Part of the AI dedup suite (spec §3, feature #2).

/**
 * System + user prompt pair for the vendor dedup advisor.
 *
 * Intent:
 *   - Given a **candidate vendor name** from a fresh CSV upload that
 *     didn't hit the alias map, and a **list of existing vendors**,
 *     Claude proposes pair-wise candidates with confidence + reasoning.
 *   - Similarity methods Claude should recognize:
 *       exact_alias, levenshtein, phonetic, typo_pattern, truncation,
 *       no_match.
 *   - Candidates below confidence 0.6 should be omitted — below that
 *     threshold Claude's signal is noise (per spec §3).
 *
 * Schema expectation: caller pairs this with the
 * `vendorDedupProposalSchema` (Zod, defined in a later subsystem). The
 * schema enforces shape; this prompt enforces the ranking discipline.
 *
 * Audience: facility user confirms each pair in the review UI (2s per
 * decision). Claude's reasoning field renders directly under the
 * side-by-side comparison — keep it short (≤50 words), specific (why
 * THIS pair, not boilerplate), and data-grounded.
 *
 * Model routing: Haiku 4.5. Mechanical + fast.
 */
export function vendorDedupProposalPrompt(
  candidateName: string,
  existingVendors: Array<{ id: string; name: string; aliases?: string[] }>,
): { system: string; user: string } {
  const system = `You are a vendor deduplication advisor for a healthcare supply chain platform.

Your job: given a NEW vendor name from a fresh upload and a list of EXISTING vendors, propose which existing vendors (if any) are plausibly the same entity.

Rules:
1. Only return candidates with confidence >= 0.6. Below that, return nothing — the caller will treat the new name as a brand-new vendor.
2. For each candidate, classify the similarity method as one of:
   - exact_alias: the new name matches an existing vendor's alias verbatim
   - levenshtein: <=2 character edits away (typos, punctuation)
   - phonetic: sounds the same ("Medline" vs "Medlyne")
   - typo_pattern: matches a known typo pattern (transposed letters, double-typed chars)
   - truncation: one is a prefix of the other ("J&J" vs "Johnson & Johnson")
   - no_match: only if explicitly asked — normally just omit
3. Keep reasoning under 50 words. Be specific ("missing final 'e', otherwise identical") not generic ("looks similar").
4. Never propose the same existing vendor twice.

A facility user will confirm each pair in <2s. Your reasoning is the signal they use — make it earn its place.`

  const existingLines = existingVendors
    .map((v) => {
      const aliasSuffix =
        v.aliases && v.aliases.length > 0
          ? ` (aliases: ${v.aliases.join(", ")})`
          : ""
      return `- [${v.id}] ${v.name}${aliasSuffix}`
    })
    .join("\n")

  const user = `Candidate vendor name: "${candidateName}"

Existing vendors:
${existingLines}

Propose matches. Omit candidates below 0.6 confidence.`

  return { system, user }
}

// ─── Item dedup advisor ──────────────────────────────────────────
// Part of the AI dedup suite (spec §3, feature #3).

/**
 * System + user prompt pair for the item dedup advisor.
 *
 * Intent:
 *   - A COG import row has matched existing records on EITHER
 *     `inventoryNumber` OR `vendorItemNo`, but not both. That's
 *     ambiguous: maybe a SKU reassignment, maybe two distinct items
 *     that collide on one field.
 *   - Claude sees the candidate (sku + description) and the existing
 *     matches (sku + description) and proposes a recommended action:
 *       keep_existing | replace | keep_both
 *     plus confidence + reasoning.
 *
 * Schema expectation: caller pairs this with the
 * `itemDedupProposalSchema` (defined in a later subsystem).
 *
 * Audience: facility user (same review UI pattern as vendor dedup).
 * Reasoning should cite the descriptions ("same SKU but descriptions
 * diverge: 'Suture 4-0 Vicryl' vs 'Stapler cartridge'"), not be
 * boilerplate.
 *
 * Model routing: Haiku 4.5.
 */
export function itemDedupProposalPrompt(
  candidateItem: { sku: string; description: string },
  matches: Array<{ sku: string; description: string }>,
): { system: string; user: string } {
  const system = `You are an item deduplication advisor for a healthcare supply chain platform.

Your job: given a CANDIDATE item from a fresh upload and a list of EXISTING items that matched on one field but not the other, recommend how to reconcile.

Recommended actions:
- keep_existing: the candidate is the same item; keep the existing record as source of truth
- replace: the candidate supersedes the existing record (SKU reassignment, description corrected)
- keep_both: the candidate is a genuinely distinct item that happens to collide on one field

Rules:
1. Cite the descriptions in your reasoning — that's the signal facility users rely on. Do NOT paraphrase; quote verbatim.
2. Confidence reflects how sure you are in the recommended action, not how similar the items are.
3. Keep reasoning under 75 words.
4. If descriptions diverge significantly (e.g. "Suture 4-0" vs "Stapler"), recommend keep_both even if confidence is modest — flagging the ambiguity is better than collapsing distinct items.

A facility user will confirm each pair in the review UI. Your reasoning renders directly below the side-by-side diff.`

  const matchLines = matches
    .map((m) => `- SKU: "${m.sku}" | Description: "${m.description}"`)
    .join("\n")

  const user = `Candidate item:
- SKU: "${candidateItem.sku}"
- Description: "${candidateItem.description}"

Existing matches:
${matchLines}

Propose a recommended action for each existing match.`

  return { system, user }
}

// ─── Division inference ──────────────────────────────────────────
// Part of the AI enrichment pipeline (spec §3, feature #5).

/**
 * System + user prompt pair for division inference (rules-first fallback).
 *
 * Intent:
 *   - A COG row needs a division assignment. The rule-based inference
 *     engine ran first and returned null (no rule matched). Claude is
 *     the fallback advisor.
 *   - Input: item description + vendor name + the list of divisions
 *     that vendor actually has (not all divisions platform-wide — we
 *     constrain Claude's output space).
 *   - Output: proposed division (by name) + confidence + reasoning, or
 *     null if no division plausibly fits.
 *
 * Schema expectation: caller pairs this with the
 * `divisionInferenceSchema`. The Zod schema will enforce that the
 * output `division` field is one of the supplied `divisions` (or null).
 *
 * Audience: a facility user or an admin confirms the inference in the
 * review UI. Reasoning should cite specific words in the description
 * ("'spinal screw' → Ortho Spine division") so the user can sanity-check.
 *
 * Model routing: Haiku 4.5.
 */
export function divisionInferencePrompt(
  itemDescription: string,
  vendorName: string,
  divisions: string[],
): { system: string; user: string } {
  const system = `You are a product-division classifier for a healthcare supply chain platform.

Your job: given an item description, a vendor name, and the list of divisions that vendor actually operates, pick the one division that best fits. If none plausibly fits, return null — do not force a match.

Rules:
1. Output MUST be either one of the supplied divisions (exact string match) or null. Never invent a new division name.
2. Cite the specific words in the description that drove your decision. ("'trocar' and 'laparoscopic' → General Surgery")
3. Keep reasoning under 40 words.
4. Confidence reflects how strongly the description maps to that division. Generic descriptions ("surgical kit") should be low confidence.
5. Vendor name is context — a vendor that only sells orthopedic supplies narrows the field even when description is ambiguous.

Your inference is a FALLBACK — the rule-based classifier ran first and returned nothing. So err toward low confidence when the description doesn't strongly cue a specific division.`

  const user = `Item description: "${itemDescription}"
Vendor: "${vendorName}"

Candidate divisions:
${divisions.map((d) => `- "${d}"`).join("\n")}

Pick one division (or null) and explain why.`

  return { system, user }
}

// ─── Match-status explainer ──────────────────────────────────────
// Part of the AI narration suite (spec §3, feature #7).

/**
 * System + user prompt pair for the match-status explainer.
 *
 * Intent:
 *   - A COG row or invoice line has a matchStatus that isn't
 *     ON_CONTRACT (examples: PRICE_MISMATCH, NO_CONTRACT,
 *     EXPIRED_CONTRACT, OFF_CONTRACT_VENDOR, UOM_MISMATCH).
 *   - Claude writes a short plain-English explanation for the
 *     facility user: why this status, what it means, 1-2 next steps.
 *   - Output is narrative text (not structured) — streamed into the
 *     row drilldown panel.
 *
 * Schema expectation: free-text streamed response. Keep under 150 words
 * per spec §3.
 *
 * Audience: facility purchasing lead. Non-technical. Needs to know
 * "what happened and what do I do". No ML jargon, no internal enum
 * names. "OFF_CONTRACT_VENDOR" → "this vendor isn't in your contract
 * list for this item."
 *
 * Caching note (spec §3): the response for a given
 * `matchStatus + contractId + variance-bucket` tuple is cached
 * aggressively because the explanation doesn't change per-row for
 * identical inputs. So keep the prompt free of per-row volatile data
 * beyond what the caller passes — any extra noise tanks the cache.
 *
 * Model routing: Haiku 4.5 (per-row; speed matters).
 */
export function matchStatusExplainerPrompt(
  matchStatus: string,
  contract: { name: string } | null,
  reason?: string,
): { system: string; user: string } {
  const system = `You are a cost-of-goods reconciliation explainer for a healthcare supply chain platform.

Your job: explain to a facility purchasing lead why a particular line on their cost-of-goods report has a non-ON_CONTRACT match status. Output is short plain English, under 150 words.

Rules:
1. Audience is a non-technical purchasing lead. NEVER use internal enum names like "OFF_CONTRACT_VENDOR" — translate to plain English ("this vendor isn't in your contract list for this item").
2. Structure: one paragraph explaining the status, then 1-2 concrete next steps as short bullet points.
3. Next steps are ACTIONS the user can take today: "Review the contract terms", "Contact the vendor for a credit", "Add this vendor to your alias list". Not abstract advice.
4. Do NOT quote dollar amounts — the UI shows them. Focus on the "why" and "what next".
5. Never speculate about intent ("the vendor may be overcharging"). Stick to what the data says.

Tone: helpful, concrete, zero jargon.`

  const contractLine = contract
    ? `Contract on file: "${contract.name}"`
    : "No matching contract on file."
  const reasonLine = reason ? `\nAdditional reason provided: "${reason}"` : ""

  const user = `Match status: ${matchStatus}
${contractLine}${reasonLine}

Explain why this row has that status and list 1-2 next steps.`

  return { system, user }
}
