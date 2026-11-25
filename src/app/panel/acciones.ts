"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/supabase/admin";
import { clienteSesion, exigirAnalista } from "@/lib/supabase/sesion";
import { registrarEvento } from "@/lib/eventos";
import { encolarNotificacion, procesarReclamacion, reevaluar } from "@/lib/motor";
import { NOMBRE_DOCUMENTO, TIPOS_DOCUMENTO, TIPOS_RECLAMACION } from "@/lib/dominio";

export type ResultadoAccion = { ok: boolean; mensaje: string };

export async function cerrarSesion() {
  const supabase = await clienteSesion();
  await supabase.auth.signOut();
  redirect("/panel/login");
}

/** El analista confirma o corrige el tipo que sugirió el modelo. Alimenta la métrica de correcciones. */
export async function confirmarTipo(_: ResultadoAccion | null, fd: FormData): Promise<ResultadoAccion> {
  const analista = await exigirAnalista();
  const datos = z.object({ id: z.string().uuid(), tipo: z.enum(TIPOS_RECLAMACION) }).safeParse(Object.fromEntries(fd));
  if (!datos.success) return { ok: false, mensaje: "Datos no válidos" };

  const { data: r } = await db().from("reclamaciones").select("tipo_sugerido, tipo_final, estado").eq("id", datos.data.id).single();
  if (!r || r.estado === "cerrado") return { ok: false, mensaje: "El caso no existe o está cerrado" };

  await db().from("reclamaciones").update({
    tipo_final: datos.data.tipo,
    tipo_confirmado_por: analista.user_id,
    tipo_confirmado_at: new Date().toISOString(),
  }).eq("id", datos.data.id);

  const corrigio = r.tipo_sugerido !== datos.data.tipo;
  await registrarEvento(datos.data.id, corrigio ? "tipo_corregido_por_analista" : "tipo_confirmado_por_analista", `analista:${analista.email}`, {
    sugerido_por_modelo: r.tipo_sugerido, anterior: r.tipo_final, final: datos.data.tipo,
  });
  await reevaluar(datos.data.id, `analista:${analista.email}`);
  revalidatePath(`/panel/casos/${datos.data.id}`);
  return { ok: true, mensaje: corrigio ? "Tipo corregido. El expediente se recalculó." : "Tipo confirmado." };
}

