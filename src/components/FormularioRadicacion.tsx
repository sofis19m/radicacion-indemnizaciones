"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SubirPorCasillas, { aplanar, MAX_ARCHIVOS, totalArchivos, validarEnCliente, type ArchivosPorCasilla } from "./SubirPorCasillas";
import { BarraAvance, IcoAlerta, IcoCandado, IcoCheck, IcoCorazon, IcoPersona } from "./Iconos";
import { metaDe, subirYConfirmar } from "@/lib/subirArchivos";
import { SITUACIONES, type Situacion } from "@/lib/casillas";

const ICONO_SITUACION = { fallecimiento: <IcoCorazon />, accidente: <IcoAlerta />, incapacidad: <IcoPersona /> };

const LLAVE_SESION = "radicacion_idempotency_key";
const PARENTESCOS = ["Cónyuge", "Hijo/a", "Madre", "Padre", "Hermano/a"];

type Datos = {
  beneficiario_nombre: string; beneficiario_tipo_doc: string; beneficiario_documento: string;
  beneficiario_email: string; beneficiario_telefono: string;
  asegurado_nombre: string; asegurado_documento: string; parentesco: string; relato: string;
};
type Clave = keyof Datos | "consentimiento" | "archivos" | "situacion";

const VACIO: Datos = {
  beneficiario_nombre: "", beneficiario_tipo_doc: "CC", beneficiario_documento: "", beneficiario_email: "",
  beneficiario_telefono: "", asegurado_nombre: "", asegurado_documento: "", parentesco: "", relato: "",
};

const dosPalabras = (v: string) => v.trim().split(/\s+/).filter(Boolean).length >= 2;
const soloDigitos = (v: string) => /^\d{4,15}$/.test(v.replace(/[.\s-]/g, ""));

/** Validación amable, campo por campo. Devuelve el mensaje de error o "". */
function validar(k: keyof Datos, d: Datos, soyAsegurado: boolean): string {
  const v = d[k];
  switch (k) {
    case "beneficiario_nombre": return dosPalabras(v) ? "" : "Escriba su nombre y apellido.";
    case "beneficiario_documento":
      if (!v.trim()) return "Escriba su número de documento.";
      return ["PA", "PPT"].includes(d.beneficiario_tipo_doc) || soloDigitos(v) ? "" : "Revise el número: solo dígitos, sin puntos ni espacios.";
    case "beneficiario_email": return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "Escriba un correo válido, por ejemplo nombre@correo.com.";
    case "beneficiario_telefono": return !v || /^\d{10}$/.test(v.replace(/\s/g, "")) ? "" : "El celular debe tener 10 dígitos.";
    case "asegurado_nombre": return soyAsegurado || dosPalabras(v) ? "" : "Escriba el nombre completo de la persona asegurada.";
    case "asegurado_documento": return soyAsegurado || soloDigitos(v) ? "" : "Revise la cédula: solo dígitos, sin puntos.";
    case "relato": return v.trim().length >= 20 ? "" : "Cuéntenos un poco más de lo que pasó (al menos una o dos frases).";
    default: return "";
  }
}

