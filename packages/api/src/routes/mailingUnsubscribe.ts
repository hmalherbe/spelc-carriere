import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { verifyUnsubscribeToken } from "../mailing/unsubscribeToken.js";
import { escapeHtml } from "../mailing/template.js";

/**
 * Route PUBLIQUE (aucun requireAuth — voir app.ts, montée AVANT mailingRouter pour que
 * "/mailing/unsubscribe/:token" soit interceptée ici d'abord) : le lien cliqué depuis un mail de
 * notification, jamais depuis une session connectée à l'appli.
 *
 * GET affiche une page de confirmation (bouton -> POST) plutôt que de désabonner directement sur
 * le simple chargement du lien : de nombreuses passerelles de sécurité académiques/professionnelles
 * pré-chargent automatiquement (GET) les liens d'un mail entrant pour les scanner avant livraison —
 * un GET qui désabonnerait directement désabonnerait alors des gens qui n'ont jamais cliqué eux-
 * mêmes. Seul le POST (déclenché par un vrai clic humain sur le bouton de cette page) écrit en base.
 */
export const mailingUnsubscribeRouter = Router();

const PAGE_STYLE = `body{font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#222;text-align:center}
h1{font-size:1.2rem}button{font-size:1rem;padding:10px 24px;background:#1a56db;color:#fff;border:none;border-radius:6px;cursor:pointer}
button:hover{background:#1543ad}`;

function page(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body>${bodyHtml}</body></html>`;
}

mailingUnsubscribeRouter.get(
  "/unsubscribe/:token",
  asyncHandler(async (req, res) => {
    const payload = verifyUnsubscribeToken(req.params.token);
    if (!payload) {
      res.status(400).send(page("Lien invalide", "<h1>Ce lien de désabonnement n'est pas valide.</h1><p>Il a peut-être été tronqué par votre messagerie en le copiant.</p>"));
      return;
    }
    res.send(
      page(
        "Confirmer le désabonnement",
        `<h1>Se désabonner des notifications de promotion du Spelc ?</h1>
         <p>${escapeHtml(payload.prenom)} ${escapeHtml(payload.nom)}${payload.email ? ` (${escapeHtml(payload.email)})` : ""}</p>
         <p>Vous ne recevrez plus aucun mail du Spelc concernant vos avancements d'échelon, lors des campagnes futures.</p>
         <form method="POST" action="/mailing/unsubscribe/${encodeURIComponent(req.params.token)}">
           <button type="submit">Confirmer le désabonnement</button>
         </form>`,
      ),
    );
  }),
);

mailingUnsubscribeRouter.post(
  "/unsubscribe/:token",
  asyncHandler(async (req, res) => {
    const payload = verifyUnsubscribeToken(req.params.token);
    if (!payload) {
      res.status(400).send(page("Lien invalide", "<h1>Ce lien de désabonnement n'est pas valide.</h1>"));
      return;
    }

    // Évite les doublons sur plusieurs clics (bouton rechargé, double soumission...) — un match
    // déjà existant par email OU par nom+prénom suffit à ne rien réinsérer.
    const existing = await prisma.mailingOptOut.findFirst({
      where: {
        OR: [...(payload.email ? [{ email: payload.email }] : []), { nom: payload.nom, prenom: payload.prenom }],
      },
    });
    if (!existing) {
      await prisma.mailingOptOut.create({ data: { email: payload.email, nom: payload.nom, prenom: payload.prenom } });
    }

    res.send(
      page(
        "Désabonnement confirmé",
        `<h1>C'est fait.</h1><p>${escapeHtml(payload.prenom)} ${escapeHtml(payload.nom)} ne recevra plus de notifications de promotion du Spelc.</p>`,
      ),
    );
  }),
);
