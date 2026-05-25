// Quick verifier: do prod's stored hashes actually match the demo passwords?
// Runs better-auth/crypto's verifyPassword against the prod hashes.
//
// We DON'T print hashes — just yes/no.

import { Pool } from "pg"
import { verifyPassword, hashPassword } from "better-auth/crypto"

const DEMOS = [
  { email: "demo-facility@tydei.com", password: "demo-facility-2024" },
  { email: "demo-vendor@tydei.com", password: "demo-vendor-2024" },
  { email: "demo-admin@tydei.com", password: "demo-admin-2024" },
]

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set — run via `railway run bun /tmp/verify-demo-passwords.ts`")
    process.exit(2)
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  for (const { email, password } of DEMOS) {
    const { rows } = await pool.query<{ password: string }>(
      `SELECT a.password
         FROM account a JOIN "user" u ON a."userId" = u.id
        WHERE u.email = $1 AND a."providerId" = 'credential'
        LIMIT 1`,
      [email],
    )
    if (rows.length === 0) {
      console.log(`${email}: NO credential account row`)
      continue
    }
    const stored = rows[0].password
    const ok = await verifyPassword({ hash: stored, password })
    const algo = stored.split(":")[0] || "?"
    console.log(`${email}: verify=${ok}  algo-prefix=${algo}  stored-len=${stored.length}`)
  }

  // Also: hash "demo-facility-2024" right now to confirm the current
  // better-auth version produces a hash with the same shape as what's stored.
  const fresh = await hashPassword("demo-facility-2024")
  console.log(`\nFresh hash of 'demo-facility-2024': algo-prefix=${fresh.split(":")[0] || "?"}  len=${fresh.length}`)

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
