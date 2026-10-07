import fs from "node:fs"
import path from "node:path"
import { Client } from "pg"

export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = path.resolve(process.cwd(), ".env")
  const line = fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.trimStart().startsWith("DATABASE_URL="))
  const value = line?.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "")
  if (!value) throw new Error(`DATABASE_URL not set and not found in ${envPath}`)
  return value
}

export async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function scalar<T = string>(sql: string, params: unknown[] = []): Promise<T> {
  return withDb(async (c) => {
    const { rows } = await c.query(sql, params)
    const first = rows[0] as Record<string, unknown> | undefined
    return (first ? Object.values(first)[0] : null) as T
  })
}

export async function facilityIdByName(name = "Lighthouse Surgical Center"): Promise<string> {
  const id = await scalar<string | null>(`select id from facility where name = $1`, [name])
  if (!id) throw new Error(`facility "${name}" not found — is the database seeded?`)
  return id
}

export async function vendorIdForUser(email = "demo-vendor@tydei.com"): Promise<string> {
  const id = await scalar<string | null>(
    `select v.id from "user" u
       join member m on m."userId" = u.id
       join vendor v on v."organizationId" = m."organizationId"
      where u.email = $1 limit 1`,
    [email],
  )
  if (!id) throw new Error(`no vendor linked to ${email}`)
  return id
}
