/**
 * Multi-Provider Model Abstraction
 *
 * Supports: Anthropic, OpenAI, Google, DeepSeek, Zhipu, Minimax, Mistral, OpenRouter
 *
 * Design decisions:
 * 1. ESM-compatible top-level imports for installed SDKs
 * 2. Backward compatible - existing code works unchanged
 * 3. Provider detection via environment variables
 * 4. OpenAI-compatible API for providers without dedicated SDK
 * 5. Prefer models with tools + strict structured output support
 *
 * @module agent/model-provider
 */

import "../env/bootstrap-env.js";
import { createAnthropic } from "@ai-sdk/anthropic";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { google } from "@ai-sdk/google";
import { mistral } from "@ai-sdk/mistral";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, type LanguageModel } from "ai";
import {
  type VariantName,
  type ModelConfigWithVariant,
  type ModelVariantOptions,
  extractVariant,
  getVariantOptions,
  getVariantProviderOptions,
} from "./model-variants.js";
import { modelCapabilities } from "./model-capabilities/index.js";

// Re-export variant types and functions for convenience
export type { VariantName, ModelConfigWithVariant, ModelVariantOptions };
export { getVariantProviderOptions };

// ============================================================================
// Types
// ============================================================================

export type ProviderName =
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "zhipu"
  | "openrouter"
  | "mistral"
  | "ollama";

export interface ModelConfig {
  provider: ProviderName;
  model: string;
}

export interface ProviderInfo {
  name: string;
  envVar: string;
  docUrl: string;
  defaultModel: string;
  models: string[];
  description?: string;
}

/**
 * Providers that support only `json_object` (no strict `json_schema` validation).
 * GateFlow requires strict schema validation for structured output workflows.
 */
export const STRICT_SCHEMA_UNSUPPORTED_PROVIDERS: ReadonlySet<ProviderName> =
  new Set<ProviderName>(["deepseek", "zhipu"]);

/**
 * Check whether a provider supports strict JSON schema structured output.
 */
export function supportsStrictStructuredOutputs(
  provider: ProviderName,
): boolean {
  return !STRICT_SCHEMA_UNSUPPORTED_PROVIDERS.has(provider);
}

/**
 * Return a human-readable compatibility error if provider/model is not supported.
 */
export function getStructuredOutputCompatibilityError(
  config: Pick<ModelConfig, "provider" | "model">,
): string | null {
  if (supportsStrictStructuredOutputs(config.provider)) {
    return null;
  }

  return (
    `Model "${config.provider}/${config.model}" is not compatible with GateFlow structured output.\n` +
    `Reason: provider currently supports json_object mode only (no strict json_schema validation).\n` +
    `Use Anthropic, OpenAI, Google, Mistral, Ollama, or compatible OpenRouter models.`
  );
}

// ============================================================================
// Provider Registry (January 2026)
// Models are listed per provider, with strict-structured-output compatibility
// enforced via supportsStrictStructuredOutputs() and runtime checks.
//
// Sources:
// - Anthropic: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
// - OpenAI: https://platform.openai.com/docs/models/
// - Google: https://ai.google.dev/gemini-api/docs/models
// - Mistral: https://docs.mistral.ai/capabilities/structured_output
// - DeepSeek: https://api-docs.deepseek.com/news/news251201
// - Zhipu: https://open.bigmodel.cn/
// - Ollama: https://docs.ollama.com/capabilities/tool-calling
// ============================================================================

