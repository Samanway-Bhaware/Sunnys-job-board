import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database | null = null;
let db: Db | null = null;
let openedAt: string | null = null;

function resolveDatabasePath(): string {
  const configured = getEnv().DATABASE_PATH;
  if (configured === ":memory:") return configured;
  // Deliberately not `resolve(process.cwd(), …)`: Next's file tracer treats that
  // exact pattern as "read the whole project" and copies every source file into
  // the standalone output. `resolve(x)` resolves against cwd just the same.
  return isAbsolute(configured) ? configured : resolve(configured);
}

export function getSqlite(): Database.Database {
  const path = resolveDatabasePath();

  // DATABASE_PATH changing under us only happens in tests; reopen rather than
  // silently keep handing back a handle to the previous file.
  if (sqlite && openedAt !== path) closeDb();

  if (!sqlite) {
    if (path !== ":memory:") {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    openedAt = path;
  }

  return sqlite;
}

export function getDb(): Db {
  const connection = getSqlite();
  if (!db || openedAt !== resolveDatabasePath()) {
    db = drizzle(connection, { schema });
  }
  return db;
}

export function closeDb(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
  openedAt = null;
}

export { schema };
