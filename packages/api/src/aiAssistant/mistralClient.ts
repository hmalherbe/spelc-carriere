/**
 * Thin wrapper over Mistral's chat completions API (https://api.mistral.ai/v1/chat/completions).
 * No SDK dependency — same reasoning as mailing/brevo.ts: a single REST call is trivial to mock in
 * tests and keeps the door open to swapping providers later.
 */

export class MistralConfigError extends Error {}

export interface MistralChatMessage {
  role: "system" | "user";
  content: string;
}

/** Sends one chat completion request and returns the assistant's raw text content. Throws on any
 * non-2xx response or an unexpected/empty response shape. */
export async function callMistralChat(apiKey: string, model: string, messages: MistralChatMessage[]): Promise<string> {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature: 0 }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Échec de l'appel à l'API Mistral (HTTP ${res.status}): ${body}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Réponse de l'API Mistral vide ou inattendue");
  return content;
}