export const PROVIDERS: Record<ProviderName, ProviderInfo> = {
  anthropic: {
    name: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    docUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-sonnet-4-5-20250929",
    models: [
      // Claude 4.5 family - all support tools + structured outputs + extended thinking
      "claude-opus-4-5-20251101", // Most capable, extended thinking
      "claude-sonnet-4-5-20250929", // Balanced performance/cost (default)
      "claude-haiku-4-5-20251001", // Fastest, most cost-efficient
      // Legacy Claude 4 models (still available)
      "claude-opus-4-1-20250805", // Opus 4.1 - agentic tasks
      "claude-sonnet-4-20250514", // Sonnet 4
      "claude-opus-4-20250514", // Opus 4
    ],
  },
  openai: {
    name: "OpenAI (GPT)",
    envVar: "OPENAI_API_KEY",
    docUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-5",
    models: [
      // GPT-5 family - all support tools + structured outputs
      "gpt-5.2", // Latest (Dec 2025) - SOTA on ARC-AGI
      "gpt-5.1", // November 2025
      "gpt-5", // Default in ChatGPT, replaces 4o
      // O-series reasoning models - tools + structured outputs
      "o3", // Most powerful reasoning
      "o3-pro", // Extended thinking version
      "o4-mini", // Fast reasoning, best on AIME
      // GPT-4 series - still supported
      "gpt-4.1", // Coding specialist, 1M context
      "gpt-4o", // Previous flagship
      "gpt-4o-mini", // Fast, cost-efficient
    ],
  },
  google: {
    name: "Google (Gemini)",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    docUrl: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-2.5-flash",
    models: [
      // Gemini 3 (preview) - tools + structured outputs + thinking_level
      "gemini-3-pro-preview", // State-of-the-art reasoning, 1M context
      "gemini-3-flash-preview", // Fast Gemini 3
      // Gemini 2.5 - stable, tools + structured outputs
      "gemini-2.5-pro", // Most powerful 2.5, adaptive thinking
      "gemini-2.5-flash", // Fast and capable
      "gemini-2.5-flash-lite", // Lowest latency/cost
    ],
  },
  deepseek: {
    name: "DeepSeek",
    envVar: "DEEPSEEK_API_KEY",
    docUrl: "https://platform.deepseek.com/api_keys",
    defaultModel: "deepseek-chat",
    models: [
      // V3.2 - hybrid thinking mode, tools + json_object (NOT json_schema)
      // Structured output: json_object only, no server-side schema validation
      "deepseek-chat", // V3.2 - both thinking and non-thinking modes
      // NOTE: deepseek-reasoner points to R1 which has limited structured output support
    ],
  },
  zhipu: {
    name: "Zhipu (GLM)",
    envVar: "ZHIPU_API_KEY",
    docUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    defaultModel: "GLM-4.7",
    models: [
      // All support native function calling + json_object mode (NOT json_schema)
      // Structured output: json_object only, no server-side schema validation
      // API model IDs from https://open.bigmodel.cn/dev/api
      "GLM-4.7", // Dec 2025 - 400B params, deep reasoning
      "GLM-4.7-Flash", // Lightweight 30B-A3B model
      "GLM-4-Flash", // Free tier, 128K context, fast inference
      "GLM-4-Plus", // Enhanced model, 10T tokens pretrained
      "GLM-4-Air", // Balanced cost/performance
      "GLM-4-AirX", // Extended air model
      "GLM-4-Long", // Long context specialist
      "GLM-4-FlashX", // Extended flash model
    ],
  },
  mistral: {
    name: "Mistral AI",
    envVar: "MISTRAL_API_KEY",
    docUrl: "https://console.mistral.ai/api-keys/",
    defaultModel: "mistral-large-latest",
    models: [
      // All support tools + custom structured outputs (response_format: json_schema)
      "mistral-large-latest", // Flagship model
      "mistral-small-latest", // v3.2 - improved tool use
      "magistral-small", // Reasoning model (Jun 2025), 24B, Apache 2.0
      "magistral-medium", // Enterprise reasoning
      "codestral-latest", // Code specialist
    ],
  },
  openrouter: {
    name: "OpenRouter (300+ Models)",
    envVar: "OPENROUTER_API_KEY",
    docUrl: "https://openrouter.ai/keys",
    defaultModel: "anthropic/claude-sonnet-4.5",
    description: "Dynamic model discovery - only shows models with tools + structured output",
    models: [], // Dynamic - filtered by tools + structuredOutputs capability at runtime
  },
  ollama: {
    name: "Ollama (Local)",
    envVar: "OLLAMA_BASE_URL", // Optional, defaults to localhost
    docUrl: "https://ollama.ai/download",
    defaultModel: "qwen3:8b",
    // Ollama: JSON Schema supported via `format` param (grammar-based validation since v0.5)
    // Listed models support tool calling; structured outputs work via grammar constraints
    models: [
      // Qwen 3 - best tool support + thinking
      "qwen3:8b",
      "qwen3:14b",
      "qwen3:32b",
      // Qwen 2.5 Coder - optimized for code
      "qwen2.5-coder:7b",
      "qwen2.5-coder:14b",
      "qwen2.5-coder:32b",
      // Llama 3.x - Meta's best with tools
      "llama3.1:8b",
      "llama3.1:70b",
      "llama3.3:70b",
      // Mistral on Ollama
      "mistral-nemo:12b",
      "mistral-small:24b",
      // DeepSeek R1 - reasoning with tools
      "deepseek-r1:8b",
      "deepseek-r1:32b",
    ],
  },
};

// ============================================================================
// API Key Format Patterns (for client-side validation)
// ============================================================================

/**
 * Regex patterns for validating API key formats by provider.
 * These patterns validate the prefix and structure before making API calls.
 *
 * Sources:
 * - Anthropic: sk-ant-api03-[48-95 chars]
 * - OpenAI: sk- or sk-proj- or sk-None- or sk-svcacct- [20-160 chars]
 * - Google: AIza[35 chars]
 * - DeepSeek: sk-[40+ chars] (OpenAI-compatible)
 * - Zhipu/MiniMax: Generic alphanumeric [32+ chars]
 */
