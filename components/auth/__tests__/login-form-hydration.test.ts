import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Guards the "have to click Sign in twice" fix.
 *
 * The login form is `method="post"` on purpose: if someone clicks before React
 * hydrates, the credentials go in the request BODY rather than a GET query
 * string, keeping the password out of URLs, access logs and history.
 *
 * The side effect is that a pre-hydration click performs a real native POST to
 * /login. Verified directly:
 *
 *     curl -X POST -d "email=...&password=..." /login   ->  200, login page
 *
 * Nothing signs in, the form comes back EMPTY, and the user clicks again — the
 * reported symptom exactly. Disabling the button until hydration makes that
 * early click a harmless no-op instead of destroying their input.
 *
 * This is asserted at source level deliberately: Playwright cannot cover it,
 * because it waits for actionability and therefore always clicks AFTER
 * hydration. A browser test here would pass whether or not the fix exists —
 * confirmed by reverting the fix and watching the e2e suite stay green.
 */

const FORM = join(
  import.meta.dirname,
  "..",
  "login-form.tsx",
)

describe("login form pre-hydration safety", () => {
  const src = readFileSync(FORM, "utf8")
  /**
   * Comment-stripped view, for assertions about what the code DOES.
   * The component explains at length why it avoids router.push/refresh, and a
   * naive regex over the raw source matches that prose — which is exactly how
   * the first draft of this file failed against correct code.
   */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n")

  it("tracks hydration", () => {
    expect(
      /const \[hydrated, setHydrated\] = useState\(false\)/.test(src),
      "the form no longer tracks hydration",
    ).toBe(true)
    expect(/useEffect\(\(\) => setHydrated\(true\), \[\]\)/.test(src)).toBe(true)
  })

  it("keeps the submit button disabled until hydrated", () => {
    const button = src.match(/<Button type="submit"[\s\S]{0,200}?>/)
    expect(button, "submit button not found").toBeTruthy()
    expect(
      /disabled=\{!hydrated \|\| isPending\}/.test(button![0]),
      "Sign in must be disabled until hydration. Without it a pre-hydration " +
        "click native-POSTs to /login, which returns the login page with an " +
        "empty form — the 'click Sign in twice' bug.",
    ).toBe(true)
  })

  it("still posts credentials in the body, not the query string", () => {
    // Removing method="post" would make a pre-hydration submit a GET, putting
    // the PASSWORD in the URL. The hydration guard is not a licence to drop it:
    // form-level attributes still apply if the button guard ever regresses.
    expect(
      /method="post"/.test(src),
      "method=\"post\" removed — a pre-hydration submit would put the " +
        "password in the query string, and thus in access logs and history.",
    ).toBe(true)
  })

  it("navigates hard after sign-in rather than router.push + refresh", () => {
    // router.refresh() refreshes the CURRENT route and clears the Client Cache
    // for the current route only, so after push() it targets /login — the route
    // being left — while racing the navigation. A full navigation also avoids
    // reusing a destination RSC payload prefetched while signed out.
    expect(code).toContain("window.location.assign(destination)")
    expect(
      /router\.push\(|router\.refresh\(/.test(code),
      "router.push/refresh reintroduced on the sign-in success path",
    ).toBe(false)
  })

  it("only follows same-origin callbackUrl paths", () => {
    expect(src).toContain("safeDestination")
    // Protocol-relative "//evil.com" must be rejected alongside absolute URLs.
    expect(src).toContain('startsWith("//")')
  })
})
