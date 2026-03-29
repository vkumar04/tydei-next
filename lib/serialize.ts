import { Decimal } from "@prisma/client/runtime/client"

/**
 * Recursively converts Prisma Decimal objects to plain numbers
 * and Date objects to ISO strings so data can pass to Client Components.
 */
export function serialize<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (obj instanceof Decimal) return Number(obj) as T
  if (obj instanceof Date) return obj.toISOString() as T
  if (Array.isArray(obj)) return obj.map(serialize) as T
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = serialize(value)
    }
    return result as T
  }
  return obj
}