/**
 * API Key Format Patterns - Based on GitGuardian, Gitleaks, and official documentation.
 *
 * Key findings from security scanning tools:
 * - Anthropic: Always ends with "AA", total 107 chars
 * - OpenAI: Contains base64 marker "T3BlbkFJ" (= "OpenAI")
 * - Google: Always starts with "AIza", exactly 39 chars total
 * - DeepSeek: Uses "sk-" prefix + 32 lowercase alphanumeric chars
 * - Zhipu: Two-part format with dot separator
 */
export const API_KEY_PATTERNS: Record<
  ProviderName,
  { regex: RegExp; description: string; example: string }
> = {
  anthropic: {
    // Verified: sk-ant-api03-[93 chars]AA (total 107 chars, always ends with AA)
    // Source: GitGuardian, Gitleaks
    regex: /^sk-ant-api03-[A-Za-z0-9_-]{91,95}AA$/,
    description:
      'Anthropic keys: "sk-ant-api03-" + ~93 chars + "AA" (107 total)',
    example: "sk-ant-api03-[93 alphanumeric chars]AA",
  },
  openai: {
    // Verified: All OpenAI keys contain "T3BlbkFJ" (base64 "OpenAI")
    // Legacy: sk-[20]T3BlbkFJ[20] (51 chars)
    // Project: sk-proj-[58-74]T3BlbkFJ[58-74] (~164 chars)
    // Also allow generic sk- pattern for flexibility
    regex:
      /^sk-(proj-|svcacct-|admin-|None-)?[A-Za-z0-9_-]{20,80}(T3BlbkFJ[A-Za-z0-9_-]{20,80})?$/,
    description: 'OpenAI keys: "sk-" prefix, often contain "T3BlbkFJ" marker',
    example: "sk-proj-xxxx...T3BlbkFJ...xxxx",
  },
  google: {
    // Verified: AIza + 35 chars = 39 total (exact length)
    // Source: Gitleaks, Google docs
    regex: /^AIza[A-Za-z0-9_-]{35}$/,
    description: 'Google keys: "AIza" + exactly 35 chars (39 total)',
    example: "AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  deepseek: {
    // Verified: sk-[32 lowercase alphanumeric] (35 total)
    // Source: Semgrep, DeepSeek docs
    // Note: Lowercase only to distinguish from OpenAI
    regex: /^sk-[a-z0-9]{32}$/,
    description: 'DeepSeek keys: "sk-" + exactly 32 lowercase chars (35 total)',
    example: "sk-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  },
  zhipu: {
    // Verified: {32 hex}.{secret} - Two-part format
    // Source: Zhipu API docs, user confirmation
    regex: /^[a-f0-9]{32}\.[A-Za-z0-9_-]{10,}$/,
    description:
      'Zhipu keys: 32-char hex + "." + secret (e.g., abc123...def.XyzSecret)',
    example: "39c8c7b4d7584d6dbf05516cca9c72f4.Avx1htdBdB1RZpE1",
  },
  openrouter: {
    // OpenRouter keys start with "sk-or-v1-" followed by 64 hex chars
    regex: /^sk-or-v1-[a-f0-9]{64}$/,
    description: 'OpenRouter keys: "sk-or-v1-" + 64 hex chars',
    example: "sk-or-v1-abc123def456...",
  },
  mistral: {
    // Mistral keys are 32-char alphanumeric
    regex: /^[A-Za-z0-9]{32}$/,
    description: "Mistral keys: 32 alphanumeric chars",
    example: "abcdef0123456789abcdef0123456789",
  },
  ollama: {
    // Ollama doesn't use API keys - it uses a base URL
    regex: /^https?:\/\/.+/,
    description: "Ollama base URL (default: http://localhost:11434)",
    example: "http://localhost:11434",
  },
};

/**
 * Validate API key format before making API calls.
 *
 * @param provider - Provider name
 * @param apiKey - API key to validate
 * @returns Validation result with details
 */
export function validateKeyFormat(
  provider: ProviderName,
  apiKey: string,
): { valid: boolean; error?: string; hint?: string } {
  // Basic checks
  if (!apiKey || typeof apiKey !== "string") {
    return { valid: false, error: "API key is required" };
  }

  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "API key cannot be empty" };
  }

  // Check for common issues
  if (trimmed !== apiKey) {
    return {
      valid: false,
      error: "API key has leading/trailing whitespace",
      hint: "Remove any spaces or newlines from the key",
    };
  }

  if (apiKey.includes("\n") || apiKey.includes("\r")) {
    return {
      valid: false,
      error: "API key contains newline characters",
      hint: "Make sure you copied only the key, not surrounding text",
    };
  }

  if (apiKey.includes('"') || apiKey.includes("'")) {
    return {
      valid: false,
      error: "API key contains quote characters",
      hint: "Remove any quotes from around the key",
    };
  }

  // Check for non-ASCII characters (common copy-paste issue)
  if (!/^[\x20-\x7E]+$/.test(apiKey)) {
    return {
      valid: false,
      error: "API key contains non-ASCII or control characters",
      hint: "Make sure you copied only the key text without any special characters",
    };
  }

  // Check for common invisible characters
  if (/[\u200B-\u200D\uFEFF\u00A0]/.test(apiKey)) {
    return {
      valid: false,
      error: "API key contains invisible/zero-width characters",
      hint: "Try typing the key manually or paste it into a plain text editor first",
    };
  }

  // Provider-specific format validation
  const pattern = API_KEY_PATTERNS[provider];
  if (!pattern) {
    return { valid: true }; // Unknown provider, skip format check
  }

  if (!pattern.regex.test(apiKey)) {
    return {
      valid: false,
      error: `Invalid ${PROVIDERS[provider].name} API key format`,
      hint: `${pattern.description}.\nExample: ${pattern.example}`,
    };
  }

  return { valid: true };
}

