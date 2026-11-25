import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { registrarEvento } from "@/lib/eventos";
import { analizarReclamacion, ErrorIA, esModeloDeMenorCapacidad, VERSION_PROMPT } from "@/lib/ia/analizar";
import { crucesEntreDocumentos, validarDocumento, type DocParaCruce } from "@/lib/validacion";
import { evaluarExpediente, resumenParaBeneficiario, type DocumentoEvaluable } from "@/lib/expediente";
import type { Preliminar } from "@/lib/ia/base-conocimiento";
import {
  NOMBRE_DOCUMENTO,
  type EstadoDocumento,
  type TipoDocumento,
  type TipoReclamacion,
} from "@/lib/dominio";

const MAX_INTENTOS_IA = 3;
const CONFIANZA_MINIMA_TIPO = 0.6;
const BYTES_POR_LLAMADA = 12 * 1024 * 1024;

type Reclamacion = {
  id: string;
  radicado: string;
  estado: string;
  relato: string;
  asegurado_nombre: string;
  asegurado_documento: string;
  beneficiario_nombre: string;
  beneficiario_documento: string;
  tipo_sugerido: TipoReclamacion | null;
  tipo_final: TipoReclamacion | null;
  tipo_preliminar: TipoReclamacion | null;
  preliminar: Preliminar | null;
  completo_at: string | null;
  primera_respuesta_at: string | null;
  intentos_ia: number;
};

type Documento = DocumentoEvaluable & {
  tipo_declarado: TipoDocumento | null;
  storage_path: string;
  mime: string;
  bytes: number;
  sha256: string;
};

/** Toma el candado del caso. Devuelve false si otro proceso lo está analizando. */
async function tomarCandado(id: string): Promise<boolean> {
  const ahora = new Date().toISOString();
  const hasta = new Date(Date.now() + 2 * 60_000).toISOString();
  const { data } = await db()
    .from("reclamaciones")
    .update({ procesando_hasta: hasta })
    .eq("id", id)
    .or(`procesando_hasta.is.null,procesando_hasta.lt.${ahora}`)
    .select("id");
  return !!data?.length;
}

async function soltarCandado(id: string) {
  await db().from("reclamaciones").update({ procesando_hasta: null }).eq("id", id);
}

/** Descarga un archivo del almacenamiento con hasta 3 intentos (fallas de red pasajeras). */
async function descargarConReintentos(ruta: string): Promise<Blob> {
  let ultimo = "";
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const { data, error } = await db().storage.from("documentos").download(ruta);
      if (data) return data;
      ultimo = error?.message ?? "sin datos";
    } catch (e) {
      ultimo = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 1000 * intento));
  }
  throw new Error(`${ruta}: ${ultimo}`);
}

/** El relato debe contener literalmente la evidencia citada; si no, el modelo la inventó. */
function evidenciaVerificable(relato: string, evidencia: string): boolean {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  return evidencia.trim().length > 0 && norm(relato).includes(norm(evidencia));
}

function agruparPorTamano(docs: Documento[]): Documento[][] {
  const grupos: Documento[][] = [];
  let actual: Documento[] = [];
  let bytes = 0;
  for (const d of docs) {
    if (actual.length && bytes + d.bytes > BYTES_POR_LLAMADA) {
      grupos.push(actual);
      actual = [];
      bytes = 0;
    }
    actual.push(d);
    bytes += d.bytes;
  }
  if (actual.length) grupos.push(actual);
  return grupos;
}

async function cargarCaso(id: string) {
  const { data: rec, error } = await db().from("reclamaciones").select("*").eq("id", id).single();
  if (error || !rec) throw new Error(`No existe la reclamación ${id}`);
  const { data: docs } = await db()
    .from("documentos")
    .select("id, nombre_original, tipo_detectado, tipo_declarado, cara, estado, motivo, created_at, storage_path, mime, bytes, sha256")
    .eq("reclamacion_id", id)
    .order("created_at");
  return { rec: rec as Reclamacion, docs: (docs ?? []) as Documento[] };
}

/**
 * Procesa una reclamación: analiza con IA los documentos pendientes, aplica las
 * reglas, actualiza el estado, arranca el reloj si corresponde y le responde al
 * beneficiario. Es seguro llamarla varias veces (idempotente por diseño).
 */
