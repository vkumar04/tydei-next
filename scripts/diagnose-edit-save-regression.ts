// Charles W1.Y-A — diagnose which field domain the edit-contract flow
// drops on save. Usage:
//   bun scripts/diagnose-edit-save-regression.ts <contractId>
// If no <contractId> is passed, picks the first tie-in contract on
// the demo facility (cmo4sbr8p0004wthl91ubwfwb).

import { prisma } from "@/lib/db"

const DEMO_FACILITY_ID = "cmo4sbr8p0004wthl91ubwfwb"

async function main() {
  let contractId = process.argv[2]

  if (!contractId) {
    const tieIn = await prisma.contract.findFirst({
      where: { facilityId: DEMO_FACILITY_ID, contractType: "tie_in" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    })
    if (!tieIn) {
      throw new Error(
        `No tie-in contract found on demo facility ${DEMO_FACILITY_ID}. Pass a <contractId> explicitly.`,
      )
    }
    contractId = tieIn.id
    console.log(
      `# Edit-save diagnostic — auto-picked tie-in contract "${tieIn.name}" (${tieIn.id})\n`,
    )
  } else {
    console.log(`# Edit-save diagnostic — contract ${contractId}\n`)
  }

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: { terms: { include: { tiers: true } } },
  })

  type Scalar = Omit<typeof contract, "terms">
  const scalars: Scalar = { ...contract }
  // strip relations for printing
  // @ts-expect-error — delete on structural copy
  delete (scalars as Record<string, unknown>).terms

  console.log("## Contract scalar fields\n")
  console.log("```json")
  console.log(
    JSON.stringify(
      scalars,
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  )
  console.log("```\n")

  console.log("## Terms + tiers\n")
  console.log("```json")
  console.log(
    JSON.stringify(
      contract.terms,
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  )
  console.log("```\n")

  console.log("## Contract scalar field names\n")
  console.log(Object.keys(scalars).sort().join(", "))
  console.log()

  if (contract.terms[0]) {
    console.log("## Term scalar field names\n")
    console.log(
      Object.keys(contract.terms[0])
        .filter((k) => k !== "tiers")
        .sort()
        .join(", "),
    )
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