/** El analista corrige la validación de un documento (p. ej. la IA dijo ilegible y sí se lee). */
export async function corregirDocumento(_: ResultadoAccion | null, fd: FormData): Promise<ResultadoAccion> {
  const analista = await exigirAnalista();
  const datos = z.object({
    id: z.string().uuid(),
    reclamacion_id: z.string().uuid(),
    tipo: z.enum(TIPOS_DOCUMENTO),
    estado: z.enum(["valido", "sin_firma", "ilegible", "no_corresponde", "vencido_o_incompleto", "no_reconocido"]),
    motivo: z.string().max(300).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!datos.success) return { ok: false, mensaje: "Datos no válidos" };
  const d = datos.data;

  const { data: antes } = await db().from("documentos").select("tipo_detectado, estado").eq("id", d.id).eq("reclamacion_id", d.reclamacion_id).single();
  if (!antes) return { ok: false, mensaje: "Documento no encontrado" };

  await db().from("documentos").update({
    tipo_detectado: d.tipo === "otro" ? null : d.tipo,
    estado: d.estado,
    motivo: d.motivo || null,
    estado_corregido_por: analista.user_id,
  }).eq("id", d.id);
  await registrarEvento(d.reclamacion_id, "documento_corregido_por_analista", `analista:${analista.email}`, {
    documento_id: d.id, antes, despues: { tipo: d.tipo, estado: d.estado, motivo: d.motivo },
  });
  await reevaluar(d.reclamacion_id, `analista:${analista.email}`);
  revalidatePath(`/panel/casos/${d.reclamacion_id}`);
  return { ok: true, mensaje: "Documento actualizado y expediente recalculado." };
}

/**
 * Decisión humana: pagar, objetar o pedir documentos. Queda registrado quién,
 * cuándo y por qué. El sistema no toma esta decisión en ningún flujo.
 */
export async function registrarDecision(_: ResultadoAccion | null, fd: FormData): Promise<ResultadoAccion> {
  const analista = await exigirAnalista();
  const datos = z.object({
    id: z.string().uuid(),
    decision: z.enum(["pagar", "objetar", "pedir_documentos"]),
    justificacion: z.string().trim().min(10, "Escriba una justificación (mínimo 10 caracteres)").max(2000),
    documentos: z.array(z.enum(TIPOS_DOCUMENTO)).default([]),
  }).safeParse({ ...Object.fromEntries(fd), documentos: fd.getAll("documentos") });
  if (!datos.success) return { ok: false, mensaje: datos.error.issues[0]?.message ?? "Datos no válidos" };
  const d = datos.data;

  const { data: r } = await db().from("reclamaciones").select("radicado, estado, tipo_final, beneficiario_nombre").eq("id", d.id).single();
  if (!r) return { ok: false, mensaje: "Caso no encontrado" };
  if (r.estado === "cerrado") return { ok: false, mensaje: "El caso ya está cerrado" };
  if (d.decision !== "pedir_documentos" && !r.tipo_final) {
    return { ok: false, mensaje: "Antes de pagar u objetar, confirme o corrija el tipo de reclamación sugerido por el modelo." };
  }
  if (d.decision === "pagar" && r.estado !== "completo") {
    return { ok: false, mensaje: "No se puede aprobar el pago de un expediente incompleto." };
  }
  if (d.decision === "pedir_documentos" && d.documentos.length === 0) {
    return { ok: false, mensaje: "Seleccione qué documentos se le piden al beneficiario." };
  }

  const { error } = await db().from("decisiones").insert({
    reclamacion_id: d.id,
    decision: d.decision,
    justificacion: d.justificacion,
    documentos_solicitados: d.documentos.length ? d.documentos : null,
    analista_id: analista.user_id,
    analista_email: analista.email,
  });
  if (error) return { ok: false, mensaje: error.message };

  if (d.decision === "pedir_documentos") {
    // Si el reloj no ha arrancado, el caso sigue incompleto. Si ya arrancó, NO se detiene:
    // pedir más documentos no suspende el plazo legal (supuesto documentado en el README).
    if (r.estado !== "completo") await db().from("reclamaciones").update({ estado: "incompleto" }).eq("id", d.id);
  } else {
    await db().from("reclamaciones").update({ estado: "cerrado", cerrado_at: new Date().toISOString() }).eq("id", d.id);
  }

  await registrarEvento(d.id, `decision_${d.decision}`, `analista:${analista.email}`, { justificacion: d.justificacion, documentos: d.documentos });

  const primerNombre = r.beneficiario_nombre.split(" ")[0];
  const mensaje = {
    pagar: { asunto: `Su reclamación ${r.radicado} fue aprobada`, cuerpo: `${primerNombre}, su reclamación fue aprobada. En los próximos días le informaremos el detalle del pago a la cuenta que registró.` },
    objetar: { asunto: `Respuesta a su reclamación ${r.radicado}`, cuerpo: `${primerNombre}, su reclamación fue revisada y no fue posible aprobarla en esta oportunidad. Le enviaremos una carta formal con los motivos y los pasos que puede seguir si no está de acuerdo.` },
    pedir_documentos: {
      asunto: `Necesitamos documentos adicionales para ${r.radicado}`,
      cuerpo: `${primerNombre}, para continuar con su reclamación necesitamos:\n${d.documentos.map((t) => `• ${NOMBRE_DOCUMENTO[t]}`).join("\n")}\n\nPuede subirlos desde su enlace de seguimiento.`,
    },
  }[d.decision];
  await encolarNotificacion({
    reclamacionId: d.id, destinatario: "beneficiario", canal: "email", tipo: `decision_${d.decision}`,
    llave: `decision:${d.id}:${Date.now()}`, ...mensaje,
  });

  revalidatePath(`/panel/casos/${d.id}`);
  revalidatePath("/panel");
  return { ok: true, mensaje: "Decisión registrada." };
}

/** Reintenta el análisis del modelo (p. ej. después de una caída del servicio). */
export async function reintentarAnalisis(_: ResultadoAccion | null, fd: FormData): Promise<ResultadoAccion> {
  const analista = await exigirAnalista();
  const id = z.string().uuid().parse(fd.get("id"));
  await db().from("reclamaciones").update({ intentos_ia: 0, estado: "recibido" }).eq("id", id).neq("estado", "cerrado");
  await db().from("documentos").update({ estado: "pendiente_revision" }).eq("reclamacion_id", id).is("revisado_at", null);
  await registrarEvento(id, "reanalisis_solicitado", `analista:${analista.email}`);
  await procesarReclamacion(id, `analista:${analista.email}`);
  revalidatePath(`/panel/casos/${id}`);
  return { ok: true, mensaje: "Análisis ejecutado." };
}
