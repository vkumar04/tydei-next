import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"
import type { Vendors } from "./vendors"

const now = new Date()

function poDate(monthsAgo: number, day: number) {
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, day)
}

export async function seedPurchaseOrders(
  prisma: PrismaClient,
  deps: { facilities: Facilities; vendors: Vendors }
) {
  const { facilities: f, vendors: v } = deps
  let count = 0

  // PO 1: Stryker knee implants at Lighthouse (completed)
  const po1 = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-2025-001", facilityId: f.lighthouseSurgical.id, vendorId: v.stryker.id,
      orderDate: poDate(2, 5), totalCost: 22250, status: "completed",
    },
  })
  await prisma.pOLineItem.createMany({
    data: [
      { purchaseOrderId: po1.id, inventoryDescription: "Triathlon Total Knee System", vendorItemNo: "STK-TKS-001", quantity: 3, unitPrice: 4500, extendedPrice: 13500 },
      { purchaseOrderId: po1.id, inventoryDescription: "Mako SmartRobotics Disposable Kit", vendorItemNo: "STK-MKD-001", quantity: 3, unitPrice: 850, extendedPrice: 2550 },
      { purchaseOrderId: po1.id, inventoryDescription: "X3 Poly Liner", vendorItemNo: "STK-X3L-001", quantity: 3, unitPrice: 1200, extendedPrice: 3600 },
      { purchaseOrderId: po1.id, inventoryDescription: "Triathlon Tibial Baseplate Size 5", vendorItemNo: "STK-TTB-005", quantity: 3, unitPrice: 1800, extendedPrice: 5400, isOffContract: true },
    ],
  })
  count++

  // PO 2: Medtronic spine at Lighthouse Community (approved)
  const po2 = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-2025-002", facilityId: f.lighthouseCommunity.id, vendorId: v.medtronic.id,
      orderDate: poDate(1, 10), totalCost: 24440, status: "approved",
    },
  })
  await prisma.pOLineItem.createMany({
    data: [
      { purchaseOrderId: po2.id, inventoryDescription: "CD HORIZON SOLERA Spinal System", vendorItemNo: "MDT-SOL-001", quantity: 1, unitPrice: 8900, extendedPrice: 8900 },
      { purchaseOrderId: po2.id, inventoryDescription: "CERTA Plus Pedicle Screw 6.5x45", vendorItemNo: "MDT-CPS-645", quantity: 8, unitPrice: 520, extendedPrice: 4160 },
      { purchaseOrderId: po2.id, inventoryDescription: "PRESTIGE LP Cervical Disc", vendorItemNo: "MDT-PLP-001", quantity: 1, unitPrice: 6200, extendedPrice: 6200 },
      { purchaseOrderId: po2.id, inventoryDescription: "INFUSE Bone Graft Large Kit", vendorItemNo: "MDT-IBG-001", quantity: 1, unitPrice: 3400, extendedPrice: 3400 },
      { purchaseOrderId: po2.id, inventoryDescription: "Navigation Drape Single-Use", vendorItemNo: "MDT-OAD-001", quantity: 10, unitPrice: 178, extendedPrice: 1780 },
    ],
  })
  count++

  // PO 3: DePuy trauma at Summit (sent)
  const po3 = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-2025-003", facilityId: f.summitGeneral.id, vendorId: v.depuySynthes.id,
      orderDate: poDate(1, 18), totalCost: 15340, status: "sent",
    },
  })
  await prisma.pOLineItem.createMany({
    data: [
      { purchaseOrderId: po3.id, inventoryDescription: "3.5mm LCP Plate 8-hole", vendorItemNo: "DPS-LCP-835", quantity: 4, unitPrice: 890, extendedPrice: 3560 },
      { purchaseOrderId: po3.id, inventoryDescription: "TFN-ADVANCED Proximal Femoral Nail", vendorItemNo: "DPS-TFN-001", quantity: 2, unitPrice: 2400, extendedPrice: 4800 },
      { purchaseOrderId: po3.id, inventoryDescription: "4.5mm Cortical Screw 40mm", vendorItemNo: "DPS-CS-4540", quantity: 30, unitPrice: 65, extendedPrice: 1950 },
      { purchaseOrderId: po3.id, inventoryDescription: "ATTUNE Knee System Primary", vendorItemNo: "DPS-ATK-001", quantity: 1, unitPrice: 4200, extendedPrice: 4200 },
    ],
  })
  count++

  // PO 4: Arthrex arthroscopy at Lighthouse (pending)
  const po4 = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-2025-004", facilityId: f.lighthouseSurgical.id, vendorId: v.arthrex.id,
      orderDate: poDate(0, 8), totalCost: 7770, status: "pending",
    },
  })
  await prisma.pOLineItem.createMany({
    data: [
      { purchaseOrderId: po4.id, inventoryDescription: "FiberWire #2 Suture Pack", vendorItemNo: "ART-FW2-001", quantity: 15, unitPrice: 85, extendedPrice: 1275 },
      { purchaseOrderId: po4.id, inventoryDescription: "SwiveLock Anchor 5.5mm", vendorItemNo: "ART-SL55-001", quantity: 6, unitPrice: 420, extendedPrice: 2520 },
      { purchaseOrderId: po4.id, inventoryDescription: "TightRope RT Implant", vendorItemNo: "ART-TRT-001", quantity: 3, unitPrice: 580, extendedPrice: 1740 },
      { purchaseOrderId: po4.id, inventoryDescription: "SpeedBridge Implant System", vendorItemNo: "ART-SBI-001", quantity: 3, unitPrice: 745, extendedPrice: 2235 },
    ],
  })
  count++

  // PO 5: Zimmer Biomet knee at Heritage (completed)
  const po5 = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-2025-005", facilityId: f.heritageRegional.id, vendorId: v.zimmerBiomet.id,
      orderDate: poDate(1, 2), totalCost: 17700, status: "completed",
    },
  })
  await prisma.pOLineItem.createMany({
    data: [
      { purchaseOrderId: po5.id, inventoryDescription: "Persona TKA Primary System", vendorItemNo: "ZB-PTK-001", quantity: 2, unitPrice: 4800, extendedPrice: 9600 },
      { purchaseOrderId: po5.id, inventoryDescription: "Vivacit-E Poly Insert", vendorItemNo: "ZB-VEP-001", quantity: 2, unitPrice: 1100, extendedPrice: 2200 },
      { purchaseOrderId: po5.id, inventoryDescription: "Taperloc Complete Hip Stem", vendorItemNo: "ZB-TCH-001", quantity: 1, unitPrice: 2900, extendedPrice: 2900 },
      { purchaseOrderId: po5.id, inventoryDescription: "G7 Acetabular System", vendorItemNo: "ZB-G7A-001", quantity: 1, unitPrice: 2600, extendedPrice: 2600 },
    ],
  })
  count++

  // PO 6: Conmed off-contract at Summit (draft)
  const po6 = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-2025-006", facilityId: f.summitGeneral.id, vendorId: v.conmed.id,
      orderDate: poDate(0, 15), totalCost: 6400, status: "draft", isOffContract: true,
    },
  })
  await prisma.pOLineItem.createMany({
    data: [
      { purchaseOrderId: po6.id, inventoryDescription: "AirSeal Trocar 12mm", vendorItemNo: "CNMD-AST-12", quantity: 8, unitPrice: 290, extendedPrice: 2320, isOffContract: true },
      { purchaseOrderId: po6.id, inventoryDescription: "AirSeal iFS Filter Tubing Set", vendorItemNo: "CNMD-IFT-001", quantity: 8, unitPrice: 180, extendedPrice: 1440, isOffContract: true },
      { purchaseOrderId: po6.id, inventoryDescription: "Hall 50 Power Instrument", vendorItemNo: "CNMD-H50-001", quantity: 1, unitPrice: 1800, extendedPrice: 1800, isOffContract: true },
    ],
  })
  count++

  console.log(`  Purchase Orders: ${count} (with line items)`)

  return count
}
