/**
 * qa-sanity — post-seed assertions that the demo database is in a
 * human-usable state. Runs after `bun run db:seed` and fails loudly
 * with actionable messages when any invariant breaks.
 *
 * Every invariant here is something Charles has complained about at
 * least once. The goal is to catch "stored value is 0 so the UI looks
 * broken" issues BEFORE Charles hits them.
 *
 * Usage:
 *   bun run scripts/qa-sanity.ts
 *   PROD_URL=http://localhost:3000 bun run scripts/qa-sanity.ts
 */

import { prisma } from "../lib/db"

type Invariant = {
  name: string
  describe: string
  check: () => Promise<{ ok: true } | { ok: false; detail: string }>
}

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const DIM = "\x1b[2m"
const RESET = "\x1b[0m"

async function getDemoFacility() {
  const facility = await prisma.facility.findFirst({
    where: { name: "Lighthouse Surgical Center" },
    select: { id: true, name: true },
  })
  if (!facility) {
    throw new Error(
      "Seed is missing the Lighthouse Surgical Center facility. Run `bun run db:seed`.",
    )
  }
  return facility
}

const invariants: Invariant[] = [
  {
    name: "demo-facility-exists",
    describe: "Lighthouse Surgical Center facility is seeded",
    async check() {
      const f = await prisma.facility.findFirst({
        where: { name: "Lighthouse Surgical Center" },
        select: { id: true },
      })
      return f
        ? { ok: true }
        : { ok: false, detail: "Run `bun run db:seed`" }
    },
  },

  {
    name: "demo-users-exist",
    describe: "demo-facility@tydei.com / demo-vendor@tydei.com / demo-admin@tydei.com all exist",
    async check() {
      const users = await prisma.user.findMany({
        where: {
          email: {
            in: [
              "demo-facility@tydei.com",
              "demo-vendor@tydei.com",
              "demo-admin@tydei.com",
            ],
          },
        },
        select: { email: true },
      })
      if (users.length !== 3) {
        return {
          ok: false,
          detail: `Found ${users.length}/3 demo users. Missing: ${[
            "demo-facility@tydei.com",
            "demo-vendor@tydei.com",
            "demo-admin@tydei.com",
          ]
            .filter((e) => !users.some((u) => u.email === e))
            .join(", ")}`,
        }
      }
      return { ok: true }
    },
  },

  {
    name: "active-contracts-with-tiers",
    describe: "demo facility has ≥3 active/expiring contracts with tier structure",
    async check() {
      const facility = await getDemoFacility()
      const contracts = await prisma.contract.findMany({
        where: {
          OR: [
            { facilityId: facility.id },
            { contractFacilities: { some: { facilityId: facility.id } } },
          ],
          status: { in: ["active", "expiring"] },
          terms: { some: { tiers: { some: {} } } },
        },
        select: { id: true, name: true },
      })
      if (contracts.length < 3) {
        return {
          ok: false,
          detail: `Only ${contracts.length} contract(s) with tiers. Rebate optimizer will show "No data coming up". Check prisma/seeds/contracts.ts.`,
        }
      }
      return { ok: true }
    },
  },

  {
    name: "on-contract-spend",
    describe: "≥$500k of COG spend matches an active contract's vendor",
    async check() {
      const facility = await getDemoFacility()
      const agg = await prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          vendor: {
            contracts: {
              some: {
                status: { in: ["active", "expiring"] },
                OR: [
                  { facilityId: facility.id },
                  { contractFacilities: { some: { facilityId: facility.id } } },
                ],
              },
            },
          },
        },
        _sum: { extendedPrice: true },
      })
      const spend = Number(agg._sum.extendedPrice ?? 0)
      if (spend < 500_000) {
        return {
          ok: false,
          detail: `On-contract spend is $${spend.toFixed(
            0,
          )}. Dashboard "On Contract %" card will look broken. Verify seedCOGForContracts is running and contract.facilityId or contractFacilities is populated.`,
        }
      }
      return { ok: true }
    },
  },

  {
    name: "earned-rebates",
    describe: "demo facility has ≥$10k in earned rebates (from Rebate or ContractPeriod tables)",
    async check() {
      const facility = await getDemoFacility()
      const [rebateAgg, periodAgg] = await Promise.all([
        prisma.rebate.aggregate({
          where: { facilityId: facility.id },
          _sum: { rebateEarned: true },
        }),
        prisma.contractPeriod.aggregate({
          where: { facilityId: facility.id },
          _sum: { rebateEarned: true },
        }),
      ])
      const fromRebates = Number(rebateAgg._sum.rebateEarned ?? 0)
      const fromPeriods = Number(periodAgg._sum.rebateEarned ?? 0)
      const total = Math.max(fromRebates, fromPeriods)
      if (total < 10_000) {
        return {
          ok: false,
          detail: `Only $${total.toFixed(
            0,
          )} earned rebates. Dashboard "Rebates Earned" card will read $0. Verify seedCOGForContracts is generating ContractPeriod + Rebate rows.`,
        }
      }
      return { ok: true }
    },
  },

  {
    name: "pricing-file-category-coverage",
    describe: "≥50% of COG rows can resolve a category via pricing file match",
    async check() {
      const facility = await getDemoFacility()
      const totalCog = await prisma.cOGRecord.count({
        where: { facilityId: facility.id },
      })
      if (totalCog === 0) {
        return { ok: false, detail: "No COG records at demo facility." }
      }

      // Count COG rows where at least ONE of: (a) the row has an inline
      // category, (b) a pricing file matches by (vendorId, vendorItemNo),
      // or (c) the vendor has an active contract with a productCategory.
      const withInlineCategory = await prisma.cOGRecord.count({
        where: {
          facilityId: facility.id,
          category: { not: null, notIn: ["", "Uncategorized"] },
        },
      })

      // Pricing-file match is easier to approximate via a GROUP BY than
      // a row-by-row join for the sanity pass.
      const pricingMatched = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT cr.id)::bigint AS count
        FROM cog_record cr
        INNER JOIN pricing_file pf
          ON pf."vendorId" = cr."vendorId"
          AND pf."vendorItemNo" = cr."vendorItemNo"
          AND pf.category IS NOT NULL
        WHERE cr."facilityId" = ${facility.id}
      `.then((r) => Number(r[0]?.count ?? 0))

      const viaContract = await prisma.cOGRecord.count({
        where: {
          facilityId: facility.id,
          category: null,
          vendor: {
            contracts: {
              some: {
                status: { in: ["active", "expiring"] },
                OR: [
                  { facilityId: facility.id },
                  { contractFacilities: { some: { facilityId: facility.id } } },
                ],
                productCategoryId: { not: null },
              },
            },
          },
        },
      })

      const approxResolved = Math.min(
        totalCog,
        withInlineCategory + pricingMatched + viaContract,
      )
      const coverage = approxResolved / totalCog
      if (coverage < 0.5) {
        return {
          ok: false,
          detail: `Only ${(coverage * 100).toFixed(
            1,
          )}% of ${totalCog} COG rows can resolve a category (inline: ${withInlineCategory}, pricing-file: ${pricingMatched}, contract: ${viaContract}). Spend by Category chart will show mostly "Uncategorized". Expand pricing file seed or ensure COG import matches pricing files.`,
        }
      }
      return { ok: true }
    },
  },

  {
    name: "case-reimbursement-coverage",
    describe: "≥50% of cases can compute a reimbursement via payor CPT rate lookup",
    async check() {
      const facility = await getDemoFacility()
      const totalCases = await prisma.case.count({
        where: { facilityId: facility.id },
      })
      if (totalCases === 0) {
        return { ok: true } // nothing to reimburse
      }

      // Build CPT → rate map from active payor contracts (tolerant of
      // both `{cpt, rate}` and `{cptCode, rate}` seed shapes, mirroring
      // lib/actions/cases.ts).
      const payorContracts = await prisma.payorContract.findMany({
        where: { facilityId: facility.id, status: "active" },
        select: { cptRates: true },
      })
      const cptRateMap = new Map<string, number>()
      for (const pc of payorContracts) {
        const rates =
          (pc.cptRates as
            | Array<{ cpt?: string; cptCode?: string; rate: number }>
            | null) ?? []
        for (const r of rates) {
          const code = r.cptCode ?? r.cpt
          if (!code || typeof r.rate !== "number") continue
          const existing = cptRateMap.get(code)
          if (existing === undefined || r.rate > existing) {
            cptRateMap.set(code, r.rate)
          }
        }
      }

      const cases = await prisma.case.findMany({
        where: { facilityId: facility.id },
        include: { procedures: { select: { cptCode: true } } },
      })
      const matched = cases.filter((c) => {
        if (Number(c.totalReimbursement) > 0) return true
        if (c.primaryCptCode && cptRateMap.has(c.primaryCptCode)) return true
        return c.procedures.some(
          (p) => p.cptCode && cptRateMap.has(p.cptCode),
        )
      })
      const coverage = matched.length / totalCases
      if (coverage < 0.5) {
        return {
          ok: false,
          detail: `Only ${matched.length}/${totalCases} cases (${(
            coverage * 100
          ).toFixed(
            1,
          )}%) will produce a non-zero reimbursement. Case costing Margin table will look blank. Expand payor contract CPT coverage in prisma/seeds/payor-contracts.ts.`,
        }
      }
      return { ok: true }
    },
  },

  {
    name: "dashboard-recent-contracts",
    describe: "dashboard getRecentContracts returns ≥3 contracts",
    async check() {
      const facility = await getDemoFacility()
      const contracts = await prisma.contract.findMany({
        where: {
          OR: [
            { facilityId: facility.id },
            { contractFacilities: { some: { facilityId: facility.id } } },
          ],
        },
        take: 5,
      })
      if (contracts.length < 3) {
        return {
          ok: false,
          detail: `Only ${contracts.length} contracts visible to demo facility. Dashboard Recent Contracts card will look empty.`,
        }
      }
      return { ok: true }
    },
  },

  {
    name: "alerts-populated",
    describe: "demo facility has ≥5 alerts",
    async check() {
      const facility = await getDemoFacility()
      const count = await prisma.alert.count({
        where: { facilityId: facility.id },
      })
      if (count < 5) {
        return {
          ok: false,
          detail: `Only ${count} alerts. Alerts page and bell badge will look empty.`,
        }
      }
      return { ok: true }
    },
  },

  {
    name: "active-contracts-resolve-rebates-at-read-time",
    describe: "every active contract with tiers can compute non-zero spend OR rebates at read time",
    async check() {
      const facility = await getDemoFacility()
      const contracts = await prisma.contract.findMany({
        where: {
          OR: [
            { facilityId: facility.id },
            { contractFacilities: { some: { facilityId: facility.id } } },
          ],
          status: { in: ["active", "expiring"] },
          terms: { some: { tiers: { some: {} } } },
        },
        include: {
          periods: { select: { totalSpend: true, rebateEarned: true } },
          rebates: { select: { rebateEarned: true } },
        },
      })
      const empty: string[] = []
      for (const c of contracts) {
        const periodSpend = c.periods.reduce(
          (s, p) => s + Number(p.totalSpend),
          0,
        )
        const rebateEarned =
          c.periods.reduce((s, p) => s + Number(p.rebateEarned), 0) +
          c.rebates.reduce((s, r) => s + Number(r.rebateEarned), 0)

        // Also probe whether COG would produce computed periods (the
        // contract-periods fallback path in lib/actions/contract-periods.ts).
        let cogFallback = 0
        if (periodSpend === 0 && c.vendorId) {
          const cogAgg = await prisma.cOGRecord.aggregate({
            where: {
              facilityId: facility.id,
              vendorId: c.vendorId,
              transactionDate: {
                gte: new Date(c.effectiveDate),
                lte: new Date(c.expirationDate),
              },
            },
            _sum: { extendedPrice: true },
          })
          cogFallback = Number(cogAgg._sum.extendedPrice ?? 0)
        }

        if (periodSpend === 0 && rebateEarned === 0 && cogFallback === 0) {
          empty.push(c.name)
        }
      }
      if (empty.length > 0) {
        return {
          ok: false,
          detail: `${empty.length} contract(s) with tiers show no spend/rebates via ANY path: ${empty
            .slice(0, 3)
            .join(
              ", ",
            )}. Detail page Performance tab will be blank for these.`,
        }
      }
      return { ok: true }
    },
  },
]

async function main() {
  console.log(`\n${DIM}tydei qa-sanity — post-seed invariant check${RESET}\n`)

  let passed = 0
  let failed = 0
  const failures: { name: string; describe: string; detail: string }[] = []

  for (const inv of invariants) {
    try {
      const result = await inv.check()
      if (result.ok) {
        console.log(`${GREEN}✓${RESET} ${inv.name} ${DIM}— ${inv.describe}${RESET}`)
        passed++
      } else {
        console.log(`${RED}✗${RESET} ${inv.name} ${DIM}— ${inv.describe}${RESET}`)
        console.log(`  ${YELLOW}→ ${result.detail}${RESET}`)
        failed++
        failures.push({
          name: inv.name,
          describe: inv.describe,
          detail: result.detail,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`${RED}✗${RESET} ${inv.name} ${DIM}— ${inv.describe}${RESET}`)
      console.log(`  ${RED}→ threw: ${msg}${RESET}`)
      failed++
      failures.push({ name: inv.name, describe: inv.describe, detail: msg })
    }
  }

  console.log(
    `\n${DIM}──────────────────────────────${RESET}\n${
      failed === 0 ? GREEN : RED
    }${passed}/${passed + failed} passing${RESET}\n`,
  )

  if (failed > 0) {
    console.log(`${RED}qa-sanity FAILED${RESET}\n`)
    for (const f of failures) {
      console.log(`  ${RED}${f.name}${RESET}: ${f.detail}`)
    }
    await prisma.$disconnect()
    process.exit(1)
  }

  console.log(`${GREEN}qa-sanity OK${RESET}\n`)
  await prisma.$disconnect()
  process.exit(0)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