export async function procesarReclamacion(id: string, actor = "sistema"): Promise<void> {
  if (!(await tomarCandado(id))) return;
  try {
    const { rec, docs } = await cargarCaso(id);
    if (rec.estado === "cerrado") return;

    const pendientes = docs.filter((d) => d.estado === "pendiente_revision");
    let respuestaTipo: { tipo: TipoReclamacion; confianza: number; evidencia: string; razon: string } | null = null;

    if (pendientes.length || !rec.tipo_sugerido) {
      const yaRevisados = docs.filter((d) => d.estado !== "pendiente_revision" && d.tipo_detectado);
      const contexto = yaRevisados.length
        ? `DOCUMENTOS YA RECIBIDOS ANTES EN ESTE CASO (no vienen adjuntos ahora): ${yaRevisados.map((d) => d.tipo_detectado).join(", ")}`
        : "";
      // Pista preliminar (sin IA) calculada al radicar con el relato y los archivos anunciados
      const pista = rec.preliminar
        ? `${rec.preliminar.explicacion}${rec.preliminar.frasesEncontradas?.length ? ` Frases detectadas: ${rec.preliminar.frasesEncontradas.map((f) => `"${f.texto}" (${f.tipo})`).join(", ")}.` : ""}${rec.preliminar.pistasArchivos?.length ? ` Archivos: ${rec.preliminar.pistasArchivos.join("; ")}.` : ""}`
        : undefined;
      const grupos = pendientes.length ? agruparPorTamano(pendientes) : [[]];

      for (const grupo of grupos) {
        let archivos;
        try {
          archivos = await Promise.all(
          grupo.map(async (d, i) => {
            const data = await descargarConReintentos(d.storage_path);
            return { indice: i, mime: d.mime, base64: Buffer.from(await data.arrayBuffer()).toString("base64"), nombre: d.nombre_original, tipoDeclarado: d.tipo_declarado };
          }),
          );
        } catch (e) {
          // Falla de almacenamiento o de red: cuenta como intento fallido, queda registrado y el cron reintenta
          await manejarFalloIA(rec, `No se pudieron leer los archivos del almacenamiento: ${(e as Error).message}`);
          return;
        }

        const entradaResumen = {
          relato: rec.relato,
          documentos: grupo.map((d, i) => ({ indice: i, documento_id: d.id, sha256: d.sha256, nombre: d.nombre_original, casilla: d.tipo_declarado })),
          contexto_previo: contexto || null,
          pista_preliminar: pista ?? null,
        };

        let resultado;
        try {
          resultado = await analizarReclamacion({
            relato: rec.relato,
            aseguradoNombre: rec.asegurado_nombre,
            beneficiarioNombre: rec.beneficiario_nombre,
            archivos,
            pistaPreliminar: pista,
            contextoPrevio: contexto || undefined,
          });
        } catch (e) {
          const err = e as ErrorIA;
          await db().from("ejecuciones_ia").insert({
            reclamacion_id: id, modelo: env.geminiModelos.join(" → "), version_prompt: VERSION_PROMPT,
            entrada_resumen: entradaResumen, salida: err.crudo ? { crudo: err.crudo } : null, ok: false, error: err.message,
          });
          await manejarFalloIA(rec, err.message);
          return;
        }

        await db().from("ejecuciones_ia").insert({
          reclamacion_id: id, modelo: resultado.modelo, version_prompt: VERSION_PROMPT,
          entrada_resumen: entradaResumen, salida: resultado.respuesta, ok: true, latencia_ms: resultado.latenciaMs,
          error: resultado.fallosPrevios.length ? `Respondió el modelo de respaldo. Fallos previos: ${resultado.fallosPrevios.join(" | ")}` : null,
        });
        if (resultado.fallosPrevios.length) {
          await registrarEvento(id, "ia_modelo_respaldo", "sistema", { modelo: resultado.modelo, fallos: resultado.fallosPrevios });
        }

        const r = resultado.respuesta;
        // Evidencia no verificable => la confianza se castiga: no confiamos en lo que no podemos comprobar.
        let confianza = evidenciaVerificable(rec.relato, r.evidencia_relato) ? r.confianza_tipo : Math.min(r.confianza_tipo, 0.55);
        // Si respondió un modelo de menor capacidad, el caso no se completa solo: lo confirma un analista.
        if (esModeloDeMenorCapacidad(resultado.modelo)) {
          confianza = Math.min(confianza, 0.59);
          await registrarEvento(id, "analisis_con_modelo_de_menor_capacidad", "sistema", {
            modelo: resultado.modelo, efecto: "El expediente pasa a revisión manual en lugar de completarse automáticamente.",
          });
        }
        if (!respuestaTipo || confianza > respuestaTipo.confianza) {
          respuestaTipo = { tipo: r.tipo_reclamacion, confianza, evidencia: r.evidencia_relato, razon: r.razon_tipo };
        }

        for (const [i, d] of grupo.entries()) {
          const extraido = r.documentos.find((x) => x.indice === i);
          if (!extraido) {
            // El modelo omitió un archivo: no se asume nada, queda para revisión.
            await actualizarDocumento(d.id, { tipo_detectado: null, estado: "no_reconocido", motivo: null, datos_extraidos: null, confianza: null, cara: null, problemas: [], elementos_faltantes: [], alertas_analista: [] });
            continue;
          }
          const v = validarDocumento(extraido, rec);
          // Si lo que llegó no es lo de la casilla, se evalúa por lo que realmente es y se le explica a la persona
          const otraCasilla = d.tipo_declarado && extraido.tipo !== d.tipo_declarado && extraido.tipo !== "otro";
          const motivo = otraCasilla
            ? `Lo subió en "${NOMBRE_DOCUMENTO[d.tipo_declarado!]}", pero parece ser: ${NOMBRE_DOCUMENTO[extraido.tipo]}.${v.motivo ? " " + v.motivo : ""}`
            : v.motivo;
          await actualizarDocumento(d.id, {
            tipo_detectado: extraido.tipo === "otro" ? null : extraido.tipo,
            estado: v.estado,
            motivo,
            datos_extraidos: extraido,
            confianza: extraido.confianza,
            cara: extraido.cara,
            problemas: extraido.problemas,
            elementos_faltantes: extraido.elementos_faltantes,
            alertas_analista: v.alertasAnalista,
          });
          await registrarEvento(id, "documento_revisado", "ia", {
            documento_id: d.id, casilla: d.tipo_declarado, tipo: extraido.tipo, estado: v.estado, motivo,
            problemas: extraido.problemas, elementos_faltantes: extraido.elementos_faltantes,
            alertas_analista: v.alertasAnalista, confianza: extraido.confianza, observacion: extraido.observacion,
          });
          if (otraCasilla) {
            await registrarEvento(id, "documento_en_casilla_equivocada", "ia", { documento_id: d.id, casilla: d.tipo_declarado, detectado: extraido.tipo });
          }
        }
      }
    }

    // Clasificación: solo se actualiza la sugerencia; si una persona ya confirmó el tipo, manda la persona.
    if (respuestaTipo && !rec.tipo_final) {
      await db().from("reclamaciones").update({
        tipo_sugerido: respuestaTipo.tipo,
        tipo_confianza: Number(respuestaTipo.confianza.toFixed(2)),
        tipo_evidencia: `${respuestaTipo.razon}${respuestaTipo.evidencia ? ` · Cita: "${respuestaTipo.evidencia}"` : ""}`,
      }).eq("id", id);
      await registrarEvento(id, "tipo_sugerido", "ia", { ...respuestaTipo, tipo_preliminar: rec.tipo_preliminar });
      if (rec.tipo_preliminar && rec.tipo_preliminar !== respuestaTipo.tipo) {
        // El relato apuntaba a un tipo y los documentos a otro: queda a la vista del analista.
        await registrarEvento(id, "clasificacion_difiere_de_preliminar", "ia", {
          preliminar: rec.tipo_preliminar, modelo: respuestaTipo.tipo, razon: respuestaTipo.razon,
        });
      }
    }

    // Cruces entre documentos (fechas, nombres): alertas para el analista
    const { data: paraCruce } = await db().from("documentos").select("tipo_detectado, estado, datos_extraidos").eq("reclamacion_id", id);
    const alertasCruce = crucesEntreDocumentos((paraCruce ?? []) as DocParaCruce[], rec.asegurado_nombre);
    await db().from("reclamaciones").update({ intentos_ia: 0, ultimo_error_ia: null, alertas_cruce: alertasCruce }).eq("id", id);
    if (alertasCruce.length) await registrarEvento(id, "alertas_cruce_documentos", "sistema", { alertas: alertasCruce });
    await reevaluar(id, actor);
  } finally {
    await soltarCandado(id);
  }
}

