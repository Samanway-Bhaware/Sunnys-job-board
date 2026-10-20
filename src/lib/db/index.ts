import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { neon } from "@neondatabase/serverless";
import { PGlite } from "@electric-sql/pglite";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema> | PgliteDatabase<typeof schema>;

interface GlobalDbState {
  db: Db | null;
  pgliteInstance: PGlite | null;
  openedTarget: string | null;
  migratedTarget: string | null;
  migrationPromise: Promise<void> | null;
  seededTarget: string | null;
  seedPromise: Promise<void> | null;
}

const globalForDb = globalThis as unknown as {
  __sunnynunnyDb?: GlobalDbState;
};

export function getDbState(): GlobalDbState {
  if (!globalForDb.__sunnynunnyDb) {
    globalForDb.__sunnynunnyDb = {
      db: null,
      pgliteInstance: null,
      openedTarget: null,
      migratedTarget: null,
      migrationPromise: null,
      seededTarget: null,
      seedPromise: null,
    };
  }
  return globalForDb.__sunnynunnyDb;
}

export function currentDbTarget(): string {
  const env = getEnv();
  const dbUrl = env.DATABASE_URL;
  const isNeon = Boolean(dbUrl && (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://")));
  return isNeon ? dbUrl! : ":memory:";
}

export function getDb(): Db {
  const state = getDbState();
  const target = currentDbTarget();
  const isNeon = target !== ":memory:";

  if (state.db && state.openedTarget === target) {
    return state.db;
  }

  if (isNeon) {
    const sql = neon(target);
    state.db = drizzleNeon(sql, { schema });
    state.openedTarget = target;
    state.migratedTarget = null;
    state.migrationPromise = null;
    state.seededTarget = null;
    state.seedPromise = null;
    return state.db;
  }

  // In-memory PGlite for tests or local development without external Postgres
  if (!state.pgliteInstance || state.openedTarget !== target) {
    state.pgliteInstance = new PGlite();
    state.db = drizzlePglite(state.pgliteInstance, { schema });
    state.openedTarget = target;
    state.migratedTarget = null;
    state.migrationPromise = null;
    state.seededTarget = null;
    state.seedPromise = null;
  }

  return state.db!;
}

export async function closeDb(): Promise<void> {
  const state = getDbState();
  if (state.pgliteInstance) {
    await state.pgliteInstance.close();
    state.pgliteInstance = null;
  }
  state.db = null;
  state.openedTarget = null;
  state.migratedTarget = null;
  state.migrationPromise = null;
  state.seededTarget = null;
  state.seedPromise = null;
}

export { schema };
