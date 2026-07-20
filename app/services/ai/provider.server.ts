import { AiProviderError, type AiProvider } from "./types";
import { createOpenAiProvider } from "./openai.server";
import { createAnthropicProvider } from "./anthropic.server";
import { createGeminiProvider } from "./gemini.server";

// The single place that reads AI_PROVIDER — switching providers is a config change here,
// never a change to aiSummary.server.ts (the only caller of this function) or any UI code.
export function getAiProvider(): AiProvider {
  const configured = (process.env.AI_PROVIDER || "openai").trim().toLowerCase();

  switch (configured) {
    case "openai":
      return createOpenAiProvider();
    case "anthropic":
      return createAnthropicProvider();
    case "gemini":
      return createGeminiProvider();
    default:
      throw new AiProviderError(
        `Unknown AI_PROVIDER "${configured}". Expected "openai", "anthropic", or "gemini".`,
        configured,
      );
  }
}
