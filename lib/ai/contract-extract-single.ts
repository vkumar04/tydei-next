import type { LanguageModel } from "ai"
import { claudeExtractionFallback, claudeExtractionModel } from "@/lib/ai/config"
import { generateStructured } from "@/lib/ai/generate-structured"
import { getActiveContractExtractPrompt } from "@/lib/ai/prompts/contract-extract"
import { extractedContractSchema, type ExtractedContractData } from "@/lib/ai/schemas"

export async function extractContractSingle(opts: {
  fileData: Uint8Array
  fileName: string
  mediaType?: "application/pdf"
  textHint?: string
  userInstructionsHint?: string
  abortSignal?: AbortSignal
  actionName: string
  primary?: LanguageModel
  fallback?: LanguageModel
}): Promise<{ extracted: ExtractedContractData; modelUsed: "primary" | "fallback" }> {
  const result = await generateStructured({
    schema: extractedContractSchema,
    outputMode: "plain",
    actionName: opts.actionName,
    primary: opts.primary ?? claudeExtractionModel,
    fallback: opts.fallback ?? claudeExtractionFallback,
    abortSignal: opts.abortSignal,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: getActiveContractExtractPrompt().prompt + (opts.textHint ?? "") + (opts.userInstructionsHint ?? ""),
          },
          {
            type: "file",
            data: opts.fileData,
            mediaType: opts.mediaType ?? "application/pdf",
            filename: opts.fileName,
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
          },
        ],
      },
    ],
  })
  return { extracted: result.output, modelUsed: result.modelUsed }
}
