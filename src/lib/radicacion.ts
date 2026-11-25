import "server-only";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { db } from "@/lib/supabase/admin";
import { registrarEvento } from "@/lib/eventos";
import { LIMITES, nombreSeguro, nuevoToken, sha256 } from "@/lib/seguridad";
import { TIPOS_DOCUMENTO } from "@/lib/dominio";

const documentoId = z.string().trim().regex(/^[0-9A-Za-z.\- ]{4,20}$/, "Número de documento no válido");

export const MetaArchivo = z.object({
  nombre: z.string().min(1).max(200),
  /** Casilla donde el beneficiario subió el archivo (null = "otros documentos"). */
  tipo_declarado: z.enum(TIPOS_DOCUMENTO).nullable().optional(),
  mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"], { message: "Solo PDF o imágenes JPG/PNG/WEBP" }),
  bytes: z.number().int().positive().max(LIMITES.bytesPorArchivo, "Cada archivo debe pesar máximo 10 MB"),
});

export const DatosRadicacion = z.object({
  beneficiario_nombre: z.string().trim().min(3, "Escriba su nombre completo").max(120),
  beneficiario_tipo_doc: z.enum(["CC", "TI", "RC", "CE", "PA", "PPT"]),
  beneficiario_documento: documentoId,
  beneficiario_email: z.string().trim().toLowerCase().email("Correo no válido").max(160),
  beneficiario_telefono: z.string().trim().regex(/^[0-9+ ()-]{7,20}$/, "Teléfono no válido").optional().or(z.literal("")),
  parentesco: z.string().trim().max(60).optional().or(z.literal("")),
  asegurado_nombre: z.string().trim().min(3, "Escriba el nombre de la persona asegurada").max(120),
  asegurado_documento: documentoId,
  relato: z.string().trim().min(20, "Cuéntenos un poco más de lo que pasó (mínimo 20 caracteres)").max(4000),
  consentimiento: z.literal(true, { message: "Debe autorizar el tratamiento de datos para continuar" }),
  idempotency_key: z.string().uuid(),
  sitio_web: z.string().optional(), // trampa para bots
  /** Lo que indicó en "¿Qué ocurrió?". Organiza el formulario; no es la clasificación oficial. */
  situacion_declarada: z.enum(["fallecimiento", "accidente", "incapacidad"]).nullable().optional(),
  archivos: z.array(MetaArchivo).min(1, "Adjunte al menos un documento.").max(LIMITES.archivosPorEnvio, `Máximo ${LIMITES.archivosPorEnvio} archivos por envío.`),
});
export type DatosRadicacion = z.infer<typeof DatosRadicacion>;

export const ConfirmacionLote = z.object({ lote: z.string().uuid(), secreto: z.string().min(20).max(100) });

export function normalizarNumero(v: string) {
  return v.replace(/\D/g, "") || v.trim();
}

export type Cupo = { carga_id: string; path: string; token: string; nombre: string };

/** Crea URLs firmadas de subida (una por archivo) hacia la zona de cuarentena. */
export async function crearCupos(reclamacionId: string, archivos: z.infer<typeof MetaArchivo>[]) {
  const lote = randomUUID();
  const { token: secreto, hash } = nuevoToken();
  const cupos: Cupo[] = [];
  for (const a of archivos) {
    const path = `entrantes/${lote}/${randomUUID()}`;
    const { data, error } = await db().storage.from("documentos").createSignedUploadUrl(path);
    if (error || !data) throw new Error(`No se pudo preparar la carga: ${error?.message}`);
    const { data: carga, error: e2 } = await db()
      .from("cargas")
      .insert({ reclamacion_id: reclamacionId, lote, secreto_hash: hash, storage_path: path, nombre_original: nombreSeguro(a.nombre), tipo_declarado: a.tipo_declarado === "otro" ? null : a.tipo_declarado ?? null })
      .select("id")
      .single();
    if (e2) throw new Error(e2.message);
    cupos.push({ carga_id: carga.id, path, token: data.token, nombre: a.nombre });
  }
  return { lote, secreto, cupos };
}

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Confirma un lote de cargas: valida cada archivo por su contenido real, descarta
 * duplicados (mismo SHA-256 ya presente en el caso) y lo convierte en documento.
 */
