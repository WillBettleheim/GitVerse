import express from "express";
import { registerRoutes } from "./routes";
import { logger } from "./lib/logger";

export function createApp() {
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  logger.info("app ready");
  return app;
}
