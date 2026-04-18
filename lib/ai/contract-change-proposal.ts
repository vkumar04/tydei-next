/**
 * Helpers for working with `ContractChangeProposal` Prisma rows when the
 * proposer is the **AI contract-change advisor** (as opposed to a vendor
 * submitting a change via the UI).
 *
 * Why a separate helper module:
 *   1. The AI advisor's vocabulary is semantic ("pricing", "facility_scope",
 *      "status_change") — richer than the Prisma `ProposalType` enum
 *      (term_change / new_term / remove_term / contract_edit). We store
 *      the semantic kind inside the `changes` JSON payload rather than
 *      widen the enum.
 *   2. AI proposals carry a `confidence` score and `reasoning` string that
 *      vendor-submitted proposals don't have. We stash those in the
 *      `changes` JSON + `vendorMessage` fields respectively.
 *   3. UI rendering routes through `AiAdvisoryProposal` (see `./types.ts`).
 *      Serializing a Prisma row → that shape lives here so every surface
 *      that lists AI-generated contract changes uses the same mapper.
 *
 * What this file deliberately does NOT do:
 *   - Call `prisma.contractChangeProposal.create(...)`. The helper
 *     returns a typed create-input object; the caller passes it to
 *     Prisma. This keeps the module pure-functional and trivially unit
 *     testable.
 *   - Call the Anthropic API. Prompt-building lives in `./prompts/`.
 */

import type { Prisma } from "@prisma/client"
import type { AiAdvisoryProposal } from "./types"

// ─── Input / output types ────────────────────────────────────────

/**
 * Semantic kinds the AI advisor can propose. Intentionally **NOT** the
 * Prisma `ProposalType` enum — that enum describes the **shape** of the
 * change (term vs edit), this enum describes the **intent** (pricing,
 * scope, status). We persist this in the `changes` JSON so we can widen
 * the AI vocabulary without a DB migration.
 */
export type ContractChangeProposalKind =
  | "pricing"
  | "term_addition"
  | "term_modification"
  | "status_change"
  | "facility_scope"
  | "other"

export interface ContractChangeProposalInput {
  contractId: string
  kind: ContractChangeProposalKind
  reasoning: string
  confidence: number
  /** JSON-serializable snapshot of the contract state BEFORE the proposed change. */
  beforeSnapshot: unknown
  /** JSON-serializable snapshot of the contract state AFTER the proposed change. */
  afterSnapshot: unknown
}

/**
 * Shape of the `changes` JSON column when the row originated from the AI
 * advisor. Other codepaths (vendor-submitted proposals) have a different
 * shape — always check `changes.source === "ai_advisor"` before reading.
 */
export interface AiContractChangePayload {
  source: "ai_advisor"
  kind: ContractChangeProposalKind
  confidence: number
  reasoning: string
  beforeSnapshot: unknown
  afterSnapshot: unknown
}

// ─── Builders ────────────────────────────────────────────────────

/**
 * Clamp a confidence value into [0, 1]. LLM-reported confidence is
 * notoriously uncalibrated; occasionally models emit values like 2 or
 * -0.3. We clamp rather than reject — losing the proposal over a
 * scoring glitch is worse than a mildly-miscalibrated score.
 */
function clampConfidence(value: number): number {
  // NaN is a parse glitch → safest floor is 0.
  if (Number.isNaN(value)) return 0
  // +/-Infinity are clamp-at-boundary, not reject — the sign still
  // tells us which end of the scale the model meant.
  if (value >= 1) return 1
  if (value <= 0) return 0
  return value
}

/**
 * Build a Prisma-compatible create input for an AI-generated
 * `ContractChangeProposal` row.
 *
 * Design notes:
 *   - The caller supplies only `contractId` — we do NOT require
 *     `vendorId` / `vendorName` because the AI advisor can run against
 *     any contract. The caller is responsible for providing those via
 *     a subsequent `connect`/`set` if the downstream schema requires
 *     them; in this v1 helper, we set them to empty strings and let the
 *     caller override. This is intentional: the AI advisor shape is
 *     evolving, and forcing vendor identity into the helper signature
 *     now would cost us every time we widen it.
 *   - `proposalType` defaults to `"contract_edit"` — the broadest
 *     Prisma enum variant, appropriate for AI-semantic kinds that don't
 *     neatly map to term_change/new_term/remove_term.
 *   - Confidence is clamped (2 → 1, -5 → 0, 0.5 → 0.5, NaN → 0).
 *   - The full semantic payload lives in `changes` JSON under the
 *     `source: "ai_advisor"` discriminator so readers can tell an
 *     AI-authored row from a vendor-authored one.
 */
