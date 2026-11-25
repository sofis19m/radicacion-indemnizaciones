// Reglas del negocio (sección 5 del enunciado). La tabla `requisitos` en la base
// tiene la misma información; esta copia es para la interfaz y el motor.

export const TIPOS_RECLAMACION = ["muerte_natural", "muerte_accidental", "incapacidad_total_permanente"] as const;
export type TipoReclamacion = (typeof TIPOS_RECLAMACION)[number];

export const TIPOS_DOCUMENTO = [
  "formato_reclamacion",
  "registro_civil_defuncion",
  "certificado_medico_defuncion",
  "documento_identidad_asegurado",
  "documento_identidad_beneficiario",
  "formulario_sarlaft",
  "certificacion_bancaria",
  "informe_autoridad",
  "dictamen_pcl",
  "historia_clinica",
  "otro",
] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export type EstadoDocumento =
  | "pendiente_revision"
  | "valido"
  | "sin_firma"
  | "ilegible"
  | "no_corresponde"
  | "vencido_o_incompleto"
  | "incompleto"
  | "vencido"
  | "no_reconocido";

const MUERTE_BASE: TipoDocumento[] = [
  "formato_reclamacion",
  "registro_civil_defuncion",
  "certificado_medico_defuncion",
  "documento_identidad_asegurado",
  "documento_identidad_beneficiario",
  "formulario_sarlaft",
  "certificacion_bancaria",
];

export const REQUISITOS: Record<TipoReclamacion, TipoDocumento[]> = {
  muerte_natural: MUERTE_BASE,
  muerte_accidental: [...MUERTE_BASE, "informe_autoridad"],
  incapacidad_total_permanente: [
    "formato_reclamacion",
    "dictamen_pcl",
    "historia_clinica",
    "documento_identidad_asegurado",
    "formulario_sarlaft",
    "certificacion_bancaria",
  ],
};

export const NOMBRE_TIPO_RECLAMACION: Record<TipoReclamacion, string> = {
  muerte_natural: "Muerte natural",
  muerte_accidental: "Muerte accidental",
  incapacidad_total_permanente: "Incapacidad total y permanente",
};

export const NOMBRE_DOCUMENTO: Record<TipoDocumento, string> = {
  formato_reclamacion: "Formato de reclamación diligenciado",
  registro_civil_defuncion: "Registro civil de defunción",
  certificado_medico_defuncion: "Certificado médico de defunción",
  documento_identidad_asegurado: "Documento de identidad del asegurado",
  documento_identidad_beneficiario: "Documento de identidad del beneficiario",
  formulario_sarlaft: "Formulario SARLAFT firmado",
  certificacion_bancaria: "Certificación bancaria del beneficiario",
  informe_autoridad: "Informe de la autoridad competente (policía o fiscalía)",
  dictamen_pcl: "Dictamen de pérdida de capacidad laboral",
  historia_clinica: "Historia clínica resumida",
  otro: "Otro documento",
};

/** Cómo explicarle al beneficiario, en lenguaje claro, qué hacer con cada documento faltante. */
export const AYUDA_DOCUMENTO: Record<TipoDocumento, string> = {
  formato_reclamacion: "Es el formulario de la aseguradora. Debe estar completo y firmado.",
  registro_civil_defuncion: "Se solicita en la notaría o registraduría donde se registró el fallecimiento.",
  certificado_medico_defuncion: "Lo expide el médico o la institución de salud que atendió el fallecimiento.",
  documento_identidad_asegurado: "Copia legible, por ambas caras, de la cédula de la persona asegurada.",
  documento_identidad_beneficiario: "Copia legible, por ambas caras, de su propia cédula.",
  formulario_sarlaft: "Formulario de conocimiento del cliente. Debe ir firmado por usted.",
  certificacion_bancaria: "Certificado de su banco, a su nombre, con número y tipo de cuenta. No mayor a 30 días.",
  informe_autoridad: "Informe o noticia criminal de la Policía o la Fiscalía sobre el accidente.",
  dictamen_pcl: "Dictamen de la junta de calificación (o EPS/ARL) con el porcentaje de pérdida de capacidad.",
  historia_clinica: "Resumen de la historia clínica relacionada con la incapacidad.",
  otro: "",
};

/** Mensaje al beneficiario cuando el documento llegó pero no sirve. Distinto de "falta". */
export const MOTIVO_ESTADO: Record<Exclude<EstadoDocumento, "valido" | "pendiente_revision">, string> = {
  sin_firma: "Llegó, pero le falta la firma o la huella. Por favor complételo y vuelva a enviarlo.",
  ilegible: "Llegó, pero no se puede leer bien. Envíe una foto más nítida o un escaneo.",
  no_corresponde: "Llegó, pero los datos no coinciden con los de la reclamación. Revise que sea el documento de la persona correcta.",
  vencido_o_incompleto: "Llegó, pero está incompleto o desactualizado.",
  incompleto: "Llegó, pero le falta información.",
  vencido: "Llegó, pero ya no está vigente.",
  no_reconocido: "Recibimos este archivo, pero no pudimos identificar qué documento es.",
};

export const DOCUMENTOS_CON_FIRMA: TipoDocumento[] = ["formulario_sarlaft", "formato_reclamacion"];

export const SEMAFORO_ETIQUETA: Record<string, string> = {
  sin_reloj: "Sin reloj (incompleto)",
  en_plazo: "En plazo",
  en_riesgo: "En riesgo",
  critico: "Crítico",
  vencido: "Vencido",
  cerrado: "Cerrado",
};

export function normalizarDocumento(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}
