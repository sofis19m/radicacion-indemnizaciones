"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SubirPorCasillas, { aplanar, MAX_ARCHIVOS, validarEnCliente, type ArchivosPorCasilla } from "./SubirPorCasillas";
import { metaDe, subirYConfirmar } from "@/lib/subirArchivos";
import type { TipoDocumento } from "@/lib/dominio";

/**
 * Subir documentos desde el enlace de seguimiento. Muestra primero las casillas
 * que faltan o que hay que corregir, cada una con su problema concreto.
 */
export default function SubirMas({ token, pendientes, estados }: { token: string; pendientes: string[]; estados: Record<string, string> }) {
  const router = useRouter();
  const [archivos, setArchivos] = useState<ArchivosPorCasilla>({});
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const lista = aplanar(archivos);

  async function enviar() {
    setError(null);
    const errores = validarEnCliente(lista.map((x) => x.file));
    if (lista.length > MAX_ARCHIVOS) errores.push(`Máximo ${MAX_ARCHIVOS} archivos por envío.`);
    if (errores.length) return setError(errores.join(" "));
    setEnviando(true);
    try {
      const res = await fetch(`/api/seguimiento/${token}/cupos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivos: metaDe(lista) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const r = await subirYConfirmar(lista.map((x) => x.file), json, (h, t) => setEstado(`Subiendo ${h} de ${t}…`));
      setArchivos({});
      const partes = [`Recibimos ${r.aceptados} documento(s). En un momento verá aquí el resultado de la revisión.`];
      if (r.duplicados) partes.push(`${r.duplicados} ya los teníamos, así que no los repetimos.`);
      if (r.rechazados.length) partes.push(r.rechazados.join(" "));
      setEstado(partes.join(" "));
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "No pudimos enviar los archivos.");
      setEstado(null);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <SubirPorCasillas valor={archivos} onChange={setArchivos} recomendados={pendientes.length ? (pendientes as TipoDocumento[]) : null}
        textoRecomendados="Estos son los documentos que nos faltan o que hay que corregir." avisos={estados} />
      {lista.length > 0 && (
        <button className="btn primary" onClick={enviar} disabled={enviando}>
          {enviando ? estado ?? "Enviando…" : `Enviar ${lista.length} documento(s)`}
        </button>
      )}
      {!enviando && estado && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{estado}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
