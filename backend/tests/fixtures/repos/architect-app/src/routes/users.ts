import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { UserService } from "../services/userService";

export const usersRouter = Router();
const users = new UserService();

usersRouter.get("/:id", requireAuth, async (req, res) => {
  res.json(await users.findById(req.params.id));
});
