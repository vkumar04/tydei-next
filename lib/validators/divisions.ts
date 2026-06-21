import { z } from "zod"

/**
 * Shared shape for a single vendor division (name, code, optional
 * categories). Used by both the division-CRUD action
 * (`lib/actions/vendor-divisions.ts`) and the super-user division-member
 * action (`lib/actions/division-members.ts`) so the two cannot drift.
 */
export const divisionInputSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
  categories: z.array(z.string()).optional().default([]),
})

export type DivisionInput = z.input<typeof divisionInputSchema>
