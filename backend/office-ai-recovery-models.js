'use strict';

// Published Cloudflare model limits checked 2026-11-04. This catalog routes only
// explicitly configured fallbacks; it never installs a connection or grants tools.
const MODEL_LIMITS = Object.freeze({
  '@cf/google/gemma-4-26b-a4b-it': { contextWindowTokens: 256000, vision: true },
  '@cf/zai-org/glm-5.3': { contextWindowTokens: 1048576, vision: false },
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017': { contextWindowTokens: 1048576, vision: true },
  '@cf/deepseek-ai/deepseek-v4-flash-0731': { contextWindowTokens: 1048576, vision: false },
  '@cf/qwen/qwen3.8-27b': { contextWindowTokens: 262144, vision: true },
  '@cf/zai-org/glm-5.3-flash': { contextWindowTokens: 1048576, vision: true },
  '@cf/zai-org/glm-5.2': { contextWindowTokens: 262144, vision: false },
  '@cf/nvidia/nemotron-3-120b-a12b': { contextWindowTokens: 256000, vision: false },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { contextWindowTokens: 128000, vision: false },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { contextWindowTokens: 131000, vision: true },
  '@cf/zai-org/glm-4.7-flash': { contextWindowTokens: 131072, vision: false },
  '@cf/moonshotai/kimi-k2.6': { contextWindowTokens: 262144, vision: true },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { contextWindowTokens: 24000, vision: false },
  '@cf/qwen/qwen3-30b-a3b-fp8': { contextWindowTokens: 32768, vision: false },
});

function recoveryModelInfo(id) {
  return Object.hasOwn(MODEL_LIMITS, id) ? { model: id, ...MODEL_LIMITS[id] } : null;
}

function contextSafetyEstimate(messages, tools, maxTokens) {
  let images = 0;
  const text = messages.map(message => ({ ...message, content: Array.isArray(message.content)
    ? message.content.map(part => {
      if (part?.type !== 'image_url') return part;
      images++;
      return { type: 'image_url' }; // Uploaded bytes are not literal text tokens.
    }) : message.content }));
  // A conservative local byte envelope, not an exact tokenizer measurement.
  // Reserve provider chat framing and a bounded image allowance. The provider
  // remains authoritative and may still reject inputs for other reasons.
  return Buffer.byteLength(JSON.stringify({ messages: text, tools }))
    + maxTokens + 4096 + images * 32768;
}

function compatibleRecoveryModels(models, { messages, tools, maxTokens, vision }) {
  const estimate = contextSafetyEstimate(messages, tools, maxTokens);
  return models.filter(model => {
    const info = recoveryModelInfo(model);
    // Custom configured models keep provider-authoritative validation; an
    // absent registry entry is not evidence that a model lacks a capability.
    return !info || (!vision || info.vision) && estimate <= info.contextWindowTokens;
  });
}

module.exports = { recoveryModelInfo, compatibleRecoveryModels };
