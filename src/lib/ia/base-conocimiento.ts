// =============================================================================
// BASE DE CONOCIMIENTO PARA CLASIFICAR EL TIPO DE RECLAMACIÓN
//
// Este archivo es la fuente única de "cómo se reconoce cada tipo". Se usa en
// dos lugares:
//   1. clasificarPreliminar(): cálculo instantáneo SIN IA al momento de radicar,
//      a partir de las frases del relato y de los archivos recibidos.
//   2. El prompt del modelo: se le entrega este mismo conocimiento como guía.
//
// Si el negocio quiere ajustar cómo se reconoce un tipo, se edita AQUÍ.
// =============================================================================
import type { TipoReclamacion, TipoDocumento } from "@/lib/dominio";

type Señales = {
  descripcion: string;
  /** Frases o palabras típicas en el relato (en minúscula, sin tildes). */
  frases: { patron: RegExp; peso: number; ejemplo: string }[];
  /** Documentos cuya presencia apunta a este tipo. */
  documentosQueLoIndican: { tipo: TipoDocumento; peso: number }[];
  /** Cantidad de documentos que exige un expediente completo de este tipo. */
  documentosRequeridos: number;
};

export const BASE_CONOCIMIENTO: Record<TipoReclamacion, Señales> = {
  muerte_natural: {
    descripcion:
      "El asegurado falleció por una causa interna del cuerpo: enfermedad, vejez o un evento médico (infarto, derrame, cáncer, infección). No hubo una causa externa, violenta ni súbita ajena a su salud.",
    frases: [
      { patron: /\b(infarto|paro (cardiac\w*|cardiorrespiratorio|respiratorio)|ataque al corazon|problemas? del corazon|falla cardiac\w*)\b/, peso: 3, ejemplo: "le dio un infarto" },
      { patron: /\b(cancer|tumor|metastasis|leucemia|quimioterapia)\b/, peso: 3, ejemplo: "murió de cáncer" },
      { patron: /\b(derrame|acv|accidente cerebrovascular|trombosis|embolia)\b/, peso: 2, ejemplo: "tuvo un derrame cerebral" },
      { patron: /\b(enferm[oa]|enfermedad|diabetes|neumonia|covid|infeccion|sepsis|epoc|cirrosis|insuficiencia (renal|respiratoria|cardiaca))\b/, peso: 2, ejemplo: "estaba enfermo hace años" },
      { patron: /\b(vejez|edad avanzada|muerte natural|causas naturales|murio dormid[oa]|se murio dormid[oa]|en su cama)\b/, peso: 2, ejemplo: "murió de vejez" },
      { patron: /\b(hospitalizad[oa]|en la clinica|en el hospital|uci|cuidados intensivos)\b/, peso: 1, ejemplo: "falleció en la clínica" },
    ],
    documentosQueLoIndican: [
      { tipo: "certificado_medico_defuncion", peso: 1 },
      { tipo: "registro_civil_defuncion", peso: 1 },
    ],
    documentosRequeridos: 7,
  },

  muerte_accidental: {
    descripcion:
      "El asegurado falleció por una causa externa, súbita y violenta, ajena a su voluntad: accidente de tránsito, caída, ahogamiento, electrocución, quemadura, intoxicación accidental o una agresión de un tercero. Normalmente interviene la policía, la fiscalía o medicina legal.",
    frases: [
      { patron: /\b(accidente|accidentad[oa]|choque|chocaron|choco|estrell\w+|volc\w+)\b/, peso: 3, ejemplo: "tuvo un accidente de moto" },
      { patron: /\b(atropell\w+|lo cogio un carro|la cogio un carro|moto|motocicleta|bus|camion|carretera|autopista)\b/, peso: 2, ejemplo: "lo atropelló un bus" },
      { patron: /\b(se cayo|cayo de|caida|desde una altura|andamio|escalera|obra)\b/, peso: 2, ejemplo: "se cayó en la obra" },
      { patron: /\b(ahog\w+|electrocut\w+|descarga electrica|quemad\w+|incendio|explosion|intoxica\w+|monoxido)\b/, peso: 3, ejemplo: "murió ahogado" },
      { patron: /\b(lo mataron|la mataron|asesin\w+|homicidio|disparo|bala|arma|atraco|robo|apunal\w+)\b/, peso: 3, ejemplo: "lo mataron en un atraco" },
      { patron: /\b(policia|fiscalia|medicina legal|necropsia|levantamiento|transito)\b/, peso: 2, ejemplo: "la policía hizo el informe" },
    ],
    documentosQueLoIndican: [{ tipo: "informe_autoridad", peso: 5 }],
    documentosRequeridos: 8,
  },

  incapacidad_total_permanente: {
    descripcion:
      "El asegurado está VIVO pero quedó con una invalidez que le impide trabajar de forma permanente, reconocida con un dictamen de pérdida de capacidad laboral (normalmente 50 % o más). Muchas veces quien reclama es el propio asegurado.",
    frases: [
      { patron: /\b(invalidez|invalid[oa]|incapacidad (total|permanente)|perdida de capacidad|pcl|junta (regional|nacional|de calificacion)|calificaron|dictamen)\b/, peso: 4, ejemplo: "la junta me calificó con 60 %" },
      { patron: /\b(ya no puedo trabajar|no puedo volver a trabajar|quede (paralizad[oa]|en silla|cieg[oa]|sin poder)|silla de ruedas|paralisis|hemiplejia|paraplejia|cuadriplejia)\b/, peso: 3, ejemplo: "quedé en silla de ruedas" },
      { patron: /\b(dialisis|amputa\w+|perdi la vista|ceguera|esclerosis)\b/, peso: 2, ejemplo: "estoy en diálisis" },
      { patron: /\b(yo (soy|tengo|tuve|quede)|me (dio|dieron|calificaron|declararon))\b/, peso: 1, ejemplo: "me declararon inválida" },
    ],
    documentosQueLoIndican: [
      { tipo: "dictamen_pcl", peso: 5 },
      { tipo: "historia_clinica", peso: 2 },
    ],
    documentosRequeridos: 6,
  },
};

