"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SubirPorCasillas, { aplanar, MAX_ARCHIVOS, totalArchivos, validarEnCliente, type ArchivosPorCasilla } from "./SubirPorCasillas";
import { metaDe, subirYConfirmar } from "@/lib/subirArchivos";

type Errores = Record<string, string[] | undefined>;

const LLAVE_SESION = "radicacion_idempotency_key";

export default function FormularioRadicacion() {
  const router = useRouter();
  const [archivos, setArchivos] = useState<ArchivosPorCasilla>({});
  const [enviando, setEnviando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [errores, setErrores] = useState<Errores>({});
  const [erroresArchivos, setErroresArchivos] = useState<string[]>([]); // validación local de archivos
  const [soyAsegurado, setSoyAsegurado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [llave, setLlave] = useState<string>("");
  const [progreso, setProgreso] = useState<string | null>(null);

  // La llave de idempotencia sobrevive a recargas: reenviar el mismo formulario
  // no crea un segundo expediente.
  useEffect(() => {
    let k = "";
    try { k = sessionStorage.getItem(LLAVE_SESION) ?? ""; } catch {}
    if (!k) {
      k = crypto.randomUUID();
      try { sessionStorage.setItem(LLAVE_SESION, k); } catch {}
    }
    setLlave(k);
  }, []);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setErrorGeneral(null);
    setErrores({});

    const lista = aplanar(archivos);
    const locales = validarEnCliente(lista.map((x) => x.file));
    if (lista.length === 0) locales.push("Adjunte al menos un documento.");
    if (lista.length > MAX_ARCHIVOS) locales.push(`Puede adjuntar máximo ${MAX_ARCHIVOS} archivos por envío. Si tiene más, envíe el resto después desde su enlace de seguimiento.`);
    setErroresArchivos(locales);
    if (locales.length) return;

    const fd = new FormData(e.currentTarget);
    const datos: Record<string, unknown> = Object.fromEntries(fd.entries());
    if (soyAsegurado) {
      datos.asegurado_nombre = datos.beneficiario_nombre;
      datos.asegurado_documento = datos.beneficiario_documento;
      datos.parentesco = "Es el mismo asegurado";
    }
    datos.consentimiento = fd.get("consentimiento") === "si";
    datos.idempotency_key = llave;
    datos.archivos = metaDe(lista);

    setEnviando(true);
    try {
      setProgreso("Registrando su reclamación…");
      const res = await fetch("/api/radicar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
      const json = await res.json();
      if (!res.ok) {
        setErrorGeneral(json.error ?? "No pudimos enviar su reclamación.");
        setErrores(json.campos ?? {});
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
      }
    } catch {
      setErrorGeneral("Se perdió la conexión. Intente de nuevo: si su reclamación ya había llegado, no se duplicará.");
    } finally {
      setEnviando(false);
      setProgreso(null);
    }
  }

  if (aviso) {
    return (
      <div className="tarjeta border-green-200 bg-green-50 text-green-900">
        <h2 className="mb-2 text-lg font-semibold">Recibimos sus documentos</h2>
        <p>{aviso}</p>
      </div>
    );
  }

  const err = (campo: string) =>
    errores[campo]?.[0] ? <p className="mt-1 text-sm text-red-600">{errores[campo]![0]}</p> : null;

  return (
    <form onSubmit={enviar} className="space-y-6" noValidate>
      {/* Trampa para bots: invisible para personas */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
        <label>Sitio web<input name="sitio_web" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <fieldset className="tarjeta space-y-4">
        <legend className="px-1 text-lg font-semibold text-gray-900">1. Sus datos</legend>
        <div>
          <label className="etiqueta" htmlFor="beneficiario_nombre">Nombre completo</label>
          <input id="beneficiario_nombre" name="beneficiario_nombre" className="campo" autoComplete="name" required />
          {err("beneficiario_nombre")}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="etiqueta" htmlFor="beneficiario_tipo_doc">Tipo</label>
            <select id="beneficiario_tipo_doc" name="beneficiario_tipo_doc" className="campo" defaultValue="CC">
              <option value="CC">Cédula</option>
              <option value="TI">Tarjeta de identidad</option>
              <option value="RC">Registro civil</option>
              <option value="CE">Cédula de extranjería</option>
              <option value="PA">Pasaporte</option>
              <option value="PPT">PPT</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="etiqueta" htmlFor="beneficiario_documento">Número de documento</label>
            <input id="beneficiario_documento" name="beneficiario_documento" className="campo" inputMode="numeric" required />
            {err("beneficiario_documento")}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="beneficiario_email">Correo electrónico</label>
            <input id="beneficiario_email" name="beneficiario_email" type="email" className="campo" autoComplete="email" required />
            <p className="mt-1 text-xs text-gray-500">Allí le escribiremos qué falta y cómo va su caso.</p>
            {err("beneficiario_email")}
          </div>
          <div>
            <label className="etiqueta" htmlFor="beneficiario_telefono">Celular (opcional)</label>
            <input id="beneficiario_telefono" name="beneficiario_telefono" type="tel" className="campo" autoComplete="tel" />
            {err("beneficiario_telefono")}
          </div>
        </div>
      </fieldset>

      <fieldset className="tarjeta space-y-4">
        <legend className="px-1 text-lg font-semibold text-gray-900">2. La persona asegurada</legend>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" className="mt-1" checked={soyAsegurado} onChange={(e) => setSoyAsegurado(e.target.checked)} />
          <span>Yo soy la persona asegurada (por ejemplo, si reclamo por una incapacidad).</span>
        </label>
        {!soyAsegurado && (
          <>
            <div>
              <label className="etiqueta" htmlFor="asegurado_nombre">Nombre completo de la persona asegurada</label>
              <input id="asegurado_nombre" name="asegurado_nombre" className="campo" required />
              {err("asegurado_nombre")}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="etiqueta" htmlFor="asegurado_documento">Número de cédula</label>
                <input id="asegurado_documento" name="asegurado_documento" className="campo" inputMode="numeric" required />
                {err("asegurado_documento")}
              </div>
              <div>
                <label className="etiqueta" htmlFor="parentesco">Su parentesco (opcional)</label>
                <input id="parentesco" name="parentesco" className="campo" placeholder="Hija, esposo, madre…" />
              </div>
            </div>
          </>
        )}
      </fieldset>

      <fieldset className="tarjeta space-y-3">
        <legend className="px-1 text-lg font-semibold text-gray-900">3. Cuéntenos qué pasó</legend>
        <p className="text-sm text-gray-600">Con sus palabras. No necesita términos técnicos: con esto entendemos qué documentos aplican a su caso.</p>
        <textarea id="relato" name="relato" rows={5} className="campo" required minLength={20} maxLength={4000} />
        {err("relato")}
      </fieldset>

      <fieldset className="tarjeta space-y-3">
        <legend className="px-1 text-lg font-semibold text-gray-900">4. Documentos</legend>
        <p className="text-sm text-gray-600">
          Suba cada documento en su casilla. Solo los que tenga: si falta alguno, se lo diremos y podrá enviarlo después.
          Puede tomar las fotos con el celular.
        </p>
        <SubirPorCasillas valor={archivos} onChange={setArchivos} />
        <p className="text-right text-xs text-gray-500">{totalArchivos(archivos)} de {MAX_ARCHIVOS} archivos</p>
        {erroresArchivos.length > 0 && (
          <ul className="space-y-1 text-sm text-red-600">{erroresArchivos.map((m) => <li key={m}>{m}</li>)}</ul>
        )}
      </fieldset>

      <div className="tarjeta">
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" name="consentimiento" value="si" className="mt-1" required />
          <span>
            Autorizo el tratamiento de mis datos personales y los de la persona asegurada, incluidos datos sensibles de salud,
            con la única finalidad de gestionar esta reclamación (Ley 1581 de 2012).
          </span>
        </label>
        {err("consentimiento")}
      </div>

      {errorGeneral && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{errorGeneral}</p>}

      <button type="submit" className="boton w-full" disabled={enviando || !llave}>
        {enviando ? progreso ?? "Enviando… no cierre esta página" : "Radicar reclamación"}
      </button>
    </form>
  );
}