export default function FormularioRadicacion() {
  const router = useRouter();
  const [d, setD] = useState<Datos>(VACIO);
  // Lo que la persona indica en "¿Qué ocurrió?": organiza qué documentos se le muestran.
  // NO es la clasificación oficial; esa la hace el sistema con el relato y los documentos.
  const [situacion, setSituacion] = useState<Situacion | null>(null);
  const [soyAsegurado, setSoyAsegurado] = useState(false);
  const [consentimiento, setConsentimiento] = useState(false);
  const [archivos, setArchivos] = useState<ArchivosPorCasilla>({});
  const [errores, setErrores] = useState<Partial<Record<Clave, string>>>({});
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [llave, setLlave] = useState("");
  const timerToast = useRef<ReturnType<typeof setTimeout>>(undefined);

  // La llave de idempotencia sobrevive a recargas: reenviar el mismo formulario no crea otro expediente.
  useEffect(() => {
    let k = "";
    try { k = sessionStorage.getItem(LLAVE_SESION) ?? ""; } catch {}
    if (!k) {
      k = crypto.randomUUID();
      try { sessionStorage.setItem(LLAVE_SESION, k); } catch {}
    }
    setLlave(k);
  }, []);

  function mostrarToast(m: string) {
    setToast(m);
    clearTimeout(timerToast.current);
    timerToast.current = setTimeout(() => setToast(null), 2800);
  }

  function cambiar(k: keyof Datos, v: string) {
    const nuevo = { ...d, [k]: v };
    setD(nuevo);
    if (tocados.has(k)) setErrores((e) => ({ ...e, [k]: validar(k, nuevo, soyAsegurado) }));
  }
  function salir(k: keyof Datos) {
    setTocados((t) => new Set(t).add(k));
    if (d[k] || k === "beneficiario_nombre") setErrores((e) => ({ ...e, [k]: validar(k, d, soyAsegurado) }));
  }

  const secciones = {
    s0: !!situacion,
    s1: !validar("beneficiario_nombre", d, soyAsegurado) && !validar("beneficiario_documento", d, soyAsegurado) && !validar("beneficiario_email", d, soyAsegurado),
    s2: soyAsegurado || (!validar("asegurado_nombre", d, soyAsegurado) && !validar("asegurado_documento", d, soyAsegurado)),
    s3: !validar("relato", d, soyAsegurado),
    s4: totalArchivos(archivos) > 0,
  };
  const pct = Math.round(([...Object.values(secciones), consentimiento].filter(Boolean).length / 6) * 100);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setErrorGeneral(null);

    const campos: (keyof Datos)[] = ["beneficiario_nombre", "beneficiario_documento", "beneficiario_email", "beneficiario_telefono", "asegurado_nombre", "asegurado_documento", "relato"];
    const nuevos: Partial<Record<Clave, string>> = {};
    for (const k of campos) { const m = validar(k, d, soyAsegurado); if (m) nuevos[k] = m; }
    const lista = aplanar(archivos);
    const errArchivos = validarEnCliente(lista.map((x) => x.file));
    if (!lista.length) errArchivos.push("Adjunte al menos un documento.");
    if (errArchivos.length) nuevos.archivos = errArchivos.join(" ");
    if (!situacion) nuevos.situacion = "Elija una opción para continuar.";
    if (!consentimiento) nuevos.consentimiento = "Necesitamos su autorización para poder gestionar la reclamación.";
    setErrores(nuevos);
    setTocados(new Set(campos));

    if (Object.keys(nuevos).length) {
      const orden: Clave[] = ["situacion", "beneficiario_nombre", "beneficiario_documento", "beneficiario_email", "beneficiario_telefono", "asegurado_nombre", "asegurado_documento", "relato", "archivos", "consentimiento"];
      const primero = orden.find((k) => nuevos[k]) ?? Object.keys(nuevos)[0];
      document.getElementById(`campo-${primero}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      mostrarToast("Revise los campos marcados.");
      return;
    }

    const limpio = (v: string) => v.replace(/[.\s-]/g, "");
    const datos = {
      ...d,
      beneficiario_documento: limpio(d.beneficiario_documento),
      asegurado_nombre: soyAsegurado ? d.beneficiario_nombre : d.asegurado_nombre,
      asegurado_documento: soyAsegurado ? limpio(d.beneficiario_documento) : limpio(d.asegurado_documento),
      parentesco: soyAsegurado ? "Es el mismo asegurado" : d.parentesco,
      situacion_declarada: situacion,
      consentimiento: true,
      idempotency_key: llave,
      archivos: metaDe(lista),
      sitio_web: (document.getElementById("sitio_web") as HTMLInputElement | null)?.value ?? "",
    };

    setEnviando(true);
    try {
      setProgreso("Registrando su reclamación…");
      const res = await fetch("/api/radicar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
      const json = await res.json();
      if (!res.ok) {
        setErrorGeneral(json.error ?? "No pudimos enviar su reclamación.");
        const delServidor = Object.fromEntries(Object.entries((json.campos ?? {}) as Record<string, string[]>).map(([k, v]) => [k, v[0]]));
        setErrores(delServidor);
        return;
      }
      const r = await subirYConfirmar(lista.map((x) => x.file), json, (h, t) => setProgreso(`Subiendo documentos (${h} de ${t})…`));
      try { sessionStorage.removeItem(LLAVE_SESION); } catch {}
      if (json.token) {
        const extra = r.rechazados.length ? `&rechazados=${encodeURIComponent(r.rechazados.join(" | "))}` : "";
        router.push(`/seguimiento/${json.token}?nuevo=1${extra}`);
      } else {
        setAviso(
          `Ya teníamos una reclamación abierta para esta persona (${json.radicado}). No abrimos una nueva ni se reinició ningún plazo: ` +
            `agregamos ${r.aceptados} documento(s) a la existente${r.duplicados ? ` y omitimos ${r.duplicados} que ya teníamos` : ""}. ` +
            `Le enviamos el enlace de seguimiento a su correo registrado.`,
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setErrorGeneral("Se perdió la conexión. Intente de nuevo: si su reclamación ya había llegado, no se duplicará.");
    } finally {
      setEnviando(false);
      setProgreso(null);
    }
  }

  const err = (k: Clave) => errores[k];
  const MsjError = ({ k }: { k: Clave }) => (err(k) ? <div className="err" role="alert">{err(k)}</div> : null);
  const inp = (k: keyof Datos) => ({
    id: `campo-${k}`, value: d[k], className: `inp ${err(k) ? "bad" : ""}`,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => cambiar(k, e.target.value),
    onBlur: () => salir(k),
  });

  if (aviso) {
    return (
      <div className="exito fade">
        <h2 style={{ margin: "0 0 6px", fontSize: 20 }}>Recibimos sus documentos</h2>
        <p style={{ margin: 0 }}>{aviso}</p>
      </div>
    );
  }

  return (
    <>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 15 }}><BarraAvance pct={pct} /></div>
      <form onSubmit={enviar} noValidate>
        {/* Trampa para bots: invisible para personas */}
        <div aria-hidden="true" style={{ position: "absolute", left: -9999, height: 0, overflow: "hidden" }}>
          <label>Sitio web<input id="sitio_web" tabIndex={-1} autoComplete="off" /></label>
        </div>

        <section className={`sec ${secciones.s0 ? "done" : ""}`} id="campo-situacion">
          <div className="sec-h"><span className="num">1</span><h2>¿Qué ocurrió?</h2></div>
          <p className="sub">Elija la opción que mejor describe su caso.</p>
          <div className="cases" role="radiogroup" aria-label="Qué ocurrió">
            {SITUACIONES.map((s) => (
              <button
                type="button" key={s.id} className="case" role="radio" aria-checked={situacion === s.id}
                onClick={() => {
                  setSituacion(s.id);
                  if (s.id !== "incapacidad") setSoyAsegurado(false);
                  setErrores((e) => ({ ...e, situacion: undefined }));
                }}
              >
                <span className="ic">{ICONO_SITUACION[s.id]}</span>
                <span className="tx"><b>{s.titulo}</b><span>{s.descripcion}</span></span>
                <span className="tick"><IcoCheck /></span>
              </button>
            ))}
          </div>
          <MsjError k="situacion" />
        </section>

        <section className={`sec ${secciones.s1 ? "done" : ""}`}>
          <div className="sec-h"><span className="num">2</span><h2>Sus datos</h2></div>
          <p className="sub">Los usamos para identificarle y escribirle sobre su caso.</p>
          <div className="campos">
            <div className="full field">
              <label htmlFor="campo-beneficiario_nombre">Nombre completo</label>
              <input {...inp("beneficiario_nombre")} autoComplete="name" />
              <MsjError k="beneficiario_nombre" />
            </div>
            <div className="field">
              <label htmlFor="campo-beneficiario_tipo_doc">Tipo de documento</label>
              <select {...inp("beneficiario_tipo_doc")}>
                <option value="CC">Cédula</option>
                <option value="CE">Cédula de extranjería</option>
                <option value="PA">Pasaporte</option>
                <option value="PPT">PPT</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="campo-beneficiario_documento">Número de documento</label>
              <input {...inp("beneficiario_documento")} inputMode="numeric" placeholder="Solo números" />
              <MsjError k="beneficiario_documento" />
            </div>
            <div className="field">
              <label htmlFor="campo-beneficiario_email">Correo electrónico</label>
              <input {...inp("beneficiario_email")} type="email" autoComplete="email" />
              {err("beneficiario_email") ? <MsjError k="beneficiario_email" /> : <div className="msg">Allí le escribiremos qué falta y cómo va su caso.</div>}
            </div>
            <div className="field">
              <label htmlFor="campo-beneficiario_telefono">Celular<span className="opt">(opcional)</span></label>
              <input {...inp("beneficiario_telefono")} type="tel" inputMode="tel" autoComplete="tel" />
              <MsjError k="beneficiario_telefono" />
            </div>
          </div>
        </section>

        <section className={`sec ${secciones.s2 ? "done" : ""}`}>
          <div className="sec-h"><span className="num">3</span><h2>La persona asegurada</h2></div>
          <p className="sub">La persona por quien presenta la reclamación.</p>
          <label className="check" style={{ marginBottom: soyAsegurado ? 0 : 18 }}>
            <input type="checkbox" checked={soyAsegurado} onChange={(e) => setSoyAsegurado(e.target.checked)} />
            <span><b>Yo soy la persona asegurada</b><br /><span className="msg" style={{ margin: 0 }}>Marque esta casilla si reclama por su propia incapacidad.</span></span>
          </label>
          {!soyAsegurado && (
            <div className="campos">
              <div className="full field">
                <label htmlFor="campo-asegurado_nombre">Nombre completo de la persona asegurada</label>
                <input {...inp("asegurado_nombre")} />
                <MsjError k="asegurado_nombre" />
              </div>
              <div className="field">
                <label htmlFor="campo-asegurado_documento">Número de cédula</label>
                <input {...inp("asegurado_documento")} inputMode="numeric" />
                <MsjError k="asegurado_documento" />
              </div>
              <div className="field">
                <label htmlFor="campo-parentesco">Su parentesco<span className="opt">(opcional)</span></label>
                <input {...inp("parentesco")} placeholder="Hija, esposo, madre…" />
                <div className="chips">
                  {PARENTESCOS.map((p) => (
                    <button type="button" key={p} className={`chip ${d.parentesco === p ? "on" : ""}`} onClick={() => cambiar("parentesco", p)}>{p}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className={`sec ${secciones.s3 ? "done" : ""}`}>
          <div className="sec-h"><span className="num">4</span><h2>Cuéntenos qué pasó</h2></div>
          <p className="sub">Con sus palabras. No necesita términos técnicos: con esto entendemos su caso.</p>
          <div className="field">
            <label htmlFor="campo-relato" style={{ position: "absolute", left: -9999 }}>Relato</label>
            <textarea {...inp("relato")} maxLength={4000} />
            <MsjError k="relato" />
          </div>
        </section>

        <section className={`sec ${secciones.s4 ? "done" : ""}`} id="campo-archivos">
          <div className="sec-h"><span className="num">5</span><h2>Documentos</h2></div>
          <p className="sub">Suba cada documento en su casilla.</p>
          <SubirPorCasillas
            valor={archivos}
            onChange={(v) => { setArchivos(v); setErrores((e) => ({ ...e, archivos: undefined })); }}
            situacion={situacion}
            soyAsegurado={soyAsegurado}
            onLimite={() => mostrarToast(`Llegó al máximo de ${MAX_ARCHIVOS} archivos por envío.`)}
          />
          <MsjError k="archivos" />
        </section>

        <div style={{ marginBottom: 20 }} id="campo-consentimiento">
          <label className={`check ${err("consentimiento") ? "bad" : ""}`}>
            <input type="checkbox" checked={consentimiento} onChange={(e) => { setConsentimiento(e.target.checked); setErrores((x) => ({ ...x, consentimiento: undefined })); }} />
            <span style={{ fontSize: 14 }}>
              Autorizo el tratamiento de mis datos personales y los de la persona asegurada, incluidos datos sensibles de salud,
              con la única finalidad de gestionar esta reclamación (Ley 1581 de 2012).
            </span>
          </label>
          <MsjError k="consentimiento" />
        </div>

        {errorGeneral && <div className="alerta" role="alert">{errorGeneral}</div>}

        <button className="btn primary" type="submit" disabled={enviando || !llave}>
          {enviando ? progreso ?? "Enviando…" : "Radicar reclamación"}
        </button>
        <div className="seguro"><IcoCandado /><span>Sus datos y documentos viajan cifrados y se usan solo para esta reclamación.</span></div>
      </form>
      <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>
    </>
  );
}
