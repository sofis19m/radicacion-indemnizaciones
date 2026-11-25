// =============================================================================
// REGLAS DE VALIDACIÓN DE DOCUMENTOS (determinísticas, sin IA)
//
// El modelo observa y reporta (qué documento es, si se lee, si tiene firma,
// qué elementos de la ficha faltan, qué problemas ve, qué datos contiene).
// ESTE archivo decide, con reglas fijas, si el documento sirve. Así una
// alucinación del modelo no puede, por sí sola, completar un expediente.
// =============================================================================
import { normalizarDocumento, type EstadoDocumento, type TipoDocumento } from "@/lib/dominio";
import { FICHAS, PROBLEMAS, type CodigoProblema } from "@/lib/ia/fichas-documentos";
import type { DocumentoExtraido } from "@/lib/ia/analizar";

const CONFIANZA_MINIMA_DOC = 0.5;

export type ResultadoValidacion = {
  estado: EstadoDocumento;
  /** Explicación en lenguaje claro para el beneficiario (qué corregir). */
  motivo: string | null;
  /** Asuntos de fondo para el analista. No impiden que el documento cuente. */
  alertasAnalista: string[];
};

type DatosCaso = { asegurado_documento: string; beneficiario_documento: string };

function diasEntre(fechaIso: string, hoy: Date): number | null {
  const f = new Date(`${fechaIso.slice(0, 10)}T12:00:00-05:00`);
  if (Number.isNaN(f.getTime())) return null;
  return Math.floor((hoy.getTime() - f.getTime()) / 86_400_000);
}

const MENSAJE_CALIDAD: Partial<Record<CodigoProblema, string>> = {
  borroso: "La imagen está borrosa. Tome una foto nueva con buena luz, sin mover el celular.",
  cortado: "El documento salió cortado. Tome la foto con el documento completo, incluidos los bordes.",
  mal_escaneado: "La imagen salió oscura, torcida o con reflejos. Tómela de frente, sobre una superficie plana y con buena luz.",
};

export function validarDocumento(x: DocumentoExtraido, caso: DatosCaso, hoy = new Date()): ResultadoValidacion {
  const alertasAnalista: string[] = [];
  const problemas = new Set(x.problemas as CodigoProblema[]);

  // Alertas de fondo: van al analista, nunca rechazan el documento
  for (const p of problemas) if (PROBLEMAS[p].nivel === "analista") alertasAnalista.push(PROBLEMAS[p].texto);
  if (x.tipo === "dictamen_pcl" && x.porcentaje_pcl != null && x.porcentaje_pcl < 50) {
    alertasAnalista.push(`El dictamen indica ${x.porcentaje_pcl} % de pérdida de capacidad (la invalidez suele reconocerse desde el 50 %).`);
  }

  const r = (estado: EstadoDocumento, motivo: string | null = null): ResultadoValidacion => ({ estado, motivo, alertasAnalista });

  // Regla 1 · Calidad de la imagen: si no se puede leer, cortado o mal tomado → ILEGIBLE
  if (!x.legible || problemas.has("borroso")) return r("ilegible", MENSAJE_CALIDAD.borroso!);
  if (problemas.has("cortado")) return r("ilegible", MENSAJE_CALIDAD.cortado!);
  if (problemas.has("mal_escaneado")) return r("ilegible", MENSAJE_CALIDAD.mal_escaneado!);

  // Regla 2 · ¿Es alguno de los documentos de la ficha?
  if (x.tipo === "otro" || x.confianza < CONFIANZA_MINIMA_DOC) return r("no_reconocido");

  const ficha = FICHAS[x.tipo as Exclude<TipoDocumento, "otro">];

  // Regla 3 · Firma, huella y sello cuando la ficha los exige
  if (ficha.requiereFirma && (x.tiene_firma === false || problemas.has("sin_firma"))) return r("sin_firma", "Falta la firma.");
  if (problemas.has("sin_huella") || x.tiene_huella === false) {
    if (x.tipo === "formato_reclamacion" || x.tipo === "formulario_sarlaft") return r("sin_firma", "Falta la huella junto a la firma.");
  }
  if (problemas.has("sin_sello")) return r("incompleto", "Le falta el sello de la entidad que lo expide.");

  // Regla 4 · Vigencia
  if (problemas.has("documento_vencido")) return r("vencido", "El documento está vencido o ya no es vigente.");
  if (ficha.vigenciaDias && x.fecha_expedicion) {
    const dias = diasEntre(x.fecha_expedicion, hoy);
    if (dias != null && dias > ficha.vigenciaDias) {
      return r("vencido", `Fue expedido hace ${dias} días; debe tener máximo ${ficha.vigenciaDias}. Solicite uno actualizado.`);
    }
  }
  if (problemas.has("cuenta_inactiva")) return r("incompleto", "La cuenta figura inactiva o cancelada. Envíe la certificación de una cuenta activa.");

  // Regla 5 · Contenido incompleto según la ficha ("Debe contener")
  if (problemas.has("paginas_faltantes")) return r("incompleto", "Faltan páginas del documento.");
  if (problemas.has("campos_vacios") || x.elementos_faltantes.length) {
    const faltan = x.elementos_faltantes.length ? ` Falta: ${x.elementos_faltantes.slice(0, 3).join("; ").toLowerCase()}.` : "";
    return r("incompleto", `Tiene información incompleta.${faltan}`);
  }

  // Regla 6 · ¿Es de la persona correcta? (comparación exacta de números, no del modelo)
  const numero = normalizarDocumento(x.numero_documento_titular);
  const titularEsperado: Partial<Record<TipoDocumento, { numero: string; quien: string; obligatorio: boolean }>> = {
    documento_identidad_asegurado: { numero: normalizarDocumento(caso.asegurado_documento), quien: "la persona asegurada", obligatorio: x.cara !== "reverso" },
    documento_identidad_beneficiario: { numero: normalizarDocumento(caso.beneficiario_documento), quien: "usted como beneficiario", obligatorio: x.cara !== "reverso" },
    registro_civil_defuncion: { numero: normalizarDocumento(caso.asegurado_documento), quien: "la persona asegurada", obligatorio: false },
    certificado_medico_defuncion: { numero: normalizarDocumento(caso.asegurado_documento), quien: "la persona asegurada", obligatorio: false },
    informe_autoridad: { numero: normalizarDocumento(caso.asegurado_documento), quien: "la persona asegurada", obligatorio: false },
    dictamen_pcl: { numero: normalizarDocumento(caso.asegurado_documento), quien: "la persona asegurada", obligatorio: false },
    historia_clinica: { numero: normalizarDocumento(caso.asegurado_documento), quien: "la persona asegurada", obligatorio: false },
    certificacion_bancaria: { numero: normalizarDocumento(caso.beneficiario_documento), quien: "usted como beneficiario", obligatorio: false },
  };
  const esperado = titularEsperado[x.tipo];
  if (esperado) {
    if (!numero && esperado.obligatorio) return r("ilegible", "No se alcanza a leer el número de identificación.");
    if (numero && numero !== esperado.numero) {
      return r("no_corresponde", `El número de identificación del documento no coincide con el de ${esperado.quien}.`);
    }
  }

  return r("valido");
}

