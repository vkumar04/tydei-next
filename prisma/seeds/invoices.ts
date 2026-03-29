import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"
import type { Vendors } from "./vendors"

const now = new Date()

function invDate(monthsAgo: number, day: number) {
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, day)
}

export async function seedInvoices(
  prisma: PrismaClient,
  deps: { facilities: Facilities; vendors: Vendors }
) {
  const { facilities: f, vendors: v } = deps
  let count = 0

  // Invoice 1: Stryker knee — paid, matching contract pricing
  const inv1 = await prisma.invoice.create({
    data: {
      invoiceNumber: "STK-INV-20250115", facilityId: f.lighthouseSurgical.id, vendorId: v.stryker.id,
      invoiceDate: invDate(2, 20), totalInvoiceCost: 22250, status: "paid",
    },
  })
  await prisma.invoiceLineItem.createMany({
    data: [
      { invoiceId: inv1.id, inventoryDescription: "Triathlon Total Knee System", vendorItemNo: "STK-TKS-001", invoicePrice: 4500, invoiceQuantity: 3, totalLineCost: 13500, contractPrice: 4500, variancePercent: 0 },
      { invoiceId: inv1.id, inventoryDescription: "Mako SmartRobotics Disposable Kit", vendorItemNo: "STK-MKD-001", invoicePrice: 850, invoiceQuantity: 3, totalLineCost: 2550, contractPrice: 850, variancePercent: 0 },
      { invoiceId: inv1.id, inventoryDescription: "X3 Poly Liner", vendorItemNo: "STK-X3L-001", invoicePrice: 1200, invoiceQuantity: 3, totalLineCost: 3600, contractPrice: 1200, variancePercent: 0 },
    ],
  })
  count++

  // Invoice 2: Medtronic spine — pending, minor variance
  const inv2 = await prisma.invoice.create({
    data: {
      invoiceNumber: "MDT-INV-20250210", facilityId: f.lighthouseCommunity.id, vendorId: v.medtronic.id,
      invoiceDate: invDate(1, 15), totalInvoiceCost: 24740, status: "pending",
    },
  })
  await prisma.invoiceLineItem.createMany({
    data: [
      { invoiceId: inv2.id, inventoryDescription: "CD HORIZON SOLERA Spinal System", vendorItemNo: "MDT-SOL-001", invoicePrice: 9100, invoiceQuantity: 1, totalLineCost: 9100, contractPrice: 8900, variancePercent: 2.25, isFlagged: true },
      { invoiceId: inv2.id, inventoryDescription: "CERTA Plus Pedicle Screw 6.5x45", vendorItemNo: "MDT-CPS-645", invoicePrice: 520, invoiceQuantity: 8, totalLineCost: 4160, contractPrice: 520, variancePercent: 0 },
      { invoiceId: inv2.id, inventoryDescription: "PRESTIGE LP Cervical Disc", vendorItemNo: "MDT-PLP-001", invoicePrice: 6200, invoiceQuantity: 1, totalLineCost: 6200, contractPrice: 6200, variancePercent: 0 },
      { invoiceId: inv2.id, inventoryDescription: "INFUSE Bone Graft Large Kit", vendorItemNo: "MDT-IBG-001", invoicePrice: 3500, invoiceQuantity: 1, totalLineCost: 3500, contractPrice: 3400, variancePercent: 2.94, isFlagged: true },
      { invoiceId: inv2.id, inventoryDescription: "Navigation Drape Single-Use", vendorItemNo: "MDT-OAD-001", invoicePrice: 178, invoiceQuantity: 10, totalLineCost: 1780 },
    ],
  })
  count++

  // Invoice 3: DePuy trauma — paid
  const inv3 = await prisma.invoice.create({
    data: {
      invoiceNumber: "DPS-INV-20250220", facilityId: f.summitGeneral.id, vendorId: v.depuySynthes.id,
      invoiceDate: invDate(1, 22), totalInvoiceCost: 15540, status: "paid",
    },
  })
  await prisma.invoiceLineItem.createMany({
    data: [
      { invoiceId: inv3.id, inventoryDescription: "3.5mm LCP Plate 8-hole", vendorItemNo: "DPS-LCP-835", invoicePrice: 890, invoiceQuantity: 4, totalLineCost: 3560, contractPrice: 890, variancePercent: 0 },
      { invoiceId: inv3.id, inventoryDescription: "TFN-ADVANCED Proximal Femoral Nail", vendorItemNo: "DPS-TFN-001", invoicePrice: 2400, invoiceQuantity: 2, totalLineCost: 4800, contractPrice: 2400, variancePercent: 0 },
      { invoiceId: inv3.id, inventoryDescription: "4.5mm Cortical Screw 40mm", vendorItemNo: "DPS-CS-4540", invoicePrice: 65, invoiceQuantity: 30, totalLineCost: 1950, contractPrice: 65, variancePercent: 0 },
      { invoiceId: inv3.id, inventoryDescription: "ATTUNE Knee System Primary", vendorItemNo: "DPS-ATK-001", invoicePrice: 4500, invoiceQuantity: 1, totalLineCost: 4500, contractPrice: 4200, variancePercent: 7.14, isFlagged: true },
    ],
  })
  count++

  // Invoice 4: Integra neurosurgery — disputed (pricing error)
  const inv4 = await prisma.invoice.create({
    data: {
      invoiceNumber: "ILS-INV-20250305", facilityId: f.lighthouseCommunity.id, vendorId: v.integra.id,
      invoiceDate: invDate(0, 10), totalInvoiceCost: 7840, status: "disputed",
    },
  })
  await prisma.invoiceLineItem.createMany({
    data: [
      { invoiceId: inv4.id, inventoryDescription: "DuraGen Plus Dural Matrix 4x5cm", vendorItemNo: "ILS-DGP-45", invoicePrice: 1380, invoiceQuantity: 3, totalLineCost: 4140, contractPrice: 1250, variancePercent: 10.4, isFlagged: true },
      { invoiceId: inv4.id, inventoryDescription: "DuraMatrix Onlay 6x8cm", vendorItemNo: "ILS-DMO-68", invoicePrice: 980, invoiceQuantity: 2, totalLineCost: 1960, contractPrice: 980, variancePercent: 0 },
      { invoiceId: inv4.id, inventoryDescription: "CUSA Clarity Ultrasonic Tips", vendorItemNo: "ILS-CCT-001", invoicePrice: 580, invoiceQuantity: 3, totalLineCost: 1740, contractPrice: 680 },
    ],
  })
  count++

  // Invoice 5: Smith & Nephew sports med — paid
  const inv5 = await prisma.invoice.create({
    data: {
      invoiceNumber: "SN-INV-20250118", facilityId: f.lighthouseSurgical.id, vendorId: v.smithNephew.id,
      invoiceDate: invDate(2, 25), totalInvoiceCost: 11280, status: "paid",
    },
  })
  await prisma.invoiceLineItem.createMany({
    data: [
      { invoiceId: inv5.id, inventoryDescription: "FAST-FIX 360 Meniscal Repair", vendorItemNo: "SN-FF360-001", invoicePrice: 650, invoiceQuantity: 8, totalLineCost: 5200, contractPrice: 650, variancePercent: 0 },
      { invoiceId: inv5.id, inventoryDescription: "HEALICOIL Suture Anchor 5.5mm", vendorItemNo: "SN-HC55-001", invoicePrice: 480, invoiceQuantity: 6, totalLineCost: 2880, contractPrice: 480, variancePercent: 0 },
      { invoiceId: inv5.id, inventoryDescription: "DYONICS Platinum Shaver Blade", vendorItemNo: "SN-DPB-001", invoicePrice: 320, invoiceQuantity: 10, totalLineCost: 3200, contractPrice: 320, variancePercent: 0 },
    ],
  })
  count++

  // Invoice 6: Zimmer Biomet knee — pending
  const inv6 = await prisma.invoice.create({
    data: {
      invoiceNumber: "ZB-INV-20250302", facilityId: f.heritageRegional.id, vendorId: v.zimmerBiomet.id,
      invoiceDate: invDate(0, 5), totalInvoiceCost: 17700, status: "pending",
    },
  })
  await prisma.invoiceLineItem.createMany({
    data: [
      { invoiceId: inv6.id, inventoryDescription: "Persona TKA Primary System", vendorItemNo: "ZB-PTK-001", invoicePrice: 4800, invoiceQuantity: 2, totalLineCost: 9600, contractPrice: 4800, variancePercent: 0 },
      { invoiceId: inv6.id, inventoryDescription: "Vivacit-E Poly Insert", vendorItemNo: "ZB-VEP-001", invoicePrice: 1100, invoiceQuantity: 2, totalLineCost: 2200, contractPrice: 1100, variancePercent: 0 },
      { invoiceId: inv6.id, inventoryDescription: "Taperloc Complete Hip Stem", vendorItemNo: "ZB-TCH-001", invoicePrice: 2900, invoiceQuantity: 1, totalLineCost: 2900, contractPrice: 2900, variancePercent: 0 },
      { invoiceId: inv6.id, inventoryDescription: "G7 Acetabular System", vendorItemNo: "ZB-G7A-001", invoicePrice: 2600, invoiceQuantity: 1, totalLineCost: 2600, contractPrice: 2600, variancePercent: 0 },
    ],
  })
  count++

  console.log(`  Invoices: ${count} (with line items)`)

  return count
}