async function actualizarDocumento(
  id: string,
  campos: {
    tipo_detectado: TipoDocumento | null; estado: EstadoDocumento; motivo: string | null; datos_extraidos: unknown; confianza: number | null;
    cara: string | null; problemas: string[]; elementos_faltantes: string[]; alertas_analista: string[];
  },
) {
  await db().from("documentos").update({ ...campos, revisado_at: new Date().toISOString() }).eq("id", id);
}

async function manejarFalloIA(rec: Reclamacion, mensaje: string) {
  const intentos = rec.intentos_ia + 1;
  const agotado = intentos >= MAX_INTENTOS_IA;
  await db().from("reclamaciones").update({
    intentos_ia: intentos,
    ultimo_error_ia: mensaje.slice(0, 500),
    ...(agotado ? { estado: "revision_manual" } : {}),
  }).eq("id", rec.id);
  await registrarEvento(rec.id, agotado ? "ia_agotada_revision_manual" : "ia_fallo_reintento", "sistema", { intentos, error: mensaje });

  if (agotado) {
    await encolarNotificacion({
      reclamacionId: rec.id, destinatario: "analistas", canal: "email", tipo: "ia_no_disponible",
      llave: `ia_agotada:${rec.id}:${Date.now()}`,
      asunto: `Caso ${rec.radicado} requiere revisión manual`,
      cuerpo: `El caso ${rec.radicado} no pudo ser analizado por el modelo después de ${intentos} intentos (${mensaje.slice(0, 160)}).

Pasó a revisión manual: un analista debe revisar sus documentos o reintentar el análisis desde el panel.`,
    });
  }
}