// ============================================================================
// Model Creation
// ============================================================================

/**
 * Create a language model instance for the specified provider/model.
 *
 * Supports optional variant configurations:
 * - Anthropic: Extended thinking with configurable token budgets
 * - OpenAI: Reasoning effort levels for o1/o3 models
 * - Google: Thinking budget configuration
 *
 * @param config - Provider and model configuration (with optional variant)
 * @returns LanguageModel instance ready for use with AI SDK
 * @throws Error if API key is missing or provider is unknown
 */
export function createModel(
  config: ModelConfig | ModelConfigWithVariant,
): LanguageModel {
  const { provider, model } = config;
  const variant = "variant" in config ? config.variant : undefined;
  const providerInfo = PROVIDERS[provider];

  if (!providerInfo) {
    const validProviders = Object.keys(PROVIDERS).join(", ");
    throw new Error(
      `Unknown provider: ${provider}\n` + `Valid providers: ${validProviders}`,
    );
  }

  const apiKey = process.env[providerInfo.envVar];
  if (!apiKey && provider !== "ollama") {
    throw new Error(
      `${providerInfo.envVar} not set.\n` +
      `Get your API key at: ${providerInfo.docUrl}`,
    );
  }

  // Note: Variant options should be applied via providerOptions at call time
  // (generateText/streamText), not at model creation. Use getVariantProviderOptions()
  // to get the appropriate options for the variant.

  switch (provider) {
    case "anthropic": {
      // Use createAnthropic with explicit API key to avoid AI Gateway fallback
      const anthropic = createAnthropic({ apiKey: apiKey! });
      return anthropic(model);
    }

    case "openai": {
      process.env.OPENAI_API_KEY = apiKey;
      return openai(model);
    }

    case "google": {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
      return google(model);
    }

    case "deepseek": {
      // DeepSeek uses OpenAI-compatible Chat Completions API
      // Use createOpenAICompatible to use /chat/completions (not /responses)
      // Note: supportsStructuredOutputs is FALSE because DeepSeek only supports
      // json_object mode, not json_schema with server-side validation.
      // Tool parameters work fine regardless of this setting.
      const deepseek = createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com/v1",
        apiKey: apiKey!,
        // DeepSeek supports json_object but NOT json_schema (no server-side schema validation)
        supportsStructuredOutputs: false,
      });
      return deepseek(model);
    }

    case "zhipu": {
      // Z.ai / Zhipu uses OpenAI-compatible Chat Completions API
      // IMPORTANT: Use createOpenAICompatible (NOT createOpenAI) because:
      // - createOpenAI uses the Responses API endpoint (/responses)
      // - createOpenAICompatible uses Chat Completions endpoint (/chat/completions)
      // Zhipu/Z.ai only supports the Chat Completions format
      // Note: supportsStructuredOutputs is FALSE because Zhipu only supports
      // json_object mode, not json_schema with server-side validation.
      // Tool parameters work fine regardless of this setting.
      const zhipu = createOpenAICompatible({
        name: "zhipu",
        baseURL: "https://api.z.ai/api/coding/paas/v4",
        apiKey: apiKey!,
        // Zhipu supports json_object but NOT json_schema (no server-side schema validation)
        supportsStructuredOutputs: false,
      });
      return zhipu(model);
    }

    case "openrouter": {
      // Use official OpenRouter SDK
      const openrouter = createOpenRouter({
        apiKey: apiKey!,
      });
      return openrouter(model);
    }

    case "mistral": {
      process.env.MISTRAL_API_KEY = apiKey;
      return mistral(model);
    }

    case "ollama": {
      // Ollama uses OpenAI-compatible Chat Completions API
      // Use createOpenAICompatible to use /chat/completions (not /responses)
      // Note: Ollama DOES support JSON Schema via its `format` parameter (since v0.5)
      // which provides grammar-based output validation.
      const baseURL = apiKey || "http://localhost:11434/v1";
      const ollama = createOpenAICompatible({
        name: "ollama",
        baseURL,
        apiKey: "ollama", // Ollama doesn't require a real API key
        // Ollama supports JSON Schema via format parameter (grammar-based validation)
        supportsStructuredOutputs: true,
      });
      return ollama(model);
    }

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = provider;
      throw new Error(`Provider ${_exhaustive} not implemented`);
    }
  }
}

