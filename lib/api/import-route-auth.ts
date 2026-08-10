import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { AccessDeniedError } from "@/lib/auth/access-error"

/**
 * Portal + write-tier gate for upload Route Handlers.
 *
 * Why not `requireFacility()` / `requireVendor()`: those are page-level gates.
 * `denyingARender()` keys off the `next-action` header, which a Route Handler
 * never carries, so they take the `redirect()` branch — a fetch() upload would
 * silently follow a 303 to /login, get HTML with status 200, and blow up on
 * `res.json()` instead of showing the real reason. Route handlers want a JSON
 * status, so this mirrors the direct role lookup in
 * app/api/alerts/unread-count/route.ts. `requireCanMutate()` throws (it never
 * redirects) and is safe to call directly.
 *
 * The ingestion Server Actions re-check both — this is the early gate that
 * keeps unauthorized callers from driving a full server-side file parse, not
 * the only one.
 *
 * @returns a JSON error response to return early, or `null` when allowed.
 */
export async function denyUnlessPortalWriter(
  userId: string,
  portal: "facility" | "vendor",
): Promise<NextResponse | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  if (user?.role !== portal) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  // Role alone is NOT the gate requireFacility/requireVendor apply — they also
  // require the caller's organization to actually link to a Facility/Vendor.
  // Skipping that admits the TENANTLESS population: `User.role` defaults to
  // "facility" (prisma/schema.prisma) and self-signup never sets it, so a user
  // who only ever joined a vendor org still carries role="facility" and would
  // otherwise drive a full parse — and, on /api/import-cog, an unmetered
  // Anthropic column-mapping call — against a portal they cannot use.
  const member = await prisma.member.findFirst({
    where: {
      userId,
      organization:
        portal === "facility"
          ? { facility: { isNot: null } }
          : { vendor: { isNot: null } },
    },
    select: { id: true },
  })
  if (!member) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }
  try {
    await requireCanMutate()
  } catch (err) {
    // redirect-swallow-skip: requireCanMutate THROWS AccessDeniedError and
    // never redirects (documented in lib/actions/auth-permissions.ts) — and a
    // NEXT_REDIRECT escaping a Route Handler is exactly the 303-to-/login
    // failure this helper exists to prevent. Only an access denial becomes a
    // 403; anything else (a DB outage, a bug) propagates rather than
    // masquerading as an authorization result.
    if (!(err instanceof AccessDeniedError)) throw err
    return NextResponse.json(
      { error: "Your access is read-only" },
      { status: 403 },
    )
  }
  return null
}
