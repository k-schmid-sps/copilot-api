import consola from "consola"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"

import { translateModelName } from "~/routes/messages/non-stream-translation"

/**
 * Sanitize an Anthropic /v1/messages payload for Copilot backend compatibility.
 *
 * All models: strip context_management, budget_tokens, defer_loading, tool_reference
 * (confirmed rejected by Copilot's backend).
 */

export function sanitizeForCopilotBackend(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizePayload(
    payload as unknown as AnthropicMessagesPayload,
  ) as unknown as Record<string, unknown>
}

export function sanitizePayload(
  payload: AnthropicMessagesPayload,
): AnthropicMessagesPayload {
  // Deep clone to avoid mutating the original
  const sanitized = structuredClone(payload) as AnthropicMessagesPayload
    & Record<string, unknown>

  // 1. Normalize model name (Copilot uses dotted minor versions)
  sanitized.model = translateModelName(sanitized.model)

  // 2. Strip context_management (rejected by all models)
  if ("context_management" in sanitized) {
    consola.debug("Stripping context_management from request")
    delete sanitized.context_management
  }

  // 3. Strip budget_tokens from thinking (rejected by Copilot's backend)
  if (sanitized.thinking && "budget_tokens" in sanitized.thinking) {
    consola.debug("Stripping budget_tokens from thinking")
    const { budget_tokens: _, ...rest } = sanitized.thinking as Record<
      string,
      unknown
    >
    sanitized.thinking = rest as typeof sanitized.thinking
  }

  // 4. Strip defer_loading from tool definitions
  if (sanitized.tools) {
    for (const tool of sanitized.tools) {
      const t = tool as unknown as Record<string, unknown>
      if ("defer_loading" in t) {
        delete t.defer_loading
      }
    }
  }

  // 5. Filter tool_reference content blocks from messages
  for (const msg of sanitized.messages) {
    if (Array.isArray(msg.content)) {
      msg.content = (
        msg.content as unknown as Array<Record<string, unknown>>
      ).filter(
        (block) => block.type !== "tool_reference",
      ) as unknown as typeof msg.content
    }
  }

  return sanitized
}

/**
 * Check if a model name is a Claude model (should use native Anthropic passthrough)
 */
export function isClaude(model: string): boolean {
  return isClaudeModel(model)
}

export function isClaudeModel(model: string): boolean {
  return model.startsWith("claude-") || model.startsWith("claude_")
}
