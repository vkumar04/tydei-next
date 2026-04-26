import { z } from "zod"

/**
 * Charles audit Iter4-B2: `fromType` / `fromId` / `fromName` were
 * removed from the wire schema after the server started deriving
 * them from the caller's session in `sendConnectionInvite`. Keeping
 * them on the client would be a phishing primitive (Medtronic could
 * label its invite as coming from "Lighthouse Surgical Center") and
 * is now dead input — the server ignores them.
 */
export const sendConnectionInviteSchema = z.object({
  toEmail: z.string().email("Valid email is required"),
  toName: z.string().min(1, "Name is required"),
  message: z.string().optional(),
})

export type SendConnectionInviteInput = z.infer<typeof sendConnectionInviteSchema>
