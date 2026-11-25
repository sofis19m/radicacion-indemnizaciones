import "server-only";
import { db } from "@/lib/supabase/admin";

/** Las cuatro preguntas del punto 7, respondidas con lo que realmente pasó en la base. */
export async function obtenerMetricas() {
  const [plazos, clasif, docs, tiempos, ultimoLatido, notifs] = await Promise.all([
    db().from("v_resumen_plazos").select("*").single(),
    db().from("v_correcciones_clasificacion").select("*").single(),
    db().from("v_correcciones_documentos").select("*").single(),
    db().from("v_tiempo_primera_respuesta").select("*").single(),
    db().from("latidos").select("origen, created_at, detalle").order("created_at", { ascending: false }).limit(2),
    db().from("notificaciones").select("estado"),
  ]);
  const conteoNotif: Record<string, number> = {};
  for (const n of notifs.data ?? []) conteoNotif[n.estado] = (conteoNotif[n.estado] ?? 0) + 1;

  return {
    generado_at: new Date().toISOString(),
    p1_plazos: plazos.data,
    p2_correcciones: { clasificacion: clasif.data, documentos: docs.data },
    p3_tiempo_primera_respuesta: { ...tiempos.data, linea_base_manual_dias: 4.5 },
    p4_reconstruccion: "GET /api/metricas/historia/{radicado} o el panel /panel/casos/{id}",
    operacion: { ultimos_latidos: ultimoLatido.data, notificaciones: conteoNotif },
  };
}
