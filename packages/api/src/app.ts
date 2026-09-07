import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { campagnesRouter } from "./routes/campagnes.js";
import { teachersRouter } from "./routes/teachers.js";
import { matchesRouter } from "./routes/matches.js";
import { baSeuilsRouter } from "./routes/baSeuils.js";
import { importsRouter } from "./routes/imports.js";
import { mailingRouter } from "./routes/mailing.js";
import { adelRouter } from "./routes/adel.js";
import { grillesRouter } from "./routes/grilles.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/auth", authRouter);
  app.use("/campagnes", campagnesRouter);
  app.use("/teachers", teachersRouter);
  app.use("/matches", matchesRouter);
  app.use("/ba-seuils", baSeuilsRouter);
  app.use("/imports", importsRouter);
  app.use("/mailing", mailingRouter);
  app.use("/adel", adelRouter);
  app.use("/grilles", grillesRouter);

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
