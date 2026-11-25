// Casillas del formulario: una por documento, agrupadas por situación.
// No se le pregunta al beneficiario el tipo de reclamación: ve todas las
// casillas y sube lo que tiene. Lo que suba en cada una es una pista más para
// el sistema, que igual verifica el contenido de cada archivo.
import type { TipoDocumento } from "@/lib/dominio";

export type Casilla = { tipo: TipoDocumento; titulo: string; ayuda: string; variasFotos?: boolean };
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
    titulo: "Si la persona asegurada falleció",
    descripcion: "",
    casillas: [
      { tipo: "registro_civil_defuncion", titulo: "Registro civil de defunción", ayuda: "Lo expide la notaría o registraduría." },
      { tipo: "certificado_medico_defuncion", titulo: "Certificado médico de defunción", ayuda: "Lo expide el médico o la clínica." },
    ],
  },
  {
    id: "accidente",
    titulo: "Si el fallecimiento fue por un accidente o un hecho violento",
    descripcion: "",
    casillas: [{ tipo: "informe_autoridad", titulo: "Informe de policía, fiscalía o medicina legal", ayuda: "Informe de tránsito, noticia criminal o necropsia." }],
  },
  {
    id: "incapacidad",
    titulo: "Si reclama por una incapacidad",
    descripcion: "",
    casillas: [
      { tipo: "dictamen_pcl", titulo: "Dictamen de pérdida de capacidad laboral", ayuda: "De la junta de calificación, EPS, ARL o fondo de pensiones." },
      { tipo: "historia_clinica", titulo: "Historia clínica resumida", ayuda: "O la epicrisis de la clínica u hospital." },
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
