/**
 * Strategic-direction Plan #2 parity guard.
 *
 * Every key in `createContractBase` must also be threaded through
 * `updateContract` action's data spread. The PO-bug class "field
 * collected by the form but lost on save" (W1.Y-A regression: tie-in
 * capital fields silently dropped because the action's spread didn't
 * whitelist them; spendMax bug class) all trace to drift between
 * schema keys and the action's write path.
 *
 * This test reads the source files and asserts every schema key
 * appears in the action body. A new field added to the schema MUST
 * also be referenced in the update action; otherwise build fails
 * before the field can ship to prod.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(__dirname, "..", "..", "..")

function readFile(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8")
}

/**
 * Parse the createContractBase z.object literal from contracts.ts
 * and pull out the keys. We don't want to import + introspect the
 * Zod schema at runtime (that'd require evaluating server-action
 * imports in a test); a string-level scan of the field declarations
 * is enough since the format is stable.
 */
function readSchemaKeys(): string[] {
  const src = readFile("lib/validators/contracts.ts")
  const start = src.indexOf("const createContractBase = z.object({")
  if (start < 0) {
    throw new Error(
      "createContractBase declaration not found — schema-parity test needs updating",
    )
  }
  // Match up to the closing `})` at the same indent. Pragmatic balance
  // count starting after the opening brace.
  const after = src.slice(start)
  const open = after.indexOf("{")
  let depth = 1
  let i = open + 1
  for (; i < after.length && depth > 0; i++) {
    if (after[i] === "{") depth++
    else if (after[i] === "}") depth--
  }
  const body = after.slice(open + 1, i - 1)

  // Find lines like `  fieldName: z.<thing>` at the OUTERMOST nesting
  // (depth 1 within the body).
  const keys: string[] = []
  let nest = 0
  let line = ""
  for (const ch of body) {
    if (ch === "{") nest++
    else if (ch === "}") nest--
    if (ch === "\n") {
      if (nest === 0) {
        const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*z\./)
        if (m) keys.push(m[1])
      }
      line = ""
    } else {
      line += ch
    }
  }
  // Catch the last line if no trailing newline.
  if (nest === 0) {
    const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*z\./)
    if (m) keys.push(m[1])
  }
  return keys
}

describe("createContractBase ↔ updateContract action parity", () => {
  // Fields the action legitimately doesn't write through:
  //   - facilityIds / additionalFacilityIds: handled via the
  //     ContractFacility join table, not Contract.facilityIds[]
  //     directly. Action wires these via separate logic.
  //   - facilityId: similar (single-facility contracts use the
  //     primary; multi-facility goes through the join).
  //   - categoryIds: managed via productCategory + ContractCategory
  //     join, not the array verbatim.
  //   - idempotencyKey: dedup key, not persisted.
  //   - isMultiFacility / isGrouped: derived flags, not stored as-is.
  const ALLOWLIST_NOT_WRITTEN = new Set([
    "facilityIds",
    "additionalFacilityIds",
    "facilityId",
    "categoryIds",
    "idempotencyKey",
    "isMultiFacility",
    "isGrouped",
    "productCategoryId",
  ])

  it("every createContractBase field is referenced in updateContract", () => {
    const keys = readSchemaKeys()
    expect(keys.length).toBeGreaterThan(20) // sanity: we found the schema

    const actionSrc = readFile("lib/actions/contracts.ts")

    const missing: string[] = []
    for (const key of keys) {
      if (ALLOWLIST_NOT_WRITTEN.has(key)) continue
      // The action threads fields through patterns like:
      //   data.<key>           (spread/conditional)
      //   updateData.<key>     (mutable build)
      //   "<key>"              (Prisma data: { ... } literal)
      //   <key>:                (object key)
      // A field missing from ALL of those is a drift hazard.
      const referenced =
        actionSrc.includes(`data.${key}`) ||
        actionSrc.includes(`updateData.${key}`) ||
        actionSrc.includes(`"${key}"`) ||
        new RegExp(`\\b${key}\\s*:`).test(actionSrc)
      if (!referenced) missing.push(key)
    }

    if (missing.length > 0) {
      throw new Error(
        `createContractBase has ${missing.length} field(s) NOT referenced in lib/actions/contracts.ts:\n  ${missing.join(", ")}\n\nEither (a) wire the field through the create + update action paths, or (b) add it to ALLOWLIST_NOT_WRITTEN with a one-line comment explaining why it's intentionally out-of-band (e.g. join-table managed).`,
      )
    }
    expect(missing).toEqual([])
  })

  it("ALLOWLIST_NOT_WRITTEN entries still exist in the schema", () => {
    const keys = readSchemaKeys()
    const stale = [...ALLOWLIST_NOT_WRITTEN].filter((k) => !keys.includes(k))
    if (stale.length > 0) {
      throw new Error(
        `ALLOWLIST_NOT_WRITTEN has ${stale.length} stale entries (no longer in createContractBase): ${stale.join(", ")}. Remove them.`,
      )
    }
    expect(stale).toEqual([])
  })
})
