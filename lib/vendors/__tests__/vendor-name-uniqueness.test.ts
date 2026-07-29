import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

/**
 * `Vendor.name` must stay unique.
 *
 * Charles 2026-07-28: the catalog had no uniqueness at all, so two rows could
 * carry the identical name. That is not theoretical — Settings → Vendors showed
 * only the first 100 of 200 vendors with "Add Vendor" directly above the
 * truncated table, so a user who scrolled for Stryker (alphabetical rank 176),
 * failed to find it, and clicked Add minted a second Stryker. Every COG / PO /
 * invoice row then split across the two, which is exactly the fragmentation the
 * alias system exists to undo.
 *
 * A schema assertion rather than a DB round trip: this suite runs without a
 * database, and the point is that the CONSTRAINT is declared — if someone drops
 * `@unique` the guarantee is gone regardless of what any live DB happens to hold.
 */
const SCHEMA = readFileSync(
  path.resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8",
)

function vendorModel(): string {
  const start = SCHEMA.indexOf("model Vendor {")
  expect(start).toBeGreaterThan(-1)
  return SCHEMA.slice(start, SCHEMA.indexOf("\n}", start))
}

describe("Vendor.name uniqueness", () => {
  it("is declared @unique in the schema", () => {
    const nameLine = vendorModel()
      .split("\n")
      .find((l) => /^\s*name\s+String/.test(l))
    expect(nameLine).toBeDefined()
    expect(nameLine).toMatch(/@unique/)
  })

  it("has a committed migration creating the index", () => {
    const dir = path.resolve(process.cwd(), "prisma/migrations")
    const sql = readdirSync(dir)
      .filter((d) => d.includes("vendor_name_unique"))
      .map((d) => readFileSync(path.join(dir, d, "migration.sql"), "utf8"))
      .join("\n")
    expect(sql).toMatch(/CREATE UNIQUE INDEX .*vendor_name_key.* ON "vendor"\("name"\)/)
  })

  it("is a plain unique, not a functional index Prisma cannot track", () => {
    // Prisma docs: "Indexes using a function ... are not yet supported by Prisma
    // ORM" and are invisible to `db pull` — a raw lower(name) index would read as
    // drift and a later `migrate dev` could drop it silently. Case variants are
    // caught above the DB instead (createVendor's case-insensitive check across
    // name AND displayName, and resolve.ts Pass 1). Pinned so nobody "upgrades"
    // this into an untracked functional index.
    const dir = path.resolve(process.cwd(), "prisma/migrations")
    // Strip `--` comments first: the migration's own note EXPLAINS why lower()
    // was rejected, and matching that prose would fail for the wrong reason.
    const statements = readdirSync(dir)
      .filter((d) => d.includes("vendor_name_unique"))
      .map((d) => readFileSync(path.join(dir, d, "migration.sql"), "utf8"))
      .join("\n")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n")
    expect(statements).not.toMatch(/lower\s*\(/i)
    expect(statements).toMatch(/CREATE UNIQUE INDEX/)
  })
})
