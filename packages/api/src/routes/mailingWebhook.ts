import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

/**
 * Route PUBLIQUE (aucun requireAuth — voir app.ts, montée AVANT mailingRouter pour que
 * "/mailing/webhook/brevo" soit interceptée ici d'abord) : Brevo appelle cette URL directement
 * depuis ses propres serveurs, jamais depuis une session connectée à l'appli. À configurer une
 * fois dans Brevo (Paramètres → Webhooks → "Transactionnel") avec l'URL
 * ${PUBLIC_APP_URL}/api/mailing/webhook/brevo et les événements utiles cochés (delivered, click,
 * hardBounce, softBounce, blocked, spam, invalid, deferred, opened, error — ou "tout cocher").
 *
 * Le message-id renvoyé par Brevo à l'envoi (routes/mailing.ts, sendBrevoEmail -> MailingLog.
 * brevoMessageId) est celui que Brevo réutilise dans chaque événement de webhook pour identifier
 * l'envoi d'origine — c'est la clé de corrélation ici.
 *
 * Les noms de champs exacts du payload Brevo n'ont pas pu être confirmés à 100% au moment
 * d'écrire cette route (accès à leur documentation indisponible depuis cet environnement) — la
 * doc Brevo documente "event", "message-id" (avec le tiret, pas messageId) et "link" pour un clic,
 * mais avec une marge d'incertitude sur la casse exacte de certaines valeurs ("click" vs
 * "clicked", par ex.). D'où une lecture volontairement tolérante ci-dessous (plusieurs noms de
 * champs essayés), et surtout `raw` qui conserve le payload JSON complet tel que reçu : en cas de
 * divergence, il suffit de regarder un vrai événement réel en base pour ajuster l'extraction sans
 * avoir rien perdu entre-temps.
 */
export const mailingWebhookRouter = Router();

function firstString(body: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

mailingWebhookRouter.post(
  "/webhook/brevo",
  asyncHandler(async (req, res) => {
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const type = firstString(body, ["event"]) ?? "inconnu";
    const messageId = firstString(body, ["message-id", "messageId", "message_id"]);
    const url = firstString(body, ["link", "url", "URL"]);

    const mailingLog = messageId ? await prisma.mailingLog.findFirst({ where: { brevoMessageId: messageId } }) : null;

    await prisma.mailingEvent.create({
      data: {
        mailingLogId: mailingLog?.id ?? null,
        brevoMessageId: messageId,
        type,
        url,
        raw: body as never,
      },
    });

    // Toujours 200 : un code d'erreur ferait que Brevo réessaie indéfiniment le même événement, et
    // l'événement est de toute façon déjà conservé (avec mailingLogId=null si la corrélation a
    // échoué) — rien à gagner à faire échouer la requête du côté de Brevo.
    res.status(200).json({ ok: true });
  }),
);
