import { PrismaClient } from "@prisma/client"
import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { hashPassword } from "better-auth/crypto"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log("Seeding TYDEi database...")

  // ─── Clean existing data ────────────────────────────────────────
  console.log("  Clearing existing data...")
  await prisma.aIUsageRecord.deleteMany()
  await prisma.aICredit.deleteMany()
  await prisma.reportSchedule.deleteMany()
  await prisma.caseCostingFile.deleteMany()
  await prisma.caseSupply.deleteMany()
  await prisma.caseProcedure.deleteMany()
  await prisma.case.deleteMany()
  await prisma.surgeonUsage.deleteMany()
  await prisma.invoiceLineItem.deleteMany()
  await prisma.invoice.deleteMany()
  await prisma.pOLineItem.deleteMany()
  await prisma.purchaseOrder.deleteMany()
  await prisma.alert.deleteMany()
  await prisma.contractChangeProposal.deleteMany()
  await prisma.pendingContract.deleteMany()
  await prisma.contractDocument.deleteMany()
  await prisma.contractPricing.deleteMany()
  await prisma.contractTier.deleteMany()
  await prisma.contractTermProduct.deleteMany()
  await prisma.contractTermProcedure.deleteMany()
  await prisma.contractTerm.deleteMany()
  await prisma.contractPeriod.deleteMany()
  await prisma.rebate.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.credit.deleteMany()
  await prisma.contractFacility.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.cOGRecord.deleteMany()
  await prisma.pricingFile.deleteMany()
  await prisma.vendorNameMapping.deleteMany()
  await prisma.categoryMapping.deleteMany()
  await prisma.productBenchmark.deleteMany()
  await prisma.payorContract.deleteMany()
  await prisma.connection.deleteMany()
  await prisma.featureFlag.deleteMany()
  await prisma.member.deleteMany()
  await prisma.invitation.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.user.deleteMany()
  await prisma.organization.deleteMany()
  await prisma.vendorDivision.deleteMany()
  await prisma.vendor.deleteMany()
  await prisma.productCategory.deleteMany()
  await prisma.facility.deleteMany()
  await prisma.healthSystem.deleteMany()

  // ─── Health Systems ─────────────────────────────────────────────
  const lighthouse = await prisma.healthSystem.create({
    data: {
      name: "Lighthouse Health",
      code: "LH",
      headquarters: "Portland, OR",
      primaryContactEmail: "admin@lighthousehealth.com",
      phone: "503-555-1000",
      website: "https://lighthousehealth.com",
    },
  })

  const heritage = await prisma.healthSystem.create({
    data: {
      name: "Heritage Medical Group",
      code: "HMG",
      headquarters: "Austin, TX",
      primaryContactEmail: "admin@heritagemedical.com",
      phone: "512-555-2000",
      website: "https://heritagemedical.com",
    },
  })

  // ─── Organizations ──────────────────────────────────────────────
  const facilityOrg = await prisma.organization.create({
    data: { name: "Lighthouse Surgery Center", slug: "lighthouse-surgery-center" },
  })

  const vendorOrg = await prisma.organization.create({
    data: { name: "Stryker", slug: "stryker" },
  })

  // ─── Facilities ─────────────────────────────────────────────────
  const lsc = await prisma.facility.create({
    data: {
      name: "Lighthouse Surgery Center",
      type: "asc",
      address: "1200 NW Surgical Way",
      city: "Portland",
      state: "OR",
      zip: "97209",
      beds: 12,
      healthSystemId: lighthouse.id,
      organizationId: facilityOrg.id,
    },
  })

  const lmh = await prisma.facility.create({
    data: {
      name: "Lighthouse Main Hospital",
      type: "hospital",
      address: "500 SE Medical Blvd",
      city: "Portland",
      state: "OR",
      zip: "97214",
      beds: 350,
      healthSystemId: lighthouse.id,
    },
  })

  const hmc = await prisma.facility.create({
    data: {
      name: "Heritage Medical Center",
      type: "hospital",
      address: "2000 Heritage Parkway",
      city: "Austin",
      state: "TX",
      zip: "78701",
      beds: 200,
      healthSystemId: heritage.id,
    },
  })

  const hoc = await prisma.facility.create({
    data: {
      name: "Heritage Orthopedic Clinic",
      type: "clinic",
      address: "450 Bone & Joint Dr",
      city: "Austin",
      state: "TX",
      zip: "78702",
      beds: 0,
      healthSystemId: heritage.id,
    },
  })

  // ─── Vendors ────────────────────────────────────────────────────
  const stryker = await prisma.vendor.create({
    data: {
      name: "Stryker",
      code: "STK",
      displayName: "Stryker Corporation",
      contactName: "Sarah Mitchell",
      contactEmail: "sarah.mitchell@stryker.com",
      contactPhone: "269-555-1000",
      website: "https://stryker.com",
      tier: "premium",
      organizationId: vendorOrg.id,
    },
  })

  const medtronic = await prisma.vendor.create({
    data: {
      name: "Medtronic",
      code: "MDT",
      displayName: "Medtronic plc",
      contactName: "James Park",
      contactEmail: "james.park@medtronic.com",
      contactPhone: "763-555-2000",
      website: "https://medtronic.com",
      tier: "premium",
    },
  })

  const smithNephew = await prisma.vendor.create({
    data: {
      name: "Smith & Nephew",
      code: "SN",
      displayName: "Smith & Nephew plc",
      contactName: "Lisa Chen",
      contactEmail: "lisa.chen@smith-nephew.com",
      contactPhone: "901-555-3000",
      website: "https://smith-nephew.com",
      tier: "standard",
    },
  })

  // ─── Vendor Divisions ───────────────────────────────────────────
  await prisma.vendorDivision.createMany({
    data: [
      { vendorId: stryker.id, name: "Joint Replacement", code: "JR", categories: ["Hips", "Knees"] },
      { vendorId: stryker.id, name: "Instruments", code: "INST", categories: ["Surgical Instruments"] },
      { vendorId: medtronic.id, name: "Spine", code: "SP", categories: ["Spine Hardware", "Biologics"] },
      { vendorId: medtronic.id, name: "Neurovascular", code: "NV", categories: ["Neurovascular Devices"] },
      { vendorId: smithNephew.id, name: "Sports Medicine", code: "SM", categories: ["Arthroscopy", "Soft Tissue Repair"] },
    ],
  })

  // ─── Product Categories ─────────────────────────────────────────
  const categories = await Promise.all([
    prisma.productCategory.create({ data: { name: "Joint Replacement", description: "Hip, knee, and shoulder replacement implants" } }),
    prisma.productCategory.create({ data: { name: "Spine", description: "Spinal implants, fusion hardware, and biologics" } }),
    prisma.productCategory.create({ data: { name: "Biologics", description: "Bone grafts, growth factors, and tissue products" } }),
    prisma.productCategory.create({ data: { name: "Arthroscopy", description: "Minimally invasive surgical instruments and implants" } }),
    prisma.productCategory.create({ data: { name: "Trauma", description: "Plates, screws, nails, and external fixation" } }),
  ])

  // ─── Demo Users ─────────────────────────────────────────────────
  // Hash passwords using Better Auth's crypto so login actually works
  const facilityHash = await hashPassword("demo-facility-2024")
  const vendorHash = await hashPassword("demo-vendor-2024")
  const adminHash = await hashPassword("demo-admin-2024")

  const facilityUser = await prisma.user.create({
    data: {
      name: "Facility Demo",
      email: "demo-facility@tydei.com",
      emailVerified: true,
      role: "facility",
    },
  })

  await prisma.account.create({
    data: {
      userId: facilityUser.id,
      accountId: facilityUser.id,
      providerId: "credential",
      password: facilityHash,
    },
  })

  await prisma.member.create({
    data: {
      userId: facilityUser.id,
      organizationId: facilityOrg.id,
      role: "admin",
    },
  })

  const vendorUser = await prisma.user.create({
    data: {
      name: "Vendor Demo",
      email: "demo-vendor@tydei.com",
      emailVerified: true,
      role: "vendor",
    },
  })

  await prisma.account.create({
    data: {
      userId: vendorUser.id,
      accountId: vendorUser.id,
      providerId: "credential",
      password: vendorHash,
    },
  })

  await prisma.member.create({
    data: {
      userId: vendorUser.id,
      organizationId: vendorOrg.id,
      role: "admin",
    },
  })

  const adminUser = await prisma.user.create({
    data: {
      name: "Admin Demo",
      email: "demo-admin@tydei.com",
      emailVerified: true,
      role: "admin",
    },
  })

  await prisma.account.create({
    data: {
      userId: adminUser.id,
      accountId: adminUser.id,
      providerId: "credential",
      password: adminHash,
    },
  })

  // ─── Contracts ──────────────────────────────────────────────────
  const now = new Date()
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const twoYearsFromNow = new Date(now.getFullYear() + 2, now.getMonth(), 1)
  const sixMonthsFromNow = new Date(now.getFullYear(), now.getMonth() + 6, 1)

  const contract1 = await prisma.contract.create({
    data: {
      contractNumber: "STK-2025-001",
      name: "Stryker Joint Replacement Agreement",
      vendorId: stryker.id,
      facilityId: lsc.id,
      productCategoryId: categories[0].id,
      contractType: "usage",
      status: "active",
      effectiveDate: oneYearAgo,
      expirationDate: twoYearsFromNow,
      autoRenewal: true,
      terminationNoticeDays: 90,
      totalValue: 2500000,
      annualValue: 1250000,
      description: "Multi-year joint replacement implant agreement with tiered spend rebates",
      performancePeriod: "quarterly",
      rebatePayPeriod: "quarterly",
      createdById: facilityUser.id,
    },
  })

  const term1 = await prisma.contractTerm.create({
    data: {
      contractId: contract1.id,
      termName: "Annual Spend Rebate",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      effectiveStart: oneYearAgo,
      effectiveEnd: twoYearsFromNow,
      spendBaseline: 500000,
    },
  })

  await prisma.contractTier.createMany({
    data: [
      { termId: term1.id, tierNumber: 1, spendMin: 0, spendMax: 500000, rebateType: "percent_of_spend", rebateValue: 0.02 },
      { termId: term1.id, tierNumber: 2, spendMin: 500000, spendMax: 1000000, rebateType: "percent_of_spend", rebateValue: 0.04 },
      { termId: term1.id, tierNumber: 3, spendMin: 1000000, rebateType: "percent_of_spend", rebateValue: 0.06 },
    ],
  })

  const contract2 = await prisma.contract.create({
    data: {
      contractNumber: "MDT-2025-001",
      name: "Medtronic Spine Hardware",
      vendorId: medtronic.id,
      facilityId: lmh.id,
      productCategoryId: categories[1].id,
      contractType: "usage",
      status: "active",
      effectiveDate: oneYearAgo,
      expirationDate: twoYearsFromNow,
      totalValue: 1800000,
      annualValue: 900000,
      description: "Spine hardware and biologics agreement",
      performancePeriod: "monthly",
      rebatePayPeriod: "quarterly",
    },
  })

  const term2 = await prisma.contractTerm.create({
    data: {
      contractId: contract2.id,
      termName: "Volume Rebate",
      termType: "volume_rebate",
      baselineType: "volume_based",
      effectiveStart: oneYearAgo,
      effectiveEnd: twoYearsFromNow,
      volumeBaseline: 200,
    },
  })

  await prisma.contractTier.createMany({
    data: [
      { termId: term2.id, tierNumber: 1, volumeMin: 0, volumeMax: 200, rebateType: "fixed_rebate_per_unit", rebateValue: 50 },
      { termId: term2.id, tierNumber: 2, volumeMin: 200, volumeMax: 500, rebateType: "fixed_rebate_per_unit", rebateValue: 75 },
      { termId: term2.id, tierNumber: 3, volumeMin: 500, rebateType: "fixed_rebate_per_unit", rebateValue: 100 },
    ],
  })

  const contract3 = await prisma.contract.create({
    data: {
      contractNumber: "SN-2025-001",
      name: "Smith & Nephew Arthroscopy",
      vendorId: smithNephew.id,
      facilityId: lsc.id,
      productCategoryId: categories[3].id,
      contractType: "usage",
      status: "expiring",
      effectiveDate: oneYearAgo,
      expirationDate: sixMonthsFromNow,
      totalValue: 800000,
      annualValue: 400000,
      description: "Arthroscopy instruments and implants",
      performancePeriod: "quarterly",
      rebatePayPeriod: "semi_annual",
    },
  })

  const term3 = await prisma.contractTerm.create({
    data: {
      contractId: contract3.id,
      termName: "Market Share Pricing",
      termType: "market_share",
      baselineType: "spend_based",
      effectiveStart: oneYearAgo,
      effectiveEnd: sixMonthsFromNow,
      desiredMarketShare: 65,
    },
  })

  await prisma.contractTier.createMany({
    data: [
      { termId: term3.id, tierNumber: 1, marketShareMin: 0, marketShareMax: 50, rebateType: "percent_of_spend", rebateValue: 0.01 },
      { termId: term3.id, tierNumber: 2, marketShareMin: 50, marketShareMax: 65, rebateType: "percent_of_spend", rebateValue: 0.03 },
      { termId: term3.id, tierNumber: 3, marketShareMin: 65, rebateType: "percent_of_spend", rebateValue: 0.05 },
    ],
  })

  await prisma.contract.create({
    data: {
      contractNumber: "STK-2024-CAP",
      name: "Stryker Capital Equipment - Mako Robot",
      vendorId: stryker.id,
      facilityId: lsc.id,
      contractType: "capital",
      status: "active",
      effectiveDate: oneYearAgo,
      expirationDate: twoYearsFromNow,
      totalValue: 1500000,
      annualValue: 0,
      description: "Capital lease agreement for Mako robotic-arm system",
    },
  })

  await prisma.contract.create({
    data: {
      contractNumber: "STK-2025-TIE",
      name: "Stryker Tie-In: Joint + Capital",
      vendorId: stryker.id,
      facilityId: lsc.id,
      productCategoryId: categories[0].id,
      contractType: "tie_in",
      status: "active",
      effectiveDate: oneYearAgo,
      expirationDate: twoYearsFromNow,
      totalValue: 4000000,
      annualValue: 2000000,
      description: "Tie-in agreement linking capital equipment to implant usage commitments",
      tieInCapitalContractId: contract1.id,
    },
  })

  const contract6 = await prisma.contract.create({
    data: {
      contractNumber: "MDT-2024-BIO",
      name: "Medtronic Biologics Agreement",
      vendorId: medtronic.id,
      facilityId: hmc.id,
      productCategoryId: categories[2].id,
      contractType: "usage",
      status: "active",
      effectiveDate: oneYearAgo,
      expirationDate: twoYearsFromNow,
      totalValue: 600000,
      annualValue: 300000,
      performancePeriod: "quarterly",
      rebatePayPeriod: "quarterly",
    },
  })

  const term6 = await prisma.contractTerm.create({
    data: {
      contractId: contract6.id,
      termName: "Growth Rebate",
      termType: "growth_rebate",
      baselineType: "growth_based",
      effectiveStart: oneYearAgo,
      effectiveEnd: twoYearsFromNow,
      growthBaselinePercent: 10,
    },
  })

  await prisma.contractTier.createMany({
    data: [
      { termId: term6.id, tierNumber: 1, spendMin: 0, spendMax: 300000, rebateType: "percent_of_spend", rebateValue: 0.02 },
      { termId: term6.id, tierNumber: 2, spendMin: 300000, rebateType: "percent_of_spend", rebateValue: 0.04 },
    ],
  })

  await prisma.contract.create({
    data: {
      contractNumber: "SN-2024-TRMA",
      name: "Smith & Nephew Trauma",
      vendorId: smithNephew.id,
      facilityId: hmc.id,
      productCategoryId: categories[4].id,
      contractType: "usage",
      status: "expired",
      effectiveDate: new Date(now.getFullYear() - 2, 0, 1),
      expirationDate: new Date(now.getFullYear(), 0, 1),
      totalValue: 500000,
      annualValue: 250000,
    },
  })

  // ─── Sample COG Records ─────────────────────────────────────────
  const cogData = [
    { facilityId: lsc.id, vendorId: stryker.id, vendorName: "Stryker", inventoryNumber: "INV-001", inventoryDescription: "Triathlon Total Knee System", vendorItemNo: "STK-TKS-001", unitCost: 4500, quantity: 3, transactionDate: new Date(now.getFullYear(), now.getMonth() - 1, 15), category: "Joint Replacement" },
    { facilityId: lsc.id, vendorId: stryker.id, vendorName: "Stryker", inventoryNumber: "INV-002", inventoryDescription: "Mako SmartRobotics Disposable", vendorItemNo: "STK-MKD-001", unitCost: 850, quantity: 5, transactionDate: new Date(now.getFullYear(), now.getMonth() - 1, 15), category: "Joint Replacement" },
    { facilityId: lsc.id, vendorId: smithNephew.id, vendorName: "Smith & Nephew", inventoryNumber: "INV-003", inventoryDescription: "FAST-FIX 360 Meniscal Repair", vendorItemNo: "SN-FF360-001", unitCost: 650, quantity: 8, transactionDate: new Date(now.getFullYear(), now.getMonth() - 1, 20), category: "Arthroscopy" },
    { facilityId: lmh.id, vendorId: medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-004", inventoryDescription: "PRESTIGE LP Cervical Disc", vendorItemNo: "MDT-PLP-001", unitCost: 6200, quantity: 2, transactionDate: new Date(now.getFullYear(), now.getMonth() - 2, 10), category: "Spine" },
    { facilityId: lmh.id, vendorId: medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-005", inventoryDescription: "INFUSE Bone Graft", vendorItemNo: "MDT-IBG-001", unitCost: 3400, quantity: 4, transactionDate: new Date(now.getFullYear(), now.getMonth() - 2, 10), category: "Biologics" },
    { facilityId: hmc.id, vendorId: medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-006", inventoryDescription: "CD HORIZON SOLERA Spinal System", vendorItemNo: "MDT-SOL-001", unitCost: 8900, quantity: 1, transactionDate: new Date(now.getFullYear(), now.getMonth() - 1, 5), category: "Spine" },
    { facilityId: hmc.id, vendorId: smithNephew.id, vendorName: "Smith & Nephew", inventoryNumber: "INV-007", inventoryDescription: "TRIGEN INTERTAN Nail", vendorItemNo: "SN-TIN-001", unitCost: 2100, quantity: 6, transactionDate: new Date(now.getFullYear(), now.getMonth() - 1, 12), category: "Trauma" },
    { facilityId: lsc.id, vendorId: stryker.id, vendorName: "Stryker", inventoryNumber: "INV-008", inventoryDescription: "Accolade II Hip Stem", vendorItemNo: "STK-AHS-001", unitCost: 3200, quantity: 4, transactionDate: new Date(now.getFullYear(), now.getMonth(), 3), category: "Joint Replacement" },
  ]

  for (const cog of cogData) {
    await prisma.cOGRecord.create({
      data: {
        ...cog,
        extendedPrice: cog.unitCost * cog.quantity,
      },
    })
  }

  // ─── Sample Alerts ──────────────────────────────────────────────
  const alerts = [
    { portalType: "facility", alertType: "expiring_contract" as const, title: "Contract Expiring Soon", description: "Smith & Nephew Arthroscopy agreement expires in 6 months", severity: "high" as const, facilityId: lsc.id, contractId: contract3.id, actionLink: "/dashboard/contracts" },
    { portalType: "facility", alertType: "tier_threshold" as const, title: "Approaching Tier 2", description: "Stryker Joint Replacement spend is 85% to Tier 2 threshold", severity: "medium" as const, facilityId: lsc.id, contractId: contract1.id, actionLink: "/dashboard/contracts" },
    { portalType: "facility", alertType: "rebate_due" as const, title: "Q4 Rebate Due", description: "Medtronic Spine rebate of $12,500 due for Q4 2025", severity: "medium" as const, facilityId: lmh.id, contractId: contract2.id },
    { portalType: "facility", alertType: "off_contract" as const, title: "Off-Contract Purchase Detected", description: "3 purchases from uncontracted vendor detected this month", severity: "high" as const, facilityId: lsc.id },
    { portalType: "vendor", alertType: "payment_due" as const, title: "Rebate Payment Due", description: "Q4 rebate payment of $18,750 due to Lighthouse Surgery Center", severity: "medium" as const, vendorId: stryker.id, contractId: contract1.id },
    { portalType: "vendor", alertType: "expiring_contract" as const, title: "Contract Renewal Needed", description: "Arthroscopy agreement with Lighthouse Surgery Center expiring in 6 months", severity: "high" as const, vendorId: smithNephew.id, contractId: contract3.id },
    { portalType: "facility", alertType: "compliance" as const, title: "Compliance Review Required", description: "Monthly compliance review for Heritage Medical Center spine program", severity: "low" as const, facilityId: hmc.id },
  ]

  for (const alert of alerts) {
    await prisma.alert.create({ data: alert })
  }

  console.log("Seed complete!")
  console.log("  Health Systems: 2")
  console.log("  Facilities: 4")
  console.log("  Vendors: 3")
  console.log("  Product Categories: 5")
  console.log("  Demo Users: 3 (demo-facility@tydei.com, demo-vendor@tydei.com, demo-admin@tydei.com)")
  console.log("  Contracts: 7 (with terms and tiers)")
  console.log("  COG Records:", cogData.length)
  console.log("  Alerts:", alerts.length)
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
