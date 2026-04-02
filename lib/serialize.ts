import { Decimal } from "@prisma/client/runtime/client"

/**
 * Recursively converts Prisma Decimal/BigInt/Date values to JSON-safe types
 * so data can pass from Server Actions to Client Components.
 */
export function serialize<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "bigint") return Number(obj) as T
  if (obj instanceof Decimal) return Number(obj) as T
  if (obj instanceof Date) return obj.toISOString() as T
  if (Array.isArray(obj)) return obj.map(serialize) as T
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = serialize((obj as Record<string, unknown>)[key])
      }
    }
    return result as T
  }
  return obj
}
