"use server"

/**
 * Charles audit suggestion (v0-port): Service SLA Penalty wrapper.
 * Delegates to `v0ServiceSlaPenalty` for the math; wires it to the
 * contract's annualValue + the SLA defaults documented in v0 §1.
 *
 * v0's spec stores SLA terms on the contract; tydei doesn't yet
 * carry response/uptime SLA columns. Until those land, this action
 * accepts the actuals + SLA targets as input from the caller (a
 * Service Level Card the user fills in) and returns the penalty.
 */

import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { v0ServiceSlaPenalty } from "@/lib/v0-spec/tie-in"
import { requireContractScope } from "@/lib/actions/analytics/_scope"
import { withTelemetry } from "@/lib/actions/analytics/_telemetry"

export interface ServiceSlaInput {
  contractId: string
  actualResponseHours: number
  slaResponseHours: number
  /** $ per hour over the SLA. Default $250/hr for hospital service contracts. */
  hourlyPenaltyRate?: number
  actualUptimePct: number
  slaUptimePct: number
}

export async function evaluateServiceSla(input: ServiceSlaInput) {
  return withTelemetry(
    "evaluateServiceSla",
    { contractId: input.contractId },
    async () => {
      try {
        return await _evaluateServiceSlaImpl(input)
      } catch (err) {
        console.error("[evaluateServiceSla]", err, {
          contractId: input.contractId,
        })
        throw new Error("SLA evaluation is unavailable for this contract.")
      }
    },
  )
}

async function _evaluateServiceSlaImpl(input: ServiceSlaInput) {
  await requireContractScope(input.contractId)

  const contract = await prisma.contract.findFirstOrThrow({
    where: { id: input.contractId },
    select: { annualValue: true, contractType: true },
  })

  const result = v0ServiceSlaPenalty({
    actualResponseHours: input.actualResponseHours,
    slaResponseHours: input.slaResponseHours,
    hourlyPenaltyRate: input.hourlyPenaltyRate ?? 250,
    actualUptimePct: input.actualUptimePct,
    slaUptimePct: input.slaUptimePct,
    annualFee: Number(contract.annualValue ?? 0),
  })

  return serialize({
    ...result,
    contractType: contract.contractType,
    annualFee: Number(contract.annualValue ?? 0),
  })
}
