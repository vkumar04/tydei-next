import { PrismaClient } from "@prisma/client"
import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { clean } from "./seeds/clean"
import { seedHealthSystems } from "./seeds/health-systems"
import { seedVendors } from "./seeds/vendors"
import { seedCategories } from "./seeds/categories"
import { seedUsers } from "./seeds/users"
import { seedContracts } from "./seeds/contracts"
import { seedContractPeriods } from "./seeds/contract-periods"
import { seedRebates } from "./seeds/rebates"
import { seedFeatureFlags } from "./seeds/feature-flags"
import { seedPayorContracts } from "./seeds/payor-contracts"
import { seedBenchmarks } from "./seeds/benchmarks"
import { seedPendingContracts } from "./seeds/pending-contracts"
import { seedCOGRecords } from "./seeds/cog-records"
import { seedCOGForContracts } from "./seeds/cog-for-contracts"
import { seedContractPricing } from "./seeds/contract-pricing"
import { seedPricingFiles } from "./seeds/pricing-files"
import { seedAlerts } from "./seeds/alerts"
import { seedPurchaseOrders } from "./seeds/purchase-orders"
import { seedInvoices } from "./seeds/invoices"
import { seedCases } from "./seeds/cases"
import { seedCrossVendorTieIns } from "./seeds/cross-vendor-tie-ins"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log("Seeding TYDEi database...\n")

  await clean(prisma)

  const { healthSystems, facilities } = await seedHealthSystems(prisma)
  const { vendors } = await seedVendors(prisma)
  const { categories } = await seedCategories(prisma)
  const { users, organizations } = await seedUsers(prisma, { facilities, vendors })
  const { contracts } = await seedContracts(prisma, { facilities, vendors, categories, users })

  // Depends on contracts + facilities
  await seedContractPeriods(prisma, { contracts, facilities })
  await seedRebates(prisma, { contracts, facilities })
  await seedPendingContracts(prisma, { vendors, facilities })

  // Depends on facilities only
  await seedFeatureFlags(prisma, { facilities })
  await seedPayorContracts(prisma, { facilities })

  // No dependencies
  await seedBenchmarks(prisma)

  // Charles 2026-04-25: ContractPricing rows must seed BEFORE the COG
  // recompute pass kicked off by seedCOGRecords / seedCOGForContracts.
  // Without these rows, every COG row stays at matchStatus=pending
  // and on-contract %, optimizer projections, and rebate accruals all
  // read as zero — Charles's "broken engines" perception was actually
  // missing seed data, not broken code.
  await seedContractPricing(prisma)
  // Existing seeds
  await seedCOGRecords(prisma, { facilities, vendors })
  await seedCOGForContracts(prisma)
  await seedPricingFiles(prisma, { facilities, vendors })
  await seedAlerts(prisma, { facilities, vendors, contracts })
  await seedPurchaseOrders(prisma, { facilities, vendors })
  await seedInvoices(prisma, { facilities, vendors })
  await seedCases(prisma, { facilities })
  await seedCrossVendorTieIns(prisma, { facilities, vendors })

  console.log("\nSeed complete!")
  console.log("  Demo logins:")
  console.log("    demo-facility@tydei.com / demo-facility-2024")
  console.log("    demo-vendor@tydei.com   / demo-vendor-2024")
  console.log("    demo-admin@tydei.com    / demo-admin-2024")
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
