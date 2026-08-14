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
 * leftmost token is client-controlled behind an appending proxy) and Railway
 * always adds at least one internal hop.
 *
 * Railway strips client-supplied X-Forwarded-For at its edge and its internal
 * proxy hops are always in 100.0.0.0/8, so declaring that range as a trusted
 * proxy makes the leftmost surviving token the true client.
 */

const TRUSTED = ["100.0.0.0/8"]

describe("client IP resolution behind Railway's proxy", () => {
  it("resolves the client from a Railway-shaped chain", () => {
    expect(
      getIPFromHeader("203.0.113.5, 100.64.1.2", { trustedProxies: TRUSTED }),
    ).toBe("203.0.113.5")
    // More than one internal hop is normal once the CDN layer is in play.
    expect(
      getIPFromHeader("203.0.113.5, 100.64.1.2, 100.90.3.4", {
        trustedProxies: TRUSTED,
      }),
    ).toBe("203.0.113.5")
  })

  it("still resolves a single-entry chain", () => {
    expect(
      getIPFromHeader("203.0.113.5", { trustedProxies: TRUSTED }),
    ).toBe("203.0.113.5")
  })

  it("ignores a spoofed leftmost token rather than trusting it", () => {
    // Railway strips client-supplied XFF, so this should never arrive — but if
    // it ever leaked through, the attacker's value must NOT win. Walking right
    // to left past the trusted hops lands on the address Railway appended.
    expect(
      getIPFromHeader("9.9.9.9, 203.0.113.5, 100.64.1.2", {
        trustedProxies: TRUSTED,
      }),
    ).toBe("203.0.113.5")
  })

  it("REGRESSION: without trustedProxies a Railway chain yields no IP at all", () => {
    // This is the production bug. If someone removes the config, this is the
    // behaviour that returns — and the only symptom is a one-time log line.
    expect(getIPFromHeader("203.0.113.5, 100.64.1.2", {})).toBeNull()
    expect(
      getIPFromHeader("203.0.113.5, 100.64.1.2, 100.90.3.4", {}),
    ).toBeNull()
  })

  it("auth-server declares the Railway proxy range", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/auth-server.ts"),
      "utf8",
    )
    // Strip line comments so the rationale prose below the config (which names
    // ipAddressHeaders in order to warn against it) doesn't match.
    const code = source
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n")

    expect(
      code,
      "advanced.ipAddress.trustedProxies must stay configured — without it the rate limiter buckets every user together",
    ).toMatch(/trustedProxies:\s*\[\s*"100\.0\.0\.0\/8"\s*\]/)

    // x-real-ip is the header better-auth's docs reach for first, but Railway's
    // CDN sets it to the POP address rather than the client, which reintroduces
    // the shared-bucket bug. Guard against a well-meaning "simplification".
    expect(
      code,
      "do not switch to ipAddressHeaders:['x-real-ip'] — Railway's CDN sets it to the edge IP, not the client",
    ).not.toMatch(/ipAddressHeaders/)
  })
})