// ============================================================================
// Model String Parsing
// ============================================================================

/**
 * Error thrown when model string parsing fails.
 */
export class ModelParseError extends Error {
  constructor(
    message: string,
    public readonly spec: string,
  ) {
    super(message);
    this.name = "ModelParseError";
  }
}

/**
 * Parse a model specification string into provider/model config.
 *
 * Formats supported:
 * - "provider/model" (e.g., "openai/gpt-4o")
 * - "provider/model:variant" (e.g., "anthropic/claude-sonnet-4:high")
 * - "model" alone (infers provider or defaults to Anthropic)
 * - "model:variant" (e.g., "claude-sonnet-4:high")
 *
 * @param spec - Model specification string
 * @returns Parsed ModelConfigWithVariant (includes optional variant)
 * @throws ModelParseError if the provider prefix is invalid
 */
export function parseModelString(spec: string): ModelConfigWithVariant {
  if (!spec || typeof spec !== "string") {
    return { provider: "anthropic", model: PROVIDERS.anthropic.defaultModel };
  }

  const trimmed = spec.trim();
  if (!trimmed) {
    return { provider: "anthropic", model: PROVIDERS.anthropic.defaultModel };
  }

  // Check for provider/model format
  if (trimmed.includes("/")) {
    const slashIndex = trimmed.indexOf("/");
    const providerPart = trimmed.slice(0, slashIndex).toLowerCase();
    const modelPartWithVariant = trimmed.slice(slashIndex + 1);

    if (!modelPartWithVariant) {
      throw new ModelParseError(
        `Invalid model spec: missing model name after '/'`,
        spec,
      );
    }

    // Extract variant if present (e.g., "claude-sonnet-4:high")
    const { model: modelPart, variant } = extractVariant(modelPartWithVariant);

    if (providerPart in PROVIDERS) {
      return {
        provider: providerPart as ProviderName,
        model: modelPart,
        variant,
      };
    }

    // Unknown provider prefix - throw error with suggestions
    const validProviders = Object.keys(PROVIDERS).join(", ");
    throw new ModelParseError(
      `Unknown provider: '${providerPart}'\n` +
      `Valid providers: ${validProviders}`,
      spec,
    );
  }

  // Extract variant from model-only format (e.g., "claude-sonnet-4:high")
  const { model: cleanSpec, variant } = extractVariant(trimmed);

  // Infer provider from model name patterns
  const lowerSpec = cleanSpec.toLowerCase();

  if (
    lowerSpec.startsWith("gpt-") ||
    lowerSpec.startsWith("o1") ||
    lowerSpec.startsWith("o3") ||
    lowerSpec.startsWith("o4")
  ) {
    return { provider: "openai", model: cleanSpec, variant };
  }
  if (lowerSpec.startsWith("gemini-")) {
    return { provider: "google", model: cleanSpec, variant };
  }
  if (lowerSpec.startsWith("deepseek")) {
    return { provider: "deepseek", model: cleanSpec, variant };
  }
  if (lowerSpec.startsWith("glm-") || lowerSpec.startsWith("glm ")) {
    // Normalize "GLM 4.7" to "glm-4.7"
    const normalized = cleanSpec.replace(/^glm\s+/i, "glm-");
    return { provider: "zhipu", model: normalized, variant };
  }
  // Mistral models (including Magistral reasoning models)
  if (
    lowerSpec.startsWith("mistral-") ||
    lowerSpec.startsWith("codestral") ||
    lowerSpec.startsWith("magistral")
  ) {
    return { provider: "mistral", model: cleanSpec, variant };
  }

  // Default to Anthropic (backward compatibility)
  return { provider: "anthropic", model: cleanSpec, variant };
}

/**
 * Validate a model config, checking provider API key availability.
 *
 * @param config - Model configuration to validate
 * @returns Validation result with error message if invalid
 */
export function validateModelConfig(config: ModelConfig): {
  valid: boolean;
  error?: string;
} {
  const providerInfo = PROVIDERS[config.provider];
  if (!providerInfo) {
    return {
      valid: false,
      error: `Unknown provider: ${config.provider}`,
    };
  }

  // Ollama doesn't require an API key - it uses a local server
  if (config.provider === "ollama") {
    return { valid: true };
  }

  const apiKey = process.env[providerInfo.envVar];
  if (!apiKey) {
    return {
      valid: false,
      error: `${providerInfo.envVar} not set. Get your API key at: ${providerInfo.docUrl}`,
    };
  }

  return { valid: true };
}

