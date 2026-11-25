import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { nuevoToken } from "@/lib/seguridad";
import { registrarEvento } from "@/lib/eventos";
import { correoConfigurado, enviarCorreo } from "@/lib/correo";
import { evaluarExpediente, resumenParaBeneficiario, type DocumentoEvaluable } from "@/lib/expediente";
import type { TipoReclamacion } from "@/lib/dominio";

const MAX_INTENTOS = 5;

type Notificacion = {
  id: string;
  reclamacion_id: string | null;
  destinatario: "beneficiario" | "analistas";
  canal: string;
  tipo: string;
  asunto: string | null;
  cuerpo: string;
  intentos: number;
};

/** Cada correo al beneficiario lleva su propio enlace de seguimiento (el token en claro no se guarda). */
async function enlaceSeguimiento(reclamacionId: string): Promise<string> {
  const { token, hash } = nuevoToken();
  await db().from("enlaces_seguimiento").insert({ token_hash: hash, reclamacion_id: reclamacionId });
  return `${env.appUrl}/seguimiento/${token}`;
}

async function cuerpoRecordatorio(reclamacionId: string): Promise<{ asunto: string; cuerpo: string } | null> {
  const { data: r } = await db().from("reclamaciones").select("radicado, beneficiario_nombre, tipo_final, tipo_sugerido, estado").eq("id", reclamacionId).single();
  if (!r || r.estado !== "incompleto") return null;
  const { data: docs } = await db().from("documentos").select("id, nombre_original, tipo_detectado, estado, motivo, created_at").eq("reclamacion_id", reclamacionId);
  const ev = evaluarExpediente((r.tipo_final ?? r.tipo_sugerido) as TipoReclamacion, (docs ?? []) as DocumentoEvaluable[]);
  const base = resumenParaBeneficiario(r.radicado, ev, r.beneficiario_nombre);
  return {
    asunto: `Recordatorio: ${base.asunto}`,
    cuerpo: `Le escribimos de nuevo porque su reclamación sigue en espera. Sabemos que este es un momento difícil; si necesita ayuda para conseguir algún documento, responda este correo.\n\n${base.cuerpo}`,
  };
}

async function correosAnalistas(): Promise<string[]> {
  if (env.alertasEmail) return env.alertasEmail.split(",").map((s) => s.trim()).filter(Boolean);
  const { data } = await db().from("analistas").select("email").eq("activo", true);
  return (data ?? []).map((a) => a.email);
}

/** Envía las notificaciones pendientes. Llamada por el cron; segura de repetir. */
export async function despacharPendientes(limite = 30): Promise<{ enviadas: number; fallidas: number; omitidas: number }> {
  const { data } = await db()
    .from("notificaciones")
    .select("id, reclamacion_id, destinatario, canal, tipo, asunto, cuerpo, intentos")
    .in("estado", ["pendiente", "fallida"])
    .lt("intentos", MAX_INTENTOS)
    .order("created_at")
    .limit(limite);

  const resumen = { enviadas: 0, fallidas: 0, omitidas: 0 };

  for (const n of (data ?? []) as Notificacion[]) {
    try {
      if (!correoConfigurado()) {
        await marcar(n, "omitida", "Correo no configurado (SMTP_USER/SMTP_PASS). El beneficiario ve el estado en su enlace y la alerta se ve en el panel.");
        resumen.omitidas++;
        continue;
      }

      if (n.destinatario === "beneficiario") {
        const { data: r } = await db().from("reclamaciones").select("beneficiario_email").eq("id", n.reclamacion_id!).single();
        // Dominios reservados para pruebas (RFC 2606): no se envía, se deja constancia.
        if (/@([a-z0-9-]+\.)*(ejemplo\.test|example\.(com|org)|test|invalid)$/i.test(r!.beneficiario_email)) {
          await marcar(n, "omitida", `Dirección ficticia del conjunto de prueba (${r!.beneficiario_email}); no se envía.`);
          resumen.omitidas++;
          continue;
        }
        let asunto = n.asunto ?? "Su reclamación";
        let cuerpo = n.cuerpo;
        if (n.tipo === "recordatorio_documentos") {
          const rec = await cuerpoRecordatorio(n.reclamacion_id!);
          if (!rec) {
            await marcar(n, "omitida", "El caso ya no está incompleto");
            resumen.omitidas++;
            continue;
          }
          ({ asunto, cuerpo } = rec);
        }
        await enviarCorreo({
          para: r!.beneficiario_email,
          asunto,
          texto: cuerpo,
          enlace: { texto: "Ver mi reclamación y enviar documentos", url: await enlaceSeguimiento(n.reclamacion_id!) },
          pie: "Este enlace es personal: no lo comparta. No necesita usuario ni contraseña.",
        });
      } else {
        const para = await correosAnalistas();
        if (!para.length) {
          await marcar(n, "omitida", "No hay analistas activos con correo");
          resumen.omitidas++;
          continue;
        }
        await enviarCorreo({
          para,
          asunto: `[Reclamaciones] ${n.asunto ?? n.tipo}`,
          texto: n.cuerpo,
          enlace: { texto: "Abrir el caso en el panel", url: n.reclamacion_id ? `${env.appUrl}/panel/casos/${n.reclamacion_id}` : `${env.appUrl}/panel` },
          pie: "Alerta automática del vigilante de plazos. Uso interno.",
        });
      }
      await marcar(n, "enviada");
      resumen.enviadas++;
    } catch (e) {
      await marcar(n, "fallida", (e as Error).message);
      resumen.fallidas++;
    }
  }
  return resumen;
}

async function marcar(n: Notificacion, estado: "enviada" | "fallida" | "omitida", error?: string) {
  await db().from("notificaciones").update({
    estado,
    error: error ?? null,
    intentos: n.intentos + 1,
    enviada_at: estado === "enviada" ? new Date().toISOString() : null,
  }).eq("id", n.id);
  if (n.reclamacion_id) {
    await registrarEvento(n.reclamacion_id, `notificacion_${estado}`, "sistema", { notificacion_id: n.id, tipo: n.tipo, destinatario: n.destinatario, error });
  }
}
