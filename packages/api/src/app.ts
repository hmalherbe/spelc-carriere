import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { campagnesRouter } from "./routes/campagnes.js";
import { teachersRouter } from "./routes/teachers.js";
import { matchesRouter } from "./routes/matches.js";
import { importsRouter } from "./routes/imports.js";
import { mailingRouter } from "./routes/mailing.js";
import { mailingUnsubscribeRouter } from "./routes/mailingUnsubscribe.js";
import { mailingWebhookRouter } from "./routes/mailingWebhook.js";
import { adelRouter } from "./routes/adel.js";
import { grillesRouter } from "./routes/grilles.js";
import { adherentsRouter } from "./routes/adherents.js";
import { settingsRouter } from "./routes/settings.js";
import { statsRouter } from "./routes/stats.js";
import { elusRouter } from "./routes/elus.js";
import { aiAssistantRouter } from "./routes/aiAssistant.js";
import { hcExcRouter } from "./routes/hcExc.js";
import { reliquatsRouter } from "./routes/reliquats.js";
import { reclassementsRouter } from "./routes/reclassements.js";
import { saisiesManuellesRouter } from "./routes/saisiesManuelles.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/auth", authRouter);
  app.use("/campagnes", campagnesRouter);
  app.use("/teachers", teachersRouter);
  app.use("/matches", matchesRouter);
  app.use("/imports", importsRouter);
  // Montées AVANT mailingRouter (qui exige requireAuth sur tout son préfixe) : le lien de
  // désabonnement est cliqué depuis un mail, et le webhook est appelé directement par les serveurs
  // Brevo — ni l'un ni l'autre n'a de session connectée à l'appli. Express essaie les middlewares
  // /mailing dans l'ordre de montage — seules /unsubscribe/:token et /webhook/brevo matchent ici,
  // tout le reste retombe sur mailingRouter juste après.
  app.use("/mailing", mailingUnsubscribeRouter);
  app.use("/mailing", mailingWebhookRouter);
  app.use("/mailing", mailingRouter);
  app.use("/adel", adelRouter);
  app.use("/grilles", grillesRouter);
  app.use("/adherents", adherentsRouter);
  app.use("/settings", settingsRouter);
  app.use("/stats", statsRouter);
  app.use("/elus", elusRouter);
  app.use("/ai-assistant", aiAssistantRouter);
  app.use("/hc-exc", hcExcRouter);
  app.use("/reliquats", reliquatsRouter);
  app.use("/reclassements", reclassementsRouter);
  app.use("/saisies-manuelles", saisiesManuellesRouter);

  app.use((req, res) => {
    res.status(404).json({ error: `Route inconnue: ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Erreur interne du serveur" });
  });

  return app;
}
