"use client";

import { useRef, useState } from "react";
import { GRUPOS_CASILLAS, OTROS, type Casilla, type ClaveCasilla, type Situacion } from "@/lib/casillas";
import type { TipoDocumento } from "@/lib/dominio";
import { IcoCheck, IcoDoc, IcoInfo, IcoX } from "./Iconos";

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

type CasillaVista = Casilla | { tipo: typeof OTROS; titulo: string; ayuda: string; variasFotos: true };

function FilaCasilla({
  casilla, archivos, onChange, aviso, onLimite, disponibles,
}: {
  casilla: CasillaVista;
  archivos: File[];
  onChange: (f: File[]) => void;
  aviso?: string;
  onLimite: () => void;
  disponibles: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const varias = casilla.variasFotos ?? false;
  const tiene = archivos.length > 0;

  function agregar(lista: FileList | null) {
    if (!lista?.length) return;
    let nuevos = Array.from(lista);
    if (!varias) nuevos = nuevos.slice(0, 1);
    const cupo = disponibles + (varias ? 0 : archivos.length);
    if (cupo <= 0) return onLimite();
    nuevos = nuevos.slice(0, cupo);
    const base = varias ? archivos.filter((x) => !nuevos.some((n) => n.name === x.name && n.size === x.size)) : [];
    onChange([...base, ...nuevos]);
    if (input.current) input.current.value = "";
  }

  return (
    <div
      className={`doc ${tiene ? "has" : aviso ? "pend" : ""} ${arrastrando ? "drag" : ""}`}
      onDragEnter={(e) => { e.preventDefault(); setArrastrando(true); }}
      onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
      onDragLeave={(e) => { e.preventDefault(); setArrastrando(false); }}
      onDrop={(e) => { e.preventDefault(); setArrastrando(false); agregar(e.dataTransfer.files); }}
    >
      <span className="st">{tiene ? <IcoCheck /> : <IcoDoc />}</span>
      <div className="tx">
        <b>{casilla.titulo}</b>
        <span>{casilla.ayuda}</span>
        {aviso && !tiene && <span className="aviso">{aviso}</span>}
        {tiene && (
          <div className="files">
            {archivos.map((f, i) => (
              <span className="file" key={`${f.name}-${i}`}>
                <span title={f.name}>{f.name}</span>
                <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => onChange(archivos.filter((_, j) => j !== i))}><IcoX /></button>
              </span>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="add" onClick={() => input.current?.click()}>
        {tiene ? (varias ? "Agregar otro" : "Cambiar") : "Agregar"}
      </button>
      <input ref={input} type="file" hidden multiple={varias} accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => agregar(e.target.files)} />
    </div>
  );
}

/**
 * Carga por casillas: una por documento. El sistema sabe en qué casilla se subió
 * cada archivo (no hay que renombrar nada) y verifica que sea lo que dice ser.
 *
 * - recomendados: tipos de documento que se muestran primero (deducidos del relato,
 *   o los que faltan en el seguimiento). Las demás casillas quedan detrás de
 *   "Ver todas las casillas", salvo que ya tengan archivos.
 * - soyAsegurado: quien reclama es el propio asegurado (un solo documento de identidad).
 */
export default function SubirPorCasillas({
  valor, onChange, recomendados, textoRecomendados, avisos, soyAsegurado, onLimite, situacion,
}: {
  /**
   * Formulario de radicación: lo que la persona eligió en "¿Qué ocurrió?".
   * null = aún no ha elegido (se muestra la indicación); undefined = no aplica (seguimiento).
   */
  situacion?: Situacion | null;
  valor: ArchivosPorCasilla;
  onChange: (v: ArchivosPorCasilla) => void;
  recomendados?: TipoDocumento[] | null;
  textoRecomendados?: string;
  avisos?: Record<string, string>;
  soyAsegurado?: boolean;
  onLimite?: () => void;
}) {
  const [verTodas, setVerTodas] = useState(false);
  const set = (clave: ClaveCasilla, files: File[]) => onChange({ ...valor, [clave]: files });
  const disponibles = MAX_ARCHIVOS - totalArchivos(valor);

  const ajustar = (c: Casilla): Casilla | null => {
    if (!soyAsegurado) return c;
    // Si reclama el propio asegurado, basta un documento de identidad (el del asegurado)
    if (c.tipo === "documento_identidad_beneficiario") return null;
    if (c.tipo === "documento_identidad_asegurado") return { ...c, titulo: "Su documento de identidad", ayuda: "Usted es la persona asegurada. Por ambas caras." };
    return c;
  };

  // Formulario: aún no se ha elegido qué ocurrió → solo la indicación
  if (situacion === null) {
    return (
      <div className="hint fade">
        <IcoInfo />
        <span>Elija arriba qué ocurrió y aquí aparecerán únicamente los documentos que corresponden a su caso.</span>
      </div>
    );
  }

  const porSituacion = situacion !== undefined;
  const filtrar = porSituacion || (!!recomendados?.length && !verTodas);
  const aplica = (c: Casilla) =>
    porSituacion ? !c.situaciones || c.situaciones.includes(situacion!) : recomendados!.includes(c.tipo);
  const grupos = GRUPOS_CASILLAS.map((g) => ({
    ...g,
    casillas: g.casillas
      .map(ajustar)
      .filter((c): c is Casilla => !!c)
      .filter((c) => !filtrar || aplica(c) || (valor[c.tipo]?.length ?? 0) > 0),
  })).filter((g) => g.casillas.length);

  const visibles = grupos.flatMap((g) => g.casillas);
  const conArchivo = visibles.filter((c) => (valor[c.tipo]?.length ?? 0) > 0).length;
  const p = visibles.length ? Math.round((conArchivo / visibles.length) * 100) : 0;

  return (
    <div>
      {filtrar ? (
        <div className="resumen fade">
          <div className="anillo" style={{ background: `conic-gradient(var(--deep) ${p}%, var(--mist) 0)` }}>
            <span>{conArchivo}/{visibles.length}</span>
          </div>
          <div>
            <b>{conArchivo} de {visibles.length} documentos subidos</b>
            {textoRecomendados && <small>{textoRecomendados}</small>}
          </div>
        </div>
      ) : (
        <div className="hint">
          <IcoInfo />
          <span>Cuéntenos arriba qué pasó y aquí le mostraremos los documentos que normalmente se necesitan para su caso. Mientras tanto, puede subir lo que tenga en la casilla que corresponda.</span>
        </div>
      )}

      {grupos.map((g) => (
        <section className="grp" key={g.id}>
          <h4>{g.titulo}</h4>
          {g.descripcion && <p>{g.descripcion}</p>}
          {!g.descripcion && <div style={{ height: 8 }} />}
          {g.casillas.map((c) => (
            <FilaCasilla key={c.tipo} casilla={c} archivos={valor[c.tipo] ?? []} onChange={(f) => set(c.tipo, f)}
              aviso={avisos?.[c.tipo]} onLimite={() => onLimite?.()} disponibles={disponibles} />
          ))}
        </section>
      ))}

      <section className="grp">
        <h4>Otros</h4>
        <div style={{ height: 8 }} />
        <FilaCasilla
          casilla={{ tipo: OTROS, titulo: "Otros documentos", ayuda: "Si no sabe en qué casilla va, súbalo aquí: nosotros lo identificamos.", variasFotos: true }}
          archivos={valor[OTROS] ?? []} onChange={(f) => set(OTROS, f)} onLimite={() => onLimite?.()} disponibles={disponibles}
        />
      </section>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
        {!porSituacion && recomendados?.length ? (
          <button type="button" className="enlace" onClick={() => setVerTodas(!verTodas)}>
            {verTodas ? "Ver solo los recomendados" : "¿Tiene otros documentos? Ver todas las casillas"}
          </button>
        ) : <span />}
        <span className="contador">{totalArchivos(valor)} de {MAX_ARCHIVOS} archivos</span>
      </div>
    </div>
  );
}