// ============================================================================
// Provider Detection
// ============================================================================

/**
 * Detect which providers have API keys configured.
 *
 * Note: Ollama is included if OLLAMA_BASE_URL is set, OR if the default
 * localhost URL is accessible. For local-only mode, set OLLAMA_BASE_URL
 * to enable Ollama detection.
 *
 * @returns Array of available provider names
 */
export function detectAvailableProviders(): ProviderName[] {
  const available = (
    Object.entries(PROVIDERS) as [ProviderName, ProviderInfo][]
  )
    .filter(([name, info]) => {
      // Ollama is special - it doesn't require an API key
      // Include it if OLLAMA_BASE_URL is explicitly set
      if (name === "ollama") {
        return Boolean(process.env.OLLAMA_BASE_URL);
      }
      return Boolean(process.env[info.envVar]);
    })
    .map(([name]) => name);

  return available;
}

/**
 * Get the default provider (first one with an API key).
 * Priority: anthropic > openai > google > deepseek > zhipu > mistral > openrouter > ollama
 * @returns Default provider name, or null if none configured
 */
export function getDefaultProvider(): ProviderName | null {
  const available = detectAvailableProviders();
  return available.length > 0 ? available[0] : null;
}

/**
 * Check if at least one provider is configured.
 * @returns True if any provider API key is set
 */
export function hasAnyProvider(): boolean {
  return detectAvailableProviders().length > 0;
}

/**
 * Get the default model config based on available providers.
 * @returns ModelConfig for the first available provider, or Anthropic default
 */
export function getDefaultModelConfig(): ModelConfig {
  const provider = getDefaultProvider();
  if (provider) {
    return {
      provider,
      model: PROVIDERS[provider].defaultModel,
    };
  }
  // Fallback to Anthropic (will fail at runtime if no key)
  return {
    provider: "anthropic",
    model: PROVIDERS.anthropic.defaultModel,
  };
}

// ============================================================================
// Backward Compatibility
// ============================================================================

/**
 * Legacy wrapper for existing code.
 * Maintains backward compatibility with direct Anthropic calls.
 *
 * @param model - Anthropic model name
 * @returns LanguageModel instance
 * @deprecated Use createModel({ provider: 'anthropic', model }) instead
 */