/**
 * Casos borde: situaciones donde las señales confunden. Se le entregan al
 * modelo para que no se equivoque y para que baje su confianza cuando aplique.
 */
export const CASOS_BORDE = [
  "Muerte en el hospital DESPUÉS de un accidente o una caída (\"se cayó y murió dos días después en la clínica\"): es ACCIDENTAL, aunque el relato mencione el hospital. La causa que cuenta es la que originó la muerte.",
  "Homicidio o agresión de un tercero: se trata como ACCIDENTAL (causa externa y violenta), pero el clausulado de algunas pólizas lo trata distinto. Clasifícalo como accidental y menciónalo en la razón para que el analista lo confirme.",
  "Suicidio: NO lo clasifiques con seguridad. Usa confianza menor a 0.5 y explica que requiere revisión humana (puede estar excluido según el clausulado y la antigüedad de la póliza).",
  "Infarto o desmayo MIENTRAS conducía y luego un choque: la causa puede ser natural o accidental. Confianza menor a 0.6 y explícalo.",
  "Relato que dice \"murió dormido\" o \"no sabemos qué pasó\" pero llega un informe de autoridad o necropsia con causa externa (p. ej. monóxido de carbono): manda el DOCUMENTO sobre el relato → accidental.",
  "Incapacidad vs. muerte: si hay registro civil de defunción o certificado de defunción, el asegurado falleció; NO es incapacidad aunque antes haya tenido una invalidez.",
  "Relato muy vago (\"necesito reclamar el seguro de mi papá\") y sin documentos clínicos ni de autoridad: no hay base para decidir. Confianza menor a 0.5.",
];

// -----------------------------------------------------------------------------
// Clasificación preliminar (sin IA)
// -----------------------------------------------------------------------------

