"use client";

import { useRef } from "react";
import { GRUPOS_CASILLAS, OTROS, type Casilla, type ClaveCasilla } from "@/lib/casillas";

const MAX_MB = 10;
const TIPOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const MAX_ARCHIVOS = 15;

export type ArchivosPorCasilla = Partial<Record<ClaveCasilla, File[]>>;

export function totalArchivos(a: ArchivosPorCasilla) {
  return Object.values(a).reduce((n, l) => n + (l?.length ?? 0), 0);
}

/** Lista plana (archivo + casilla), en el orden en que se suben. */
export function aplanar(a: ArchivosPorCasilla): { file: File; casilla: ClaveCasilla }[] {
  return (Object.entries(a) as [ClaveCasilla, File[]][]).flatMap(([casilla, files]) => files.map((file) => ({ file, casilla })));
}

export function validarEnCliente(files: File[]): string[] {
  const errores: string[] = [];
  for (const f of files) {
    if (!TIPOS.includes(f.type)) errores.push(`"${f.name}": solo se aceptan PDF o fotos (JPG, PNG).`);
    else if (f.size > MAX_MB * 1024 * 1024) errores.push(`"${f.name}" pesa más de ${MAX_MB} MB.`);
  }
  return errores;
}

function FilaCasilla({
  casilla, archivos, onChange, destacada, estadoActual,
}: {
  casilla: Casilla | { tipo: typeof OTROS; titulo: string; ayuda: string; variasFotos: true };
  archivos: File[];
  onChange: (f: File[]) => void;
  destacada?: boolean;
  estadoActual?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const tiene = archivos.length > 0;

  function agregar(lista: FileList | null) {
    if (!lista) return;
    const nuevos = [...archivos];
    for (const f of Array.from(lista)) if (!nuevos.some((x) => x.name === f.name && x.size === f.size)) nuevos.push(f);
    onChange(nuevos);
    if (input.current) input.current.value = "";
  }

  return (
    <div className={`rounded-xl border p-3 transition ${tiene ? "border-green-300 bg-green-50/60" : destacada ? "border-amber-300 bg-amber-50/60" : "border-gray-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">
            {tiene && <span className="mr-1" aria-hidden>✅</span>}
            {casilla.titulo}
          </p>
          <p className="text-sm text-gray-500">{casilla.ayuda}</p>
          {estadoActual && <p className="mt-1 text-sm text-amber-800">{estadoActual}</p>}
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="shrink-0 rounded-lg border border-marca px-3 py-1.5 text-sm font-semibold text-marca hover:bg-marca-claro"
          aria-label={`Agregar archivo en ${casilla.titulo}`}
        >
          {tiene ? "+ Otra" : "Agregar"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        multiple={casilla.variasFotos ?? true}
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => agregar(e.target.files)}
      />
      {tiene && (
        <ul className="mt-2 space-y-1">
          {archivos.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1 text-sm ring-1 ring-gray-100">
              <span className="truncate">📄 {f.name}</span>
              <button type="button" className="shrink-0 text-red-600 hover:underline" onClick={() => onChange(archivos.filter((_, j) => j !== i))} aria-label={`Quitar ${f.name}`}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Carga por casillas: una por documento. El sistema sabe en qué casilla se subió
 * cada archivo (no hay que renombrar nada) y verifica que sea lo que dice ser.
 */
export default function SubirPorCasillas({
  valor, onChange, pendientes, estados,
}: {
  valor: ArchivosPorCasilla;
  onChange: (v: ArchivosPorCasilla) => void;
  /** Casillas que faltan en el expediente (en el seguimiento se muestran primero). */
  pendientes?: string[];
  /** Mensaje del estado actual de cada casilla (p. ej. "Llegó sin firma"). */
  estados?: Record<string, string>;
}) {
  const set = (clave: ClaveCasilla, files: File[]) => onChange({ ...valor, [clave]: files });
  const grupos = pendientes
    ? [
        { id: "pendientes", titulo: "Lo que nos falta", descripcion: "", casillas: GRUPOS_CASILLAS.flatMap((g) => g.casillas).filter((c) => pendientes.includes(c.tipo)) },
      ]
    : GRUPOS_CASILLAS;

  return (
    <div className="space-y-5">
      {grupos.map((g) => (
        <section key={g.id}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{g.titulo}</h3>
          {g.descripcion && <p className="text-sm text-gray-500">{g.descripcion}</p>}
          <div className="mt-2 grid gap-2">
            {g.casillas.map((c) => (
              <FilaCasilla key={c.tipo} casilla={c} archivos={valor[c.tipo] ?? []} onChange={(f) => set(c.tipo, f)} destacada={!!pendientes} estadoActual={estados?.[c.tipo]} />
            ))}
          </div>
        </section>
      ))}
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{pendientes ? "¿Algo más?" : "Otros"}</h3>
        <div className="mt-2">
          <FilaCasilla
            casilla={{ tipo: OTROS, titulo: "Otros documentos", ayuda: "Si no sabe en qué casilla va, súbalo aquí: nosotros lo identificamos.", variasFotos: true }}
            archivos={valor[OTROS] ?? []}
            onChange={(f) => set(OTROS, f)}
          />
        </div>
      </section>
    </div>
  );
}
