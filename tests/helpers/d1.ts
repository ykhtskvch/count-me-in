// A small stand-in for Cloudflare D1 over Node's built-in SQLite, with the real
// migrations applied, so database code can be tested without Cloudflare.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Value = string | number | null;

class Statement {
  readonly db: DatabaseSync;
  readonly sql: string;
  readonly params: Value[];

  constructor(db: DatabaseSync, sql: string, params: Value[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params: Value[]) {
    return new Statement(this.db, this.sql, params);
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes) } };
  }
}

export function testDatabase(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../../drizzle/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  return {
    prepare: (sql: string) => new Statement(db, sql),
    // Like D1, a batch is one transaction: any failure rolls the whole batch back.
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => s.runSync());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
    },
  } as unknown as D1Database;
}
