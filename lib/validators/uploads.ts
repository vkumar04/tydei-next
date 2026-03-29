import { z } from "zod"

export const uploadRequestSchema = z.object({
  fileName: z.string().min(1, "File name is required"),
  contentType: z.string().min(1, "Content type is required"),
  folder: z.enum(["contracts", "pricing", "cog", "invoices"]),
})

export type UploadRequest = z.infer<typeof uploadRequestSchema>
