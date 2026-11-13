import type { Express } from "express";
import { usersRouter } from "./users";
import { sessionsRouter } from "./sessions";

export function registerRoutes(app: Express) {
  app.use("/users", usersRouter);
  app.use("/sessions", sessionsRouter);
}
