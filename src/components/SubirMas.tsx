"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SelectorArchivos, { validarEnCliente } from "./SelectorArchivos";
import { metaDe, subirYConfirmar } from "@/lib/subirArchivos";

export default function SubirMas({ token }: { token: string }) {
  const router = useRouter();
  const [archivos, setArchivos] = useState<File[]>([]);
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setError(null);
    const errores = validarEnCliente(archivos);
    if (errores.length) return setError(errores.join(" "));
    setEnviando(true);
    try {
      const res = await fetch(`/api/seguimiento/${token}/cupos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivos: metaDe(archivos) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const r = await subirYConfirmar(archivos, json, (h, t) => setEstado(`Subiendo ${h} de ${t}…`));
      setArchivos([]);
      const partes = [`Recibimos ${r.aceptados} documento(s).`];
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
    <div className="space-y-3">
      <SelectorArchivos archivos={archivos} onChange={setArchivos} />
      {archivos.length > 0 && (
        <button className="boton w-full" onClick={enviar} disabled={enviando}>
          {enviando ? estado ?? "Enviando…" : `Enviar ${archivos.length} documento(s)`}
        </button>
      )}
      {!enviando && estado && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{estado}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
