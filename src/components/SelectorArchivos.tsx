"use client";

import { useRef } from "react";

const MAX_MB = 10;
const TIPOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export function validarEnCliente(files: File[]): string[] {
  const errores: string[] = [];
  for (const f of files) {
    if (!TIPOS.includes(f.type)) errores.push(`"${f.name}": solo se aceptan PDF o fotos (JPG, PNG).`);
    else if (f.size > MAX_MB * 1024 * 1024) errores.push(`"${f.name}" pesa más de ${MAX_MB} MB.`);
  }
  return errores;
}

export default function SelectorArchivos({ archivos, onChange }: { archivos: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);

  function agregar(nuevos: FileList | null) {
    if (!nuevos) return;
    const lista = [...archivos];
    for (const f of Array.from(nuevos)) {
      if (!lista.some((x) => x.name === f.name && x.size === f.size)) lista.push(f);
    }
    onChange(lista.slice(0, 15));
    if (input.current) input.current.value = "";
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-gray-300 bg-white px-4 py-6 text-center transition hover:border-marca"
      >
        <span className="text-base font-semibold text-marca">Agregar documentos</span>
        <span className="mt-1 text-sm text-gray-500">PDF o fotos · hasta 10 MB cada uno · máximo 15</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => agregar(e.target.files)}
      />
      {archivos.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {archivos.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="truncate">{f.name}</span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-gray-400">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                <button type="button" onClick={() => onChange(archivos.filter((_, j) => j !== i))} className="text-red-600 hover:underline" aria-label={`Quitar ${f.name}`}>
                  Quitar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
