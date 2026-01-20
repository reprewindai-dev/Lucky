import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

// IMPORTANT: For "ZIP -> Vercel" deployments we allow DATABASE_URL to be optional.
// When it's missing, the app will use in-memory storage (see server/storage.ts).
export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

export const db = pool ? drizzle(pool, { schema }) : null;
