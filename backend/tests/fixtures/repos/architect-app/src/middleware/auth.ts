import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../auth/tokens";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const userId = verifyToken(header.replace("Bearer ", ""));
  if (!userId) {
    res.status(401).end();
    return;
  }
  next();
}
