// Casillas del formulario: una por documento, agrupadas.
// La sección "¿Qué ocurrió?" del formulario solo decide qué casillas se muestran.
// La clasificación oficial la hace el sistema con el relato y los documentos.
import type { TipoDocumento, TipoReclamacion } from "@/lib/dominio";

export type Situacion = "fallecimiento" | "accidente" | "incapacidad";

export const SITUACIONES: { id: Situacion; titulo: string; descripcion: string; tipoEquivalente: TipoReclamacion }[] = [
  { id: "fallecimiento", titulo: "Fallecimiento de la persona asegurada", descripcion: "Por enfermedad u otra causa natural.", tipoEquivalente: "muerte_natural" },
  { id: "accidente", titulo: "Fallecimiento por accidente o hecho violento", descripcion: "Accidente de tránsito, hecho criminal u otro suceso.", tipoEquivalente: "muerte_accidental" },
  { id: "incapacidad", titulo: "Incapacidad de la persona asegurada", descripcion: "Pérdida de capacidad laboral por enfermedad o accidente.", tipoEquivalente: "incapacidad_total_permanente" },
];

export type Casilla = { tipo: TipoDocumento; titulo: string; ayuda: string; variasFotos?: boolean; situaciones?: Situacion[] };
export type GrupoCasillas = { id: string; titulo: string; descripcion: string; casillas: Casilla[] };

export const GRUPOS_CASILLAS: GrupoCasillas[] = [
  {
    id: "formularios",
    titulo: "Formularios de la aseguradora",
    descripcion: "Diligenciados y firmados.",
    casillas: [
      { tipo: "formato_reclamacion", titulo: "Formato de reclamación", ayuda: "Completo, con firma y huella." },
      { tipo: "formulario_sarlaft", titulo: "Formulario SARLAFT", ayuda: "Conocimiento del cliente, con firma y huella." },
    ],
  },
  {
    id: "identidad",
    titulo: "Documentos de identidad",
    descripcion: "Por ambas caras. Puede subir dos fotos: frente y reverso.",
    casillas: [
      { tipo: "documento_identidad_beneficiario", titulo: "Su documento de identidad", ayuda: "Cédula, tarjeta de identidad, cédula de extranjería, pasaporte o PPT.", variasFotos: true },
      { tipo: "documento_identidad_asegurado", titulo: "Documento de la persona asegurada", ayuda: "El de la persona por quien reclama.", variasFotos: true },
    ],
  },
  {
    id: "fallecimiento",
    titulo: "Por el fallecimiento",
    descripcion: "",
    casillas: [
      { tipo: "registro_civil_defuncion", titulo: "Registro civil de defunción", ayuda: "Lo expide la notaría o registraduría.", situaciones: ["fallecimiento", "accidente"] },
      { tipo: "certificado_medico_defuncion", titulo: "Certificado médico de defunción", ayuda: "Lo expide el médico o la clínica.", situaciones: ["fallecimiento", "accidente"] },
    ],
  },
  {
    id: "accidente",
    titulo: "Por el accidente o hecho violento",
    descripcion: "",
    casillas: [{ tipo: "informe_autoridad", titulo: "Informe de policía, fiscalía o medicina legal", ayuda: "Informe de tránsito, noticia criminal o necropsia.", situaciones: ["accidente"] }],
  },
  {
    id: "incapacidad",
    titulo: "Por la incapacidad",
    descripcion: "",
    casillas: [
      { tipo: "dictamen_pcl", titulo: "Dictamen de pérdida de capacidad laboral", ayuda: "De la junta de calificación, EPS, ARL o fondo de pensiones.", situaciones: ["incapacidad"] },
      { tipo: "historia_clinica", titulo: "Historia clínica resumida", ayuda: "O la epicrisis de la clínica u hospital.", situaciones: ["incapacidad"] },
    ],
  },
  {
    id: "pago",
    titulo: "Para el pago",
    descripcion: "",
    casillas: [{ tipo: "certificacion_bancaria", titulo: "Certificación bancaria", ayuda: "A su nombre, de una cuenta activa, de no más de 30 días." }],
  },
];

/** Clave de la casilla "Otros documentos". */
export const OTROS = "otros" as const;
export type ClaveCasilla = TipoDocumento | typeof OTROS;