/**
 * Recalcula el estado del expediente sin llamar al modelo. Se usa después del
 * análisis, cuando un analista confirma el tipo o corrige un documento.
 */
export async function reevaluar(id: string, actor: string): Promise<void> {
  const { rec, docs } = await cargarCaso(id);
  if (rec.estado === "cerrado") return;

  const { data: fresca } = await db()
    .from("reclamaciones")
    .select("tipo_sugerido, tipo_confianza, tipo_final, completo_at, primera_respuesta_at, estado, radicado, beneficiario_nombre, beneficiario_email")
    .eq("id", id)
    .single();
  if (!fresca) return;

  const tipo = (fresca.tipo_final ?? fresca.tipo_sugerido) as TipoReclamacion | null;
  if (!tipo) return;

  const evaluacion = evaluarExpediente(tipo, docs);
  const tipoSeguro = !!fresca.tipo_final || Number(fresca.tipo_confianza ?? 0) >= CONFIANZA_MINIMA_TIPO;
  const hayPendientes = docs.some((d) => d.estado === "pendiente_revision");

  let nuevoEstado: string;
  const cambios: Record<string, unknown> = {};

  if (evaluacion.completo && tipoSeguro) {
    nuevoEstado = "completo";
    if (!fresca.completo_at) {
      // Criterio conservador: el plazo corre desde que llegó el último documento
      // válido, no desde que el sistema o la persona lo confirmó.
      cambios.completo_at = evaluacion.completoDesde;
    }
  } else if (!tipoSeguro || hayPendientes) {
    nuevoEstado = "revision_manual";
  } else {
    nuevoEstado = "incompleto";
  }
  // Si el reloj ya arrancó, el caso nunca vuelve a "sin reloj": queda completo
  // aunque el analista pida documentos adicionales.
  if (fresca.completo_at && nuevoEstado !== "completo") nuevoEstado = "completo";

  cambios.estado = nuevoEstado;

  // Respuesta al beneficiario: si el tipo es incierto pero el expediente está
  // incompleto, igual se le dice lo que falta según el tipo más probable.
  const debeResponder = !hayPendientes && (tipoSeguro || !evaluacion.completo);
  const primeraVez = debeResponder && !fresca.primera_respuesta_at;
  if (primeraVez) cambios.primera_respuesta_at = new Date().toISOString();

  await db().from("reclamaciones").update(cambios).eq("id", id);

  if (fresca.estado !== nuevoEstado) {
    await registrarEvento(id, "estado_cambiado", actor, { de: fresca.estado, a: nuevoEstado, tipo, tipo_seguro: tipoSeguro });
  }
  if (cambios.completo_at) {
    await registrarEvento(id, "reloj_iniciado", actor, {
      completo_at: cambios.completo_at,
      regla: "Art. 1080 C. Co.: un mes desde que el expediente quedó completo",
    });
  }

  if (debeResponder) {
    const { asunto, cuerpo } = resumenParaBeneficiario(fresca.radicado, evaluacion, fresca.beneficiario_nombre);
    // La llave incluye la "foto" del checklist: si nada cambió, no se repite el mensaje.
    const foto = evaluacion.checklist.map((i) => `${i.tipo}:${i.situacion}`).join("|");
    const llave = `estado_expediente:${id}:${hashCorto(foto)}`;
    await encolarNotificacion({ reclamacionId: id, destinatario: "beneficiario", canal: "email", tipo: "estado_expediente", llave, asunto, cuerpo });
    if (primeraVez) {
      await registrarEvento(id, "primera_respuesta_beneficiario", "sistema", { asunto, faltantes: evaluacion.checklist.filter((i) => i.situacion !== "recibido_valido").map((i) => i.tipo) });
    }
  }
}

function hashCorto(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function encolarNotificacion(n: {
  reclamacionId: string | null;
  destinatario: "beneficiario" | "analistas";
  canal: "email" | "seguimiento_web";
  tipo: string;
  llave: string;
  asunto: string;
  cuerpo: string;
}) {
  const { error } = await db().from("notificaciones").insert({
    reclamacion_id: n.reclamacionId, destinatario: n.destinatario, canal: n.canal, tipo: n.tipo,
    llave_unica: n.llave, asunto: n.asunto, cuerpo: n.cuerpo,
  });
  if (error && !error.message.includes("duplicate")) console.error("[notificaciones]", error.message);
}
