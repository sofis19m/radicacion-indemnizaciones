// Aplica las migraciones de supabase/migrations en orden, una sola vez cada una.
// Uso: npm run db:migrar   (requiere DATABASE_URL en .env.local)
import { config } from "dotenv";
config({ path: ".env.local" });
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await db.query("create table if not exists _migraciones (nombre text primary key, aplicada_at timestamptz default now())");
  const aplicadas = new Set((await db.query("select nombre from _migraciones")).rows.map((r) => r.nombre));
  const archivos = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  for (const f of archivos) {
    if (aplicadas.has(f)) { console.log(`= ${f} (ya aplicada)`); continue; }
    const sql = readFileSync(`supabase/migrations/${f}`, "utf8");
    try {
      await db.query("begin");
      await db.query(sql);
      await db.query("insert into _migraciones (nombre) values ($1)", [f]);
      await db.query("commit");
      console.log(`✓ ${f}`);
    } catch (e) {
      await db.query("rollback");
      console.error(`✗ ${f}: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  await db.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