export async function confirmarLote(lote: string, secreto: string, actor: string) {
  const { data: cargas } = await db().from("cargas").select("*").eq("lote", lote).eq("estado", "pendiente");
  if (!cargas?.length) return { ok: false as const, error: "No hay cargas pendientes para este envío." };
  if (cargas[0].secreto_hash !== sha256(secreto)) return { ok: false as const, error: "Envío no autorizado." };

  const reclamacionId = cargas[0].reclamacion_id as string;
  const resultado = { aceptados: 0, duplicados: 0, rechazados: [] as string[] };

  for (const c of cargas) {
    const { data: blob, error } = await db().storage.from("documentos").download(c.storage_path);
    if (error || !blob) {
      await db().from("cargas").update({ estado: "rechazada", motivo_rechazo: "El archivo no llegó" }).eq("id", c.id);
      resultado.rechazados.push(`"${c.nombre_original}" no terminó de subir.`);
      continue;
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    const tipo = await fileTypeFromBuffer(buffer);
    if (!tipo || !LIMITES.mimesPermitidos.includes(tipo.mime) || buffer.length > LIMITES.bytesPorArchivo) {
      await db().storage.from("documentos").remove([c.storage_path]);
      await db().from("cargas").update({ estado: "rechazada", motivo_rechazo: `Tipo real: ${tipo?.mime ?? "desconocido"}` }).eq("id", c.id);
      await registrarEvento(reclamacionId, "archivo_rechazado", "sistema", { nombre: c.nombre_original, tipo_real: tipo?.mime ?? null, bytes: buffer.length });
      resultado.rechazados.push(`"${c.nombre_original}" no es un PDF ni una imagen válida.`);
      continue;
    }

    const hash = sha256(buffer);
    const { data: existente } = await db().from("documentos").select("id").eq("reclamacion_id", reclamacionId).eq("sha256", hash).maybeSingle();
    if (existente) {
      await db().storage.from("documentos").remove([c.storage_path]);
      await db().from("cargas").update({ estado: "duplicada", documento_id: existente.id }).eq("id", c.id);
      await registrarEvento(reclamacionId, "documento_duplicado_ignorado", actor, { sha256: hash, nombre: c.nombre_original, documento_existente: existente.id });
      resultado.duplicados++;
      continue;
    }

    const destino = `${reclamacionId}/${hash}.${EXT[tipo.mime]}`;
    const { error: errMove } = await db().storage.from("documentos").move(c.storage_path, destino);
    if (errMove && !/exists/i.test(errMove.message)) throw new Error(`No se pudo mover el archivo: ${errMove.message}`);

    const { data: doc, error: errDoc } = await db()
      .from("documentos")
      .insert({ reclamacion_id: reclamacionId, sha256: hash, storage_path: destino, nombre_original: c.nombre_original, mime: tipo.mime, bytes: buffer.length, tipo_declarado: c.tipo_declarado })
      .select("id")
      .single();
    if (errDoc) {
      if (errDoc.code === "23505") {
        // Dos archivos idénticos en el mismo envío o dos envíos simultáneos
        await db().from("cargas").update({ estado: "duplicada" }).eq("id", c.id);
        resultado.duplicados++;
        continue;
      }
      throw new Error(errDoc.message);
    }
    await db().from("cargas").update({ estado: "aceptada", documento_id: doc.id }).eq("id", c.id);
    await registrarEvento(reclamacionId, "documento_recibido", actor, { documento_id: doc.id, casilla: c.tipo_declarado, sha256: hash, nombre: c.nombre_original, mime: tipo.mime, bytes: buffer.length });
    resultado.aceptados++;
  }

  if (resultado.aceptados > 0) {
    // Hay algo nuevo que revisar: si el caso estaba "incompleto", vuelve a la fila del motor.
    await db().from("reclamaciones").update({ estado: "recibido" }).eq("id", reclamacionId).eq("estado", "incompleto");
  }
  return { ok: true as const, reclamacionId, ...resultado };
}

export async function reclamacionPorToken(token: string) {
  const { data: enlace } = await db()
    .from("enlaces_seguimiento")
    .select("reclamacion_id, expira_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!enlace || new Date(enlace.expira_at) < new Date()) return null;
  return enlace.reclamacion_id as string;
}
