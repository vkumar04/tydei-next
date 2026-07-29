/**
 * Scope tests for the notification bell (Charles 2026-07-28 revalidation).
 *
 * The bug: `getMyNotifications` read `take: 20` beside an UNCAPPED unread
 * count, and the dropdown had no pager, no "view all", and no total. A user
 * with 25 unread saw a badge reading 25 above a list of 20 — five
 * notifications, including an actionable "Submission needs revision",
 * unreachable from anywhere in the app. "Mark all read" then cleared them via
 * an unbounded updateMany, so they were silently discarded unseen.
 *
 * These are source-level assertions rather than DB round-trips because what
 * regressed is a *relationship between two numbers* and whether the UI states
 * it — exactly the thing a unit test over a mocked Prisma call would miss.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..", "..", "..")
const ACTION = join(ROOT, "lib/actions/notifications/in-app.ts")
const BELL = join(ROOT, "components/shared/notification-bell.tsx")

const actionSrc = () => readFileSync(ACTION, "utf8")
const bellSrc = () => readFileSync(BELL, "utf8")

describe("getMyNotifications", () => {
  it("returns an uncapped total beside the capped rows", () => {
    const src = actionSrc()
    // Two counts: unread (drives the badge) and total (lets the UI say what
    // it is not showing). Without the second there is nothing to compare the
    // page against, which is how the mismatch stayed invisible.
    expect(src).toMatch(/prisma\.notification\.count\(\{\s*where:\s*\{\s*userId\s*\}\s*\}\)/)
    expect(src).toContain("total")
  })

  it("caps the list with a named constant, not a bare literal", () => {
    const src = actionSrc()
    expect(src).toContain("take: NOTIFICATION_BELL_LIMIT")
    expect(src).not.toMatch(/take:\s*20\b/)
  })

  it("keeps the limit module-local — a 'use server' file may only export async functions", () => {
    // CLAUDE.md hard rule: `export const` in a "use server" module emits
    // registerServerReference(X, …), throws at module load, and kills every
    // action in the file. Dev works; prod does not.
    const src = actionSrc()
    expect(src).toMatch(/^const NOTIFICATION_BELL_LIMIT/m)
    expect(src).not.toMatch(/^export const NOTIFICATION_BELL_LIMIT/m)
  })

  it("ships the limit to the client in the payload instead of duplicating it", () => {
    expect(actionSrc()).toContain("limit: NOTIFICATION_BELL_LIMIT")
  })
})

describe("notification bell UI", () => {
  it("states the truncation when rows are hidden", () => {
    const src = bellSrc()
    expect(src).toContain("hidden")
    expect(src).toMatch(/Showing the \{rows\.length\} most recent of \{total\}/)
  })

  it("derives hidden from the server total, not from the page length alone", () => {
    expect(bellSrc()).toMatch(/Math\.max\(0,\s*total\s*-\s*rows\.length\)/)
  })

  it("names the count on the mark-all button", () => {
    // "Mark all read" clears every unread row the user owns, including ones
    // this dropdown never displayed. That is correct for "all" — but it has
    // to be stated, or the button discards notifications unseen.
    expect(bellSrc()).toMatch(/Mark all \{unreadCount\} read/)
  })

  it("scrolls rather than clipping the longer list", () => {
    expect(bellSrc()).toMatch(/overflow-y-auto/)
  })

  it("preserves untouched fields in both optimistic updates", () => {
    // Rebuilding the cache object literally drops `total`/`limit`, so the
    // truncation footer would blink out on every click and reappear on the
    // next poll. Both onMutate handlers must spread `prev`.
    const src = bellSrc()
    const spreads = src.match(/setQueryData<NotificationsData>\(NOTIF_KEY,\s*\{\s*\.\.\.prev/g)
    expect(spreads).toHaveLength(2)
  })
})
