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

export async function vendorIdByName(name: string): Promise<string> {
  const id = await scalar<string | null>(`select id from vendor where name = $1 limit 1`, [name])
  if (!id) throw new Error(`vendor "${name}" not found — is the database seeded?`)
  return id
}

export async function createScratchContract(name: string, vendorName = "Stryker"): Promise<string> {
  const facilityId = await facilityIdByName()
  const vendorId = await vendorIdByName(vendorName)
  const id = `e2e-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`
  await withDb((c) =>
    c.query(
      `insert into contract (id, name, "vendorId", "facilityId", "contractType", status, "effectiveDate", "expirationDate", "updatedAt")
       values ($1, $2, $3, $4, 'usage', 'active', '2026-01-01', '2028-12-31', now())`,
      [id, name, vendorId, facilityId],
    ),
  )
  return id
}

export async function deleteContract(id: string): Promise<void> {
  await withDb(async (c) => {
    for (const sql of [
      `delete from contract_pricing where "contractId" = $1`,
      `delete from contract_tier where "termId" in (select id from contract_term where "contractId" = $1)`,
      `delete from contract_term where "contractId" = $1`,
      `delete from contract_document where "contractId" = $1`,
      `delete from contract where id = $1`,
    ]) {
      await c.query(sql, [id]).catch(() => undefined)
    }
  })
}
