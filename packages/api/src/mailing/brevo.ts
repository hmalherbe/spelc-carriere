/**
 * Thin wrapper over Brevo's transactional email API (https://api.brevo.com/v3/smtp/email).
 * No SDK dependency — it's a single REST call, and a hand-rolled `fetch` keeps it trivial to
 * mock in tests and to swap providers later if needed.
 */

export class BrevoConfigError extends Error {}

export interface BrevoRecipient {
  email: string;
  name?: string;
}

export interface SendEmailInput {
  to: BrevoRecipient;
  subject: string;
  html: string;
}

export interface BrevoConfig {
  apiKey: string;
  senderEmail: string;
  senderName: string;
}

/** Reads BREVO_API_KEY / BREVO_SENDER_EMAIL / BREVO_SENDER_NAME from the environment. */
export function loadBrevoConfig(env: NodeJS.ProcessEnv = process.env): BrevoConfig {
  const apiKey = env.BREVO_API_KEY;
  const senderEmail = env.BREVO_SENDER_EMAIL;
  if (!apiKey || !senderEmail) {
    throw new BrevoConfigError(
      "Envoi de mailing non configuré : définissez BREVO_API_KEY et BREVO_SENDER_EMAIL (voir README) avant d'envoyer.",
    );
  }
  return { apiKey, senderEmail, senderName: env.BREVO_SENDER_NAME ?? "Spelc" };
}

/** Sends one transactional email via Brevo. Throws on any non-2xx response. */
export async function sendBrevoEmail(config: BrevoConfig, input: SendEmailInput): Promise<{ messageId: string }> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": config.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: config.senderEmail, name: config.senderName },
      to: [{ email: input.to.email, name: input.to.name }],
      subject: input.subject,
      htmlContent: input.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Échec de l'envoi Brevo (HTTP ${res.status}): ${body}`);
  }

  const data = (await res.json()) as { messageId?: string };
  return { messageId: data.messageId ?? "" };
}
