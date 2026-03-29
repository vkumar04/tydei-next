import type { PrismaClient, ProductCategory } from "@prisma/client"

export async function seedCategories(prisma: PrismaClient) {
  // --- Parent categories ---
  const orthopedics = await prisma.productCategory.create({
    data: { name: "Orthopedics", description: "Orthopedic implants, instruments, and biologics" },
  })

  const generalSurgery = await prisma.productCategory.create({
    data: { name: "General Surgery", description: "General surgical instruments and disposables" },
  })

  const cardiovascular = await prisma.productCategory.create({
    data: { name: "Cardiovascular", description: "Cardiac and vascular devices and implants" },
  })

  const neurosurgery = await prisma.productCategory.create({
    data: { name: "Neurosurgery", description: "Neurosurgical implants and instruments" },
  })

  const diagnostics = await prisma.productCategory.create({
    data: { name: "Diagnostics", description: "Diagnostic imaging and laboratory equipment" },
  })

  const biologics = await prisma.productCategory.create({
    data: { name: "Biologics", description: "Bone grafts, growth factors, and tissue products" },
  })

  // --- Orthopedics children ---
  const jointReplacement = await prisma.productCategory.create({
    data: { name: "Joint Replacement", description: "Hip, knee, and shoulder replacement implants", parentId: orthopedics.id },
  })

  const trauma = await prisma.productCategory.create({
    data: { name: "Trauma", description: "Plates, screws, nails, and external fixation", parentId: orthopedics.id },
  })

  const spine = await prisma.productCategory.create({
    data: { name: "Spine", description: "Spinal implants, fusion hardware, and interbody devices", parentId: orthopedics.id },
  })

  const sportsMedicine = await prisma.productCategory.create({
    data: { name: "Sports Medicine", description: "Ligament reconstruction and soft tissue repair", parentId: orthopedics.id },
  })

  const arthroscopy = await prisma.productCategory.create({
    data: { name: "Arthroscopy", description: "Minimally invasive surgical instruments and implants", parentId: orthopedics.id },
  })

  // --- General Surgery children ---
  const woundCare = await prisma.productCategory.create({
    data: { name: "Wound Care", description: "Wound dressings, negative pressure, and skin substitutes", parentId: generalSurgery.id },
  })

  const surgicalInstruments = await prisma.productCategory.create({
    data: { name: "Surgical Instruments", description: "Electrosurgery, suction, and powered instruments", parentId: generalSurgery.id },
  })

  // --- Cardiovascular children ---
  const cardiacRhythm = await prisma.productCategory.create({
    data: { name: "Cardiac Rhythm", description: "Pacemakers, defibrillators, and CRT devices", parentId: cardiovascular.id },
  })

  // --- Diagnostics children ---
  const imaging = await prisma.productCategory.create({
    data: { name: "Imaging", description: "Mammography, fluoroscopy, and ultrasound", parentId: diagnostics.id },
  })

  const categories = {
    orthopedics,
    generalSurgery,
    cardiovascular,
    neurosurgery,
    diagnostics,
    biologics,
    jointReplacement,
    trauma,
    spine,
    sportsMedicine,
    arthroscopy,
    woundCare,
    surgicalInstruments,
    cardiacRhythm,
    imaging,
  }

  console.log("  Product Categories: 15 (6 parents, 9 children)")

  return { categories }
}

export type Categories = Awaited<ReturnType<typeof seedCategories>>["categories"]
