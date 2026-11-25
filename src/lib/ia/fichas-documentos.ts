// =============================================================================
// FICHA TÉCNICA DE DOCUMENTOS DE RECLAMACIÓN
//
// Para cada documento: cómo se reconoce, qué debe contener y qué alertas
// revisar. Se le entrega al modelo como criterio de revisión: el modelo no
// decide "por intuición" qué es un documento ni si sirve, lo compara contra
// esta ficha y reporta qué elemento falta o qué problema encontró.
//
// Las alertas se dividen en dos niveles:
//   · "documento": problema del documento en sí. Se corrige reenviándolo.
//     El documento NO cuenta para completar el expediente.
//   · "analista": asunto de fondo (cobertura, legitimidad, consistencia).
//     El documento SÍ cuenta, pero el caso queda marcado para que una
//     persona lo revise. El sistema no rechaza por estas razones: decidir
//     sobre ellas es pagar u objetar, y eso es humano.
// =============================================================================
import type { TipoDocumento } from "@/lib/dominio";

export type NivelAlerta = "documento" | "analista";

export type Ficha = {
  nombre: string;
  /** Señas para reconocerlo (encabezados, entidades, títulos típicos). */
  comoSeReconoce: string[];
  debeContener: string[];
  alertas: { texto: string; nivel: NivelAlerta }[];
  /** Exige firma (o firma y huella) de quien lo diligencia / expide. */
  requiereFirma: boolean;
  /** Exige ambas caras (documentos de identidad). */
  requiereAmbasCaras?: boolean;
  /** Vigencia máxima desde su expedición, en días. */
  vigenciaDias?: number;
};

