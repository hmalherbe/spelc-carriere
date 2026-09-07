import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthTokenPayload } from "./jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentification requise" });
  }
  try {
    req.auth = verifyToken(header.slice("Bearer ".length));
    next();
  } catch {
    return res.status(401).json({ error: "Jeton invalide ou expiré" });
  }
}

/** GESTIONNAIRE can do day-to-day work; LECTURE is read-only; ADMIN can do everything. */
export function requireRole(...roles: Array<"ADMIN" | "GESTIONNAIRE" | "LECTURE">) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "Droits insuffisants pour cette action" });
    }
    next();
  };
}
