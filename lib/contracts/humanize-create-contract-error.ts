// Extracted from lib/actions/contracts.ts during the F5 decomposition:
// a "use server" module may only export async functions, so this pure
// error-humanizer lives here. Bug #9 — surfaces the real create-contract
// failure reason instead of Next.js's redacted server-action digest.

export function humanizeCreateContractError(err: unknown): string {
  // Zod validation: include the path + first issue.
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues?: Array<{ path: unknown[]; message: string }> })
      .issues
    if (Array.isArray(issues) && issues.length > 0) {
      const first = issues[0]
      const path = Array.isArray(first.path) ? first.path.join(".") : "(root)"
      return `Contract validation failed at ${path}: ${first.message}`
    }
  }
  // Prisma known errors: keep the code so we can map common ones.
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code?: unknown }).code ?? "")
    const meta = (err as { meta?: { target?: unknown; field_name?: unknown } })
      .meta
    if (code === "P2002") {
      const target = Array.isArray(meta?.target)
        ? meta!.target.join(", ")
        : String(meta?.target ?? "")
      return `Contract creation failed: a row with the same ${target || "unique key"} already exists.`
    }
    if (code === "P2003") {
      const field = String(meta?.field_name ?? "")
      return `Contract creation failed: foreign-key violation${field ? ` on ${field}` : ""}. The referenced row likely no longer exists or was never created (vendor / category / facility).`
    }
    if (code === "P2025") {
      return "Contract creation failed: a referenced row (vendor / category / facility) does not exist."
    }
  }
  if (err instanceof Error) {
    return `Contract creation failed: ${err.message}`
  }
  return "Contract creation failed (unknown error). Check the server logs for the full stack."
}
