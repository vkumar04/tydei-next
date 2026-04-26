/**
 * Versioned prompt selector for /api/ai/extract-contract.
 *
 * Add new versions as v2.ts, v3.ts. Switch the active version by
 * setting `ACTIVE_PROMPT_VERSION` env var (defaults to v1). Lets us
 * ship a prompt revision behind a flag and roll back instantly
 * without a code change.
 *
 * Per-version files keep history searchable in git — a regression
 * in extraction accuracy traces directly to which prompt was active
 * at the time, with the diff visible vs the prior version.
 */

import { PROMPT_V1 } from "./v1"

const VERSIONS: Record<string, string> = {
  v1: PROMPT_V1,
  // v2: PROMPT_V2,
}

export function getActiveContractExtractPrompt(): {
  version: string
  prompt: string
} {
  const requested = process.env.ACTIVE_CONTRACT_EXTRACT_PROMPT ?? "v1"
  const prompt = VERSIONS[requested] ?? VERSIONS.v1
  return {
    version: VERSIONS[requested] ? requested : "v1",
    prompt,
  }
}
