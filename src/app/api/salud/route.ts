import { NextResponse } from "next/server";
import { db } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chequeo de salud para el monitor externo (UptimeRobot). Responde 503 si algo
 * se rompió en silencio: el cron dejó de correr, hay casos atascados o
 * notificaciones fallando. Así nos enteramos antes que el usuario.
 * No expone datos personales: solo conteos.
 */
export async function GET() {
  const problemas: string[] = [];
  try {
    const hace40 = new Date(Date.now() - 40 * 60_000).toISOString();
    const hace30 = new Date(Date.now() - 30 * 60_000).toISOString();

    const [{ data: latVig }, { data: latApp }, { count: atascados }, { count: fallidas }, { count: manuales }] = await Promise.all([
      db().from("latidos").select("created_at").eq("origen", "vigilar_plazos").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db().from("latidos").select("created_at").eq("origen", "tick_app").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db().from("reclamaciones").select("id", { count: "exact", head: true }).eq("estado", "recibido").lt("radicado_at", hace30),
      db().from("notificaciones").select("id", { count: "exact", head: true }).eq("estado", "fallida"),
      db().from("reclamaciones").select("id", { count: "exact", head: true }).eq("estado", "revision_manual"),
    ]);

    if (!latVig || latVig.created_at < hace40) problemas.push("vigilante_de_plazos_sin_latido");
    if (!latApp || latApp.created_at < hace40) problemas.push("tick_de_la_app_sin_latido");
    if ((atascados ?? 0) > 0) problemas.push(`casos_sin_procesar_30min:${atascados}`);
    if ((fallidas ?? 0) > 0) problemas.push(`notificaciones_fallidas:${fallidas}`);

    return NextResponse.json(
      { ok: problemas.length === 0, problemas, revision_manual: manuales ?? 0, ultimo_latido_vigilante: latVig?.created_at ?? null, ultimo_latido_app: latApp?.created_at ?? null },
      { status: problemas.length ? 503 : 200 },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, problemas: ["base_de_datos_inaccesible"], detalle: (e as Error).message }, { status: 503 });
  }
}
