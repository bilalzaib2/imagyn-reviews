import { AiProviderError, type AiProvider, type AiSummaryRequest, type AiSummaryResult } from "./types";
import { buildSystemPrompt, buildUserPrompt, parseAiSummaryJson } from "./shared";

// A real, current Anthropic model as of this integration — overridable via
// ANTHROPIC_MODEL without a code change.
const DEFAULT_MODEL = "claude-3-5-haiku-20241022";
const ANTHROPIC_VERSION = "2023-06-01";

export function createAnthropicProvider(): AiProvider {
  return {
    name: "anthropic",
    async generateReviewSummary(request: AiSummaryRequest): Promise<AiSummaryResult> {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new AiProviderError(
          "ANTHROPIC_API_KEY is not configured. Set it in the environment to enable AI summaries.",
          "anthropic",
        );
      }

      const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          temperature: 0.3,
          system: buildSystemPrompt(),
          messages: [{ role: "user", content: buildUserPrompt(request) }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new AiProviderError(
          `Anthropic request failed (${response.status}): ${errorText.slice(0, 300)}`,
          "anthropic",
        );
      }

      const data = (await response.json()) as {
        model?: string;
        content?: Array<{ type: string; text?: string }>;
      };

      const textBlock = data.content?.find((block) => block.type === "text");
      if (!textBlock?.text) {
        throw new AiProviderError("Anthropic response did not include any text content.", "anthropic");
      }

      const parsed = parseAiSummaryJson(textBlock.text, "anthropic");
      return { ...parsed, modelUsed: data.model || model };
    },
  };
}
