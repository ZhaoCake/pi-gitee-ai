// LLM model catalog for the gitee-ai provider (registered via pi.registerProvider).
// Mirrors the previous ~/.pi/agent/models.json entries. Context windows / max
// tokens follow pi's built-in catalogs for the same underlying models
// (deepseek / zai / moonshotai).

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const DEEPSEEK_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  maxTokensField: "max_tokens",
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "deepseek",
} as const;

const ZAI_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  maxTokensField: "max_tokens",
  thinkingFormat: "zai",
} as const;

const KIMI_K3_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  thinkingFormat: "openai",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

const KIMI_K2_CODE_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  thinkingFormat: "deepseek",
} as const;

// Cost is unknown for Gitee AI's per-resource-package billing; zeros keep the
// usage/cost footer honest until real per-token pricing is known.
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const GITEE_AI_MODELS: ProviderModelConfig[] = [
  {
    id: "deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash (0731)",
    reasoning: true,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: 1000000,
    maxTokens: 384000,
    compat: DEEPSEEK_COMPAT,
    thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" },
  },
  {
    id: "GLM-5.2",
    name: "GLM 5.2",
    reasoning: true,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: 1000000,
    maxTokens: 131072,
    compat: ZAI_COMPAT,
    thinkingLevelMap: { minimal: null, low: "high", medium: "high", high: "high", max: "max" },
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    reasoning: true,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: 1048576,
    maxTokens: 131072,
    compat: KIMI_K3_COMPAT,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
  },
  {
    id: "Kimi-K2.7-Code",
    name: "Kimi K2.7 Code",
    reasoning: true,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: 262144,
    maxTokens: 262144,
    compat: KIMI_K2_CODE_COMPAT,
    thinkingLevelMap: { off: null },
  },
];