export const FICHAS: Record<Exclude<TipoDocumento, "otro">, Ficha> = {
  formato_reclamacion: {
    nombre: "Formato de reclamación diligenciado",
    comoSeReconoce: ["Formulario de la aseguradora titulado como reclamación, solicitud de indemnización o aviso de siniestro", "Secciones de asegurado, beneficiario y siniestro"],
    debeContener: [
      "Datos del asegurado, tomador y beneficiario",
      "Número de póliza",
      "Fecha, lugar y causa del siniestro",
      "Cobertura reclamada",
      "Firma y huella del reclamante",
      "Fecha de diligenciamiento",
    ],
    alertas: [
      { texto: "Campos en blanco", nivel: "documento" },
      { texto: "Sin firma o sin huella", nivel: "documento" },
      { texto: "Enmendaduras o tachones", nivel: "analista" },
      { texto: "Datos que no coinciden con la cédula", nivel: "analista" },
      { texto: "Firma de alguien que no es el beneficiario, sin poder o representación legal", nivel: "analista" },
    ],
    requiereFirma: true,
  },
  registro_civil_defuncion: {
    nombre: "Registro civil de defunción",
    comoSeReconoce: ["Encabezado \"República de Colombia\" y \"Registraduría Nacional del Estado Civil\"", "Título \"Registro Civil de Defunción\"", "Expedido por una notaría o registraduría"],
    debeContener: [
      "Indicativo serial",
      "Nombre y número de documento del fallecido",
      "Fecha, hora y lugar de la muerte",
      "Datos del declarante",
      "Firma y sello del funcionario",
    ],
    alertas: [
      { texto: "Copia sin sello o sin serial verificable", nivel: "documento" },
      { texto: "Fecha de muerte distinta a la del certificado médico o del informe de la autoridad", nivel: "analista" },
      { texto: "Nombre con diferencias frente a la cédula", nivel: "analista" },
    ],
    requiereFirma: true,
  },
  certificado_medico_defuncion: {
    nombre: "Certificado médico de defunción",
    comoSeReconoce: ["Formato del Ministerio de Salud / DANE", "\"Certificado de defunción · antecedente para el registro civil\"", "Sección de causas de muerte (directa, antecedente, básica)"],
    debeContener: [
      "Causa básica y causas directas de la muerte",
      "Fecha y hora del fallecimiento",
      "Datos del fallecido",
      "Nombre, registro médico y firma del profesional",
    ],
    alertas: [
      { texto: "Causa de muerte ilegible o genérica", nivel: "documento" },
      { texto: "Sin registro médico del profesional", nivel: "documento" },
      { texto: "Sin firma", nivel: "documento" },
      { texto: "Inconsistencias con la historia clínica o con el registro civil", nivel: "analista" },
    ],
    requiereFirma: true,
  },
  documento_identidad_asegurado: {
    nombre: "Documento de identidad del asegurado",
    comoSeReconoce: ["Cédula de ciudadanía, tarjeta de identidad, registro civil de nacimiento, cédula de extranjería, pasaporte o PPT", "\"República de Colombia · Identificación personal\" en la cédula"],
    debeContener: [
      "Documento válido según la persona: cédula (mayores de 18), tarjeta de identidad (7 a 17 años), registro civil de nacimiento (menores de 7), cédula de extranjería, pasaporte o PPT (extranjeros)",
      "Ambas caras, legibles",
      "Nombre y número de documento visibles",
    ],
    alertas: [
      { texto: "Documento ilegible o incompleto", nivel: "documento" },
      { texto: "Documento vencido o no vigente", nivel: "documento" },
      { texto: "Número o nombre que no coincide con la póliza, el registro civil u otros soportes", nivel: "documento" },
    ],
    requiereFirma: false,
    requiereAmbasCaras: true,
  },
  documento_identidad_beneficiario: {
    nombre: "Documento de identidad del beneficiario",
    comoSeReconoce: ["Igual que el del asegurado, pero a nombre de quien reclama"],
    debeContener: [
      "Documento válido según la persona (cédula, tarjeta de identidad, registro civil de nacimiento, cédula de extranjería, pasaporte o PPT)",
      "Ambas caras, legibles",
      "Nombre y número de documento visibles",
    ],
    alertas: [
      { texto: "Documento ilegible o incompleto", nivel: "documento" },
      { texto: "Documento vencido o no vigente", nivel: "documento" },
      { texto: "Número o nombre que no coincide con los datos del reclamante", nivel: "documento" },
      { texto: "Quien reclama no es el beneficiario designado ni heredero acreditado", nivel: "analista" },
      { texto: "Beneficiario menor de edad sin representante legal que acredite el vínculo", nivel: "analista" },
    ],
    requiereFirma: false,
    requiereAmbasCaras: true,
  },
  formulario_sarlaft: {
    nombre: "Formulario SARLAFT firmado",
    comoSeReconoce: ["\"Formulario de conocimiento del cliente\" o \"SARLAFT\"", "Secciones de actividad económica, información financiera y PEP"],
    debeContener: [
      "Identificación completa del diligenciante",
      "Actividad económica",
      "Origen de fondos",
      "Información financiera",
      "Condición de PEP (persona expuesta políticamente)",
      "Firma, huella y fecha",
    ],
    alertas: [
      { texto: "Sin firma o sin huella", nivel: "documento" },
      { texto: "Campos vacíos, especialmente origen de fondos", nivel: "documento" },
      { texto: "Formato desactualizado frente al vigente de la aseguradora", nivel: "analista" },
    ],
    requiereFirma: true,
  },
  certificacion_bancaria: {
    nombre: "Certificación bancaria del beneficiario",
    comoSeReconoce: ["Membrete de un banco o entidad financiera", "Texto del tipo \"certifica que ... posee cuenta de ahorros/corriente\""],
    debeContener: [
      "Nombre y documento del titular",
      "Tipo y número de cuenta",
      "Estado de la cuenta (activa)",
      "Fecha de expedición",
      "Firma o sello de la entidad financiera",
    ],
    alertas: [
      { texto: "Cuenta de un tercero, no del beneficiario", nivel: "documento" },
      { texto: "Cuenta inactiva o cancelada", nivel: "documento" },
      { texto: "Certificado vencido (más de 30 días desde su expedición)", nivel: "documento" },
      { texto: "Datos que no coinciden con la cédula", nivel: "documento" },
    ],
    requiereFirma: false,
    vigenciaDias: 30,
  },
  informe_autoridad: {
    nombre: "Informe de la autoridad competente (Policía, Fiscalía, Medicina Legal)",
    comoSeReconoce: ["Membrete de Policía Nacional (p. ej. IPAT, informe policial de accidente de tránsito), Fiscalía General de la Nación (noticia criminal, número SPOA) o Instituto Nacional de Medicina Legal (informe pericial de necropsia)"],
    debeContener: [
      "Número de radicado o consecutivo",
      "Descripción de los hechos",
      "Fecha, hora y lugar del evento",
      "Identificación de las personas involucradas",
      "Nombre, firma o sello del funcionario",
      "Según el caso: croquis (tránsito), acta de inspección a cadáver o informe de necropsia",
    ],
    alertas: [
      { texto: "Sin firma del funcionario", nivel: "documento" },
      { texto: "Sin número de radicado", nivel: "documento" },
      { texto: "Copia ilegible", nivel: "documento" },
      { texto: "Fechas o personas distintas a las de los demás documentos", nivel: "analista" },
      { texto: "Informe que no corresponde a la cobertura reclamada", nivel: "analista" },
    ],
    requiereFirma: true,
  },
  dictamen_pcl: {
    nombre: "Dictamen de pérdida de capacidad laboral",
    comoSeReconoce: ["Expedido por una Junta Regional o Nacional de Calificación de Invalidez, EPS, ARL o administradora de pensiones", "Porcentaje de pérdida de capacidad laboral y fecha de estructuración"],
    debeContener: [
      "Porcentaje de pérdida de capacidad laboral",
      "Fecha de estructuración",
      "Origen (común o laboral)",
      "Diagnósticos",
      "Firmas de los calificadores",
      "Constancia de notificación o ejecutoria",
    ],
    alertas: [
      { texto: "Sin fecha de estructuración", nivel: "documento" },
      { texto: "Porcentaje inferior al exigido por la cobertura (la invalidez suele reconocerse desde el 50 %)", nivel: "analista" },
      { texto: "Dictamen sin ejecutoria", nivel: "analista" },
      { texto: "Fecha de estructuración fuera de la vigencia de la póliza", nivel: "analista" },
    ],
    requiereFirma: true,
  },
  historia_clinica: {
    nombre: "Historia clínica resumida",
    comoSeReconoce: ["Membrete de una IPS, clínica u hospital", "\"Resumen de historia clínica\" o \"epicrisis\"", "Diagnósticos (a veces con códigos CIE-10) y evolución"],
    debeContener: [
      "Datos del paciente",
      "Fechas de atención",
      "Diagnósticos, procedimientos y evolución",
      "Nombre, registro médico y firma del profesional",
      "Sello de la institución",
    ],
    alertas: [
      { texto: "Sin firma ni registro médico", nivel: "documento" },
      { texto: "Ilegible o incompleta", nivel: "documento" },
      { texto: "Sin autorización de entrega del titular, heredero o representante legal", nivel: "analista" },
      { texto: "Diagnóstico que no concuerda con el certificado de defunción o con el dictamen", nivel: "analista" },
    ],
    requiereFirma: true,
  },
};