export function createAnthropicClient(model: string): LanguageModel {
  return createModel({ provider: "anthropic", model });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a ModelConfig as a display string.
 * @param config - Model configuration
 * @returns Formatted string like "openai/gpt-4o"
 */
export function formatModelConfig(config: ModelConfig): string {
  return `${config.provider}/${config.model}`;
}

/**
 * Validate that a model exists in the provider's model list.
 * Note: This is advisory only - providers may support unlisted models.
 * @param config - Model configuration to validate
 * @returns True if model is in the known list
 */
export function isKnownModel(config: ModelConfig): boolean {
  const providerInfo = PROVIDERS[config.provider];
  if (!providerInfo) return false;
  return providerInfo.models.includes(config.model);
}

/**
 * Get all available models for a provider.
 * @param provider - Provider name
 * @returns Array of model names, or empty array if provider unknown
 */
export function getProviderModels(provider: ProviderName): string[] {
  return PROVIDERS[provider]?.models ?? [];
}

// ============================================================================
// API Key Validation
// ============================================================================

/**
 * Test an API key by first validating format, then making a minimal API call.
 *
 * Validation steps:
 * 1. Format validation (prefix, length, characters)
 * 2. Live API call to verify key works
 *
 * @param provider - Provider to test
 * @param apiKey - API key to validate
 * @returns Validation result with success status, error message, and optional hint
 */
export async function testApiKey(
  provider: ProviderName,
  apiKey: string,
): Promise<{ valid: boolean; error?: string; hint?: string }> {
  const providerInfo = PROVIDERS[provider];
  if (!providerInfo) {
    return { valid: false, error: `Unknown provider: ${provider}` };
  }

  // Step 1: Trim and basic validation
  const trimmedKey = apiKey?.trim() ?? "";

  if (!trimmedKey) {
    return { valid: false, error: "API key cannot be empty" };
  }

  // Step 2: Format validation (catches most issues before API call)
  const formatResult = validateKeyFormat(provider, trimmedKey);
  if (!formatResult.valid) {
    return {
      valid: false,
      error: formatResult.error,
      hint: formatResult.hint,
    };
  }

  // Step 3: Live API test
  const envVar = providerInfo.envVar;
  const originalKey = process.env[envVar];

  try {
    process.env[envVar] = trimmedKey;

    // Create a minimal model and test with a simple prompt
    const model = createModel({
      provider,
      model: providerInfo.defaultModel,
    });

    // Import generateText dynamically to avoid circular dependency issues
    const { generateText } = await import("ai");

    // Make a minimal API call
    await generateText({
      model,
      prompt: 'Say "ok"',
    });

    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();

    // Parse common error patterns with specific hints
    if (
      lowerMessage.includes("401") ||
      lowerMessage.includes("unauthorized") ||
      lowerMessage.includes("invalid_api_key") ||
      lowerMessage.includes("incorrect api key")
    ) {
      return {
        valid: false,
        error: "Invalid API key - authentication failed",
        hint: `Check that your key is correct and active at: ${providerInfo.docUrl}`,
      };
    }

    if (
      lowerMessage.includes("403") ||
      lowerMessage.includes("forbidden") ||
      lowerMessage.includes("permission")
    ) {
      return {
        valid: false,
        error: "API key lacks required permissions",
        hint: "Check that your key has access to the API and the model you are trying to use",
      };
    }

    if (
      lowerMessage.includes("429") ||
      lowerMessage.includes("rate") ||
      lowerMessage.includes("too many requests")
    ) {
      // Rate limit means the key is valid but overused
      return {
        valid: true,
        hint: "Key is valid but rate limited. Wait a moment before making requests.",
      };
    }

    if (
      lowerMessage.includes("quota") ||
      lowerMessage.includes("insufficient") ||
      lowerMessage.includes("billing") ||
      lowerMessage.includes("credit")
    ) {
      return {
        valid: false,
        error: "API key has insufficient quota or billing issue",
        hint: "Add credits or check billing at: " + providerInfo.docUrl,
      };
    }

    if (
      lowerMessage.includes("model") &&
      (lowerMessage.includes("not found") ||
        lowerMessage.includes("does not exist") ||
        lowerMessage.includes("invalid"))
    ) {
      return {
        valid: false,
        error: `Model '${providerInfo.defaultModel}' not available`,
        hint: "Your API key may not have access to this model tier",
      };
    }

    if (
      lowerMessage.includes("network") ||
      lowerMessage.includes("fetch") ||
      lowerMessage.includes("econnrefused") ||
      lowerMessage.includes("timeout")
    ) {
      return {
        valid: false,
        error: "Network error - could not reach API",
        hint: "Check your internet connection and try again",
      };
    }

    // Return the original error with a generic hint
    return {
      valid: false,
      error: message.slice(0, 200), // Truncate long errors
      hint: "If the error persists, try generating a new API key",
    };
  } finally {
    // Restore original key (or remove if it wasn't set)
    if (originalKey !== undefined) {
      process.env[envVar] = originalKey;
    } else {
      delete process.env[envVar];
    }
  }
}

/**
 * Set an API key in the environment for a provider.
 *
 * @param provider - Provider name
 * @param apiKey - API key to set
 */
export function setProviderApiKey(
  provider: ProviderName,
  apiKey: string,
): void {
  const providerInfo = PROVIDERS[provider];
  if (providerInfo) {
    process.env[providerInfo.envVar] = apiKey;
  }
}

/**
 * Check if a provider has an API key configured.
 *
 * @param provider - Provider name
 * @returns True if API key is set
 */
export function hasApiKey(provider: ProviderName): boolean {
  const providerInfo = PROVIDERS[provider];
  if (!providerInfo) return false;
  return Boolean(process.env[providerInfo.envVar]);
}

// ============================================================================
// Model + Variant Bundle Helper
// ============================================================================

/**
 * Result of creating a model with variant options.
 * Used to simplify calls to generateText/streamText/generateStructured.
 */
export interface ModelWithVariant {
  /** The language model instance */
  model: LanguageModel;
  /** Provider options to spread into API calls */
  variantOptions: Record<string, unknown>;
  /** Parsed model configuration */
  config: ModelConfigWithVariant;
}

/**
 * Parse a model string and create both the model and variant options.
 *
 * This is a convenience function that combines parseModelString, createModel,
 * and getVariantProviderOptions into a single call.
 *
 * @param modelSpec - Model specification string (e.g., "anthropic/claude-sonnet-4:high")
 * @returns Object with model, variantOptions, and parsed config
 *
 * @example
 * const { model, variantOptions } = createModelWithVariant("anthropic/claude-sonnet-4:high");
 * await generateText({
 *   model,
 *   prompt: "Hello",
 *   ...variantOptions  // Applies extended thinking for Anthropic
 * });
 */
export function createModelWithVariant(modelSpec: string): ModelWithVariant {
  const config = parseModelString(modelSpec);
  const model = createModel(config);
  const variantOptions = getVariantProviderOptions(
    config.provider,
    config.variant,
  );

  return { model, variantOptions, config };
}

// ============================================================================
// Structured Output Routing
// ============================================================================

import type { ZodSchema } from "zod";

type GenerateStructuredCallOptions = Omit<
  Parameters<typeof generateText>[0],
  "model" | "output"
>;

/**
 * Options for generateStructured - requires schema and modelId.
 */
export interface GenerateStructuredOptions<T>
  extends GenerateStructuredCallOptions {
  model: LanguageModel;
  schema: ZodSchema<T>;
  modelId: string;
  /** Optional name for the schema (improves model understanding) */
  schemaName?: string;
  /** Optional description for the schema (improves model understanding) */
  schemaDescription?: string;
}

/**
 * Native structured output using generateText + Output.object().
 *
 * Uses AI SDK 6's native structured output mode which works with thinking/reasoning.
 * This is the only supported path - models must have structuredOutputs capability.
 */
async function nativeStructuredOutput<T>(
  options: Omit<GenerateStructuredOptions<T>, "modelId">,
): Promise<T> {
  const {
    schema,
    schemaName,
    schemaDescription,
    model,
    ...callOptions
  } = options;

  // Build Output.object config with optional schema metadata
  // Note: Output.object uses 'name' and 'description', not 'schemaName'/'schemaDescription'
  const outputConfig: Parameters<typeof Output.object>[0] = { schema };
  if (schemaName) outputConfig.name = schemaName;
  if (schemaDescription) outputConfig.description = schemaDescription;

  // Use 'as any' due to complex AI SDK overloaded types for generateText
  const { output } = await generateText({
    model,
    output: Output.object(outputConfig),
    ...callOptions,
  } as any);

  return output as T;
}

/**
 * Check if modelId belongs to a direct provider (not OpenRouter).
 * Direct providers in our curated PROVIDERS list are pre-verified compatible,
 * EXCEPT providers that only support `json_object` (no strict schema validation).
 *
 * @param modelId - Model identifier (e.g., "anthropic/claude-opus-4-5-20251101")
 * @returns True if direct provider, false if OpenRouter
 */
function isDirectProvider(modelId: string): boolean {
  if (!modelId) return false;

  // Check for explicit openrouter prefix
  const lower = modelId.toLowerCase();
  if (lower.startsWith("openrouter/") || lower.startsWith("openrouter:")) {
    return false;
  }

  // Check for provider/model format
  const slashIndex = modelId.indexOf("/");
  if (slashIndex > 0) {
    const provider = modelId.slice(0, slashIndex).toLowerCase() as ProviderName;
    // If it's a known direct provider with strict schema support, return true.
    if (
      provider in PROVIDERS &&
      provider !== "openrouter" &&
      supportsStrictStructuredOutputs(provider)
    ) {
      return true;
    }
    return false;
  }

  // Check for model name patterns from direct providers
  if (lower.startsWith("claude-")) return true; // Anthropic
  if (
    lower.startsWith("gpt-") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4")
  )
    return true; // OpenAI
  if (lower.startsWith("gemini-")) return true; // Google
  if (lower.startsWith("deepseek")) return false; // DeepSeek (json_object only)
  if (lower.startsWith("glm-")) return false; // Zhipu (json_object only)
  if (
    lower.startsWith("mistral-") ||
    lower.startsWith("codestral") ||
    lower.startsWith("magistral")
  )
    return true; // Mistral
  if (lower.startsWith("qwen") || lower.startsWith("llama")) return true; // Ollama

  return false;
}

/**
 * Generate structured output with provider-based routing.
 *
 * Routing logic:
 * - Direct Providers (Anthropic, OpenAI, etc.) → Trust curated PROVIDERS list
 *   These are pre-verified to support both tools AND structuredOutputs.
 * - OpenRouter → Use ModelCapabilityService to check capabilities dynamically
 *
 * This separation ensures:
 * 1. Direct provider models always work (no false negatives from cache misses)
 * 2. OpenRouter models are capability-checked for safety
 */
export async function generateStructured<T>(
  options: GenerateStructuredOptions<T>,
): Promise<T> {
  const { modelId, ...callOptions } = options;

  // Direct Providers: Trust our curated PROVIDERS list
  // We've verified these support both tools + structuredOutputs
  if (isDirectProvider(modelId)) {
    return nativeStructuredOutput<T>(callOptions);
  }

  // OpenRouter: Check capabilities dynamically via ModelCapabilityService
  const caps = await modelCapabilities.getCapabilities(modelId);

  if (!caps.tools || !caps.structuredOutputs) {
    const missing: string[] = [];
    if (!caps.tools) missing.push("tools");
    if (!caps.structuredOutputs) missing.push("structuredOutputs");

    throw new Error(
      `Model "${modelId}" is not compatible. Missing capabilities: ${missing.join(", ")}.\n` +
        `Only models with BOTH tools AND structuredOutputs are supported.\n` +
        `Use modelCapabilities.getCompatibleModels() to find compatible models.`,
    );
  }

  return nativeStructuredOutput<T>(callOptions);
}
