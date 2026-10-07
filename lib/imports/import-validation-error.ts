import { ZodError } from "zod"

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImportValidationError"
  }
}

export function importErrorMessage(error: unknown): string | null {
  if (error instanceof ImportValidationError) return error.message
  if (error instanceof ZodError) {
    return error.issues.map((i) => i.message).join("; ") || "The import details are invalid."
  }
  return null
}
