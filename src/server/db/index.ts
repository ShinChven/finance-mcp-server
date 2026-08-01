import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

export const db = drizzle(pool, { schema });

export async function waitForDb(maxAttempts = 30, delayMs = 1000): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("select 1");
      return;
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      console.log(`Waiting for database (attempt ${attempt}/${maxAttempts})…`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