// -----------------------------------------------------------------------------
// Cruces entre documentos: lo que solo se ve comparando un documento con otro.
// Generan alertas para el analista (no rechazan): decidir si una diferencia de
// fechas invalida la reclamación es una decisión humana.
// -----------------------------------------------------------------------------
export type DocParaCruce = {
  tipo_detectado: TipoDocumento | null;
  estado: string;
  datos_extraidos: Partial<DocumentoExtraido> | null;
};

function normNombre(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").split(/\s+/).filter((t) => t.length > 2);
}

export function crucesEntreDocumentos(docs: DocParaCruce[], aseguradoNombre: string): string[] {
  const alertas: string[] = [];
  const utiles = docs.filter((d) => d.datos_extraidos && d.estado !== "ilegible" && d.estado !== "no_reconocido");

  // Fecha de muerte o del evento: registro civil, certificado médico e informe de autoridad deben coincidir
  const fechas = utiles
    .filter((d) => ["registro_civil_defuncion", "certificado_medico_defuncion", "informe_autoridad"].includes(d.tipo_detectado ?? ""))
    .map((d) => ({ tipo: d.tipo_detectado!, fecha: d.datos_extraidos!.fecha_evento?.slice(0, 10) }))
    .filter((f): f is { tipo: TipoDocumento; fecha: string } => !!f.fecha);
  const distintas = new Set(fechas.map((f) => f.fecha));
  if (distintas.size > 1) {
    alertas.push(`Las fechas del evento no coinciden entre documentos: ${fechas.map((f) => `${f.tipo.replaceAll("_", " ")} ${f.fecha}`).join(" · ")}.`);
  }

  // Nombre del fallecido o paciente frente al nombre del asegurado declarado
  const esperado = new Set(normNombre(aseguradoNombre));
  for (const d of utiles) {
    if (!["registro_civil_defuncion", "certificado_medico_defuncion", "dictamen_pcl", "historia_clinica", "documento_identidad_asegurado"].includes(d.tipo_detectado ?? "")) continue;
    const nombre = d.datos_extraidos!.nombre_titular;
    if (!nombre) continue;
    const tokens = normNombre(nombre);
    const comunes = tokens.filter((t) => esperado.has(t)).length;
    if (tokens.length && comunes < Math.min(2, tokens.length)) {
      alertas.push(`El nombre en ${d.tipo_detectado!.replaceAll("_", " ")} ("${nombre}") difiere del asegurado declarado ("${aseguradoNombre}").`);
    }
  }
  return alertas;
}
