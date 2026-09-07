import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 doesn't forward a rejected promise from an async handler to `next()` on its own — an
 * unhandled rejection there crashes the whole Node process (observed firsthand: a bad échelon
 * lookup and a duplicate-teacherId insert each took the entire API down for every user, not just
 * the one request). Wrapping a handler with this turns that into an ordinary 500 through the
 * app's existing error middleware.
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
