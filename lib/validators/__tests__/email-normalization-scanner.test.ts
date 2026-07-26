import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import {
  emailListSchema,
  emailSchema,
  normalizeEmail,
  optionalEmailSchema,
} from "@/lib/validators/email"

/**
 * Every email entering the system must be normalized at the validation
 * boundary.
 *
 * Why this exists: on 2026-07-26 an admin-created account stored
 * `Vick.Kumar19@gmail.com` verbatim. better-auth's `findUserByEmail`
 * lowercases its input and matches exactly against a plain `text` column, so
 * the row was invisible to sign-in AND to password reset — which fails
 * silently by design so as not to leak account existence. The account held an
 * admin role and could not be used or recovered by any route.
 *
 * A raw `z.email()` anywhere in lib/validators/ reintroduces that hazard, and
 * nothing else would catch it: the code compiles, the form submits, the row
 * writes. It only surfaces when a real person can't log in.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..")
const VALIDATORS = join(ROOT, "lib", "validators")
const CANONICAL = join(VALIDATORS, "email.ts")

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (entry.endsWith(".ts")) yield full
  }
}

describe("email normalization", () => {
  it("no validator declares a raw z.email() outside the canonical module", () => {
    const offenders: string[] = []
    for (const file of walk(VALIDATORS)) {
      if (file === CANONICAL) continue
      const src = readFileSync(file, "utf8")
      src.split("\n").forEach((line, i) => {
        // `z.email(` or the legacy `z.string().email(` — both skip
        // normalization and store whatever the user typed.
        if (/z\.email\(|z\.string\(\)[\s\S]{0,40}?\.email\(/.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(
      offenders,
      "Use emailSchema() / optionalEmailSchema() from lib/validators/email.ts.\n" +
        "A raw z.email() stores the address as typed, and a mixed-case row is " +
        "invisible to every better-auth lookup — including password reset, " +
        "which fails silently.\nOffenders:\n" +
        offenders.join("\n"),
    ).toEqual([])
  })

  it("normalizes case and surrounding whitespace", () => {
    expect(normalizeEmail("  Vick.Kumar19@Gmail.com  ")).toBe(
      "vick.kumar19@gmail.com",
    )
    expect(emailSchema().parse("  Vick.Kumar19@Gmail.com  ")).toBe(
      "vick.kumar19@gmail.com",
    )
  })

  it("trims BEFORE validating, so a pasted address with a space still passes", () => {
    // z.email().trim().toLowerCase() validates first and would reject this
    // with a baffling "Invalid email". The canonical schema pipes the other
    // way round on purpose.
    expect(emailSchema().safeParse(" a@b.com ").success).toBe(true)
  })

  it("still rejects genuinely invalid addresses", () => {
    for (const bad of ["not-an-email", "a@", "@b.com", ""]) {
      expect(emailSchema().safeParse(bad).success, `${bad} should fail`).toBe(false)
    }
  })

  it("optional schema accepts empty string and undefined, normalizes the rest", () => {
    const s = optionalEmailSchema()
    expect(s.parse(undefined)).toBeUndefined()
    expect(s.parse("")).toBe("")
    expect(s.parse("  Foo@Bar.COM ")).toBe("foo@bar.com")
    expect(s.safeParse("nope").success).toBe(false)
  })

  it("list schema normalizes every recipient", () => {
    expect(emailListSchema().parse([" A@B.com", "C@D.COM "])).toEqual([
      "a@b.com",
      "c@d.com",
    ])
  })
})
