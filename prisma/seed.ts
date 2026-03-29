import { PrismaClient } from "@prisma/client"
import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { clean } from "./seeds/clean"
import { seedHealthSystems } from "./seeds/health-systems"
import { seedVendors } from "./seeds/vendors"
import { seedCategories } from "./seeds/categories"
import { seedUsers } from "./seeds/users"
import { seedContracts } from "./seeds/contracts"
import { seedCOGRecords } from "./seeds/cog-records"
import { seedPricingFiles } from "./seeds/pricing-files"
import { seedAlerts } from "./seeds/alerts"
import { seedPurchaseOrders } from "./seeds/purchase-orders"
import { seedInvoices } from "./seeds/invoices"
import { seedCases } from "./seeds/cases"

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
  await seedCOGRecords(prisma, { facilities, vendors })
  await seedPricingFiles(prisma, { facilities, vendors })
  await seedAlerts(prisma, { facilities, vendors, contracts })
  await seedPurchaseOrders(prisma, { facilities, vendors })
  await seedInvoices(prisma, { facilities, vendors })
  await seedCases(prisma, { facilities })

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
