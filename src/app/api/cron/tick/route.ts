import { NextResponse } from "next/server";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { compararSecreto } from "@/lib/seguridad";
import { procesarReclamacion } from "@/lib/motor";
import { despacharPendientes } from "@/lib/notificaciones";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Lo invoca pg_cron cada 15 minutos (y se puede invocar a mano con el secreto).
 * 1. Corre el vigilante de plazos (también corre solo dentro de la base).
 * 2. Reintenta casos que el modelo no alcanzó a procesar o que fallaron.
 * 3. Envía notificaciones pendientes.
 */
async function tick(req: Request) {
  const auth = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
  if (!compararSecreto(auth, env.cronSecret)) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const inicio = Date.now();
  const { data: vigilante, error: errVig } = await db().rpc("vigilar_plazos");

  const hace2min = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: atascados } = await db()
    .from("reclamaciones")
    .select("id, radicado")
    .in("estado", ["recibido"])
    .lt("updated_at", hace2min)
    .lt("intentos_ia", 3)
    .order("radicado_at")
    .limit(4);

  // Documentos nuevos que nadie analizó (p. ej. si la función se cortó tras responder)
  const { data: docsPendientes } = await db()
    .from("documentos")
    .select("reclamacion_id, reclamaciones!inner(radicado, estado, intentos_ia)")
    .eq("estado", "pendiente_revision")
    .lt("created_at", hace2min)
    .limit(20);
  const cola = new Map<string, string>();
  for (const c of atascados ?? []) cola.set(c.id, c.radicado);
  for (const d of (docsPendientes ?? []) as unknown as { reclamacion_id: string; reclamaciones: { radicado: string; estado: string; intentos_ia: number } }[]) {
    if (d.reclamaciones.estado !== "cerrado" && d.reclamaciones.intentos_ia < 3) cola.set(d.reclamacion_id, d.reclamaciones.radicado);
  }

  const reprocesados: string[] = [];
  for (const c of [...cola].slice(0, 4).map(([id, radicado]) => ({ id, radicado }))) {
    if (Date.now() - inicio > 40_000) break;
    try {
      await procesarReclamacion(c.id, "cron");
      reprocesados.push(c.radicado);
    } catch (e) {
      console.error("[tick] reproceso", c.radicado, e);
    }
  }

  const envios = await despacharPendientes();
  const resumen = { vigilante, error_vigilante: errVig?.message ?? null, reprocesados, envios, ms: Date.now() - inicio };
  await db().from("latidos").insert({ origen: "tick_app", detalle: resumen });
  return NextResponse.json(resumen);
}

export const POST = tick;
export const GET = tick;
