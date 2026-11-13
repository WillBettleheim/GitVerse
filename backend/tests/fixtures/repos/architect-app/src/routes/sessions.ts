import { Router } from "express";
import { login, logout } from "../auth/session";

export const sessionsRouter = Router();

sessionsRouter.post("/", async (req, res) => {
  res.json(await login(req.body.email, req.body.password));
});

sessionsRouter.delete("/", async (req, res) => {
  await logout(req.headers.authorization ?? "");
  res.status(204).end();
});
