import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"

const now = new Date()

function surgDate(monthsAgo: number, day: number) {
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, day)
}

export async function seedCases(
  prisma: PrismaClient,
  deps: { facilities: Facilities }
) {
  const { facilities: f } = deps
  let count = 0

  const casesData: Array<{
    caseNumber: string
    facilityId: string
    surgeonName: string
    dateOfSurgery: Date
    timeInOr: string
    timeOutOr: string
    primaryCptCode: string
    totalSpend: number
    totalReimbursement: number
    procedures: Array<{ cptCode: string; procedureDescription: string }>
    supplies: Array<{ materialName: string; vendorItemNo: string; usedCost: number; quantity: number; isOnContract: boolean }>
  }> = [
    // --- Total Knee Replacements ---
    {
      caseNumber: "CS-2025-001", facilityId: f.lighthouseSurgical.id, surgeonName: "Dr. Robert Kim",
      dateOfSurgery: surgDate(1, 8), timeInOr: "07:30", timeOutOr: "09:45", primaryCptCode: "27447",
      totalSpend: 8550, totalReimbursement: 14200,
      procedures: [
        { cptCode: "27447", procedureDescription: "Total knee arthroplasty, primary" },
      ],
      supplies: [
        { materialName: "Triathlon Total Knee System", vendorItemNo: "STK-TKS-001", usedCost: 4500, quantity: 1, isOnContract: true },
        { materialName: "Mako SmartRobotics Disposable Kit", vendorItemNo: "STK-MKD-001", usedCost: 850, quantity: 1, isOnContract: true },
        { materialName: "X3 Poly Liner", vendorItemNo: "STK-X3L-001", usedCost: 1200, quantity: 1, isOnContract: true },
        { materialName: "Bone Cement 40g", vendorItemNo: "GEN-BC40-001", usedCost: 120, quantity: 2, isOnContract: false },
      ],
    },
    {
      caseNumber: "CS-2025-002", facilityId: f.lighthouseSurgical.id, surgeonName: "Dr. Robert Kim",
      dateOfSurgery: surgDate(1, 15), timeInOr: "10:00", timeOutOr: "12:15", primaryCptCode: "27447",
      totalSpend: 8550, totalReimbursement: 14200,
      procedures: [
        { cptCode: "27447", procedureDescription: "Total knee arthroplasty, primary" },
      ],
      supplies: [
        { materialName: "Triathlon Total Knee System", vendorItemNo: "STK-TKS-001", usedCost: 4500, quantity: 1, isOnContract: true },
        { materialName: "Mako SmartRobotics Disposable Kit", vendorItemNo: "STK-MKD-001", usedCost: 850, quantity: 1, isOnContract: true },
        { materialName: "X3 Poly Liner", vendorItemNo: "STK-X3L-001", usedCost: 1200, quantity: 1, isOnContract: true },
      ],
    },
    // --- Total Hip Replacement ---
    {
      caseNumber: "CS-2025-003", facilityId: f.lighthouseSurgical.id, surgeonName: "Dr. Susan Patel",
      dateOfSurgery: surgDate(1, 10), timeInOr: "07:00", timeOutOr: "09:30", primaryCptCode: "27130",
      totalSpend: 7400, totalReimbursement: 13800,
      procedures: [
        { cptCode: "27130", procedureDescription: "Total hip arthroplasty, primary" },
      ],
      supplies: [
        { materialName: "Accolade II Hip Stem", vendorItemNo: "STK-AHS-001", usedCost: 3200, quantity: 1, isOnContract: true },
        { materialName: "Trident II Acetabular Shell", vendorItemNo: "STK-TAS-001", usedCost: 2800, quantity: 1, isOnContract: true },
        { materialName: "X3 Poly Liner", vendorItemNo: "STK-X3L-001", usedCost: 1200, quantity: 1, isOnContract: true },
      ],
    },
    // --- Knee Arthroscopy ---
    {
      caseNumber: "CS-2025-004", facilityId: f.lighthouseSurgical.id, surgeonName: "Dr. Mark Tanaka",
      dateOfSurgery: surgDate(0, 5), timeInOr: "13:00", timeOutOr: "14:15", primaryCptCode: "29881",
      totalSpend: 2180, totalReimbursement: 4800,
      procedures: [
        { cptCode: "29881", procedureDescription: "Arthroscopy knee, meniscectomy" },
        { cptCode: "29877", procedureDescription: "Arthroscopy knee, debridement/shaving" },
      ],
      supplies: [
        { materialName: "FAST-FIX 360 Meniscal Repair", vendorItemNo: "SN-FF360-001", usedCost: 650, quantity: 2, isOnContract: true },
        { materialName: "DYONICS Platinum Shaver Blade", vendorItemNo: "SN-DPB-001", usedCost: 320, quantity: 1, isOnContract: true },
        { materialName: "Linvatec Shaver Blade 4.5mm", vendorItemNo: "CNMD-LSB-45", usedCost: 245, quantity: 1, isOnContract: false },
      ],
    },
    // --- ACL Reconstruction ---
    {
      caseNumber: "CS-2025-005", facilityId: f.lighthouseSurgical.id, surgeonName: "Dr. Mark Tanaka",
      dateOfSurgery: surgDate(0, 12), timeInOr: "07:30", timeOutOr: "09:45", primaryCptCode: "29888",
      totalSpend: 3250, totalReimbursement: 7200,
      procedures: [
        { cptCode: "29888", procedureDescription: "ACL reconstruction, arthroscopically aided" },
      ],
      supplies: [
        { materialName: "TightRope RT Implant", vendorItemNo: "ART-TRT-001", usedCost: 580, quantity: 1, isOnContract: true },
        { materialName: "SwiveLock Anchor 5.5mm", vendorItemNo: "ART-SL55-001", usedCost: 420, quantity: 2, isOnContract: true },
        { materialName: "FiberWire #2 Suture Pack", vendorItemNo: "ART-FW2-001", usedCost: 85, quantity: 3, isOnContract: true },
        { materialName: "SpeedBridge Implant System", vendorItemNo: "ART-SBI-001", usedCost: 720, quantity: 1, isOnContract: true },
      ],
    },
    // --- Lumbar Fusion ---
    {
      caseNumber: "CS-2025-006", facilityId: f.lighthouseCommunity.id, surgeonName: "Dr. James Rivera",
      dateOfSurgery: surgDate(1, 20), timeInOr: "07:00", timeOutOr: "11:30", primaryCptCode: "22612",
      totalSpend: 18540, totalReimbursement: 28500,
      procedures: [
        { cptCode: "22612", procedureDescription: "Lumbar arthrodesis, posterior approach" },
        { cptCode: "22614", procedureDescription: "Lumbar arthrodesis, each additional level" },
        { cptCode: "20930", procedureDescription: "Allograft morselized for spine surgery" },
      ],
      supplies: [
        { materialName: "CD HORIZON SOLERA Spinal System", vendorItemNo: "MDT-SOL-001", usedCost: 8900, quantity: 1, isOnContract: true },
        { materialName: "CERTA Plus Pedicle Screw 6.5x45", vendorItemNo: "MDT-CPS-645", usedCost: 520, quantity: 6, isOnContract: true },
        { materialName: "INFUSE Bone Graft Large Kit", vendorItemNo: "MDT-IBG-001", usedCost: 3400, quantity: 1, isOnContract: true },
      ],
    },
    // --- Cervical Disc Replacement ---
    {
      caseNumber: "CS-2025-007", facilityId: f.lighthouseCommunity.id, surgeonName: "Dr. James Rivera",
      dateOfSurgery: surgDate(0, 18), timeInOr: "08:00", timeOutOr: "10:00", primaryCptCode: "22856",
      totalSpend: 7200, totalReimbursement: 15000,
      procedures: [
        { cptCode: "22856", procedureDescription: "Total disc arthroplasty, cervical, single" },
      ],
      supplies: [
        { materialName: "PRESTIGE LP Cervical Disc", vendorItemNo: "MDT-PLP-001", usedCost: 6200, quantity: 1, isOnContract: true },
      ],
    },
    // --- Hip Fracture Fixation ---
    {
      caseNumber: "CS-2025-008", facilityId: f.summitGeneral.id, surgeonName: "Dr. Angela Frost",
      dateOfSurgery: surgDate(1, 3), timeInOr: "09:00", timeOutOr: "10:45", primaryCptCode: "27245",
      totalSpend: 5500, totalReimbursement: 9800,
      procedures: [
        { cptCode: "27245", procedureDescription: "Treatment intertrochanteric fracture, intramedullary implant" },
      ],
      supplies: [
        { materialName: "TFN-ADVANCED Proximal Femoral Nail", vendorItemNo: "DPS-TFN-001", usedCost: 2400, quantity: 1, isOnContract: true },
        { materialName: "4.5mm Cortical Screw 40mm", vendorItemNo: "DPS-CS-4540", usedCost: 65, quantity: 4, isOnContract: true },
        { materialName: "3.5mm LCP Plate 8-hole", vendorItemNo: "DPS-LCP-835", usedCost: 890, quantity: 1, isOnContract: true },
      ],
    },
    // --- Craniotomy Tumor Resection ---
    {
      caseNumber: "CS-2025-009", facilityId: f.lighthouseCommunity.id, surgeonName: "Dr. Priya Sharma",
      dateOfSurgery: surgDate(2, 12), timeInOr: "06:30", timeOutOr: "12:00", primaryCptCode: "61510",
      totalSpend: 6310, totalReimbursement: 22000,
      procedures: [
        { cptCode: "61510", procedureDescription: "Craniectomy for excision of brain tumor, supratentorial" },
      ],
      supplies: [
        { materialName: "DuraGen Plus Dural Matrix 4x5cm", vendorItemNo: "ILS-DGP-45", usedCost: 1250, quantity: 2, isOnContract: true },
        { materialName: "CUSA Clarity Ultrasonic Tips", vendorItemNo: "ILS-CCT-001", usedCost: 680, quantity: 2, isOnContract: true },
        { materialName: "Mayfield Skull Clamp Pins", vendorItemNo: "ILS-MSC-001", usedCost: 95, quantity: 3, isOnContract: false },
      ],
    },
    // --- Rotator Cuff Repair ---
    {
      caseNumber: "CS-2025-010", facilityId: f.rockyMountain.id, surgeonName: "Dr. Tyler Brooks",
      dateOfSurgery: surgDate(1, 22), timeInOr: "11:00", timeOutOr: "12:30", primaryCptCode: "29827",
      totalSpend: 3380, totalReimbursement: 6500,
      procedures: [
        { cptCode: "29827", procedureDescription: "Arthroscopy shoulder, rotator cuff repair" },
      ],
      supplies: [
        { materialName: "SpeedBridge Implant System", vendorItemNo: "ART-SBI-001", usedCost: 720, quantity: 2, isOnContract: false },
        { materialName: "FiberWire #2 Suture Pack", vendorItemNo: "ART-FW2-001", usedCost: 85, quantity: 4, isOnContract: false },
      ],
    },
    // --- Lateral Lumbar Interbody Fusion (XLIF) ---
    {
      caseNumber: "CS-2025-011", facilityId: f.summitGeneral.id, surgeonName: "Dr. Nathan Cole",
      dateOfSurgery: surgDate(1, 28), timeInOr: "07:00", timeOutOr: "10:30", primaryCptCode: "22558",
      totalSpend: 11040, totalReimbursement: 24000,
      procedures: [
        { cptCode: "22558", procedureDescription: "Lumbar arthrodesis, anterior approach" },
        { cptCode: "22585", procedureDescription: "Additional anterior interbody fusion" },
      ],
      supplies: [
        { materialName: "Modulus XLIF Cage 18x55mm", vendorItemNo: "NUV-MXC-1855", usedCost: 3200, quantity: 2, isOnContract: false },
        { materialName: "Reline Pedicle Screw 6.5x50", vendorItemNo: "NUV-RPS-6550", usedCost: 480, quantity: 6, isOnContract: false },
      ],
    },
    // --- Zimmer Biomet Knee at Heritage ---
    {
      caseNumber: "CS-2025-012", facilityId: f.heritageRegional.id, surgeonName: "Dr. Laura Mendez",
      dateOfSurgery: surgDate(0, 20), timeInOr: "07:30", timeOutOr: "09:30", primaryCptCode: "27447",
      totalSpend: 5900, totalReimbursement: 14200,
      procedures: [
        { cptCode: "27447", procedureDescription: "Total knee arthroplasty, primary" },
      ],
      supplies: [
        { materialName: "Persona TKA Primary System", vendorItemNo: "ZB-PTK-001", usedCost: 4800, quantity: 1, isOnContract: true },
        { materialName: "Vivacit-E Poly Insert", vendorItemNo: "ZB-VEP-001", usedCost: 1100, quantity: 1, isOnContract: true },
      ],
    },
  ]

  for (const c of casesData) {
    const margin = c.totalReimbursement - c.totalSpend
    const caseRecord = await prisma.case.create({
      data: {
        caseNumber: c.caseNumber,
        facilityId: c.facilityId,
        surgeonName: c.surgeonName,
        dateOfSurgery: c.dateOfSurgery,
        timeInOr: c.timeInOr,
        timeOutOr: c.timeOutOr,
        primaryCptCode: c.primaryCptCode,
        totalSpend: c.totalSpend,
        totalReimbursement: c.totalReimbursement,
        margin,
        complianceStatus: c.supplies.every((s) => s.isOnContract) ? "compliant" : "review",
      },
    })

    for (const proc of c.procedures) {
      await prisma.caseProcedure.create({
        data: { caseId: caseRecord.id, cptCode: proc.cptCode, procedureDescription: proc.procedureDescription },
      })
    }

    for (const supply of c.supplies) {
      await prisma.caseSupply.create({
        data: {
          caseId: caseRecord.id,
          materialName: supply.materialName,
          vendorItemNo: supply.vendorItemNo,
          usedCost: supply.usedCost,
          quantity: supply.quantity,
          extendedCost: supply.usedCost * supply.quantity,
          isOnContract: supply.isOnContract,
        },
      })
    }
    count++
  }

  console.log(`  Cases: ${count} (with procedures and supplies)`)

  return count
}
