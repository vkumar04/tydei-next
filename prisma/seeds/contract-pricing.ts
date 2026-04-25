import type { PrismaClient } from "@prisma/client"

/**
 * Seed `ContractPricing` rows for every active/expiring contract using
 * the same VENDOR_PRODUCTS catalog the COG generator uses, so the
 * vendor-item-numbers in COGRecord and CaseSupply rows actually have a
 * contract pricing row to match against.
 *
 * Why this exists (Charles 2026-04-25):
 *
 * Pre-2026-04-25 every demo contract had ZERO pricingItems. That meant:
 *   - "On-Contract %" was 0.0% on Case Costing (Bug 27)
 *   - COG enrichment couldn't flip rows to `on_contract`
 *   - Rebate Optimizer showed $0 potential for every contract
 *   - Reports' contract pricing coverage was 0%
 *
 * Charles read these as "broken engines" but the engines were fine —
 * they had nothing to compute against. Populating ContractPricing is
 * the missing seed step that makes the demo demonstrate the system's
 * behavior end-to-end.
 *
 * Strategy: copy each vendor's product catalog onto every active
 * contract for that vendor, with a contract price ~85% of the COG list
 * price (a realistic 15% negotiated discount). This produces enough
 * coverage that:
 *   - Every COG row at the demo facility for a contracted vendor
 *     matches a pricing row
 *   - On-Contract % goes from 0% to ~95%+ on demo Case Costing
 *   - Rebate Optimizer projections show real numbers
 *
 * Idempotent: deletes existing pricing for each contract before
 * inserting, so re-running the seed doesn't create duplicates.
 */

// Mirrored from prisma/seeds/cog-for-contracts.ts so this seed is
// self-contained and can be re-run without that file's side effects.
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
    { description: "Navigation Tracking Array", vendorItemNo: "STK-NTA-001", unitCost: 450, category: "Surgical Instruments" },
    { description: "System 8 Power Drill", vendorItemNo: "STK-S8D-001", unitCost: 2200, category: "Surgical Instruments" },
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
  Arthrex: [
    { description: "FiberWire #2 Suture Pack", vendorItemNo: "ART-FW2-001", unitCost: 85, category: "Arthroscopy" },
    { description: "SwiveLock Anchor 5.5mm", vendorItemNo: "ART-SL55-001", unitCost: 420, category: "Sports Medicine" },
    { description: "TightRope RT Implant", vendorItemNo: "ART-TRT-001", unitCost: 580, category: "Sports Medicine" },
    { description: "NanoGraft DBM Putty 5cc", vendorItemNo: "ART-NG5-001", unitCost: 350, category: "Biologics" },
    { description: "BioComposite Corkscrew 5.5mm", vendorItemNo: "ART-BC55-001", unitCost: 395, category: "Arthroscopy" },
    { description: "SpeedBridge Implant System", vendorItemNo: "ART-SBI-001", unitCost: 720, category: "Sports Medicine" },
  ],
  "DePuy Synthes": [
    { description: "ATTUNE Knee System Primary", vendorItemNo: "DPS-ATK-001", unitCost: 4200, category: "Joint Replacement" },
    { description: "PINNACLE Hip System", vendorItemNo: "DPS-PHI-001", unitCost: 3800, category: "Joint Replacement" },
    { description: "SIGMA Fixed Bearing Knee", vendorItemNo: "DPS-SFK-001", unitCost: 3900, category: "Joint Replacement" },
    { description: "ATTUNE Revision Knee System", vendorItemNo: "DPS-ATR-001", unitCost: 8200, category: "Joint Replacement" },
    { description: "3.5mm LCP Plate 8-hole", vendorItemNo: "DPS-LCP-835", unitCost: 890, category: "Trauma" },
    { description: "TFN-ADVANCED Proximal Femoral Nail", vendorItemNo: "DPS-TFN-001", unitCost: 2400, category: "Trauma" },
  ],
  "Integra LifeSciences": [
    { description: "DuraGen Plus Dural Matrix 4x5cm", vendorItemNo: "ILS-DGP-45", unitCost: 1250, category: "Neurosurgery" },
    { description: "DuraMatrix Onlay 6x8cm", vendorItemNo: "ILS-DMO-68", unitCost: 980, category: "Neurosurgery" },
    { description: "CUSA Clarity Ultrasonic Tips", vendorItemNo: "ILS-CCT-001", unitCost: 680, category: "Neurosurgery" },
    { description: "Mayfield Skull Clamp Pins", vendorItemNo: "ILS-MSC-001", unitCost: 95, category: "Neurosurgery" },
  ],
}

// Negotiated contract price = listPrice × CONTRACT_DISCOUNT_FACTOR.
// 0.85 means a 15% negotiated discount off the COG/list price.
const CONTRACT_DISCOUNT_FACTOR = 0.85

export async function seedContractPricing(prisma: PrismaClient): Promise<{
  contracts: number
  rows: number
  skipped: number
}> {
  // Pull every active/expiring contract; skip ones whose vendor isn't
  // in the catalog (we'd have nothing meaningful to seed).
  const contracts = await prisma.contract.findMany({
    where: { status: { in: ["active", "expiring"] } },
    select: {
      id: true,
      name: true,
      contractType: true,
      vendor: { select: { name: true } },
    },
  })

  let totalRows = 0
  let touchedContracts = 0
  let skipped = 0
  for (const c of contracts) {
    // Pricing-only contracts already represent a pricing catalog by
    // definition; usage / capital / service / tie_in / grouped all
    // benefit from pricing rows (capital still needs them so the
    // capital part of a tie-in matches; pricing doesn't have to be
    // exhaustive but should at least cover the COG inventory).
    const products = VENDOR_PRODUCTS[c.vendor.name]
    if (!products || products.length === 0) {
      skipped += 1
      continue
    }
    // Idempotent: clear and re-insert.
    await prisma.contractPricing.deleteMany({ where: { contractId: c.id } })
    const data = products.map((p) => ({
      contractId: c.id,
      vendorItemNo: p.vendorItemNo,
      description: p.description,
      category: p.category,
      unitPrice: Number((p.unitCost * CONTRACT_DISCOUNT_FACTOR).toFixed(2)),
      listPrice: p.unitCost,
      uom: "EA",
    }))
    const result = await prisma.contractPricing.createMany({ data })
    totalRows += result.count
    touchedContracts += 1
  }
  console.log(
    `  Contract Pricing: ${totalRows} rows across ${touchedContracts} contracts (${skipped} skipped — vendor not in catalog)`,
  )
  return { contracts: touchedContracts, rows: totalRows, skipped }
}
