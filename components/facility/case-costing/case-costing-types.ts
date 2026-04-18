/**
 * Case-costing UI shared client types.
 *
 * `getCasesForFacility` (lib/actions/case-costing/cases-list.ts) returns
 * Prisma Case rows with their supplies + procedures, passed through
 * `serialize()` (Decimal → number, Date → ISO string). The Prisma-preserved
 * static type still reports `Decimal`, so we project it into a runtime-true
 * shape here for UI consumption.
 */

export interface CaseSupplyRow {
  id: string
  vendorItemNo: string | null
  materialName: string
  /** CaseSupply has `usedCost` on the schema; the select aliases via prisma. */
  usedCost?: number
  unitCost?: number
  quantity: number
  extendedCost: number
  contractId: string | null
}

export interface CaseProcedureRow {
  id: string
  cptCode: string
}

export interface CaseRow {
  id: string
  caseNumber: string
  facilityId: string
  surgeonName: string | null
  surgeonId: string | null
  dateOfSurgery: string | Date
  primaryCptCode: string | null
  totalSpend: number
  totalReimbursement: number
  margin: number
  complianceStatus: string
  supplies: CaseSupplyRow[]
  procedures: CaseProcedureRow[]
}
