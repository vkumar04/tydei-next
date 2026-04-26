import type { PrismaClient, Facility } from "@prisma/client"

export async function seedHealthSystems(prisma: PrismaClient) {
  const lighthouse = await prisma.healthSystem.create({
    data: {
      name: "Lighthouse Health",
      code: "LH",
      headquarters: "Portland, OR",
      primaryContactEmail: "admin@lighthousehealth.com",
      phone: "503-555-1000",
      website: "https://lighthousehealth.com",
    },
  })

  const heritage = await prisma.healthSystem.create({
    data: {
      name: "Heritage Medical Group",
      code: "HMG",
      headquarters: "Austin, TX",
      primaryContactEmail: "admin@heritagemedical.com",
      phone: "512-555-2000",
      website: "https://heritagemedical.com",
    },
  })

  const summit = await prisma.healthSystem.create({
    data: {
      name: "Summit Healthcare",
      code: "SHC",
      headquarters: "Denver, CO",
      primaryContactEmail: "admin@summithealthcare.com",
      phone: "303-555-3000",
      website: "https://summithealthcare.com",
    },
  })

  // --- Lighthouse facilities (3) ---
  const lighthouseSurgical = await prisma.facility.create({
    data: {
      name: "Lighthouse Surgical Center",
      type: "asc",
      address: "1200 NW Surgical Way",
      city: "Portland",
      state: "OR",
      zip: "97209",
      beds: 12,
      healthSystemId: lighthouse.id,
    },
  })

  const lighthouseCommunity = await prisma.facility.create({
    data: {
      name: "Lighthouse Community Hospital",
      type: "hospital",
      address: "500 SE Medical Blvd",
      city: "Portland",
      state: "OR",
      zip: "97214",
      beds: 350,
      healthSystemId: lighthouse.id,
    },
  })

  const portlandOrtho = await prisma.facility.create({
    data: {
      name: "Portland Orthopedic Clinic",
      type: "clinic",
      address: "890 NE Bone & Joint Ave",
      city: "Portland",
      state: "OR",
      zip: "97232",
      beds: 0,
      healthSystemId: lighthouse.id,
    },
  })

  // --- Heritage facilities (3) ---
  const heritageRegional = await prisma.facility.create({
    data: {
      name: "Heritage Regional Medical Center",
      type: "hospital",
      address: "2000 Heritage Parkway",
      city: "Austin",
      state: "TX",
      zip: "78701",
      beds: 425,
      healthSystemId: heritage.id,
    },
  })

  const austinSpine = await prisma.facility.create({
    data: {
      name: "Austin Spine & Joint Center",
      type: "surgery_center",
      address: "450 Bone & Joint Dr",
      city: "Austin",
      state: "TX",
      zip: "78702",
      beds: 8,
      healthSystemId: heritage.id,
    },
  })

  const heritagePediatrics = await prisma.facility.create({
    data: {
      name: "Heritage Pediatrics",
      type: "clinic",
      address: "1100 Children's Way",
      city: "Austin",
      state: "TX",
      zip: "78745",
      beds: 0,
      healthSystemId: heritage.id,
    },
  })

  // --- Summit facilities (2) ---
  const summitGeneral = await prisma.facility.create({
    data: {
      name: "Summit General Hospital",
      type: "hospital",
      address: "7500 Peak View Blvd",
      city: "Denver",
      state: "CO",
      zip: "80220",
      beds: 280,
      healthSystemId: summit.id,
    },
  })

  const rockyMountain = await prisma.facility.create({
    data: {
      name: "Rocky Mountain Outpatient Center",
      type: "asc",
      address: "3200 Foothills Pkwy",
      city: "Denver",
      state: "CO",
      zip: "80222",
      beds: 6,
      healthSystemId: summit.id,
    },
  })

  const healthSystems = { lighthouse, heritage, summit }
  const facilities = {
    lighthouseSurgical,
    lighthouseCommunity,
    portlandOrtho,
    heritageRegional,
    austinSpine,
    heritagePediatrics,
    summitGeneral,
    rockyMountain,
  }

  console.log("  Health Systems: 3")
  console.log("  Facilities: 8")

  return { healthSystems, facilities }
}

export type HealthSystems = Awaited<ReturnType<typeof seedHealthSystems>>["healthSystems"]
export type Facilities = Awaited<ReturnType<typeof seedHealthSystems>>["facilities"]
