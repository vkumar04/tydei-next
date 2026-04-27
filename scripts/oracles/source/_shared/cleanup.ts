// scripts/oracles/source/_shared/cleanup.ts
/**
 * Idempotent cleanup of scenario data. Every source-level scenario
 * tags its contract `contractNumber` and its COG rows' `notes` with
 * `[ORACLE-<scenario-name>]` so we can wipe by prefix without
 * tracking individual ids. Runs both before (in case of leftover from
 * a previous failed run) and after every scenario.
 */
import { prisma } from "@/lib/db"

export async function wipeScenarioData(scenarioName: string): Promise<void> {
  const tag = `[ORACLE-${scenarioName}]`
  await prisma.cOGRecord.deleteMany({
    where: { notes: { startsWith: tag } },
  })
  await prisma.contract.deleteMany({
    where: { contractNumber: { startsWith: tag } },
  })
  // ContractTerm, ContractTier, ContractPricing, Rebate, ContractPeriod
  // all have onDelete: Cascade from Contract — they're handled by the
  // contract.deleteMany above.
}
