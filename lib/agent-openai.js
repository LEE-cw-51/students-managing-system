import { chatWithTools } from './ai-client.js';
import { toolDefinitions } from './agent-tools.js';

/**
 * Conversation state for one assistant turn on an OpenAI-compatible endpoint (OpenRouter).
 * Same interface as createAnthropicProvider: send(timeoutMs, { onText, signal }) →
 * { text, toolCalls, model }, addToolResults([{ id, content, isError }]).
 * options: chatWithTools options ({ config, fetch, temperature })
 */
export function createOpenAiProvider({ system, history, message }, options = {}) {
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: message }];
  const tools = toolDefinitions();
  return {
    async send(timeoutMs, { onText, signal } = {}) {
      const res = await chatWithTools(messages, tools, { ...options, timeoutMs, onText, signal });
      if (res.toolCalls.length) {
        messages.push({ role: 'assistant', content: res.message.content ?? null, tool_calls: res.message.tool_calls });
      }
      return { text: res.text, toolCalls: res.toolCalls, model: res.model };
    },
    addToolResults(results) {
      results.forEach((r) => messages.push({ role: 'tool', tool_call_id: r.id, content: r.content }));
    }
  };
}
