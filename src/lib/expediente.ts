// Evaluación del expediente: lógica pura y determinística, sin IA.
// Se usa en el motor, en la página de seguimiento y en el panel.
import {
  AYUDA_DOCUMENTO,
  MOTIVO_ESTADO,
  NOMBRE_DOCUMENTO,
  REQUISITOS,
  type EstadoDocumento,
  type TipoDocumento,
  type TipoReclamacion,
} from "@/lib/dominio";

export type DocumentoEvaluable = {
  id: string;
  nombre_original: string;
  tipo_detectado: TipoDocumento | null;
  estado: EstadoDocumento;
  motivo: string | null;
  created_at: string;
};

export type ItemChecklist = {
  tipo: TipoDocumento;
  nombre: string;
  situacion: "recibido_valido" | "recibido_no_sirve" | "en_revision" | "falta";
  detalle: string;
  documentoId?: string;
};

export type Evaluacion = {
  completo: boolean;
  checklist: ItemChecklist[];
  /** Momento en que llegó el último documento válido requerido: el expediente quedó completo ahí. */
  completoDesde: string | null;
  extras: DocumentoEvaluable[];
};

export function evaluarExpediente(tipo: TipoReclamacion, documentos: DocumentoEvaluable[]): Evaluacion {
  const requeridos = REQUISITOS[tipo];
  const checklist: ItemChecklist[] = [];
  const fechasValidas: string[] = [];

  for (const req of requeridos) {
    const delTipo = documentos.filter((d) => d.tipo_detectado === req);
    // Si hay varios del mismo tipo, basta con que uno sea válido (el más antiguo válido cuenta).
    const valido = delTipo
      .filter((d) => d.estado === "valido")
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    const enRevision = delTipo.find((d) => d.estado === "pendiente_revision");
    const noSirve = delTipo.filter((d) => d.estado !== "valido" && d.estado !== "pendiente_revision").at(-1);

    if (valido) {
      checklist.push({ tipo: req, nombre: NOMBRE_DOCUMENTO[req], situacion: "recibido_valido", detalle: "Recibido y revisado.", documentoId: valido.id });
      fechasValidas.push(valido.created_at);
    } else if (enRevision) {
      checklist.push({ tipo: req, nombre: NOMBRE_DOCUMENTO[req], situacion: "en_revision", detalle: "Lo estamos revisando.", documentoId: enRevision.id });
    } else if (noSirve) {
      const motivoBase = MOTIVO_ESTADO[noSirve.estado as keyof typeof MOTIVO_ESTADO] ?? "Llegó, pero no se pudo aceptar.";
      checklist.push({
        tipo: req,
        nombre: NOMBRE_DOCUMENTO[req],
        situacion: "recibido_no_sirve",
        detalle: noSirve.motivo ? `${motivoBase} ${noSirve.motivo}` : motivoBase,
        documentoId: noSirve.id,
      });
    } else {
      checklist.push({ tipo: req, nombre: NOMBRE_DOCUMENTO[req], situacion: "falta", detalle: AYUDA_DOCUMENTO[req] });
    }
  }

  const completo = checklist.every((i) => i.situacion === "recibido_valido");
  const extras = documentos.filter((d) => !d.tipo_detectado || !requeridos.includes(d.tipo_detectado));

  return {
    completo,
    checklist,
    completoDesde: completo ? fechasValidas.sort().at(-1) ?? null : null,
    extras,
  };
}

export function resumenParaBeneficiario(radicado: string, evaluacion: Evaluacion, nombre: string): { asunto: string; cuerpo: string } {
  const primerNombre = nombre.split(" ")[0];
  if (evaluacion.completo) {
    return {
      asunto: `Su reclamación ${radicado} está completa`,
      cuerpo:
        `${primerNombre}, recibimos todos los documentos de su reclamación ${radicado}. ` +
        `Su expediente quedó completo y ya está en manos de un analista. ` +
        `No necesita enviar nada más por ahora; le escribiremos cuando haya una decisión.`,
    };
  }
  const noSirven = evaluacion.checklist.filter((i) => i.situacion === "recibido_no_sirve");
  const faltan = evaluacion.checklist.filter((i) => i.situacion === "falta");
  const lineas: string[] = [];
  if (noSirven.length) {
    lineas.push("Documentos que llegaron pero necesitamos que vuelva a enviar:");
    noSirven.forEach((i) => lineas.push(`• ${i.nombre}: ${i.detalle}`));
  }
  if (faltan.length) {
    lineas.push("Documentos que aún no hemos recibido:");
    faltan.forEach((i) => lineas.push(`• ${i.nombre}. ${i.detalle}`));
  }
  return {
    asunto: `Su reclamación ${radicado}: le falta${noSirven.length + faltan.length > 1 ? "n" : ""} ${noSirven.length + faltan.length} documento${noSirven.length + faltan.length > 1 ? "s" : ""}`,
    cuerpo:
      `${primerNombre}, ya revisamos lo que nos envió para la reclamación ${radicado}. ` +
      `Para continuar necesitamos lo siguiente:\n\n${lineas.join("\n")}\n\n` +
      `Puede subirlos desde el mismo enlace de seguimiento, sin crear usuario. ` +
      `El plazo de respuesta de la aseguradora empieza a contar cuando el expediente esté completo.`,
  };
}
