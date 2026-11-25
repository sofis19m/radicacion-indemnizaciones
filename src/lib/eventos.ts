import "server-only";
import { db } from "@/lib/supabase/admin";

/** Registra un hecho en la bitácora (append-only). Nunca lanza: la bitácora no debe tumbar el flujo. */
export async function registrarEvento(
  reclamacionId: string | null,
  tipo: string,
  actor: string,
  detalle: Record<string, unknown> = {},
) {
  const { error } = await db().from("eventos").insert({ reclamacion_id: reclamacionId, tipo, actor, detalle });
  if (error) console.error("[bitacora] no se pudo registrar", tipo, error.message);
}