export function buildContractChangeProposal(
  input: ContractChangeProposalInput,
): Prisma.ContractChangeProposalUncheckedCreateInput {
  const confidence = clampConfidence(input.confidence)

  const payload: AiContractChangePayload = {
    source: "ai_advisor",
    kind: input.kind,
    confidence,
    reasoning: input.reasoning,
    beforeSnapshot: input.beforeSnapshot,
    afterSnapshot: input.afterSnapshot,
  }

  return {
    contractId: input.contractId,
    // AI advisor isn't a vendor; leave identity fields blank. Callers
    // that know the vendor context should post-process.
    vendorId: "",
    vendorName: "",
    facilityId: null,
    facilityName: null,
    proposalType: "contract_edit",
    status: "pending",
    // Prisma's Json input accepts any JSON-compatible value. Cast via
    // the InputJsonValue shape — our payload is JSON-clean by
    // construction (snapshots are unknown but the caller is responsible
    // for keeping them serializable).
    changes: payload as unknown as Prisma.InputJsonValue,
    vendorMessage: input.reasoning,
  }
}

// ─── UI serializer ───────────────────────────────────────────────

/**
 * Minimal shape of a persisted `ContractChangeProposal` row that this
 * serializer needs. Accepts the full Prisma row OR any subset that
 * provides these fields — keeps callers free to shape their own
 * `select`/`include` without breaking the contract.
 */
export interface ContractChangeProposalRow {
  id: string
  changes: Prisma.JsonValue
  submittedAt: Date
  vendorMessage: string | null
}

/**
 * Type guard: is the given `changes` JSON an AI-authored payload?
 * Exported so callers can filter mixed lists.
 */
export function isAiContractChangePayload(
  value: unknown,
): value is AiContractChangePayload {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    v.source === "ai_advisor" &&
    typeof v.kind === "string" &&
    typeof v.confidence === "number" &&
    typeof v.reasoning === "string"
  )
}

/**
 * Convert a persisted Prisma `ContractChangeProposal` row into the
 * UI-friendly `AiAdvisoryProposal` shape used by the shared review
 * panel (see `./types.ts` and subsystem 4).
 *
 * If the row's `changes` field isn't an AI-authored payload (e.g. it's
 * a vendor-submitted proposal), we throw. Callers should pre-filter
 * with `isAiContractChangePayload` when they have mixed data.
 *
 * The returned `suggestion` is `{ before, after }` — the review card
 * uses it to render the side-by-side diff.
 */
export function serializeProposalForUi(
  proposal: ContractChangeProposalRow,
): AiAdvisoryProposal<{ before: unknown; after: unknown }> {
  if (!isAiContractChangePayload(proposal.changes)) {
    throw new Error(
      `ContractChangeProposal ${proposal.id} is not an AI-authored proposal (missing source="ai_advisor" in changes JSON)`,
    )
  }

  const payload = proposal.changes

  return {
    id: proposal.id,
    kind: "contract_change",
    title: titleFromKind(payload.kind),
    reasoning: payload.reasoning,
    confidence: payload.confidence,
    suggestion: {
      before: payload.beforeSnapshot,
      after: payload.afterSnapshot,
    },
    generatedAt: proposal.submittedAt,
  }
}

/**
 * Human-readable title per semantic kind. Facility users see these as
 * card headers in the review panel — keep them short and concrete.
 */
function titleFromKind(kind: ContractChangeProposalKind): string {
  switch (kind) {
    case "pricing":
      return "Pricing change"
    case "term_addition":
      return "New term added"
    case "term_modification":
      return "Term modification"
    case "status_change":
      return "Contract status change"
    case "facility_scope":
      return "Facility scope change"
    case "other":
      return "Contract change"
  }
}
