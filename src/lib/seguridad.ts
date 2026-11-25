import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";

export const LIMITES = {
  bytesPorArchivo: 10 * 1024 * 1024,
  archivosPorEnvio: 15,
  enviosPorIpPorHora: 10,
  mimesPermitidos: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
};

export function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function nuevoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export function hashIp(ip: string): string {
  return sha256(`${env.hashSalt}:${ip}`);
}

export function compararSecreto(recibido: string | null, esperado: string): boolean {
  if (!recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Valida un archivo por su contenido real (magic bytes), no por la extensión
 * ni el Content-Type que manda el navegador, que el remitente controla.
 */
export async function validarArchivo(file: File): Promise<
  { ok: true; buffer: Buffer; mime: string } | { ok: false; motivo: string }
> {
  if (file.size === 0) return { ok: false, motivo: `"${file.name}" está vacío.` };
  if (file.size > LIMITES.bytesPorArchivo) return { ok: false, motivo: `"${file.name}" supera 10 MB.` };
  const buffer = Buffer.from(await file.arrayBuffer());
  const tipo = await fileTypeFromBuffer(buffer);
  if (!tipo || !LIMITES.mimesPermitidos.includes(tipo.mime)) {
    return { ok: false, motivo: `"${file.name}" no es un PDF ni una imagen (JPG, PNG, WEBP).` };
  }
  return { ok: true, buffer, mime: tipo.mime };
}

/** Límite simple de envíos por IP y por hora, guardado en la base (sirve entre instancias serverless). */
export async function permitirEnvio(ip: string): Promise<boolean> {
  const ventana = new Date();
  ventana.setMinutes(0, 0, 0);
  const ipHash = hashIp(ip);
  const { data } = await db()
    .from("limites_ip")
    .select("conteo")
    .eq("ip_hash", ipHash)
    .eq("ventana", ventana.toISOString())
    .maybeSingle();
  if (data && data.conteo >= LIMITES.enviosPorIpPorHora) return false;
  await db()
    .from("limites_ip")
    .upsert({ ip_hash: ipHash, ventana: ventana.toISOString(), conteo: (data?.conteo ?? 0) + 1 });
  return true;
}

export function ipDe(req: Request): string {
  // En Vercel, x-vercel-forwarded-for / x-real-ip los fija la plataforma (el cliente no los controla).
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "desconocida"
  );
}

/** Nombre de archivo seguro para mostrar/guardar como metadato (nunca se usa como ruta). */
export function nombreSeguro(nombre: string): string {
  return nombre.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "archivo";
}
