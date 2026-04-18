/**
 * Shared types for the scenario builder flow.
 *
 * Kept in a dedicated module so the builder, result cards, and compare
 * table all import from the same canonical shape without pulling in each
 * other's React components.
 */

import type { RebateScenarioInput } from "./scenario-builder"
import type { ScenarioEvaluation } from "./scenario-math"

export interface SavedScenario {
  id: string
  input: RebateScenarioInput
  evaluation: ScenarioEvaluation
  createdAt: number
}

export type { RebateScenarioInput } from "./scenario-builder"
export type { ScenarioEvaluation } from "./scenario-math"
