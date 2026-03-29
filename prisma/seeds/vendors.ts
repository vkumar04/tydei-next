import type { PrismaClient, Vendor } from "@prisma/client"

export async function seedVendors(prisma: PrismaClient) {
  const stryker = await prisma.vendor.create({
    data: {
      name: "Stryker",
      code: "STK",
      displayName: "Stryker Corporation",
      contactName: "Sarah Mitchell",
      contactEmail: "sarah.mitchell@stryker.com",
      contactPhone: "269-555-1000",
      website: "https://stryker.com",
      tier: "premium",
    },
  })

  const medtronic = await prisma.vendor.create({
    data: {
      name: "Medtronic",
      code: "MDT",
      displayName: "Medtronic plc",
      contactName: "James Park",
      contactEmail: "james.park@medtronic.com",
      contactPhone: "763-555-2000",
      website: "https://medtronic.com",
      tier: "premium",
    },
  })

  const smithNephew = await prisma.vendor.create({
    data: {
      name: "Smith & Nephew",
      code: "SN",
      displayName: "Smith & Nephew plc",
      contactName: "Lisa Chen",
      contactEmail: "lisa.chen@smith-nephew.com",
      contactPhone: "901-555-3000",
      website: "https://smith-nephew.com",
      tier: "premium",
    },
  })

  const arthrex = await prisma.vendor.create({
    data: {
      name: "Arthrex",
      code: "ART",
      displayName: "Arthrex, Inc.",
      contactName: "Michael Torres",
      contactEmail: "m.torres@arthrex.com",
      contactPhone: "239-555-4000",
      website: "https://arthrex.com",
      tier: "standard",
    },
  })

  const depuySynthes = await prisma.vendor.create({
    data: {
      name: "DePuy Synthes",
      code: "DPS",
      displayName: "DePuy Synthes (J&J)",
      contactName: "Karen Walsh",
      contactEmail: "k.walsh@depuysynthes.com",
      contactPhone: "574-555-5000",
      website: "https://depuysynthes.com",
      tier: "premium",
    },
  })

  const zimmerBiomet = await prisma.vendor.create({
    data: {
      name: "Zimmer Biomet",
      code: "ZB",
      displayName: "Zimmer Biomet Holdings",
      contactName: "David Nguyen",
      contactEmail: "d.nguyen@zimmerbiomet.com",
      contactPhone: "574-555-6000",
      website: "https://zimmerbiomet.com",
      tier: "premium",
    },
  })

  const integra = await prisma.vendor.create({
    data: {
      name: "Integra LifeSciences",
      code: "ILS",
      displayName: "Integra LifeSciences Holdings",
      contactName: "Rachel Adams",
      contactEmail: "r.adams@integralife.com",
      contactPhone: "609-555-7000",
      website: "https://integralife.com",
      tier: "standard",
    },
  })

  const conmed = await prisma.vendor.create({
    data: {
      name: "Conmed",
      code: "CNMD",
      displayName: "CONMED Corporation",
      contactName: "Brian Kelly",
      contactEmail: "b.kelly@conmed.com",
      contactPhone: "315-555-8000",
      website: "https://conmed.com",
      tier: "standard",
    },
  })

  const nuvasive = await prisma.vendor.create({
    data: {
      name: "NuVasive",
      code: "NUV",
      displayName: "NuVasive, Inc.",
      contactName: "Patricia Reyes",
      contactEmail: "p.reyes@nuvasive.com",
      contactPhone: "858-555-9000",
      website: "https://nuvasive.com",
      tier: "standard",
    },
  })

  const hologic = await prisma.vendor.create({
    data: {
      name: "Hologic",
      code: "HLG",
      displayName: "Hologic, Inc.",
      contactName: "Jennifer Liu",
      contactEmail: "j.liu@hologic.com",
      contactPhone: "508-555-0100",
      website: "https://hologic.com",
      tier: "standard",
    },
  })

  // --- Vendor Divisions ---
  await prisma.vendorDivision.createMany({
    data: [
      { vendorId: stryker.id, name: "Joint Replacement", code: "JR", categories: ["Hips", "Knees", "Shoulders"] },
      { vendorId: stryker.id, name: "Trauma & Extremities", code: "TE", categories: ["Trauma", "Plates", "Screws"] },
      { vendorId: stryker.id, name: "Instruments", code: "INST", categories: ["Surgical Instruments", "Power Tools"] },
      { vendorId: medtronic.id, name: "Spine", code: "SP", categories: ["Spine Hardware", "Biologics"] },
      { vendorId: medtronic.id, name: "Neurosurgery", code: "NS", categories: ["Neuromodulation", "Neurovascular"] },
      { vendorId: medtronic.id, name: "Cardiac Rhythm", code: "CR", categories: ["Pacemakers", "Defibrillators"] },
      { vendorId: smithNephew.id, name: "Sports Medicine", code: "SM", categories: ["Arthroscopy", "Soft Tissue Repair"] },
      { vendorId: smithNephew.id, name: "Advanced Wound Care", code: "AWC", categories: ["Wound Dressings", "Negative Pressure"] },
      { vendorId: arthrex.id, name: "Arthroscopy", code: "ARTH", categories: ["Shoulder", "Knee", "Hip Arthroscopy"] },
      { vendorId: depuySynthes.id, name: "Joint Reconstruction", code: "JRC", categories: ["Hips", "Knees"] },
      { vendorId: depuySynthes.id, name: "Trauma", code: "TRM", categories: ["Plates", "Nails", "Screws"] },
      { vendorId: zimmerBiomet.id, name: "Knee", code: "KN", categories: ["Total Knee", "Partial Knee"] },
      { vendorId: zimmerBiomet.id, name: "Robotics", code: "ROB", categories: ["ROSA Robot"] },
      { vendorId: integra.id, name: "Neurosurgery", code: "NS", categories: ["Dural Repair", "Cranial Stabilization"] },
      { vendorId: conmed.id, name: "General Surgery", code: "GS", categories: ["Electrosurgery", "Gastroenterology"] },
      { vendorId: nuvasive.id, name: "Spine", code: "SP", categories: ["Interbody Fusion", "Fixation"] },
      { vendorId: hologic.id, name: "Breast Health", code: "BH", categories: ["Mammography", "Biopsy"] },
    ],
  })

  const vendors = {
    stryker,
    medtronic,
    smithNephew,
    arthrex,
    depuySynthes,
    zimmerBiomet,
    integra,
    conmed,
    nuvasive,
    hologic,
  }

  console.log("  Vendors: 10")
  console.log("  Vendor Divisions: 17")

  return { vendors }
}

export type Vendors = Awaited<ReturnType<typeof seedVendors>>["vendors"]