// -----------------------------------------------------------------------------
// Catálogo de problemas que el modelo puede reportar en cualquier archivo.
// Es una lista cerrada: el modelo solo puede elegir de aquí (no inventa códigos).
// "nivel" define si impide que el documento cuente (documento) o si solo
// genera una alerta para el analista (analista).
// -----------------------------------------------------------------------------
export const PROBLEMAS = {
  borroso: { nivel: "documento", texto: "La imagen está borrosa o desenfocada" },
  cortado: { nivel: "documento", texto: "El documento está cortado: faltan bordes o partes" },
  mal_escaneado: { nivel: "documento", texto: "Mal escaneado o fotografiado: torcido, oscuro, con reflejos o sombras" },
  una_sola_cara: { nivel: "documento", texto: "Solo se ve una cara del documento" },
  sin_firma: { nivel: "documento", texto: "Falta la firma requerida" },
  sin_huella: { nivel: "documento", texto: "Falta la huella requerida" },
  sin_sello: { nivel: "documento", texto: "Falta el sello de la entidad o del funcionario" },
  campos_vacios: { nivel: "documento", texto: "Hay campos obligatorios en blanco" },
  elementos_faltantes: { nivel: "documento", texto: "Le faltan elementos que el documento debe contener" },
  paginas_faltantes: { nivel: "documento", texto: "Faltan páginas del documento" },
  documento_vencido: { nivel: "documento", texto: "El documento está vencido o no vigente" },
  cuenta_inactiva: { nivel: "documento", texto: "La cuenta bancaria figura inactiva o cancelada" },
  enmendaduras: { nivel: "analista", texto: "Tiene enmendaduras o tachones" },
  posible_alteracion: { nivel: "analista", texto: "Hay señales de posible alteración (tipografías mezcladas, recuadros pegados, datos sobrepuestos)" },
  datos_inconsistentes: { nivel: "analista", texto: "Datos que no concuerdan con otros documentos del expediente" },
  porcentaje_pcl_bajo: { nivel: "analista", texto: "El porcentaje de pérdida de capacidad es inferior al 50 %" },
  sin_ejecutoria: { nivel: "analista", texto: "El dictamen no tiene constancia de notificación o ejecutoria" },
  firmante_no_es_beneficiario: { nivel: "analista", texto: "Quien firma no parece ser el beneficiario y no se ve poder o representación" },
} as const;

export type CodigoProblema = keyof typeof PROBLEMAS;
export const CODIGOS_PROBLEMA = Object.keys(PROBLEMAS) as CodigoProblema[];

/** Texto de la ficha técnica para las instrucciones del modelo. */
export function fichasParaPrompt(): string {
  const fichas = (Object.entries(FICHAS) as [TipoDocumento, Ficha][])
    .map(([tipo, f]) =>
      [
        `■ ${tipo} · ${f.nombre}`,
        `  Cómo se reconoce: ${f.comoSeReconoce.join("; ")}`,
        `  Debe contener: ${f.debeContener.join("; ")}`,
        `  Alertas: ${f.alertas.map((a) => a.texto).join("; ")}`,
        f.requiereAmbasCaras ? "  Debe verse por AMBAS caras (pueden venir en dos archivos)." : "",
        f.vigenciaDias ? `  Vigencia máxima: ${f.vigenciaDias} días desde su expedición.` : "",
      ].filter(Boolean).join("\n"),
    )
    .join("\n\n");
  const problemas = CODIGOS_PROBLEMA.map((c) => `- ${c}: ${PROBLEMAS[c].texto}`).join("\n");
  return `FICHA TÉCNICA DE DOCUMENTOS\n\n${fichas}\n\nCATÁLOGO DE PROBLEMAS (usa solo estos códigos)\n${problemas}`;
}
