import type { PrismaClient, Prisma } from "@prisma/client"
import type { Facilities } from "./health-systems"
import type { Vendors } from "./vendors"
import type { Categories } from "./categories"
import type { Users } from "./users"

const now = new Date()
const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), 1)
const twoYearsFromNow = new Date(now.getFullYear() + 2, now.getMonth(), 1)
const oneYearFromNow = new Date(now.getFullYear() + 1, now.getMonth(), 1)
const sixMonthsFromNow = new Date(now.getFullYear(), now.getMonth() + 6, 1)
const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)

type ContractResult = Awaited<ReturnType<PrismaClient["contract"]["create"]>>

async function addTerm(
  prisma: PrismaClient,
  contractId: string,
  termData: Omit<Prisma.ContractTermUncheckedCreateInput, "contractId">,
  tiers: Array<Omit<Prisma.ContractTierUncheckedCreateInput, "termId">>
) {
  const term = await prisma.contractTerm.create({ data: { ...termData, contractId } })
  if (tiers.length > 0) {
    await prisma.contractTier.createMany({
      data: tiers.map((t) => ({ ...t, termId: term.id })),
    })
  }
  return term
}

export async function seedContracts(
  prisma: PrismaClient,
  deps: { facilities: Facilities; vendors: Vendors; categories: Categories; users: Users }
) {
  const { facilities: f, vendors: v, categories: c, users: u } = deps
  const contracts: Record<string, ContractResult> = {}

  // 1. Stryker Joint Replacement (usage, active)
  contracts.strykerJoint = await prisma.contract.create({
    data: {
      contractNumber: "STK-2025-001", name: "Stryker Joint Replacement Agreement",
      vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id, productCategoryId: c.jointReplacement.id,
      contractType: "usage", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      autoRenewal: true, terminationNoticeDays: 90, totalValue: 2500000, annualValue: 1250000,
      description: "Multi-year joint replacement implant agreement with tiered spend rebates",
      performancePeriod: "quarterly", rebatePayPeriod: "quarterly", createdById: u.facilityUser.id,
    },
  })
  await addTerm(prisma, contracts.strykerJoint.id, {
    termName: "Annual Spend Rebate", termType: "spend_rebate", baselineType: "spend_based",
    evaluationPeriod: "annual", paymentTiming: "quarterly",
    effectiveStart: oneYearAgo, effectiveEnd: twoYearsFromNow, spendBaseline: 500000,
  }, [
    { tierNumber: 1, spendMin: 0, spendMax: 500000, rebateType: "percent_of_spend", rebateValue: 0.02 },
    { tierNumber: 2, spendMin: 500000, spendMax: 1000000, rebateType: "percent_of_spend", rebateValue: 0.04 },
    { tierNumber: 3, spendMin: 1000000, rebateType: "percent_of_spend", rebateValue: 0.06 },
  ])

  // 2. Stryker Capital Equipment - Mako (capital, active)
  contracts.strykerMako = await prisma.contract.create({
    data: {
      contractNumber: "STK-2024-CAP", name: "Stryker Capital Equipment - Mako Robot",
      vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id,
      contractType: "capital", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 1500000, annualValue: 0,
      description: "Capital lease agreement for Mako robotic-arm assisted surgery system",
    },
  })
  // 2026-04-26: oracle capital-amortization needs at least one
  // ContractCapitalLineItem with contractTotal>0 + termMonths>0 to
  // exercise the PMT-formula comparison. Seed two financed line items
  // on the Mako contract so the amortization card on contract-detail
  // also has data to render.
  await prisma.contractCapitalLineItem.createMany({
    data: [
      {
        contractId: contracts.strykerMako.id,
        description: "Mako robotic arm system",
        itemNumber: "MAKO-RA-2024",
        serialNumber: "STR-MAKO-001",
        contractTotal: 1_200_000,
        initialSales: 200_000,
        interestRate: 0.05,
        termMonths: 60,
        paymentType: "fixed",
        paymentCadence: "monthly",
      },
      {
        contractId: contracts.strykerMako.id,
        description: "Mako navigation cart + workstation",
        itemNumber: "MAKO-NAV-2024",
        serialNumber: "STR-NAV-001",
        contractTotal: 300_000,
        initialSales: 50_000,
        interestRate: 0.05,
        termMonths: 36,
        paymentType: "fixed",
        paymentCadence: "monthly",
      },
    ],
  })

  // 3. Stryker Tie-In (tie_in, active)
  contracts.strykerTieIn = await prisma.contract.create({
    data: {
      contractNumber: "STK-2025-TIE", name: "Stryker Tie-In: Joint + Capital",
      vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id, productCategoryId: c.jointReplacement.id,
      contractType: "tie_in", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 4000000, annualValue: 2000000,
      description: "Tie-in agreement linking Mako capital equipment to implant usage commitments",
      tieInCapitalContractId: contracts.strykerMako.id,
    },
  })
  // Tie-in members surface from contract.terms in
  // lib/actions/analytics/tie-in-compliance.ts. Without these the
  // TieInComplianceCard renders an empty body.
  await addTerm(prisma, contracts.strykerTieIn.id, {
    termName: "Joint Implant Commitment", termType: "compliance_rebate", baselineType: "spend_based",
    effectiveStart: oneYearAgo, effectiveEnd: twoYearsFromNow,
    minimumPurchaseCommitment: 1_500_000,
  }, [
    { tierNumber: 1, spendMin: 0, spendMax: 1_500_000, rebateType: "percent_of_spend", rebateValue: 0.02 },
    { tierNumber: 2, spendMin: 1_500_000, rebateType: "percent_of_spend", rebateValue: 0.035 },
  ])
  await addTerm(prisma, contracts.strykerTieIn.id, {
    termName: "Capital Coverage", termType: "compliance_rebate", baselineType: "spend_based",
    effectiveStart: oneYearAgo, effectiveEnd: twoYearsFromNow,
    minimumPurchaseCommitment: 500_000,
  }, [
    { tierNumber: 1, spendMin: 0, spendMax: 500_000, rebateType: "percent_of_spend", rebateValue: 0.015 },
    { tierNumber: 2, spendMin: 500_000, rebateType: "percent_of_spend", rebateValue: 0.025 },
  ])

  // 4. Stryker Pricing Only (pricing_only, active)
  contracts.strykerPricing = await prisma.contract.create({
    data: {
      contractNumber: "STK-2025-PRC", name: "Stryker Surgical Navigation Pricing",
      vendorId: v.stryker.id, facilityId: f.lighthouseCommunity.id, productCategoryId: c.surgicalInstruments.id,
      contractType: "pricing_only", status: "active", effectiveDate: oneYearAgo, expirationDate: oneYearFromNow,
      totalValue: 350000, annualValue: 175000,
      description: "Fixed pricing agreement for Stryker surgical navigation disposables",
    },
  })
  await addTerm(prisma, contracts.strykerPricing.id, {
    termName: "Locked Pricing", termType: "locked_pricing", baselineType: "spend_based",
    effectiveStart: oneYearAgo, effectiveEnd: oneYearFromNow,
  }, [])

  // 5. Medtronic Spine Hardware (usage, active)
  contracts.medtronicSpine = await prisma.contract.create({
    data: {
      contractNumber: "MDT-2025-001", name: "Medtronic Spine Hardware",
      vendorId: v.medtronic.id, facilityId: f.lighthouseCommunity.id, productCategoryId: c.spine.id,
      contractType: "usage", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 1800000, annualValue: 900000,
      description: "Spine hardware and biologics agreement with volume-based rebates",
      performancePeriod: "monthly", rebatePayPeriod: "quarterly",
    },
  })
  await addTerm(prisma, contracts.medtronicSpine.id, {
    termName: "Volume Rebate", termType: "volume_rebate", baselineType: "volume_based",
    effectiveStart: oneYearAgo, effectiveEnd: twoYearsFromNow, volumeBaseline: 200,
  }, [
    { tierNumber: 1, volumeMin: 0, volumeMax: 200, rebateType: "fixed_rebate_per_unit", rebateValue: 50 },
    { tierNumber: 2, volumeMin: 200, volumeMax: 500, rebateType: "fixed_rebate_per_unit", rebateValue: 75 },
    { tierNumber: 3, volumeMin: 500, rebateType: "fixed_rebate_per_unit", rebateValue: 100 },
  ])

  // 6. Medtronic Neuromodulation (capital, active)
  contracts.medtronicNeuro = await prisma.contract.create({
    data: {
      contractNumber: "MDT-2025-CAP", name: "Medtronic Neuromodulation Capital",
      vendorId: v.medtronic.id, facilityId: f.heritageRegional.id, productCategoryId: c.neurosurgery.id,
      contractType: "capital", status: "active", effectiveDate: threeMonthsAgo, expirationDate: twoYearsFromNow,
      totalValue: 950000, annualValue: 0,
      description: "Capital agreement for deep brain stimulation and spinal cord stimulation systems",
    },
  })

  // 7. Medtronic Biologics (service, expiring)
  contracts.medtronicBio = await prisma.contract.create({
    data: {
      contractNumber: "MDT-2024-BIO", name: "Medtronic Biologics Agreement",
      vendorId: v.medtronic.id, facilityId: f.heritageRegional.id, productCategoryId: c.biologics.id,
      contractType: "service", status: "expiring", effectiveDate: twoYearsAgo, expirationDate: sixMonthsFromNow,
      totalValue: 600000, annualValue: 300000,
      performancePeriod: "quarterly", rebatePayPeriod: "quarterly",
      description: "Biologics supply and consignment service agreement",
    },
  })
  await addTerm(prisma, contracts.medtronicBio.id, {
    termName: "Growth Rebate", termType: "growth_rebate", baselineType: "growth_based",
    effectiveStart: twoYearsAgo, effectiveEnd: sixMonthsFromNow, growthBaselinePercent: 10,
  }, [
    { tierNumber: 1, spendMin: 0, spendMax: 300000, rebateType: "percent_of_spend", rebateValue: 0.02 },
    { tierNumber: 2, spendMin: 300000, rebateType: "percent_of_spend", rebateValue: 0.04 },
  ])

  // 8. Smith & Nephew Sports Medicine (usage, active)
  contracts.snSports = await prisma.contract.create({
    data: {
      contractNumber: "SN-2025-SM", name: "Smith & Nephew Sports Medicine",
      vendorId: v.smithNephew.id, facilityId: f.lighthouseSurgical.id, productCategoryId: c.sportsMedicine.id,
      contractType: "usage", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 800000, annualValue: 400000,
      performancePeriod: "quarterly", rebatePayPeriod: "semi_annual",
      description: "Sports medicine instruments and soft tissue repair implants",
    },
  })
  await addTerm(prisma, contracts.snSports.id, {
    // W1.U retro B2: exercise `paymentTiming: "semi_annual"` in the demo
    // seed (matches the contract-level rebatePayPeriod set above).
    termName: "Market Share Pricing", termType: "market_share", baselineType: "spend_based",
    paymentTiming: "semi_annual",
    effectiveStart: oneYearAgo, effectiveEnd: twoYearsFromNow, desiredMarketShare: 65,
  }, [
    { tierNumber: 1, marketShareMin: 0, marketShareMax: 50, rebateType: "percent_of_spend", rebateValue: 0.01 },
    { tierNumber: 2, marketShareMin: 50, marketShareMax: 65, rebateType: "percent_of_spend", rebateValue: 0.03 },
    { tierNumber: 3, marketShareMin: 65, rebateType: "percent_of_spend", rebateValue: 0.05 },
  ])

  // 9. Smith & Nephew Wound Care (usage, expired)
  contracts.snWound = await prisma.contract.create({
    data: {
      contractNumber: "SN-2023-WC", name: "Smith & Nephew Wound Care",
      vendorId: v.smithNephew.id, facilityId: f.heritageRegional.id, productCategoryId: c.woundCare.id,
      contractType: "usage", status: "expired", effectiveDate: new Date(now.getFullYear() - 2, 0, 1),
      expirationDate: new Date(now.getFullYear(), 0, 1),
      totalValue: 450000, annualValue: 225000,
      description: "Advanced wound care products including PICO negative pressure system",
    },
  })

  // 10. Arthrex Arthroscopy - Lighthouse (usage, active)
  contracts.arthrexLighthouse = await prisma.contract.create({
    data: {
      contractNumber: "ART-2025-001", name: "Arthrex Arthroscopy - Lighthouse",
      vendorId: v.arthrex.id, facilityId: f.lighthouseSurgical.id, productCategoryId: c.arthroscopy.id,
      contractType: "usage", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 650000, annualValue: 325000,
      performancePeriod: "quarterly", rebatePayPeriod: "quarterly",
      description: "Full arthroscopy product line including FiberWire and anchors",
    },
  })
  await addTerm(prisma, contracts.arthrexLighthouse.id, {
    // W1.U retro B2: exercise `appliesTo: "specific_items"` scope in the
    // demo seed so QA-sanity coverage asserts at least one term binds to
    // a literal item list (via referenceNumbers).
    termName: "Spend Rebate", termType: "spend_rebate", baselineType: "spend_based",
    appliesTo: "specific_items",
    referenceNumbers: ["ART-FW2-001", "ART-SL55-001", "ART-TRT-001"],
    effectiveStart: oneYearAgo, effectiveEnd: twoYearsFromNow, spendBaseline: 150000,
  }, [
    { tierNumber: 1, spendMin: 0, spendMax: 150000, rebateType: "percent_of_spend", rebateValue: 0.015 },
    { tierNumber: 2, spendMin: 150000, spendMax: 325000, rebateType: "percent_of_spend", rebateValue: 0.03 },
    { tierNumber: 3, spendMin: 325000, rebateType: "percent_of_spend", rebateValue: 0.05 },
  ])

  // 11. Arthrex Arthroscopy - Austin (usage, expiring)
  contracts.arthrexAustin = await prisma.contract.create({
    data: {
      contractNumber: "ART-2024-002", name: "Arthrex Arthroscopy - Austin Spine & Joint",
      vendorId: v.arthrex.id, facilityId: f.austinSpine.id, productCategoryId: c.arthroscopy.id,
      contractType: "usage", status: "expiring", effectiveDate: twoYearsAgo, expirationDate: sixMonthsFromNow,
      totalValue: 420000, annualValue: 168000,
      performancePeriod: "quarterly", rebatePayPeriod: "annual",
      description: "Arthroscopy supplies and suture anchors for sports medicine program",
    },
  })
  // 2026-04-26: oracle full-sweep flagged this contract as "0 terms" —
  // a working contract demo should have at least one term so accruals
  // can compute. Add a simple spend-rebate term.
  await addTerm(prisma, contracts.arthrexAustin.id, {
    termName: "Spend Rebate", termType: "spend_rebate", baselineType: "spend_based",
    evaluationPeriod: "annual", paymentTiming: "annual",
    effectiveStart: twoYearsAgo, effectiveEnd: sixMonthsFromNow,
  }, [
    { tierNumber: 1, spendMin: 0, spendMax: 250000, rebateType: "percent_of_spend", rebateValue: 0.02 },
    { tierNumber: 2, spendMin: 250000, spendMax: 500000, rebateType: "percent_of_spend", rebateValue: 0.03 },
    { tierNumber: 3, spendMin: 500000, rebateType: "percent_of_spend", rebateValue: 0.04 },
  ])

  // 12. DePuy Synthes Trauma (usage, active)
  contracts.depuyTrauma = await prisma.contract.create({
    data: {
      contractNumber: "DPS-2025-TRM", name: "DePuy Synthes Trauma",
      vendorId: v.depuySynthes.id, facilityId: f.summitGeneral.id, productCategoryId: c.trauma.id,
      contractType: "usage", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 1200000, annualValue: 600000,
      performancePeriod: "quarterly", rebatePayPeriod: "quarterly",
      description: "Trauma plates, screws, and intramedullary nails",
    },
  })
  await addTerm(prisma, contracts.depuyTrauma.id, {
    // W1.U retro B2: exercise `evaluationPeriod: "quarterly"` and
    // `paymentTiming: "annual"` in the demo seed.
    termName: "Compliance Rebate", termType: "compliance_rebate", baselineType: "spend_based",
    evaluationPeriod: "quarterly", paymentTiming: "annual",
    effectiveStart: oneYearAgo, effectiveEnd: twoYearsFromNow, spendBaseline: 300000,
  }, [
    { tierNumber: 1, spendMin: 0, spendMax: 300000, rebateType: "percent_of_spend", rebateValue: 0.02 },
    { tierNumber: 2, spendMin: 300000, spendMax: 600000, rebateType: "percent_of_spend", rebateValue: 0.035 },
    { tierNumber: 3, spendMin: 600000, rebateType: "percent_of_spend", rebateValue: 0.05 },
  ])

  // 13. DePuy Synthes Multi-Facility (grouped, active)
  contracts.depuyGrouped = await prisma.contract.create({
    data: {
      contractNumber: "DPS-2025-GRP", name: "DePuy Synthes Multi-Facility Joint",
      vendorId: v.depuySynthes.id, productCategoryId: c.jointReplacement.id,
      contractType: "grouped", status: "active", isGrouped: true, isMultiFacility: true,
      effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 3200000, annualValue: 1600000,
      performancePeriod: "quarterly", rebatePayPeriod: "semi_annual",
      description: "Multi-facility ATTUNE knee and PINNACLE hip agreement across Lighthouse and Summit",
    },
  })
  await prisma.contractFacility.createMany({
    data: [
      { contractId: contracts.depuyGrouped.id, facilityId: f.lighthouseCommunity.id },
      { contractId: contracts.depuyGrouped.id, facilityId: f.summitGeneral.id },
    ],
  })

  // 14. Zimmer Biomet Knee (usage, active)
  contracts.zbKnee = await prisma.contract.create({
    data: {
      contractNumber: "ZB-2025-KN", name: "Zimmer Biomet Persona Knee",
      vendorId: v.zimmerBiomet.id, facilityId: f.heritageRegional.id, productCategoryId: c.jointReplacement.id,
      contractType: "usage", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 1600000, annualValue: 533000,
      performancePeriod: "quarterly", rebatePayPeriod: "quarterly",
      description: "Persona total knee system with tiered rebate structure",
    },
  })
  await addTerm(prisma, contracts.zbKnee.id, {
    termName: "Spend Rebate", termType: "spend_rebate", baselineType: "spend_based",
    effectiveStart: oneYearAgo, effectiveEnd: twoYearsFromNow, spendBaseline: 400000,
  }, [
    { tierNumber: 1, spendMin: 0, spendMax: 400000, rebateType: "percent_of_spend", rebateValue: 0.02 },
    { tierNumber: 2, spendMin: 400000, spendMax: 800000, rebateType: "percent_of_spend", rebateValue: 0.04 },
    { tierNumber: 3, spendMin: 800000, rebateType: "percent_of_spend", rebateValue: 0.06 },
  ])

  // 15. Zimmer Biomet Robotic (capital, draft)
  contracts.zbRobotic = await prisma.contract.create({
    data: {
      contractNumber: "ZB-2025-ROB", name: "Zimmer Biomet ROSA Robot",
      vendorId: v.zimmerBiomet.id, facilityId: f.heritageRegional.id,
      contractType: "capital", status: "draft", effectiveDate: now, expirationDate: twoYearsFromNow,
      totalValue: 1100000, annualValue: 0,
      description: "ROSA robotic surgical assistant capital lease (pending approval)",
    },
  })

  // 16. Integra Dural Repair (usage, active)
  contracts.integraDural = await prisma.contract.create({
    data: {
      contractNumber: "ILS-2025-DR", name: "Integra Dural Repair",
      vendorId: v.integra.id, facilityId: f.lighthouseCommunity.id, productCategoryId: c.neurosurgery.id,
      contractType: "usage", status: "active", effectiveDate: oneYearAgo, expirationDate: oneYearFromNow,
      totalValue: 280000, annualValue: 140000,
      performancePeriod: "quarterly", rebatePayPeriod: "annual",
      description: "DuraGen and DuraMatrix dural repair products",
    },
  })
  await addTerm(prisma, contracts.integraDural.id, {
    termName: "Volume Rebate", termType: "volume_rebate", baselineType: "volume_based",
    effectiveStart: oneYearAgo, effectiveEnd: oneYearFromNow, volumeBaseline: 60,
  }, [
    { tierNumber: 1, volumeMin: 0, volumeMax: 60, rebateType: "fixed_rebate_per_unit", rebateValue: 25 },
    { tierNumber: 2, volumeMin: 60, rebateType: "fixed_rebate_per_unit", rebateValue: 50 },
  ])

  // 17. NuVasive Spine Interbody (usage, draft)
  contracts.nuvasiveSpine = await prisma.contract.create({
    data: {
      contractNumber: "NUV-2025-SP", name: "NuVasive Spine Interbody",
      vendorId: v.nuvasive.id, facilityId: f.summitGeneral.id, productCategoryId: c.spine.id,
      contractType: "usage", status: "draft", effectiveDate: now, expirationDate: twoYearsFromNow,
      totalValue: 720000, annualValue: 360000,
      performancePeriod: "quarterly", rebatePayPeriod: "quarterly",
      description: "XLIF and TLIF interbody fusion cages (pending finalization)",
    },
  })

  // 18. Hologic Mammography (service, active)
  contracts.hologicMammo = await prisma.contract.create({
    data: {
      contractNumber: "HLG-2025-SVC", name: "Hologic Mammography Service",
      vendorId: v.hologic.id, facilityId: f.heritageRegional.id, productCategoryId: c.imaging.id,
      contractType: "service", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 180000, annualValue: 60000,
      description: "Genius 3D mammography system service and maintenance agreement",
    },
  })

  // 18b. Stryker Mako Service Plan (service, active) — for Lighthouse
  // Surgical Center so the ServiceSlaCard renders on the demo facility.
  contracts.strykerMakoService = await prisma.contract.create({
    data: {
      contractNumber: "STK-2025-MKS", name: "Stryker Mako Service Plan",
      vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id, productCategoryId: c.surgicalInstruments.id,
      contractType: "service", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 240000, annualValue: 80000,
      description: "Annual service + uptime SLA for the Mako SmartRobotics system. 4-hour response, 99.9% uptime target.",
    },
  })

  // 19. Medtronic Spine — Category-Scoped Rebate (Lighthouse Surgical)
  // W1.U retro B2: seed a specific_category-scoped term at the demo
  // facility so:
  //   (a) QA-sanity coverage sees at least one `appliesTo: "specific_category"`
  //       contract with populated `categories`, and
  //   (b) `recomputeAccrualForContract` can be exercised end-to-end to
  //       prove the W1.U-A category-scope fix is honored in real seed data.
  // Medtronic's vendor catalog in seedCOGForContracts is Spine-only, so
  // the synthetic COG generated for this contract will automatically land
  // in the "Spine" category — giving the term a meaningful earned rebate
  // to compute. Uses `evaluationPeriod: "monthly"`, `paymentTiming:
  // "monthly"`, and `rebateMethod: "marginal"` to round out QA-sanity
  // enum-coverage for those fields.
  contracts.medtronicSpineSurgical = await prisma.contract.create({
    data: {
      contractNumber: "MDT-2025-SPSURG", name: "Medtronic Spine Category Rebate - Lighthouse Surgical",
      vendorId: v.medtronic.id, facilityId: f.lighthouseSurgical.id, productCategoryId: c.spine.id,
      contractType: "usage", status: "active", effectiveDate: oneYearAgo, expirationDate: twoYearsFromNow,
      totalValue: 900000, annualValue: 300000,
      performancePeriod: "monthly", rebatePayPeriod: "monthly",
      description: "Category-scoped (Spine) marginal-tier rebate agreement with monthly evaluation and monthly payment cadence",
    },
  })
  await addTerm(prisma, contracts.medtronicSpineSurgical.id, {
    termName: "Spine Category Spend Rebate", termType: "spend_rebate", baselineType: "spend_based",
    evaluationPeriod: "monthly", paymentTiming: "monthly",
    appliesTo: "specific_category", categories: ["Spine"],
    rebateMethod: "marginal",
    effectiveStart: oneYearAgo, effectiveEnd: twoYearsFromNow, spendBaseline: 200000,
  }, [
    { tierNumber: 1, spendMin: 0, spendMax: 200000, rebateType: "percent_of_spend", rebateValue: 0.02 },
    { tierNumber: 2, spendMin: 200000, spendMax: 400000, rebateType: "percent_of_spend", rebateValue: 0.035 },
    { tierNumber: 3, spendMin: 400000, rebateType: "percent_of_spend", rebateValue: 0.05 },
  ])

  console.log("  Contracts: 19 (13 active, 2 expiring, 2 expired/draft, 2 draft)")

  return { contracts }
}

export type Contracts = Awaited<ReturnType<typeof seedContracts>>["contracts"]
