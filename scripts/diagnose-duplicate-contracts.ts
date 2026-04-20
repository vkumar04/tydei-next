// scripts/diagnose-duplicate-contracts.ts
// Usage: bun scripts/diagnose-duplicate-contracts.ts [facilityId]
//
// Charles W1.Y-B — duplicate contract-create diagnostic. Pull the last
// 24h of Contract rows for a facility and group them by the tuple that
// defines "same contract" from a user's perspective
// (name, vendorId, contractType, effectiveDate). Groups of size > 1 are
// duplicates. The `gap from first (ms)` column classifies the root
// cause: <1s = double-click past the idempotency cache, >30s = TTL
// expired, different createdBy = two users (out of scope).

import { prisma } from "@/lib/db"

async function main() {
  const facilityId = process.argv[2] ?? "cmo4sbr8p0004wthl91ubwfwb"
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const contracts = await prisma.contract.findMany({
    where: { facilityId, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      vendorId: true,
      contractType: true,
      effectiveDate: true,
      createdAt: true,
      createdById: true,
    },
  })

  const groups = new Map<string, typeof contracts>()
  for (const c of contracts) {
    const key = `${c.name}|${c.vendorId}|${c.contractType}|${c.effectiveDate?.toISOString().slice(0, 10)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }

  console.log("# Duplicate contracts — last 24h\n")
  console.log(`_facilityId: \`${facilityId}\`, window: last 24h (since ${since.toISOString()})_\n`)

  const dupes = [...groups.entries()].filter(([, rows]) => rows.length > 1)
  for (const [key, rows] of dupes) {
    console.log(`## ${key}\n`)
    console.log("| id | createdAt | createdBy | gap from first (ms) |")
    console.log("|---|---|---|---:|")
    const first = rows[0].createdAt.getTime()
    for (const r of rows) {
      console.log(
        `| ${r.id} | ${r.createdAt.toISOString()} | ${r.createdById ?? ""} | ${r.createdAt.getTime() - first} |`,
      )
    }
    console.log()
  }
  if (dupes.length === 0) console.log("_No duplicate groups detected in the last 24h._")
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
