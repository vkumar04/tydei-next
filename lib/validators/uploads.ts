import { z } from "zod"

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

export const uploadRequestSchema = z.object({
  fileName: z.string().min(1, "File name is required"),
  contentType: z.string().min(1, "Content type is required"),
  folder: z.enum(["contracts", "pricing", "cog", "invoices"]),
  size: z
    .number()
    .int()
    .positive("The file is empty")
    .max(MAX_UPLOAD_BYTES, "Files must be 100 MB or smaller"),
})

export type UploadRequest = z.infer<typeof uploadRequestSchema>
