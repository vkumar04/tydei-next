import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * A `try` that wraps a `requireX()` guard must not swallow `redirect()`.
 *
 * Why this exists: `redirect()` works by THROWING a NEXT_REDIRECT control-flow
 * exception, and `requireRole()` uses it to bounce a caller whose role doesn't
 * match. `lib/actions/notifications/in-app.ts` had:
 *
 *     try   { return (await requireFacility()).user.id }
 *     catch { return (await requireVendor()).user.id }
 *
 * For an admin, requireFacility() threw a redirect, the catch SWALLOWED it,
 * requireVendor() threw another, and that one escaped — so every call became a
 * 303 to /admin/dashboard. <NotificationBell> renders in every portal shell, so
 * it fired on every admin page: invisible on /admin/dashboard (it redirected to
 * itself) and, on /admin/users, it bounced the operator back to the dashboard
 * a few seconds after arrival. Reported 2026-07-26 as "clicking Users keeps
 * going back to the dashboard".
 *
 * Nothing else catches this: it typechecks, unit tests pass, and even a browser
 * test passes if it asserts too early — the bounce lands seconds after the page
 * renders.
 *
 * A catch is fine when it re-throws the original error, or calls Next's
 * `unstable_rethrow(err)` first. It is NOT fine when it throws a NEW error or
 * returns a fallback, because that converts an intended navigation into
 * something else.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..")
const SCAN = [join(ROOT, "lib"), join(ROOT, "app")]
const SKIP = new Set(["generated", "__tests__", "node_modules", ".next"])

const GUARDS =
  /\b(requireFacility|requireVendor|requireAdmin|requireRole|requireAuth|requireCan|requireCanMutate)\s*\(/

/**
 * Blank out comments while PRESERVING length, so offsets computed on the
 * stripped text still index correctly into the raw source. Prose can then
 * never create a false match, while an opt-out marker written in a comment is
 * still findable in the raw text at the same position.
 */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
}

function* walk(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) yield full
  }
}

/**
 * Brace-matched `try { ... } catch (...) { ... }` pairs.
 *
 * The try BODY is what matters: a guard merely sitting near a catch is not a
 * hazard. An earlier draft used a fixed look-back window and flagged catches
 * around a Stripe call, a JSON.parse, and a telemetry write — none of which
 * wrap a guard at all.
 */
function tryCatchPairs(src: string): {
  tryBody: string
  catchBody: string
  catchStart: number
  catchEnd: number
  line: number
}[] {
  const out: {
    tryBody: string
    catchBody: string
    catchStart: number
    catchEnd: number
    line: number
  }[] = []
  const re = /\btry\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1
    let i = m.index + m[0].length
    const tryStart = i
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++
      else if (src[i] === "}") depth--
      i++
    }
    const tryBody = src.slice(tryStart, i - 1)

    const rest = src.slice(i)
    const cm = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(rest)
    if (!cm) continue
    let d2 = 1
    let j = i + cm[0].length
    const catchStart = j
    while (j < src.length && d2 > 0) {
      if (src[j] === "{") d2++
      else if (src[j] === "}") d2--
      j++
    }
    out.push({
      tryBody,
      catchBody: src.slice(catchStart, j - 1),
      catchStart,
      catchEnd: j - 1,
      line: src.slice(0, m.index).split("\n").length,
    })
  }
  return out
}

describe("redirect() is never swallowed by a catch", () => {
  it("no try/catch around a requireX() guard discards NEXT_REDIRECT", () => {
    const offenders: string[] = []

    for (const dir of SCAN) {
      for (const file of walk(dir)) {
        // Strip comments first. This file's own docblock quotes the broken
        // pattern verbatim, and an earlier draft flagged that prose as an
        // offender — the same trap that bit the login-form guard test.
        const raw = readFileSync(file, "utf8")
        const src = stripComments(raw)
        if (!GUARDS.test(src) || !src.includes("catch")) continue

        for (const {
          tryBody,
          catchBody,
          catchStart,
          catchEnd,
          line,
        } of tryCatchPairs(src)) {
          // Only a guard INSIDE the try can have its redirect swallowed here.
          if (!GUARDS.test(tryBody)) continue

          const rethrowsOriginal = /throw\s+(err|error|e)\b\s*;?/.test(catchBody)
          const usesRethrowHelper = /unstable_rethrow\s*\(/.test(catchBody)
          // Explicit opt-out, matching auth-scope-scanner-skip elsewhere. The
          // marker must sit in the catch body and say WHY.
          const skipped = /redirect-swallow-skip/.test(
            raw.slice(catchStart, catchEnd),
          )
          if (rethrowsOriginal || usesRethrowHelper || skipped) continue

          offenders.push(`${relative(ROOT, file)}:${line}`)
        }
      }
    }

    expect(
      offenders,
      "These catch blocks sit around a requireX() guard and neither re-throw " +
        "the original error nor call unstable_rethrow(err) first, so they " +
        "swallow redirect()'s NEXT_REDIRECT and turn an intended navigation " +
        "into a silent wrong result.\nOffenders:\n" + offenders.join("\n"),
    ).toEqual([])
  })
})
