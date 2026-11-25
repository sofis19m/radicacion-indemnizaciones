// SOLO PARA DESARROLLO: borra todas las reclamaciones, documentos, eventos y
// archivos para volver a cargar el conjunto de prueba desde cero. No toca
// analistas, requisitos ni la configuración.
// Uso: npx tsx scripts/reiniciar-datos-prueba.ts --confirmo
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";

async function main() {
  if (!process.argv.includes("--confirmo")) {
    console.error("Esto borra TODAS las reclamaciones. Si está seguro, agregue --confirmo");
    process.exit(1);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  // TRUNCATE no dispara los triggers por fila que protegen la bitácora: es una
  // operación administrativa, no algo que pueda hacer la aplicación.
  await db.query(`truncate eventos, decisiones, ejecuciones_ia, notificaciones, cargas, documentos, enlaces_seguimiento, reclamaciones, latidos, limites_ip restart identity cascade`);
  await db.query(`alter sequence radicado_seq restart with 1000`);
  await db.end();

  const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!).storage.from("documentos");
  let borrados = 0;
  for (;;) {
    const { data: carpetas } = await storage.list("", { limit: 100 });
    const rutas: string[] = [];
    for (const c of carpetas ?? []) {
      const { data: archivos } = await storage.list(c.name, { limit: 1000 });
      for (const a of archivos ?? []) {
        if (a.id) rutas.push(`${c.name}/${a.name}`);
        else {
          const { data: sub } = await storage.list(`${c.name}/${a.name}`, { limit: 1000 });
          for (const s of sub ?? []) rutas.push(`${c.name}/${a.name}/${s.name}`);
        }
      }
    }
    if (!rutas.length) break;
    await storage.remove(rutas);
    borrados += rutas.length;
  }
  console.log(`Datos de prueba reiniciados. Archivos borrados: ${borrados}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
