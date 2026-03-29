import type { PrismaClient } from "@prisma/client"

const dataDate = new Date(2025, 11, 1) // Dec 2025

export async function seedBenchmarks(prisma: PrismaClient) {
  await prisma.productBenchmark.createMany({
    data: [
      { vendorItemNo: "6260-1-040", description: "Stryker Accolade II Hip Stem", category: "Joint Replacement", nationalAvgPrice: 3850, percentile25: 3200, percentile50: 3800, percentile75: 4400, minPrice: 2600, maxPrice: 5200, sampleSize: 4200, dataDate },
      { vendorItemNo: "6260-4-520", description: "Stryker Triathlon Knee System", category: "Joint Replacement", nationalAvgPrice: 4200, percentile25: 3500, percentile50: 4150, percentile75: 4900, minPrice: 2800, maxPrice: 5800, sampleSize: 3800, dataDate },
      { vendorItemNo: "7166-7-050", description: "Stryker X3 Polyethylene Liner", category: "Joint Replacement", nationalAvgPrice: 1200, percentile25: 950, percentile50: 1180, percentile75: 1450, minPrice: 700, maxPrice: 1800, sampleSize: 3500, dataDate },
      { vendorItemNo: "PINNACLE-100", description: "DePuy Pinnacle Hip System", category: "Joint Replacement", nationalAvgPrice: 4100, percentile25: 3400, percentile50: 4050, percentile75: 4750, minPrice: 2700, maxPrice: 5500, sampleSize: 3200, dataDate },
      { vendorItemNo: "ATTUNE-RP-01", description: "DePuy ATTUNE Knee System", category: "Joint Replacement", nationalAvgPrice: 4400, percentile25: 3700, percentile50: 4350, percentile75: 5100, minPrice: 3000, maxPrice: 6100, sampleSize: 2900, dataDate },
      { vendorItemNo: "MDT-CAPSTONE", description: "Medtronic Capstone Spinal System", category: "Spine", nationalAvgPrice: 6800, percentile25: 5600, percentile50: 6700, percentile75: 8000, minPrice: 4200, maxPrice: 9500, sampleSize: 1800, dataDate },
      { vendorItemNo: "MDT-INFUSE-SM", description: "Medtronic INFUSE Bone Graft (small)", category: "Biologics", nationalAvgPrice: 4900, percentile25: 4200, percentile50: 4850, percentile75: 5600, minPrice: 3500, maxPrice: 6800, sampleSize: 2400, dataDate },
      { vendorItemNo: "SN-PICO-7", description: "Smith & Nephew PICO 7", category: "Wound Care", nationalAvgPrice: 285, percentile25: 220, percentile50: 275, percentile75: 340, minPrice: 150, maxPrice: 420, sampleSize: 5000, dataDate },
      { vendorItemNo: "ART-AR-7230", description: "Arthrex SwiveLock Anchor 5.5mm", category: "Sports Medicine", nationalAvgPrice: 480, percentile25: 380, percentile50: 465, percentile75: 560, minPrice: 280, maxPrice: 680, sampleSize: 4500, dataDate },
      { vendorItemNo: "ART-FBW-2", description: "Arthrex FiberWire #2", category: "Sports Medicine", nationalAvgPrice: 95, percentile25: 72, percentile50: 92, percentile75: 115, minPrice: 50, maxPrice: 145, sampleSize: 4800, dataDate },
      { vendorItemNo: "DPS-LCP-3545", description: "DePuy Synthes LCP Plate 3.5mm", category: "Trauma", nationalAvgPrice: 1850, percentile25: 1500, percentile50: 1800, percentile75: 2200, minPrice: 1100, maxPrice: 2800, sampleSize: 2100, dataDate },
      { vendorItemNo: "DPS-SCREW-35", description: "DePuy Synthes Cortex Screw 3.5mm", category: "Trauma", nationalAvgPrice: 85, percentile25: 65, percentile50: 82, percentile75: 105, minPrice: 40, maxPrice: 140, sampleSize: 4000, dataDate },
      { vendorItemNo: "ZB-PERSONA-TK", description: "Zimmer Biomet Persona TKA System", category: "Joint Replacement", nationalAvgPrice: 4500, percentile25: 3800, percentile50: 4450, percentile75: 5200, minPrice: 3100, maxPrice: 6200, sampleSize: 2600, dataDate },
      { vendorItemNo: "ILS-DURAGEN", description: "Integra DuraGen Dural Graft", category: "Neurosurgery", nationalAvgPrice: 1650, percentile25: 1350, percentile50: 1600, percentile75: 1950, minPrice: 1000, maxPrice: 2400, sampleSize: 1200, dataDate },
      { vendorItemNo: "NUV-XLIF-CAGE", description: "NuVasive XLIF Interbody Cage", category: "Spine", nationalAvgPrice: 5200, percentile25: 4400, percentile50: 5100, percentile75: 6000, minPrice: 3600, maxPrice: 7200, sampleSize: 1500, dataDate },
    ],
  })

  console.log("  Product Benchmarks: 15")
}
