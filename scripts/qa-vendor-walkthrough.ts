/**
 * QA walkthrough — acts as a vendor user (Stryker), exercises the
 * vendor-side pages by calling the data functions directly.
 */
import { prisma } from "@/lib/db"

const FINDINGS: { surface: string; level: "OK" | "WARN" | "BUG"; detail: string }[] = []
function note(surface: string, level: "OK" | "WARN" | "BUG", detail: string) {
  FINDINGS.push({ surface, level, detail })
  const icon = level === "OK" ? "✅" : level === "WARN" ? "⚠️ " : "🐛"
  console.log(`  ${icon} ${surface}  —  ${detail}`)
}
const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

async function main() {
  console.log("# QA walkthrough — Vendor user (Stryker)")
  console.log()

  const vendor = await prisma.vendor.findFirstOrThrow({
    where: { name: { contains: "Stryker", mode: "insensitive" } },
  })
  console.log(`Logged in as: demo-vendor@tydei.com  →  ${vendor.name}  (${vendor.id})`)
  console.log()

  // ── Page: Vendor dashboard ───────────────────────────────────
  console.log("## /vendor (dashboard)")
  const myContracts = await prisma.contract.findMany({
    where: { vendorId: vendor.id },
    include: { facility: { select: { name: true } } },
  })
  note(
    "Vendor dashboard — my contracts",
    myContracts.length > 0 ? "OK" : "WARN",
    `${myContracts.length} contracts across ${new Set(myContracts.map((c) => c.facilityId)).size} facilities`,
  )
  for (const c of myContracts.slice(0, 5)) {
    console.log(`      ${c.name.slice(0, 50)}  @  ${c.facility?.name}  |  total ${fmt(Number(c.totalValue))}  status=${c.status}`)
  }
  console.log()

  // ── Page: Vendor contracts list ──────────────────────────────
  console.log("## /vendor/contracts")
  const statusBreakdown: Record<string, number> = {}
  for (const c of myContracts) {
    statusBreakdown[c.status] = (statusBreakdown[c.status] ?? 0) + 1
  }
  note(
    "Vendor contracts list — status breakdown",
    "OK",
    Object.entries(statusBreakdown).map(([s, n]) => `${s}=${n}`).join("  "),
  )
  console.log()

  // ── Page: Vendor contract detail (pick first active) ─────────
  console.log("## /vendor/contracts/:id")
  const activeC = myContracts.find((c) => c.status === "active") ?? myContracts[0]
  if (activeC) {
    console.log(`  Picking: ${activeC.name}`)
    const c = await prisma.contract.findUniqueOrThrow({
      where: { id: activeC.id },
      include: {
        terms: { include: { tiers: true } },
        rebates: true,
        facility: { select: { name: true } },
      },
    })
    note(
      "Vendor contract detail — terms",
      c.terms.length >= 0 ? "OK" : "BUG",
      `${c.terms.length} terms`,
    )
    const totalEarned = c.rebates.reduce((s, r) => s + Number(r.rebateEarned), 0)
    const totalCollected = c.rebates.reduce((s, r) => s + Number(r.rebateCollected), 0)
    note(
      "Vendor contract detail — rebate ledger",
      "OK",
      `${c.rebates.length} rebate rows, facility owes ${fmt(totalEarned - totalCollected)}`,
    )
  } else {
    note("Vendor contract detail", "WARN", "no contracts to drill into")
  }
  console.log()

  // ── Page: Vendor pending contracts ───────────────────────────
  console.log("## /vendor/contracts/pending")
  const pending = await prisma.pendingContract.findMany({
    where: { vendorId: vendor.id },
    include: { facility: { select: { name: true } } },
  })
  note(
    "Pending submissions",
    "OK",
    `${pending.length} pending`,
  )
  for (const p of pending.slice(0, 3)) {
    console.log(`      "${p.contractName}"  →  ${p.facility.name}  status=${p.status}`)
  }
  console.log()

  // ── Page: Vendor invoices ───────────────────────────────────
  console.log("## /vendor/invoices")
  const invoices = await prisma.invoice.findMany({
    where: { vendorId: vendor.id },
    take: 5,
    orderBy: { createdAt: "desc" },
  }).catch(() => null)
  if (invoices === null) {
    note("Invoices", "WARN", "Invoice model/query path errored")
  } else {
    note("Invoices", "OK", `${invoices.length} invoices loaded`)
  }
  console.log()

  // ── Summary ─────────────────────────────────────────────────
  console.log("━".repeat(60))
  const bugs = FINDINGS.filter((f) => f.level === "BUG")
  const warns = FINDINGS.filter((f) => f.level === "WARN")
  const oks = FINDINGS.filter((f) => f.level === "OK")
  console.log(`Findings: ${oks.length} OK, ${warns.length} WARN, ${bugs.length} BUG`)
  if (bugs.length > 0) {
    console.log("\n🐛 Bugs:")
    for (const f of bugs) console.log(`  ${f.surface} — ${f.detail}`)
  }
  if (warns.length > 0) {
    console.log("\n⚠️  Warnings:")
    for (const f of warns) console.log(`  ${f.surface} — ${f.detail}`)
  }

  await prisma.$disconnect()
  process.exit(bugs.length > 0 ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
