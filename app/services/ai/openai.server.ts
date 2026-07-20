import { AiProviderError, type AiProvider, type AiSummaryRequest, type AiSummaryResult } from "./types";
import { buildSystemPrompt, buildUserPrompt, parseAiSummaryJson } from "./shared";

// A real, current OpenAI chat model as of this integration — overridable via OPENAI_MODEL
// without a code change if a merchant/ops wants a different one.
const DEFAULT_MODEL = "gpt-4o-mini";

export function createOpenAiProvider(): AiProvider {
  return {
    name: "openai",
    async generateReviewSummary(request: AiSummaryRequest): Promise<AiSummaryResult> {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new AiProviderError(
          "OPENAI_API_KEY is not configured. Set it in the environment to enable AI summaries.",
          "openai",
        );
      }

      const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          temperature: 0.3,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: buildUserPrompt(request) },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new AiProviderError(
          `OpenAI request failed (${response.status}): ${errorText.slice(0, 300)}`,
          "openai",
        );
      }

      const data = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new AiProviderError("OpenAI response did not include any content.", "openai");
      }

      const parsed = parseAiSummaryJson(content, "openai");
      return { ...parsed, modelUsed: data.model || model };
    },
  };
}
