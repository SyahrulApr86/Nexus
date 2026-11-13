import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(postgres(url, { max: 10 }), { schema });
}

type DB = ReturnType<typeof create>;

// One pool per process; survives dev hot reloads.
const globalForDb = globalThis as unknown as { nexusDb?: DB };

/** Lazily connects on first use, so `next build` never needs DATABASE_URL. */
export function getDb(): DB {
  return (globalForDb.nexusDb ??= create());
}

export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
