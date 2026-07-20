import { AiProviderError, type AiProvider, type AiSummaryRequest, type AiSummaryResult } from "./types";
import { buildSystemPrompt, buildUserPrompt, parseAiSummaryJson } from "./shared";

// A real, current Gemini model as of this integration — overridable via GEMINI_MODEL
// without a code change.
const DEFAULT_MODEL = "gemini-1.5-flash";

export function createGeminiProvider(): AiProvider {
  return {
    name: "gemini",
    async generateReviewSummary(request: AiSummaryRequest): Promise<AiSummaryResult> {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new AiProviderError(
          "GEMINI_API_KEY is not configured. Set it in the environment to enable AI summaries.",
          "gemini",
        );
      }

      const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
            contents: [{ role: "user", parts: [{ text: buildUserPrompt(request) }] }],
            generationConfig: {
              temperature: 0.3,
              responseMimeType: "application/json",
            },
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new AiProviderError(
          `Gemini request failed (${response.status}): ${errorText.slice(0, 300)}`,
          "gemini",
        );
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new AiProviderError("Gemini response did not include any text content.", "gemini");
      }

      const parsed = parseAiSummaryJson(text, "gemini");
      return { ...parsed, modelUsed: model };
    },
  };
}
