import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"
import type { Vendors } from "./vendors"

const now = new Date()

function txDate(monthsAgo: number, day: number) {
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, day)
}

export async function seedCOGRecords(
  prisma: PrismaClient,
  deps: { facilities: Facilities; vendors: Vendors }
) {
  const { facilities: f, vendors: v } = deps

  const records = [
    // --- Stryker Joint Replacement ---
    { facilityId: f.lighthouseSurgical.id, vendorId: v.stryker.id, vendorName: "Stryker", inventoryNumber: "INV-001", inventoryDescription: "Triathlon Total Knee System", vendorItemNo: "STK-TKS-001", unitCost: 4500, quantity: 3, transactionDate: txDate(1, 15), category: "Joint Replacement" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.stryker.id, vendorName: "Stryker", inventoryNumber: "INV-002", inventoryDescription: "Mako SmartRobotics Disposable Kit", vendorItemNo: "STK-MKD-001", unitCost: 850, quantity: 5, transactionDate: txDate(1, 15), category: "Joint Replacement" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.stryker.id, vendorName: "Stryker", inventoryNumber: "INV-008", inventoryDescription: "Accolade II Hip Stem", vendorItemNo: "STK-AHS-001", unitCost: 3200, quantity: 4, transactionDate: txDate(0, 3), category: "Joint Replacement" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.stryker.id, vendorName: "Stryker", inventoryNumber: "INV-009", inventoryDescription: "Trident II Acetabular Shell", vendorItemNo: "STK-TAS-001", unitCost: 2800, quantity: 4, transactionDate: txDate(0, 3), category: "Joint Replacement" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.stryker.id, vendorName: "Stryker", inventoryNumber: "INV-010", inventoryDescription: "X3 Poly Liner", vendorItemNo: "STK-X3L-001", unitCost: 1200, quantity: 4, transactionDate: txDate(0, 5), category: "Joint Replacement" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.stryker.id, vendorName: "Stryker", inventoryNumber: "INV-011", inventoryDescription: "Triathlon Revision Knee System", vendorItemNo: "STK-TRV-001", unitCost: 7800, quantity: 1, transactionDate: txDate(2, 20), category: "Joint Replacement" },
    { facilityId: f.lighthouseCommunity.id, vendorId: v.stryker.id, vendorName: "Stryker", inventoryNumber: "INV-012", inventoryDescription: "Navigation Tracking Array", vendorItemNo: "STK-NTA-001", unitCost: 450, quantity: 10, transactionDate: txDate(1, 8), category: "Surgical Instruments" },
    { facilityId: f.lighthouseCommunity.id, vendorId: v.stryker.id, vendorName: "Stryker", inventoryNumber: "INV-013", inventoryDescription: "System 8 Power Drill", vendorItemNo: "STK-S8D-001", unitCost: 2200, quantity: 2, transactionDate: txDate(2, 12), category: "Surgical Instruments" },

    // --- Medtronic Spine & Neuro ---
    { facilityId: f.lighthouseCommunity.id, vendorId: v.medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-004", inventoryDescription: "PRESTIGE LP Cervical Disc", vendorItemNo: "MDT-PLP-001", unitCost: 6200, quantity: 2, transactionDate: txDate(2, 10), category: "Spine" },
    { facilityId: f.lighthouseCommunity.id, vendorId: v.medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-005", inventoryDescription: "INFUSE Bone Graft Large Kit", vendorItemNo: "MDT-IBG-001", unitCost: 3400, quantity: 4, transactionDate: txDate(2, 10), category: "Biologics" },
    { facilityId: f.lighthouseCommunity.id, vendorId: v.medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-014", inventoryDescription: "CD HORIZON SOLERA Spinal System", vendorItemNo: "MDT-SOL-001", unitCost: 8900, quantity: 2, transactionDate: txDate(1, 5), category: "Spine" },
    { facilityId: f.lighthouseCommunity.id, vendorId: v.medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-015", inventoryDescription: "CERTA Plus Pedicle Screw 6.5x45", vendorItemNo: "MDT-CPS-645", unitCost: 520, quantity: 12, transactionDate: txDate(1, 5), category: "Spine" },
    { facilityId: f.heritageRegional.id, vendorId: v.medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-006", inventoryDescription: "CD HORIZON SOLERA Voyager System", vendorItemNo: "MDT-SVY-001", unitCost: 9200, quantity: 1, transactionDate: txDate(1, 5), category: "Spine" },
    { facilityId: f.heritageRegional.id, vendorId: v.medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-016", inventoryDescription: "INFUSE Bone Graft Small Kit", vendorItemNo: "MDT-IBG-SM", unitCost: 1800, quantity: 3, transactionDate: txDate(0, 12), category: "Biologics" },
    { facilityId: f.heritageRegional.id, vendorId: v.medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-017", inventoryDescription: "RestoreUltra SCS System", vendorItemNo: "MDT-RUS-001", unitCost: 15000, quantity: 1, transactionDate: txDate(1, 22), category: "Neurosurgery" },

    // --- Smith & Nephew ---
    { facilityId: f.lighthouseSurgical.id, vendorId: v.smithNephew.id, vendorName: "Smith & Nephew", inventoryNumber: "INV-003", inventoryDescription: "FAST-FIX 360 Meniscal Repair", vendorItemNo: "SN-FF360-001", unitCost: 650, quantity: 8, transactionDate: txDate(1, 20), category: "Sports Medicine" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.smithNephew.id, vendorName: "Smith & Nephew", inventoryNumber: "INV-018", inventoryDescription: "HEALICOIL Suture Anchor 5.5mm", vendorItemNo: "SN-HC55-001", unitCost: 480, quantity: 6, transactionDate: txDate(0, 8), category: "Sports Medicine" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.smithNephew.id, vendorName: "Smith & Nephew", inventoryNumber: "INV-019", inventoryDescription: "DYONICS Platinum Shaver Blade", vendorItemNo: "SN-DPB-001", unitCost: 320, quantity: 10, transactionDate: txDate(1, 3), category: "Arthroscopy" },
    { facilityId: f.heritageRegional.id, vendorId: v.smithNephew.id, vendorName: "Smith & Nephew", inventoryNumber: "INV-007", inventoryDescription: "TRIGEN INTERTAN Nail", vendorItemNo: "SN-TIN-001", unitCost: 2100, quantity: 6, transactionDate: txDate(1, 12), category: "Trauma" },
    { facilityId: f.heritageRegional.id, vendorId: v.smithNephew.id, vendorName: "Smith & Nephew", inventoryNumber: "INV-020", inventoryDescription: "PICO Single-Use NPWT", vendorItemNo: "SN-PICO-001", unitCost: 195, quantity: 15, transactionDate: txDate(0, 6), category: "Wound Care" },

    // --- Arthrex ---
    { facilityId: f.lighthouseSurgical.id, vendorId: v.arthrex.id, vendorName: "Arthrex", inventoryNumber: "INV-021", inventoryDescription: "FiberWire #2 Suture Pack", vendorItemNo: "ART-FW2-001", unitCost: 85, quantity: 20, transactionDate: txDate(1, 10), category: "Arthroscopy" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.arthrex.id, vendorName: "Arthrex", inventoryNumber: "INV-022", inventoryDescription: "SwiveLock Anchor 5.5mm", vendorItemNo: "ART-SL55-001", unitCost: 420, quantity: 8, transactionDate: txDate(1, 10), category: "Sports Medicine" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.arthrex.id, vendorName: "Arthrex", inventoryNumber: "INV-023", inventoryDescription: "TightRope RT Implant", vendorItemNo: "ART-TRT-001", unitCost: 580, quantity: 4, transactionDate: txDate(0, 18), category: "Sports Medicine" },
    { facilityId: f.austinSpine.id, vendorId: v.arthrex.id, vendorName: "Arthrex", inventoryNumber: "INV-024", inventoryDescription: "NanoGraft DBM Putty 5cc", vendorItemNo: "ART-NG5-001", unitCost: 350, quantity: 6, transactionDate: txDate(1, 25), category: "Biologics" },
    { facilityId: f.austinSpine.id, vendorId: v.arthrex.id, vendorName: "Arthrex", inventoryNumber: "INV-025", inventoryDescription: "BioComposite Corkscrew 5.5mm", vendorItemNo: "ART-BC55-001", unitCost: 395, quantity: 5, transactionDate: txDate(0, 2), category: "Arthroscopy" },

    // --- DePuy Synthes ---
    { facilityId: f.summitGeneral.id, vendorId: v.depuySynthes.id, vendorName: "DePuy Synthes", inventoryNumber: "INV-026", inventoryDescription: "3.5mm LCP Plate 8-hole", vendorItemNo: "DPS-LCP-835", unitCost: 890, quantity: 6, transactionDate: txDate(1, 14), category: "Trauma" },
    { facilityId: f.summitGeneral.id, vendorId: v.depuySynthes.id, vendorName: "DePuy Synthes", inventoryNumber: "INV-027", inventoryDescription: "TFN-ADVANCED Proximal Femoral Nail", vendorItemNo: "DPS-TFN-001", unitCost: 2400, quantity: 3, transactionDate: txDate(1, 14), category: "Trauma" },
    { facilityId: f.summitGeneral.id, vendorId: v.depuySynthes.id, vendorName: "DePuy Synthes", inventoryNumber: "INV-028", inventoryDescription: "4.5mm Cortical Screw 40mm", vendorItemNo: "DPS-CS-4540", unitCost: 65, quantity: 40, transactionDate: txDate(0, 7), category: "Trauma" },
    { facilityId: f.summitGeneral.id, vendorId: v.depuySynthes.id, vendorName: "DePuy Synthes", inventoryNumber: "INV-029", inventoryDescription: "ATTUNE Knee System Primary", vendorItemNo: "DPS-ATK-001", unitCost: 4200, quantity: 2, transactionDate: txDate(2, 3), category: "Joint Replacement" },
    { facilityId: f.lighthouseCommunity.id, vendorId: v.depuySynthes.id, vendorName: "DePuy Synthes", inventoryNumber: "INV-030", inventoryDescription: "PINNACLE Hip System", vendorItemNo: "DPS-PHI-001", unitCost: 3800, quantity: 3, transactionDate: txDate(1, 20), category: "Joint Replacement" },

    // --- Zimmer Biomet ---
    { facilityId: f.heritageRegional.id, vendorId: v.zimmerBiomet.id, vendorName: "Zimmer Biomet", inventoryNumber: "INV-031", inventoryDescription: "Persona TKA Primary System", vendorItemNo: "ZB-PTK-001", unitCost: 4800, quantity: 3, transactionDate: txDate(1, 8), category: "Joint Replacement" },
    { facilityId: f.heritageRegional.id, vendorId: v.zimmerBiomet.id, vendorName: "Zimmer Biomet", inventoryNumber: "INV-032", inventoryDescription: "Vivacit-E Poly Insert", vendorItemNo: "ZB-VEP-001", unitCost: 1100, quantity: 3, transactionDate: txDate(1, 8), category: "Joint Replacement" },
    { facilityId: f.heritageRegional.id, vendorId: v.zimmerBiomet.id, vendorName: "Zimmer Biomet", inventoryNumber: "INV-033", inventoryDescription: "Taperloc Complete Hip Stem", vendorItemNo: "ZB-TCH-001", unitCost: 2900, quantity: 2, transactionDate: txDate(0, 15), category: "Joint Replacement" },
    { facilityId: f.heritageRegional.id, vendorId: v.zimmerBiomet.id, vendorName: "Zimmer Biomet", inventoryNumber: "INV-034", inventoryDescription: "G7 Acetabular System", vendorItemNo: "ZB-G7A-001", unitCost: 2600, quantity: 2, transactionDate: txDate(0, 15), category: "Joint Replacement" },

    // --- Integra ---
    { facilityId: f.lighthouseCommunity.id, vendorId: v.integra.id, vendorName: "Integra LifeSciences", inventoryNumber: "INV-035", inventoryDescription: "DuraGen Plus Dural Matrix 4x5cm", vendorItemNo: "ILS-DGP-45", unitCost: 1250, quantity: 4, transactionDate: txDate(1, 18), category: "Neurosurgery" },
    { facilityId: f.lighthouseCommunity.id, vendorId: v.integra.id, vendorName: "Integra LifeSciences", inventoryNumber: "INV-036", inventoryDescription: "DuraMatrix Onlay 6x8cm", vendorItemNo: "ILS-DMO-68", unitCost: 980, quantity: 3, transactionDate: txDate(0, 9), category: "Neurosurgery" },
    { facilityId: f.lighthouseCommunity.id, vendorId: v.integra.id, vendorName: "Integra LifeSciences", inventoryNumber: "INV-037", inventoryDescription: "CUSA Clarity Ultrasonic Tips", vendorItemNo: "ILS-CCT-001", unitCost: 680, quantity: 5, transactionDate: txDate(2, 5), category: "Neurosurgery" },

    // --- Conmed ---
    { facilityId: f.summitGeneral.id, vendorId: v.conmed.id, vendorName: "Conmed", inventoryNumber: "INV-038", inventoryDescription: "System 5000 Electrosurgical Generator", vendorItemNo: "CNMD-S5K-001", unitCost: 3500, quantity: 1, transactionDate: txDate(3, 1), category: "General Surgery" },
    { facilityId: f.summitGeneral.id, vendorId: v.conmed.id, vendorName: "Conmed", inventoryNumber: "INV-039", inventoryDescription: "AirSeal Trocar 12mm", vendorItemNo: "CNMD-AST-12", unitCost: 290, quantity: 10, transactionDate: txDate(1, 22), category: "General Surgery" },
    { facilityId: f.rockyMountain.id, vendorId: v.conmed.id, vendorName: "Conmed", inventoryNumber: "INV-040", inventoryDescription: "Hall 50 Power Instrument", vendorItemNo: "CNMD-H50-001", unitCost: 1800, quantity: 2, transactionDate: txDate(0, 11), category: "Surgical Instruments" },

    // --- NuVasive ---
    { facilityId: f.summitGeneral.id, vendorId: v.nuvasive.id, vendorName: "NuVasive", inventoryNumber: "INV-041", inventoryDescription: "Modulus XLIF Cage 18x55mm", vendorItemNo: "NUV-MXC-1855", unitCost: 3200, quantity: 2, transactionDate: txDate(1, 6), category: "Spine" },
    { facilityId: f.summitGeneral.id, vendorId: v.nuvasive.id, vendorName: "NuVasive", inventoryNumber: "INV-042", inventoryDescription: "Reline Pedicle Screw System 6.5x50", vendorItemNo: "NUV-RPS-6550", unitCost: 480, quantity: 8, transactionDate: txDate(1, 6), category: "Spine" },
    { facilityId: f.summitGeneral.id, vendorId: v.nuvasive.id, vendorName: "NuVasive", inventoryNumber: "INV-043", inventoryDescription: "MAGEC Rod Growth System", vendorItemNo: "NUV-MGR-001", unitCost: 12500, quantity: 1, transactionDate: txDate(2, 15), category: "Spine" },

    // --- Hologic ---
    { facilityId: f.heritageRegional.id, vendorId: v.hologic.id, vendorName: "Hologic", inventoryNumber: "INV-044", inventoryDescription: "Genius 3D Mammography Detector", vendorItemNo: "HLG-G3D-001", unitCost: 850, quantity: 2, transactionDate: txDate(1, 1), category: "Imaging" },
    { facilityId: f.heritageRegional.id, vendorId: v.hologic.id, vendorName: "Hologic", inventoryNumber: "INV-045", inventoryDescription: "Affirm Prone Biopsy System Needle", vendorItemNo: "HLG-APB-001", unitCost: 320, quantity: 8, transactionDate: txDate(0, 20), category: "Diagnostics" },

    // --- Additional high-volume items for variety ---
    { facilityId: f.lighthouseSurgical.id, vendorId: v.stryker.id, vendorName: "Stryker", inventoryNumber: "INV-046", inventoryDescription: "Triathlon Tibial Baseplate Size 5", vendorItemNo: "STK-TTB-005", unitCost: 1800, quantity: 3, transactionDate: txDate(2, 8), category: "Joint Replacement" },
    { facilityId: f.rockyMountain.id, vendorId: v.arthrex.id, vendorName: "Arthrex", inventoryNumber: "INV-047", inventoryDescription: "SpeedBridge Implant System", vendorItemNo: "ART-SBI-001", unitCost: 720, quantity: 4, transactionDate: txDate(1, 28), category: "Sports Medicine" },
    { facilityId: f.portlandOrtho.id, vendorId: v.stryker.id, vendorName: "Stryker", inventoryNumber: "INV-048", inventoryDescription: "Sonopet IQ Ultrasonic Aspirator Tip", vendorItemNo: "STK-SIQ-001", unitCost: 380, quantity: 6, transactionDate: txDate(0, 14), category: "Surgical Instruments" },
    { facilityId: f.heritageRegional.id, vendorId: v.depuySynthes.id, vendorName: "DePuy Synthes", inventoryNumber: "INV-049", inventoryDescription: "ATTUNE Revision Knee System", vendorItemNo: "DPS-ATR-001", unitCost: 8200, quantity: 1, transactionDate: txDate(1, 3), category: "Joint Replacement" },
    { facilityId: f.summitGeneral.id, vendorId: v.medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-050", inventoryDescription: "O-arm Surgical Imaging Drape", vendorItemNo: "MDT-OAD-001", unitCost: 175, quantity: 15, transactionDate: txDate(0, 19), category: "Surgical Instruments" },
    { facilityId: f.lighthouseCommunity.id, vendorId: v.nuvasive.id, vendorName: "NuVasive", inventoryNumber: "INV-051", inventoryDescription: "CoRoent XL PEEK Cage 14x50", vendorItemNo: "NUV-CXP-1450", unitCost: 2800, quantity: 2, transactionDate: txDate(2, 22), category: "Spine" },
    { facilityId: f.austinSpine.id, vendorId: v.medtronic.id, vendorName: "Medtronic", inventoryNumber: "INV-052", inventoryDescription: "VERTEX SELECT Reconstruction System", vendorItemNo: "MDT-VSR-001", unitCost: 7500, quantity: 1, transactionDate: txDate(0, 25), category: "Spine" },
    { facilityId: f.rockyMountain.id, vendorId: v.zimmerBiomet.id, vendorName: "Zimmer Biomet", inventoryNumber: "INV-053", inventoryDescription: "Oxford Partial Knee System", vendorItemNo: "ZB-OPK-001", unitCost: 3600, quantity: 2, transactionDate: txDate(1, 17), category: "Joint Replacement" },
    { facilityId: f.summitGeneral.id, vendorId: v.integra.id, vendorName: "Integra LifeSciences", inventoryNumber: "INV-054", inventoryDescription: "Mayfield Skull Clamp Pins", vendorItemNo: "ILS-MSC-001", unitCost: 95, quantity: 20, transactionDate: txDate(0, 4), category: "Neurosurgery" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.conmed.id, vendorName: "Conmed", inventoryNumber: "INV-055", inventoryDescription: "Linvatec Shaver Blade 4.5mm", vendorItemNo: "CNMD-LSB-45", unitCost: 245, quantity: 12, transactionDate: txDate(1, 11), category: "Arthroscopy" },
    { facilityId: f.heritagePediatrics.id, vendorId: v.smithNephew.id, vendorName: "Smith & Nephew", inventoryNumber: "INV-056", inventoryDescription: "RENASYS Touch NPWT Canister", vendorItemNo: "SN-RTC-001", unitCost: 125, quantity: 8, transactionDate: txDate(0, 22), category: "Wound Care" },
    { facilityId: f.portlandOrtho.id, vendorId: v.zimmerBiomet.id, vendorName: "Zimmer Biomet", inventoryNumber: "INV-057", inventoryDescription: "Comprehensive Reverse Shoulder", vendorItemNo: "ZB-CRS-001", unitCost: 5200, quantity: 1, transactionDate: txDate(2, 10), category: "Joint Replacement" },
    { facilityId: f.lighthouseSurgical.id, vendorId: v.depuySynthes.id, vendorName: "DePuy Synthes", inventoryNumber: "INV-058", inventoryDescription: "SIGMA Fixed Bearing Knee", vendorItemNo: "DPS-SFK-001", unitCost: 3900, quantity: 2, transactionDate: txDate(0, 28), category: "Joint Replacement" },
    { facilityId: f.summitGeneral.id, vendorId: v.hologic.id, vendorName: "Hologic", inventoryNumber: "INV-059", inventoryDescription: "ThinPrep Pap Test Kit (box/50)", vendorItemNo: "HLG-TPP-050", unitCost: 425, quantity: 4, transactionDate: txDate(1, 9), category: "Diagnostics" },
    { facilityId: f.heritageRegional.id, vendorId: v.conmed.id, vendorName: "Conmed", inventoryNumber: "INV-060", inventoryDescription: "AirSeal iFS Intelligent Flow System", vendorItemNo: "CNMD-IFS-001", unitCost: 4200, quantity: 1, transactionDate: txDate(2, 18), category: "General Surgery" },
  ]

  for (const rec of records) {
    await prisma.cOGRecord.create({
      data: {
        ...rec,
        extendedPrice: rec.unitCost * rec.quantity,
      },
    })
  }

  console.log(`  COG Records: ${records.length}`)

  return records.length
}
