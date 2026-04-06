import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 })
  }

  const results: string[] = []

  await prisma.caseSupply.deleteMany({}); results.push("caseSupply")
  await prisma.caseProcedure.deleteMany({}); results.push("caseProcedure")
  await prisma.case.deleteMany({}); results.push("case")
  await prisma.invoiceLineItem.deleteMany({}); results.push("invoiceLineItem")
  await prisma.invoice.deleteMany({}); results.push("invoice")
  await prisma.pOLineItem.deleteMany({}); results.push("poLineItem")
  await prisma.purchaseOrder.deleteMany({}); results.push("purchaseOrder")
  await prisma.rebate.deleteMany({}); results.push("rebate")
  await prisma.contractPeriod.deleteMany({}); results.push("contractPeriod")
  await prisma.contractDocument.deleteMany({}); results.push("contractDocument")
  await prisma.contractPricing.deleteMany({}); results.push("contractPricing")
  await prisma.contractTermProcedure.deleteMany({}); results.push("contractTermProcedure")
  await prisma.contractTier.deleteMany({}); results.push("contractTier")
  await prisma.contractTerm.deleteMany({}); results.push("contractTerm")
  await prisma.contractChangeProposal.deleteMany({}); results.push("contractChangeProposal")
  await prisma.contractFacility.deleteMany({}); results.push("contractFacility")
  await prisma.contract.deleteMany({}); results.push("contract")
  await prisma.pendingContract.deleteMany({}); results.push("pendingContract")
  await prisma.cOGRecord.deleteMany({}); results.push("cogRecord")
  await prisma.pricingFile.deleteMany({}); results.push("pricingFile")
  await prisma.payorContract.deleteMany({}); results.push("payorContract")
  await prisma.alert.deleteMany({}); results.push("alert")
  await prisma.auditLog.deleteMany({}); results.push("auditLog")
  await prisma.aIUsageRecord.deleteMany({}); results.push("aiUsageRecord")
  await prisma.aICredit.deleteMany({}); results.push("aiCredit")
  await prisma.connection.deleteMany({}); results.push("connection")
  await prisma.featureFlag.deleteMany({}); results.push("featureFlag")
  await prisma.surgeonUsage.deleteMany({}); results.push("surgeonUsage")
  await prisma.vendorNameMapping.deleteMany({}); results.push("vendorNameMapping")
  await prisma.reportSchedule.deleteMany({}); results.push("reportSchedule")
  await prisma.vendorDivision.deleteMany({}); results.push("vendorDivision")
  await prisma.productCategory.deleteMany({}); results.push("productCategory")
  await prisma.vendor.updateMany({ data: { organizationId: null } })
  await prisma.vendor.deleteMany({}); results.push("vendor")
  await prisma.facility.updateMany({ data: { organizationId: null, healthSystemId: null } })
  await prisma.facility.deleteMany({}); results.push("facility")
  await prisma.healthSystem.deleteMany({}); results.push("healthSystem")
  await prisma.session.deleteMany({}); results.push("session")

  return NextResponse.json({ deleted: results, count: results.length })
}
