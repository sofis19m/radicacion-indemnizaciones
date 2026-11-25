"use client";

import { useActionState, useState } from "react";
import { confirmarTipo, corregirDocumento, registrarDecision, reintentarAnalisis, type ResultadoAccion } from "@/app/panel/acciones";
import { NOMBRE_DOCUMENTO, NOMBRE_TIPO_RECLAMACION, TIPOS_DOCUMENTO, TIPOS_RECLAMACION, type TipoReclamacion } from "@/lib/dominio";

function Resultado({ r }: { r: ResultadoAccion | null }) {
  if (!r) return null;
  return <p className={`mt-2 text-sm ${r.ok ? "text-green-700" : "text-red-600"}`}>{r.mensaje}</p>;
}

export function FormTipo({ id, sugerido, final }: { id: string; sugerido: TipoReclamacion | null; final: TipoReclamacion | null }) {
  const [r, accion, pendiente] = useActionState(confirmarTipo, null);
  return (
    <form action={accion} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <select name="tipo" defaultValue={final ?? sugerido ?? "muerte_natural"} className="campo !w-auto !py-1.5 text-sm">
        {TIPOS_RECLAMACION.map((t) => <option key={t} value={t}>{NOMBRE_TIPO_RECLAMACION[t]}</option>)}
      </select>
      <button className="boton-sec" disabled={pendiente}>{final ? "Cambiar tipo" : "Confirmar tipo"}</button>
      <Resultado r={r} />
    </form>
  );
}

export function FormDocumento({ id, reclamacionId, tipo, estado }: { id: string; reclamacionId: string; tipo: string | null; estado: string }) {
  const [abierto, setAbierto] = useState(false);
  const [r, accion, pendiente] = useActionState(corregirDocumento, null);
  if (!abierto) return <button className="text-xs text-marca hover:underline" onClick={() => setAbierto(true)}>Corregir</button>;
  return (
    <form action={accion} className="mt-2 grid gap-2 rounded-lg bg-gray-50 p-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="reclamacion_id" value={reclamacionId} />
      <select name="tipo" defaultValue={tipo ?? "otro"} className="campo !py-1.5 text-sm">
        {TIPOS_DOCUMENTO.map((t) => <option key={t} value={t}>{NOMBRE_DOCUMENTO[t]}</option>)}
      </select>
      <select name="estado" defaultValue={estado === "pendiente_revision" ? "valido" : estado} className="campo !py-1.5 text-sm">
        <option value="valido">Válido</option>
        <option value="sin_firma">Sin firma</option>
        <option value="ilegible">Ilegible</option>
        <option value="no_corresponde">No corresponde</option>
        <option value="vencido_o_incompleto">Vencido o incompleto</option>
        <option value="no_reconocido">No reconocido</option>
      </select>
      <input name="motivo" placeholder="Nota para el beneficiario (opcional)" className="campo !py-1.5 text-sm sm:col-span-2" />
      <div className="flex gap-2 sm:col-span-2">
        <button className="boton-sec" disabled={pendiente}>Guardar corrección</button>
        <button type="button" className="text-sm text-gray-500" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      <Resultado r={r} />
    </form>
  );
}

export function FormDecision({ id, puedePagar, tipoConfirmado }: { id: string; puedePagar: boolean; tipoConfirmado: boolean }) {
  const [decision, setDecision] = useState<"pagar" | "objetar" | "pedir_documentos">("pedir_documentos");
  const [r, accion, pendiente] = useActionState(registrarDecision, null);
  return (
    <form
      action={accion}
      className="space-y-3"
      onSubmit={(e) => {
        if (decision !== "pedir_documentos" && !confirm(`¿Confirma que decide ${decision.toUpperCase()} este caso? La decisión queda registrada a su nombre.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-3 gap-2">
        {([
          ["pedir_documentos", "Pedir documentos"],
          ["pagar", "Pagar"],
          ["objetar", "Objetar"],
        ] as const).map(([v, t]) => (
          <label key={v} className={`cursor-pointer rounded-lg border px-2 py-2 text-center text-sm font-medium ${decision === v ? "border-marca bg-marca-claro text-marca" : "border-gray-200"}`}>
            <input type="radio" name="decision" value={v} className="sr-only" checked={decision === v} onChange={() => setDecision(v)} />
            {t}
          </label>
        ))}
      </div>
      {decision === "pedir_documentos" && (
        <fieldset className="grid gap-1 text-sm sm:grid-cols-2">
          {TIPOS_DOCUMENTO.filter((t) => t !== "otro").map((t) => (
            <label key={t} className="flex items-start gap-2"><input type="checkbox" name="documentos" value={t} className="mt-1" />{NOMBRE_DOCUMENTO[t]}</label>
          ))}
        </fieldset>
      )}
      {decision === "pagar" && !puedePagar && <p className="text-sm text-amber-700">El expediente no está completo: no se puede aprobar el pago.</p>}
      {decision !== "pedir_documentos" && !tipoConfirmado && <p className="text-sm text-amber-700">Primero confirme o corrija el tipo de reclamación.</p>}
      <textarea name="justificacion" rows={3} className="campo text-sm" placeholder="Justificación (queda en el expediente)" required minLength={10} />
      <button className="boton w-full" disabled={pendiente}>{pendiente ? "Registrando…" : "Registrar decisión"}</button>
      <Resultado r={r} />
    </form>
  );
}

export function FormReintentar({ id }: { id: string }) {
  const [r, accion, pendiente] = useActionState(reintentarAnalisis, null);
  return (
    <form action={accion}>
      <input type="hidden" name="id" value={id} />
      <button className="boton-sec" disabled={pendiente}>{pendiente ? "Analizando…" : "Reintentar análisis con IA"}</button>
      <Resultado r={r} />
    </form>
  );
}
