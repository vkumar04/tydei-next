import { z } from "zod"

export const sendConnectionInviteSchema = z.object({
  fromType: z.enum(["facility", "vendor"]),
  fromId: z.string().min(1),
  fromName: z.string().min(1),
  toEmail: z.string().email("Valid email is required"),
  toName: z.string().min(1, "Name is required"),
  message: z.string().optional(),
})

export type SendConnectionInviteInput = z.infer<typeof sendConnectionInviteSchema>
