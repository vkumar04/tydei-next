import { describe, it, expect } from "vitest"
import {
  computeContractLifecycleDistribution,
  type ContractForLifecycle,
} from "../lifecycle"

const ref = new Date("2026-04-18T00:00:00Z")

const daysFromRef = (days: number): Date => {
  const d = new Date(ref.getTime())
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

describe("computeContractLifecycleDistribution", () => {
  it("counts active contracts with distant expiration as active", () => {
    const contracts: ContractForLifecycle[] = [
      { status: "active", expirationDate: daysFromRef(365) },
    ]
    expect(computeContractLifecycleDistribution(contracts, ref)).toEqual({
      active: 1,
      expiring: 0,
      expired: 0,
      other: 0,
    })
  })

  it("bucket active contracts within 90 days as expiring", () => {
    const contracts: ContractForLifecycle[] = [
      { status: "active", expirationDate: daysFromRef(60) },
      { status: "active", expirationDate: daysFromRef(30) },
    ]
    const d = computeContractLifecycleDistribution(contracts, ref)
    expect(d.expiring).toBe(2)
    expect(d.active).toBe(0)
  })

  it("treats explicit status=expiring as expiring", () => {
    const contracts: ContractForLifecycle[] = [
      { status: "expiring", expirationDate: daysFromRef(200) },
    ]
    expect(computeContractLifecycleDistribution(contracts, ref).expiring).toBe(1)
  })

  it("treats status=expired as expired regardless of date", () => {
    const contracts: ContractForLifecycle[] = [
      { status: "expired", expirationDate: daysFromRef(365) },
    ]
    expect(computeContractLifecycleDistribution(contracts, ref).expired).toBe(1)
  })

  it("treats past expirationDate as expired even when status=active", () => {
    const contracts: ContractForLifecycle[] = [
      { status: "active", expirationDate: daysFromRef(-10) },
    ]
    expect(computeContractLifecycleDistribution(contracts, ref).expired).toBe(1)
  })

  it("buckets draft/pending contracts as 'other'", () => {
    const contracts: ContractForLifecycle[] = [
      { status: "draft", expirationDate: daysFromRef(300) },
      { status: "pending", expirationDate: null },
    ]
    expect(computeContractLifecycleDistribution(contracts, ref).other).toBe(2)
  })

  it("handles empty input", () => {
    expect(computeContractLifecycleDistribution([], ref)).toEqual({
      active: 0,
      expiring: 0,
      expired: 0,
      other: 0,
    })
  })

  it("mixes all buckets correctly", () => {
    const contracts: ContractForLifecycle[] = [
      { status: "active", expirationDate: daysFromRef(365) }, // active
      { status: "active", expirationDate: daysFromRef(30) }, // expiring (soon)
      { status: "expired", expirationDate: daysFromRef(-100) }, // expired
      { status: "active", expirationDate: daysFromRef(-5) }, // expired (past date)
      { status: "draft", expirationDate: null }, // other
    ]
    const d = computeContractLifecycleDistribution(contracts, ref)
    expect(d).toEqual({ active: 1, expiring: 1, expired: 2, other: 1 })
  })
})
