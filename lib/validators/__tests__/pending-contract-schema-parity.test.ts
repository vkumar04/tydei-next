/**
 * Schema-parity guard for PendingContract — sibling of
 * contract-schema-parity.test.ts. Same pattern, same drift class.
 *
 * The vendor-mirror submission flow (lib/actions/pending-contracts.ts)
 * has a long history of fields being added to the validator but not
 * threaded through createPendingContract / updatePendingContract /
 * approvePendingContract write paths — Charles 2026-04-25 vendor-mirror
 * Phase 2 was specifically named for this fix class. The test catches
 * future regressions of the same shape automatically.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(__dirname, "..", "..", "..")

function readFile(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8")
}

function readSchemaKeys(): string[] {
  const src = readFile("lib/validators/pending-contracts.ts")
  const start = src.indexOf("export const createPendingContractSchema = z.object({")
  if (start < 0) {
    throw new Error(
      "createPendingContractSchema declaration not found — parity test needs updating",
    )
  }
  const after = src.slice(start)
  const open = after.indexOf("{")
  let depth = 1
  let i = open + 1
  for (; i < after.length && depth > 0; i++) {
    if (after[i] === "{") depth++
    else if (after[i] === "}") depth--
  }
  const body = after.slice(open + 1, i - 1)
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
  if (nest === 0) {
    const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*z\./)
    if (m) keys.push(m[1])
  }
  return keys
}

describe("createPendingContractSchema ↔ pending-contracts action parity", () => {
  // Fields the action legitimately doesn't write through the
  // create-from-vendor path — auth-derived (vendor identity), join-table-
  // managed, or downstream-only (consumed by approvePendingContract
  // when the pending becomes a real Contract).
  const ALLOWLIST_NOT_WRITTEN = new Set([
    "vendorId", // overridden from session vendor; never trusts client
    "vendorName", // ditto
    "facilityName", // resolved from Facility row
  ])

  it("every createPendingContractSchema field is referenced in pending-contracts action", () => {
    const keys = readSchemaKeys()
    expect(keys.length).toBeGreaterThan(15)

    const actionSrc = readFile("lib/actions/pending-contracts.ts")

    const missing: string[] = []
    for (const key of keys) {
      if (ALLOWLIST_NOT_WRITTEN.has(key)) continue
      const referenced =
        actionSrc.includes(`data.${key}`) ||
        actionSrc.includes(`updateData.${key}`) ||
        actionSrc.includes(`"${key}"`) ||
        new RegExp(`\\b${key}\\s*:`).test(actionSrc)
      if (!referenced) missing.push(key)
    }

    if (missing.length > 0) {
      throw new Error(
        `createPendingContractSchema has ${missing.length} field(s) NOT referenced in lib/actions/pending-contracts.ts:\n  ${missing.join(", ")}\n\nEither (a) wire the field through create + update paths, or (b) add it to ALLOWLIST_NOT_WRITTEN with a one-line comment explaining why it's intentionally out-of-band.`,
      )
    }
    expect(missing).toEqual([])
  })

  it("ALLOWLIST_NOT_WRITTEN entries still exist in the schema", () => {
    const keys = readSchemaKeys()
    const stale = [...ALLOWLIST_NOT_WRITTEN].filter((k) => !keys.includes(k))
    if (stale.length > 0) {
      throw new Error(
        `ALLOWLIST_NOT_WRITTEN has ${stale.length} stale entries: ${stale.join(", ")}. Remove them.`,
      )
    }
    expect(stale).toEqual([])
  })
})