function normalizar(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Pistas de tipo de documento a partir del NOMBRE del archivo (antes de leerlo). */
const PISTAS_NOMBRE: { patron: RegExp; tipo: TipoDocumento }[] = [
  { patron: /(informe|ipat|policia|fiscalia|noticia.?criminal|medicina.?legal|necropsia)/, tipo: "informe_autoridad" },
  { patron: /(dictamen|pcl|junta|calificacion|invalidez)/, tipo: "dictamen_pcl" },
  { patron: /(historia.?clinica|epicrisis)/, tipo: "historia_clinica" },
  { patron: /(registro.?civil|defuncion)/, tipo: "registro_civil_defuncion" },
  { patron: /(certificado.?medico|certificado.?de.?defuncion)/, tipo: "certificado_medico_defuncion" },
];

export type Preliminar = {
  tipo: TipoReclamacion | null;
  puntajes: Record<TipoReclamacion, number>;
  frasesEncontradas: { tipo: TipoReclamacion; ejemplo: string; texto: string }[];
  pistasArchivos: string[];
  explicacion: string;
};

/**
 * Clasificación preliminar al momento de radicar, antes de leer los documentos.
 * Suma puntos por frases del relato, por los nombres de los archivos y, como
 * pista débil, por la cantidad de archivos. No decide nada: orienta al modelo y
 * queda registrada para comparar con la clasificación final.
 */
export function clasificarPreliminar(relato: string, archivos: { nombre: string }[]): Preliminar {
  const texto = normalizar(relato);
  const puntajes: Record<TipoReclamacion, number> = { muerte_natural: 0, muerte_accidental: 0, incapacidad_total_permanente: 0 };
  const frasesEncontradas: Preliminar["frasesEncontradas"] = [];
  const pistasArchivos: string[] = [];

  for (const [tipo, s] of Object.entries(BASE_CONOCIMIENTO) as [TipoReclamacion, Señales][]) {
    for (const f of s.frases) {
      const m = texto.match(f.patron);
      if (m) {
        puntajes[tipo] += f.peso;
        frasesEncontradas.push({ tipo, ejemplo: f.ejemplo, texto: m[0] });
      }
    }
  }

  // Nombres de archivo: pista media (el beneficiario los nombra como quiere)
  const tiposPorNombre = new Set<TipoDocumento>();
  for (const a of archivos) {
    const n = normalizar(a.nombre);
    for (const p of PISTAS_NOMBRE) if (p.patron.test(n)) tiposPorNombre.add(p.tipo);
  }
  for (const [tipo, s] of Object.entries(BASE_CONOCIMIENTO) as [TipoReclamacion, Señales][]) {
    for (const d of s.documentosQueLoIndican) {
      if (tiposPorNombre.has(d.tipo)) {
        puntajes[tipo] += Math.ceil(d.peso / 2);
        pistasArchivos.push(`archivo con nombre de ${d.tipo.replaceAll("_", " ")}`);
      }
    }
  }
  // Si hay documentos de defunción por nombre, no es incapacidad
  if (tiposPorNombre.has("registro_civil_defuncion") || tiposPorNombre.has("certificado_medico_defuncion")) {
    puntajes.incapacidad_total_permanente = Math.max(0, puntajes.incapacidad_total_permanente - 3);
  }

  // Cantidad de archivos: pista DÉBIL (el 62 % de los expedientes llega incompleto)
  const n = archivos.length;
  if (n >= 8) {
    puntajes.muerte_accidental += 1;
    pistasArchivos.push(`${n} archivos (coincide con los 8 de muerte accidental)`);
  } else if (n === 7) {
    puntajes.muerte_natural += 1;
    pistasArchivos.push("7 archivos (coincide con los 7 de muerte natural)");
  } else if (n === 6) {
    puntajes.incapacidad_total_permanente += 1;
    pistasArchivos.push("6 archivos (coincide con los 6 de incapacidad)");
  }

  const orden = (Object.entries(puntajes) as [TipoReclamacion, number][]).sort((a, b) => b[1] - a[1]);
  const [primero, segundo] = orden;
  // Solo se propone un tipo si hay evidencia y una ventaja clara sobre el segundo
  const tipo = primero[1] >= 2 && primero[1] - segundo[1] >= 2 ? primero[0] : null;

  const explicacion = tipo
    ? `Pista inicial: ${tipo.replaceAll("_", " ")} (${primero[1]} puntos vs. ${segundo[1]}).`
    : "Sin pista clara en el relato ni en los archivos: el modelo debe decidir con los documentos.";

  return { tipo, puntajes, frasesEncontradas, pistasArchivos, explicacion };
}

/** Texto de la base de conocimiento para incluir en las instrucciones del modelo. */
export function baseParaPrompt(): string {
  const tipos = (Object.entries(BASE_CONOCIMIENTO) as [TipoReclamacion, Señales][])
    .map(([tipo, s]) => {
      const ejemplos = s.frases.map((f) => `"${f.ejemplo}"`).join(", ");
      const docs = s.documentosQueLoIndican.map((d) => d.tipo).join(", ");
      return `■ ${tipo}\n  Qué es: ${s.descripcion}\n  Frases típicas en el relato: ${ejemplos}\n  Documentos que lo indican: ${docs}\n  Un expediente completo de este tipo tiene ${s.documentosRequeridos} documentos.`;
    })
    .join("\n\n");
  const bordes = CASOS_BORDE.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return `BASE DE CONOCIMIENTO\n\n${tipos}\n\nREGLA DE PRIORIDAD: los DOCUMENTOS pesan más que el relato. El relato lo escribe una persona en duelo, puede ser vago o impreciso; un informe de autoridad o un dictamen son evidencia objetiva.\n\nCASOS BORDE\n${bordes}`;
}
