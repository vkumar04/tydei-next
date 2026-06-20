/**
 * Demo login accounts + the render gate. SERVER-ONLY — import this only from
 * the login page (a server component). It is deliberately NOT imported by any
 * client component, so when demo logins are disabled the credentials are never
 * sent to the browser at all (the server simply doesn't pass them down).
 *
 * Toggle with the `SHOW_DEMO_LOGINS` env var (NOT a NEXT_PUBLIC var, so the
 * flag is evaluated server-side and can't be flipped from the client). Set it
 * to "true" to render the buttons; unset / anything else hides them. Near
 * launch: set SHOW_DEMO_LOGINS=false AND remove the demo users from the DB.
 *
 * Accounts are seeded by `scripts/seed-demo-roles.ts` (+ `prisma/seeds/users.ts`).
 */

export interface DemoAccount {
  /** Grouping for the login UI: which side / portal. */
  group: "Facility" | "Vendor" | "Admin"
  /** Access tier or portal label shown on the button. */
  label: string
  email: string
  password: string
}

export const DEMO_LOGIN_ACCOUNTS: readonly DemoAccount[] = [
  { group: "Facility", label: "Super", email: "demo-facility@tydei.com", password: "demo-facility-2024" },
  { group: "Facility", label: "Advanced", email: "demo-facility-adv@tydei.com", password: "demo-2024" },
  { group: "Facility", label: "User", email: "demo-facility-user@tydei.com", password: "demo-2024" },
  { group: "Vendor", label: "Super", email: "demo-vendor@tydei.com", password: "demo-vendor-2024" },
  { group: "Vendor", label: "Advanced", email: "demo-vendor-adv@tydei.com", password: "demo-2024" },
  { group: "Vendor", label: "User", email: "demo-vendor-user@tydei.com", password: "demo-2024" },
  { group: "Admin", label: "Operator / Super Admin", email: "demo-admin@tydei.com", password: "demo-admin-2024" },
]

/** Server-side gate for whether the demo login buttons should render. */
export function demoLoginsEnabled(): boolean {
  return process.env.SHOW_DEMO_LOGINS === "true"
}
