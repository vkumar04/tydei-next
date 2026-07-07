import { z } from "zod"

/**
 * Validation for a persisted Deal-Scorer construct — one row of the
 * "Proposed Deal — by product" table, written into a proposal's
 * `pricingData.dealConstructs` JSON column (CLAUDE.md: validate JSON-column
 * writes).
 *
 * Lives in its OWN module (not the `"use server"` action file) so it can be
 * exported and unit-tested: a `"use server"` file may only export async
 * functions, so a schema const declared there can't be shared or guarded
 * (Vick 2026-07-06 "use next and react best practices"). The write side
 * (`runAnalysis` in `lib/actions/vendor-prospective.ts`) imports this; the
 * read side (`getVendorProposalDetail` / `getVendorProposals` in
 * `lib/actions/prospective.ts`) hand-parses the same shape tolerantly.
 *
 * `category` is OPTIONAL and additive: a benchmark file WITHOUT a Category
 * column (Charles 2026-07-06 "categories not coming through") persists no
 * category, and proposals saved before this field simply read back
 * `undefined` — never a parse failure.
 */
export const dealConstructSchema = z.object({
  benchmarkId: z.string().nullable(),
  productName: z.string().max(120),
  category: z.string().max(120).optional(),
  current: z.number(),
  floor: z.number(),
  target: z.number(),
  ask: z.number(),
  annualVolume: z.number(),
  rebatePercent: z.number(),
})

export type DealConstructInput = z.infer<typeof dealConstructSchema>
