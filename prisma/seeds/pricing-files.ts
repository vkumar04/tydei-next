import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"
import type { Vendors } from "./vendors"

const now = new Date()
const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
const twoYearsFromNow = new Date(now.getFullYear() + 2, now.getMonth(), 1)

export async function seedPricingFiles(
  prisma: PrismaClient,
  deps: { facilities: Facilities; vendors: Vendors }
) {
  const { facilities: f, vendors: v } = deps

  const entries = [
    // --- Stryker Joint Replacement ---
    { vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "STK-TKS-001", productDescription: "Triathlon Total Knee System", listPrice: 5200, contractPrice: 4500, category: "Joint Replacement" },
    { vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "STK-AHS-001", productDescription: "Accolade II Hip Stem", listPrice: 3800, contractPrice: 3200, category: "Joint Replacement" },
    { vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "STK-TAS-001", productDescription: "Trident II Acetabular Shell", listPrice: 3300, contractPrice: 2800, category: "Joint Replacement" },
    { vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "STK-X3L-001", productDescription: "X3 Poly Liner", listPrice: 1450, contractPrice: 1200, category: "Joint Replacement" },
    { vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "STK-MKD-001", productDescription: "Mako SmartRobotics Disposable Kit", listPrice: 1050, contractPrice: 850, category: "Joint Replacement" },
    { vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "STK-TRV-001", productDescription: "Triathlon Revision Knee System", listPrice: 9200, contractPrice: 7800, category: "Joint Replacement" },
    { vendorId: v.stryker.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "STK-TTB-005", productDescription: "Triathlon Tibial Baseplate Size 5", listPrice: 2100, contractPrice: 1800, category: "Joint Replacement" },
    { vendorId: v.stryker.id, facilityId: f.lighthouseCommunity.id, vendorItemNo: "STK-NTA-001", productDescription: "Navigation Tracking Array", listPrice: 550, contractPrice: 450, category: "Surgical Instruments" },

    // --- Medtronic Spine ---
    { vendorId: v.medtronic.id, facilityId: f.lighthouseCommunity.id, vendorItemNo: "MDT-PLP-001", productDescription: "PRESTIGE LP Cervical Disc", listPrice: 7400, contractPrice: 6200, category: "Spine" },
    { vendorId: v.medtronic.id, facilityId: f.lighthouseCommunity.id, vendorItemNo: "MDT-SOL-001", productDescription: "CD HORIZON SOLERA Spinal System", listPrice: 10500, contractPrice: 8900, category: "Spine" },
    { vendorId: v.medtronic.id, facilityId: f.lighthouseCommunity.id, vendorItemNo: "MDT-CPS-645", productDescription: "CERTA Plus Pedicle Screw 6.5x45", listPrice: 620, contractPrice: 520, category: "Spine" },
    { vendorId: v.medtronic.id, facilityId: f.lighthouseCommunity.id, vendorItemNo: "MDT-IBG-001", productDescription: "INFUSE Bone Graft Large Kit", listPrice: 4100, contractPrice: 3400, category: "Biologics" },
    { vendorId: v.medtronic.id, facilityId: f.heritageRegional.id, vendorItemNo: "MDT-IBG-SM", productDescription: "INFUSE Bone Graft Small Kit", listPrice: 2200, contractPrice: 1800, category: "Biologics" },
    { vendorId: v.medtronic.id, facilityId: f.heritageRegional.id, vendorItemNo: "MDT-RUS-001", productDescription: "RestoreUltra SCS System", listPrice: 18000, contractPrice: 15000, category: "Neurosurgery" },

    // --- Smith & Nephew ---
    { vendorId: v.smithNephew.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "SN-FF360-001", productDescription: "FAST-FIX 360 Meniscal Repair", listPrice: 780, contractPrice: 650, category: "Sports Medicine" },
    { vendorId: v.smithNephew.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "SN-HC55-001", productDescription: "HEALICOIL Suture Anchor 5.5mm", listPrice: 575, contractPrice: 480, category: "Sports Medicine" },
    { vendorId: v.smithNephew.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "SN-DPB-001", productDescription: "DYONICS Platinum Shaver Blade", listPrice: 390, contractPrice: 320, category: "Arthroscopy" },
    { vendorId: v.smithNephew.id, facilityId: f.heritageRegional.id, vendorItemNo: "SN-TIN-001", productDescription: "TRIGEN INTERTAN Nail", listPrice: 2500, contractPrice: 2100, category: "Trauma" },
    { vendorId: v.smithNephew.id, facilityId: f.heritageRegional.id, vendorItemNo: "SN-PICO-001", productDescription: "PICO Single-Use NPWT", listPrice: 240, contractPrice: 195, category: "Wound Care" },

    // --- Arthrex ---
    { vendorId: v.arthrex.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "ART-FW2-001", productDescription: "FiberWire #2 Suture Pack", listPrice: 105, contractPrice: 85, category: "Arthroscopy" },
    { vendorId: v.arthrex.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "ART-SL55-001", productDescription: "SwiveLock Anchor 5.5mm", listPrice: 510, contractPrice: 420, category: "Sports Medicine" },
    { vendorId: v.arthrex.id, facilityId: f.lighthouseSurgical.id, vendorItemNo: "ART-TRT-001", productDescription: "TightRope RT Implant", listPrice: 695, contractPrice: 580, category: "Sports Medicine" },
    { vendorId: v.arthrex.id, facilityId: f.austinSpine.id, vendorItemNo: "ART-BC55-001", productDescription: "BioComposite Corkscrew 5.5mm", listPrice: 475, contractPrice: 395, category: "Arthroscopy" },

    // --- DePuy Synthes ---
    { vendorId: v.depuySynthes.id, facilityId: f.summitGeneral.id, vendorItemNo: "DPS-LCP-835", productDescription: "3.5mm LCP Plate 8-hole", listPrice: 1050, contractPrice: 890, category: "Trauma" },
    { vendorId: v.depuySynthes.id, facilityId: f.summitGeneral.id, vendorItemNo: "DPS-TFN-001", productDescription: "TFN-ADVANCED Proximal Femoral Nail", listPrice: 2850, contractPrice: 2400, category: "Trauma" },
    { vendorId: v.depuySynthes.id, facilityId: f.summitGeneral.id, vendorItemNo: "DPS-CS-4540", productDescription: "4.5mm Cortical Screw 40mm", listPrice: 78, contractPrice: 65, category: "Trauma" },
    { vendorId: v.depuySynthes.id, facilityId: f.summitGeneral.id, vendorItemNo: "DPS-ATK-001", productDescription: "ATTUNE Knee System Primary", listPrice: 5000, contractPrice: 4200, category: "Joint Replacement" },
    { vendorId: v.depuySynthes.id, facilityId: f.lighthouseCommunity.id, vendorItemNo: "DPS-PHI-001", productDescription: "PINNACLE Hip System", listPrice: 4500, contractPrice: 3800, category: "Joint Replacement" },

    // --- Zimmer Biomet ---
    { vendorId: v.zimmerBiomet.id, facilityId: f.heritageRegional.id, vendorItemNo: "ZB-PTK-001", productDescription: "Persona TKA Primary System", listPrice: 5700, contractPrice: 4800, category: "Joint Replacement" },
    { vendorId: v.zimmerBiomet.id, facilityId: f.heritageRegional.id, vendorItemNo: "ZB-VEP-001", productDescription: "Vivacit-E Poly Insert", listPrice: 1350, contractPrice: 1100, category: "Joint Replacement" },
    { vendorId: v.zimmerBiomet.id, facilityId: f.heritageRegional.id, vendorItemNo: "ZB-TCH-001", productDescription: "Taperloc Complete Hip Stem", listPrice: 3450, contractPrice: 2900, category: "Joint Replacement" },
    { vendorId: v.zimmerBiomet.id, facilityId: f.heritageRegional.id, vendorItemNo: "ZB-G7A-001", productDescription: "G7 Acetabular System", listPrice: 3100, contractPrice: 2600, category: "Joint Replacement" },

    // --- Integra ---
    { vendorId: v.integra.id, facilityId: f.lighthouseCommunity.id, vendorItemNo: "ILS-DGP-45", productDescription: "DuraGen Plus Dural Matrix 4x5cm", listPrice: 1500, contractPrice: 1250, category: "Neurosurgery" },
    { vendorId: v.integra.id, facilityId: f.lighthouseCommunity.id, vendorItemNo: "ILS-DMO-68", productDescription: "DuraMatrix Onlay 6x8cm", listPrice: 1180, contractPrice: 980, category: "Neurosurgery" },

    // --- NuVasive ---
    { vendorId: v.nuvasive.id, facilityId: f.summitGeneral.id, vendorItemNo: "NUV-MXC-1855", productDescription: "Modulus XLIF Cage 18x55mm", listPrice: 3900, contractPrice: 3200, category: "Spine" },
    { vendorId: v.nuvasive.id, facilityId: f.summitGeneral.id, vendorItemNo: "NUV-RPS-6550", productDescription: "Reline Pedicle Screw 6.5x50", listPrice: 580, contractPrice: 480, category: "Spine" },

    // --- Hologic ---
    { vendorId: v.hologic.id, facilityId: f.heritageRegional.id, vendorItemNo: "HLG-G3D-001", productDescription: "Genius 3D Mammography Detector", listPrice: 1020, contractPrice: 850, category: "Imaging" },
    { vendorId: v.hologic.id, facilityId: f.heritageRegional.id, vendorItemNo: "HLG-APB-001", productDescription: "Affirm Prone Biopsy Needle", listPrice: 395, contractPrice: 320, category: "Diagnostics" },

    // --- Conmed ---
    { vendorId: v.conmed.id, facilityId: f.summitGeneral.id, vendorItemNo: "CNMD-AST-12", productDescription: "AirSeal Trocar 12mm", listPrice: 350, contractPrice: 290, category: "General Surgery" },
  ]

  await prisma.pricingFile.createMany({
    data: entries.map((e) => ({
      ...e,
      effectiveDate: oneYearAgo,
      expirationDate: twoYearsFromNow,
      uom: "EA",
    })),
  })

  console.log(`  Pricing Files: ${entries.length}`)

  return entries.length
}
