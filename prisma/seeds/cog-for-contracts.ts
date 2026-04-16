import type { PrismaClient, Prisma } from "@prisma/client"

// Vendor-specific realistic product catalogs used to generate synthetic COG
// records that match active contracts. These are intentionally scoped to the
// three Lighthouse active-contract vendors used in the demo.
const VENDOR_PRODUCTS: Record<
  string,
  { description: string; vendorItemNo: string; unitCost: number; category: string }[]
> = {
  Stryker: [
    { description: "Triathlon Total Knee System", vendorItemNo: "STK-TKS-001", unitCost: 4500, category: "Joint Replacement" },
    { description: "Mako SmartRobotics Disposable Kit", vendorItemNo: "STK-MKD-001", unitCost: 850, category: "Joint Replacement" },
    { description: "Accolade II Hip Stem", vendorItemNo: "STK-AHS-001", unitCost: 3200, category: "Joint Replacement" },
    { description: "Trident II Acetabular Shell", vendorItemNo: "STK-TAS-001", unitCost: 2800, category: "Joint Replacement" },
    { description: "X3 Poly Liner", vendorItemNo: "STK-X3L-001", unitCost: 1200, category: "Joint Replacement" },
    { description: "Triathlon Revision Knee System", vendorItemNo: "STK-TRV-001", unitCost: 7800, category: "Joint Replacement" },
    { description: "Triathlon Tibial Baseplate Size 5", vendorItemNo: "STK-TTB-005", unitCost: 1800, category: "Joint Replacement" },
    { description: "Restoris MCK Unicondylar Knee", vendorItemNo: "STK-RMC-001", unitCost: 3400, category: "Joint Replacement" },
  ],
  "Smith & Nephew": [
    { description: "FAST-FIX 360 Meniscal Repair", vendorItemNo: "SN-FF360-001", unitCost: 650, category: "Sports Medicine" },
    { description: "HEALICOIL Suture Anchor 5.5mm", vendorItemNo: "SN-HC55-001", unitCost: 480, category: "Sports Medicine" },
    { description: "DYONICS Platinum Shaver Blade", vendorItemNo: "SN-DPB-001", unitCost: 320, category: "Arthroscopy" },
    { description: "BIORAPTOR 2.9 Suture Anchor", vendorItemNo: "SN-BR29-001", unitCost: 410, category: "Sports Medicine" },
    { description: "ENDOBUTTON CL Fixation Device", vendorItemNo: "SN-EBCL-001", unitCost: 520, category: "Sports Medicine" },
    { description: "WEREWOLF Coblation Wand", vendorItemNo: "SN-WWC-001", unitCost: 380, category: "Arthroscopy" },
    { description: "DYONICS 25 4mm Arthroscope", vendorItemNo: "SN-D25-4", unitCost: 2200, category: "Arthroscopy" },
    { description: "Q-FIX All-Suture Anchor", vendorItemNo: "SN-QFX-001", unitCost: 460, category: "Sports Medicine" },
  ],
  Medtronic: [
    { description: "PRESTIGE LP Cervical Disc", vendorItemNo: "MDT-PLP-001", unitCost: 6200, category: "Spine" },
    { description: "CD HORIZON SOLERA Spinal System", vendorItemNo: "MDT-SOL-001", unitCost: 8900, category: "Spine" },
    { description: "CERTA Plus Pedicle Screw 6.5x45", vendorItemNo: "MDT-CPS-645", unitCost: 520, category: "Spine" },
    { description: "CAPSTONE PEEK Interbody Spacer", vendorItemNo: "MDT-CAP-001", unitCost: 2100, category: "Spine" },
    { description: "INFUSE Bone Graft Large Kit", vendorItemNo: "MDT-IBG-001", unitCost: 3400, category: "Spine" },
    { description: "VERTEX SELECT Reconstruction System", vendorItemNo: "MDT-VSR-001", unitCost: 7500, category: "Spine" },
    { description: "DIVERGENCE-L Interbody Cage", vendorItemNo: "MDT-DIV-001", unitCost: 2600, category: "Spine" },
    { description: "TSRH 3Dx Spinal System Rod", vendorItemNo: "MDT-TSR-001", unitCost: 950, category: "Spine" },
  ],
}

function pickProduct(vendorName: string) {
  const list = VENDOR_PRODUCTS[vendorName] ?? VENDOR_PRODUCTS.Stryker
  return list[Math.floor(Math.random() * list.length)]
}

function randomDateBetween(start: Date, end: Date): Date {
  const s = start.getTime()
  const e = end.getTime()
  const t = s + Math.random() * (e - s)
  return new Date(t)
}

