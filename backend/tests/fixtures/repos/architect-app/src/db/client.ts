import { Pool } from "pg";
import { config } from "../config";

export const db = new Pool({ connectionString: config.databaseUrl });

export async function query(sql: string, params: unknown[]) {
  const result = await db.query(sql, params);
  return result.rows[0];
}
