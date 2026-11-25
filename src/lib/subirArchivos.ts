"use client";

import { createClient } from "@supabase/supabase-js";

export type Cupo = { carga_id: string; path: string; token: string; nombre: string };
export type RespuestaCupos = { lote: string; secreto: string; cupos: Cupo[] };

let cliente: ReturnType<typeof createClient> | null = null;
function storage() {
  // Llave pública (anon): no da acceso a ninguna tabla ni a leer archivos.
  // Solo sirve aquí para usar URLs de subida firmadas por el servidor.
  cliente ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  return cliente.storage.from("documentos");
}

/** Metadatos que se anuncian al servidor: nombre, tipo, tamaño y casilla de cada archivo. */
export function metaDe(items: { file: File; casilla: string }[]) {
  return items.map(({ file, casilla }) => ({
    nombre: file.name,
    mime: file.type,
    bytes: file.size,
    tipo_declarado: casilla === "otros" ? null : casilla,
  }));
}

/** Sube cada archivo a su URL firmada y luego pide al servidor confirmarlos. */
export async function subirYConfirmar(
  files: File[],
  { lote, secreto, cupos }: RespuestaCupos,
  onProgreso?: (hechos: number, total: number) => void,
): Promise<{ aceptados: number; duplicados: number; rechazados: string[] }> {
  let hechos = 0;
  const fallidos: string[] = [];
  await Promise.all(
    cupos.map(async (c, i) => {
      const { error } = await storage().uploadToSignedUrl(c.path, c.token, files[i], { contentType: files[i].type });
      if (error) fallidos.push(`"${c.nombre}" no se pudo subir.`);
      onProgreso?.(++hechos, cupos.length);
    }),
  );
  const res = await fetch("/api/cargas/confirmar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lote, secreto }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "No pudimos confirmar los archivos.");
  return { aceptados: json.aceptados, duplicados: json.duplicados, rechazados: [...fallidos, ...json.rechazados] };
}