export async function seedCOGForContracts(prisma: PrismaClient) {
  const contracts = await prisma.contract.findMany({
    where: { status: { in: ["active", "expiring"] } },
    include: {
      vendor: true,
      terms: { include: { tiers: { orderBy: { tierNumber: "asc" } } } },
      contractFacilities: { select: { facilityId: true } },
    },
  })

  if (contracts.length === 0) {
    console.log("  COG-for-Contracts: no active contracts, skipping")
    return 0
  }

  const RECORDS_PER_CONTRACT = 160
  let totalCogCreated = 0
  let totalPeriodsCreated = 0
  let totalRebatesCreated = 0

  for (const contract of contracts) {
    const vendorName = contract.vendor.name
    const start = new Date(contract.effectiveDate)
    const end = new Date(contract.expirationDate)

    // Every facility this contract touches (direct + join-table).
    const facilityIds = new Set<string>()
    if (contract.facilityId) facilityIds.add(contract.facilityId)
    for (const cf of contract.contractFacilities) facilityIds.add(cf.facilityId)
    if (facilityIds.size === 0) continue

    // Target spend: 85% of first tier → puts each contract in a realistic
    // "approaching tier 1" state that the rebate optimizer can surface as
    // a near-tier opportunity. If no tiers exist on the contract, seed
    // a flat $200k.
    const firstTermTier = contract.terms
      .flatMap((t) => t.tiers)
      .sort((a, b) => a.tierNumber - b.tierNumber)[0]
    const firstTierMin =
      firstTermTier != null ? Number(firstTermTier.spendMin) : 250_000
    const targetSpend = Math.max(firstTierMin * 0.85, 200_000)

    // Split target across facilities so each gets proportional COG.
    const perFacility = targetSpend / facilityIds.size
    const recordsPerFacility = Math.max(40, Math.floor(RECORDS_PER_CONTRACT / facilityIds.size))
    const perRecord = perFacility / recordsPerFacility

    for (const fId of facilityIds) {
      const rows: Prisma.COGRecordCreateManyInput[] = []
      for (let i = 0; i < recordsPerFacility; i++) {
        const product = pickProduct(vendorName)
        const qty = Math.max(1, Math.round(perRecord / product.unitCost))
        const extended = product.unitCost * qty
        const txd = randomDateBetween(start, end)
        rows.push({
          facilityId: fId,
          vendorId: contract.vendorId,
          vendorName,
          inventoryNumber: `SYN-${contract.id.slice(-6)}-${i.toString().padStart(4, "0")}`,
          inventoryDescription: product.description,
          vendorItemNo: product.vendorItemNo,
          poNumber: `PO-${txd.getFullYear()}-${(20000 + totalCogCreated + i).toString().padStart(5, "0")}`,
          unitCost: product.unitCost,
          quantity: qty,
          extendedPrice: extended,
          transactionDate: txd,
          category: product.category,
        })
      }
      const cogResult = await prisma.cOGRecord.createMany({ data: rows })
      totalCogCreated += cogResult.count

      // ── Generate monthly ContractPeriod rows spanning effective→now ──
      // Each period accumulates its share of COG, computes the tier
      // achieved against the contract's first term tier structure, and
      // writes a Rebate row for the period's rebate earned/collected.
      const now = new Date()
      const periodEnd = end.getTime() < now.getTime() ? end : now
      const monthCount = Math.max(
        1,
        Math.min(
          12,
          Math.round(
            (periodEnd.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30),
          ),
        ),
      )
      const rows_sorted = [...rows].sort(
        (a, b) =>
          (a.transactionDate instanceof Date ? a.transactionDate : new Date(a.transactionDate as string)).getTime() -
          (b.transactionDate instanceof Date ? b.transactionDate : new Date(b.transactionDate as string)).getTime(),
      )
      const spendPerPeriod = perFacility / monthCount

      const primaryTerm = contract.terms[0]
      const tiers = primaryTerm?.tiers ?? []

      for (let m = 0; m < monthCount; m++) {
        const ps = new Date(start)
        ps.setMonth(ps.getMonth() + m)
        const pe = new Date(ps)
        pe.setMonth(pe.getMonth() + 1)
        pe.setDate(pe.getDate() - 1)
        if (pe.getTime() > periodEnd.getTime()) pe.setTime(periodEnd.getTime())

        // Cumulative spend up to this period end
        const cumulative = spendPerPeriod * (m + 1)

        // Determine tier achieved on cumulative
        let tierAchieved = 0
        let activeTierIdx = -1
        for (let t = 0; t < tiers.length; t++) {
          if (cumulative >= Number(tiers[t].spendMin)) {
            tierAchieved = tiers[t].tierNumber
            activeTierIdx = t
          }
        }
        const tierRebatePercent =
          activeTierIdx >= 0 ? Number(tiers[activeTierIdx].rebateValue) : 0
        const periodSpend = spendPerPeriod
        const rebateEarned = (periodSpend * tierRebatePercent) / 100
        const rebateCollected = rebateEarned * 0.8 // 80% collected on average

        if (primaryTerm) {
          const period = await prisma.contractPeriod.create({
            data: {
              contractId: contract.id,
              facilityId: fId,
              periodStart: ps,
              periodEnd: pe,
              totalSpend: periodSpend,
              tierAchieved,
              rebateEarned,
              rebateCollected,
            },
          })
          totalPeriodsCreated++

          if (rebateEarned > 0) {
            await prisma.rebate.create({
              data: {
                contractId: contract.id,
                facilityId: fId,
                periodId: period.id,
                rebateEarned,
                rebateCollected,
                payPeriodStart: ps,
                payPeriodEnd: pe,
                collectionDate: rebateCollected >= rebateEarned ? pe : null,
              },
            })
            totalRebatesCreated++
          }
        }
      }
    }

    console.log(
      `  COG-for-Contracts: ${contract.name} (${vendorName}) × ${facilityIds.size} facilities`,
    )
  }

  console.log(
    `  COG-for-Contracts total: ${totalCogCreated} COG records, ${totalPeriodsCreated} periods, ${totalRebatesCreated} rebates`,
  )
  return totalCogCreated
}
