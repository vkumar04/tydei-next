"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  createContractSchema,
  type CreateContractInput,
} from "@/lib/validators/contracts"
import type { TermFormValues } from "@/lib/validators/contract-terms"

const STEPS = ["basic", "terms", "review"] as const
type Step = (typeof STEPS)[number]

interface UseContractFormOptions {
  defaultValues?: Partial<CreateContractInput>
  defaultTerms?: TermFormValues[]
}

export function useContractForm(options?: UseContractFormOptions) {
  const [step, setStep] = useState<Step>("basic")
  const [terms, setTerms] = useState<TermFormValues[]>(
    options?.defaultTerms ?? []
  )

  const form = useForm<CreateContractInput>({
    resolver: zodResolver(createContractSchema),
    defaultValues: {
      name: "",
      contractNumber: "",
      vendorId: "",
      contractType: "usage",
      status: "draft",
      effectiveDate: "",
      expirationDate: "",
      autoRenewal: false,
      terminationNoticeDays: 90,
      totalValue: 0,
      annualValue: 0,
      description: "",
      performancePeriod: "monthly",
      rebatePayPeriod: "quarterly",
      isMultiFacility: false,
      isGrouped: false,
      facilityIds: [],
      additionalFacilityIds: [],
      categoryIds: [],
      // Charles 2026-04-25 (audit follow-up): contract-level metric
      // defaults. null (not 0) so the engine treats them as
      // "not tracked" rather than "0% achieved".
      complianceRate: null,
      currentMarketShare: null,
      marketShareCommitment: null,
      ...options?.defaultValues,
    },
  })

  const currentStepIndex = STEPS.indexOf(step)

  function nextStep() {
    const nextIdx = currentStepIndex + 1
    if (nextIdx < STEPS.length) {
      setStep(STEPS[nextIdx])
    }
  }

  function prevStep() {
    const prevIdx = currentStepIndex - 1
    if (prevIdx >= 0) {
      setStep(STEPS[prevIdx])
    }
  }

  function goToStep(s: Step) {
    setStep(s)
  }

  return {
    form,
    step,
    steps: STEPS,
    currentStepIndex,
    terms,
    setTerms,
    nextStep,
    prevStep,
    goToStep,
    isFirstStep: currentStepIndex === 0,
    isLastStep: currentStepIndex === STEPS.length - 1,
  }
}
