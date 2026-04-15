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
    where: {
      status: { in: ["active", "expiring"] },
      vendor: { name: { in: ["Stryker", "Smith & Nephew", "Medtronic"] } },
    },
    include: {
      vendor: true,
      terms: { include: { tiers: { orderBy: { tierNumber: "asc" } } } },
    },
  })

  if (contracts.length === 0) {
    console.log("  COG-for-Contracts: no matching active contracts, skipping")
    return 0
  }

  const RECORDS_PER_CONTRACT = 160
  let totalCreated = 0

  for (const contract of contracts) {
    const vendorName = contract.vendor.name
    const start = new Date(contract.effectiveDate)
    const end = new Date(contract.expirationDate)

    // Find the first tier's spendMin from embedded term tiers.
    const firstTermTier = contract.terms
      .flatMap((t) => t.tiers)
      .sort((a, b) => a.tierNumber - b.tierNumber)[0]
    const firstTierMin =
      firstTermTier != null ? Number(firstTermTier.spendMin) : 250_000

    // Target: 1.2× first tier min so we clearly hit tier 1.
    const targetSpend = Math.max(firstTierMin * 1.2, 150_000)
    const perRecord = targetSpend / RECORDS_PER_CONTRACT

    const rows: Prisma.COGRecordCreateManyInput[] = []
    for (let i = 0; i < RECORDS_PER_CONTRACT; i++) {
      const product = pickProduct(vendorName)
      // Scale quantity so roughly each row contributes perRecord to spend
      const qty = Math.max(1, Math.round(perRecord / product.unitCost))
      const extended = product.unitCost * qty
      rows.push({
        facilityId: contract.facilityId ?? "",
        vendorId: contract.vendorId,
        vendorName,
        inventoryNumber: `SYN-${contract.id.slice(-6)}-${i.toString().padStart(4, "0")}`,
        inventoryDescription: product.description,
        vendorItemNo: product.vendorItemNo,
        unitCost: product.unitCost,
        quantity: qty,
        extendedPrice: extended,
        transactionDate: randomDateBetween(start, end),
        category: product.category,
      })
    }

    if (!rows[0]?.facilityId) {
      console.log(`  COG-for-Contracts: contract ${contract.name} has no facilityId, skipping`)
      continue
    }

    const result = await prisma.cOGRecord.createMany({ data: rows })
    totalCreated += result.count
    const summedSpend = rows.reduce(
      (s: number, r) => s + Number(r.extendedPrice ?? 0),
      0,
    )
    console.log(
      `  COG-for-Contracts: ${contract.name} → ${result.count} records, ~$${summedSpend.toLocaleString()}`,
    )
  }

  console.log(`  COG-for-Contracts total: ${totalCreated}`)
  return totalCreated
}
