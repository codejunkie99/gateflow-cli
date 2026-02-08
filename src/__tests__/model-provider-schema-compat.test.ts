import { describe, expect, it } from "vitest";
import {
  PROVIDERS,
  getStructuredOutputCompatibilityError,
  supportsStrictStructuredOutputs,
  type ProviderName,
} from "../agent/model-provider.js";

const ALL_PROVIDERS = Object.keys(PROVIDERS) as ProviderName[];

describe("Provider structured output compatibility", () => {
  it("defines strict-schema compatibility for every provider", () => {
    for (const provider of ALL_PROVIDERS) {
      const model = PROVIDERS[provider].defaultModel;
      const isStrictCompatible = supportsStrictStructuredOutputs(provider);
      const compatibilityError = getStructuredOutputCompatibilityError({
        provider,
        model,
      });

      if (isStrictCompatible) {
        expect(compatibilityError).toBeNull();
      } else {
        expect(compatibilityError).toContain(`Model "${provider}/${model}"`);
        expect(compatibilityError).toContain("json_object mode only");
      }
    }
  });

  it("marks only deepseek and zhipu as strict-schema incompatible", () => {
    const incompatibleProviders = ALL_PROVIDERS.filter(
      (provider) => !supportsStrictStructuredOutputs(provider),
    ).sort();

    expect(incompatibleProviders).toEqual(["deepseek", "zhipu"]);
  });
});

