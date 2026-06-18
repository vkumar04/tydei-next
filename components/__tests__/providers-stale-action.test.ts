import { describe, it, expect } from "vitest"
import { isStaleActionError } from "../providers"

describe("isStaleActionError", () => {
  it("matches the current Next.js wording (failed to find / older or newer deployment)", () => {
    expect(
      isStaleActionError(
        new Error(
          'Failed to find Server Action "40e210fc787f30839a749bbcb8a85f612174f54423". This request might be from an older or newer deployment.',
        ),
      ),
    ).toBe(true)
  })

  it("matches the legacy wording (was not found on the server)", () => {
    expect(
      isStaleActionError(
        new Error("Server Action 'abc123' was not found on the server."),
      ),
    ).toBe(true)
  })

  it("matches on the docs slug alone", () => {
    expect(
      isStaleActionError(
        "Read more: https://nextjs.org/docs/messages/failed-to-find-server-action",
      ),
    ).toBe(true)
  })

  it("matches a bare string reason (unhandledrejection path)", () => {
    expect(
      isStaleActionError(
        "Failed to find Server Action \"x\". This request might be from an older or newer deployment.",
      ),
    ).toBe(true)
  })

  it("ignores unrelated errors", () => {
    expect(isStaleActionError(new Error("Network request failed"))).toBe(false)
    expect(isStaleActionError(new Error("Contract not found."))).toBe(false)
    expect(isStaleActionError(null)).toBe(false)
    expect(isStaleActionError(undefined)).toBe(false)
  })
})
