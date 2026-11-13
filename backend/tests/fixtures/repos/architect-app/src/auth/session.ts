import { signToken } from "./tokens";
import { query } from "../db/client";
import { UserService } from "../services/userService";

const users = new UserService();

export async function login(email: string, password: string) {
  const user = await users.findByEmail(email);
  if (!user || !(await users.checkPassword(user, password))) {
    throw new Error("Invalid credentials");
  }
  await query("insert into sessions (user_id) values ($1)", [user.id]);
  return { token: signToken(user.id) };
}

export async function logout(token: string) {
  await query("delete from sessions where token = $1", [token]);
}

export function currentUserId(token: string) {
  return users.idFromToken(token);
}
