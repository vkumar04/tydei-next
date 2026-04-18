import { describe, it, expect } from "vitest"
import {
  FACILITY_SUGGESTED_QUESTIONS,
  VENDOR_SUGGESTED_QUESTIONS,
  getSuggestedQuestions,
  type SuggestedQuestion,
} from "../chat-suggestions"

const REQUIRED_CATEGORIES: SuggestedQuestion["category"][] = [
  "Contract Performance",
  "Rebate Analysis",
  "Alerts Summary",
  "Cost Savings",
  "Market Share",
  "Surgeon Metrics",
]

describe("FACILITY_SUGGESTED_QUESTIONS", () => {
  it("ships exactly the 6 canonical categories in spec order", () => {
    expect(FACILITY_SUGGESTED_QUESTIONS).toHaveLength(6)
    expect(FACILITY_SUGGESTED_QUESTIONS.map((q) => q.category)).toEqual(
      REQUIRED_CATEGORIES,
    )
  })

  it("uses the verbatim spec copy for each facility chip", () => {
    const byCategory = Object.fromEntries(
      FACILITY_SUGGESTED_QUESTIONS.map((q) => [q.category, q.question]),
    )
    expect(byCategory["Contract Performance"]).toBe(
      "How are our top contracts performing this quarter?",
    )
    expect(byCategory["Rebate Analysis"]).toBe(
      "What is our total earned rebate this year and how close are we to hitting the next tier?",
    )
    expect(byCategory["Alerts Summary"]).toBe(
      "What are the critical alerts I should address today?",
    )
    expect(byCategory["Cost Savings"]).toBe(
      "Where are our biggest opportunities to save money on contracts?",
    )
    expect(byCategory["Market Share"]).toBe(
      "What does our market share look like across product categories?",
    )
    expect(byCategory["Surgeon Metrics"]).toBe(
      "Which surgeons have the best spend efficiency scores?",
    )
  })

  it("has no empty question strings", () => {
    for (const q of FACILITY_SUGGESTED_QUESTIONS) {
      expect(q.question.trim().length).toBeGreaterThan(0)
    }
  })
})

describe("VENDOR_SUGGESTED_QUESTIONS", () => {
  it("mirrors the 6 canonical categories in the same order", () => {
    expect(VENDOR_SUGGESTED_QUESTIONS).toHaveLength(6)
    expect(VENDOR_SUGGESTED_QUESTIONS.map((q) => q.category)).toEqual(
      REQUIRED_CATEGORIES,
    )
  })

  it("uses vendor-perspective copy (distinct from facility)", () => {
    for (let i = 0; i < VENDOR_SUGGESTED_QUESTIONS.length; i++) {
      expect(VENDOR_SUGGESTED_QUESTIONS[i]?.question).not.toBe(
        FACILITY_SUGGESTED_QUESTIONS[i]?.question,
      )
    }
  })
})

describe("getSuggestedQuestions()", () => {
  it("returns the facility list for audience='facility'", () => {
    expect(getSuggestedQuestions("facility")).toBe(FACILITY_SUGGESTED_QUESTIONS)
  })

  it("returns the vendor list for audience='vendor'", () => {
    expect(getSuggestedQuestions("vendor")).toBe(VENDOR_SUGGESTED_QUESTIONS)
  })
})
