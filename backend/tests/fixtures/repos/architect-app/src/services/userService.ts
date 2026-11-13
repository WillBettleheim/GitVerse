import { query } from "../db/client";
import { currentUserId } from "../auth/session";

export class UserService {
  async findById(id: string) {
    return query("select * from users where id = $1", [id]);
  }

  async findByEmail(email: string) {
    return query("select * from users where email = $1", [email]);
  }

  async checkPassword(user: { id: string }, password: string) {
    return password.length > 0 && Boolean(user.id);
  }

  idFromToken(token: string) {
    return token ? currentUserId(token) : null;
  }
}
