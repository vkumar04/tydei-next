import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getIPFromHeader } from "@better-auth/core/utils/ip"

/**
 * The rate limiter needs a client IP. Without one, better-auth keys every
 * request as the literal "no-trusted-ip|<path>" — ONE bucket shared by every
 * user of every tenant. With our config that caps /sign-in/email at 10 per
 * minute for the whole application and every other auth path at 100.
 *
 * That was live in production on 2026-08-14; the deploy logged
 *   "Rate limiting could not determine a client IP and is falling back to a
 *    single shared per-path bucket"
 * because better-auth refuses to trust a multi-hop x-forwarded-for chain (the
 * leftmost token is client-controlled behind an APPENDING proxy) and Railway
 * always adds an edge hop.
 *
 * Measured shape of a real production request:
 *   x-forwarded-for: 173.92.72.77, 152.233.30.102
 *   x-real-ip:       173.92.72.77
 *
 * So `x-real-ip` carries the client on its own. Railway overwrites both
 * headers at the edge — replaying the request with forged values had them
 * discarded — so a single-header resolve is both correct and unspoofable here.
 */

const REAL_IP = "173.92.72.77"
const EDGE_IP = "152.233.30.102"

describe("client IP resolution behind Railway's proxy", () => {
  it("resolves the client from the x-real-ip header alone", () => {
    // No trustedProxies needed: a one-entry header is trusted as-is.
    expect(getIPFromHeader(REAL_IP, {})).toBe(REAL_IP)
  })

  it("REGRESSION: the real x-forwarded-for chain yields NO ip by default", () => {
    // This is the production bug, reproduced with the exact measured header.
    expect(getIPFromHeader(`${REAL_IP}, ${EDGE_IP}`, {})).toBeNull()
  })

  it("a guessed trusted-proxy CIDR resolves the EDGE, not the client", () => {
    // Why this fix is not `trustedProxies: ["100.0.0.0/8"]`, which Railway's
    // community docs suggest: the measured hop is 152.233.x, so the walk
    // right-to-left stops on the edge address and every user behind that POP
    // shares a bucket. Silently wrong is worse than loudly broken.
    expect(
      getIPFromHeader(`${REAL_IP}, ${EDGE_IP}`, {
        trustedProxies: ["100.0.0.0/8"],
      }),
    ).toBe(EDGE_IP)
  })

  it("normalizes IPv6 to its /64 subnet", () => {
    // Default ipv6Subnet is 64 — one bucket per allocation, so a client can't
    // rotate through 2^64 addresses to bypass the limit.
    expect(getIPFromHeader("2001:db8::1", {})).toBe(
      "2001:0db8:0000:0000:0000:0000:0000:0000",
    )
  })

  it("auth-server resolves from x-real-ip and not a guessed proxy range", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/auth-server.ts"),
      "utf8",
    )
    // Strip line comments: the rationale prose names both options in order to
    // explain the choice, and would otherwise match either way.
    const code = source
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n")

    expect(
      code,
      "advanced.ipAddress.ipAddressHeaders must stay configured — without it the rate limiter buckets every user together",
    ).toMatch(/ipAddressHeaders:\s*\[\s*"x-real-ip"\s*\]/)

    expect(
      code,
      "do not switch to trustedProxies — Railway's edge hop is not in the CIDR their docs cite, so it would resolve the edge as the client",
    ).not.toMatch(/trustedProxies/)
  })
})
