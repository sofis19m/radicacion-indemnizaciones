// Generador de documentos sintéticos (PDF) para el conjunto de prueba.
// Todos los datos son ficticios. Cada documento puede salir en una "variante"
// que simula un problema real: sin firma, ilegible, de otra persona, etc.
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";

export type Persona = { nombre: string; cedula: string };
export type Variante = "ok" | "sin_firma" | "ilegible" | "otra_persona";

export type TipoDocPrueba =
  | "formato_reclamacion"
  | "registro_civil_defuncion"
  | "certificado_medico_defuncion"
  | "documento_identidad_asegurado"
  | "documento_identidad_beneficiario"
  | "formulario_sarlaft"
  | "certificacion_bancaria"
  | "informe_autoridad"
  | "dictamen_pcl"
  | "historia_clinica"
  | "factura_servicios"; // documento que no tiene nada que ver

export type Contexto = {
  asegurado: Persona;
  beneficiario: Persona;
  fechaEvento: string;
  causa: string;
  ciudad: string;
};

const EXTRAÑO: Persona = { nombre: "RODRIGO ALBERTO PINEDA SUÁREZ", cedula: "79.555.321" };

function texto(page: PDFPage, font: PDFFont, s: string, x: number, y: number, size = 11, color = rgb(0.1, 0.1, 0.1)) {
  page.drawText(s, { x, y, size, font, color });
}

function firma(page: PDFPage, x: number, y: number) {
  // Trazo de firma manuscrita simulado
  const puntos = [0, 6, -4, 10, -2, 8, 3, -5, 7, 2, -6, 4, 9, -3, 5];
  for (let i = 0; i < puntos.length - 1; i++) {
    page.drawLine({ start: { x: x + i * 9, y: y + puntos[i] }, end: { x: x + (i + 1) * 9, y: y + puntos[i + 1] }, thickness: 1.6, color: rgb(0.05, 0.1, 0.45) });
  }
}

function encabezado(page: PDFPage, bold: PDFFont, titulo: string, entidad: string) {
  texto(page, bold, entidad, 50, 790, 10, rgb(0.3, 0.3, 0.3));
  texto(page, bold, titulo, 50, 760, 16);
  page.drawLine({ start: { x: 50, y: 750 }, end: { x: 545, y: 750 }, thickness: 1 });
}

function campos(page: PDFPage, font: PDFFont, bold: PDFFont, lista: [string, string][], yInicial = 720) {
  let y = yInicial;
  for (const [k, v] of lista) {
    texto(page, bold, `${k}:`, 50, y, 11);
    texto(page, font, v, 230, y, 11);
    y -= 24;
  }
  return y;
}

export async function generarDocumento(tipo: TipoDocPrueba, ctx: Contexto, variante: Variante = "ok"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const asegurado = variante === "otra_persona" && ["documento_identidad_asegurado", "registro_civil_defuncion", "certificado_medico_defuncion", "dictamen_pcl", "historia_clinica"].includes(tipo) ? EXTRAÑO : ctx.asegurado;
  const beneficiario = variante === "otra_persona" && ["documento_identidad_beneficiario", "certificacion_bancaria"].includes(tipo) ? EXTRAÑO : ctx.beneficiario;
  let y = 0;
  let llevaFirma = false;

  switch (tipo) {
    case "formato_reclamacion":
      encabezado(page, bold, "FORMATO DE RECLAMACIÓN – SEGURO DE VIDA", "Aseguradora · Gerencia de Indemnizaciones");
      y = campos(page, font, bold, [
        ["Nombre del asegurado", ctx.asegurado.nombre], ["Cédula del asegurado", ctx.asegurado.cedula],
        ["Nombre del reclamante", ctx.beneficiario.nombre], ["Cédula del reclamante", ctx.beneficiario.cedula],
        ["Fecha del evento", ctx.fechaEvento], ["Ciudad", ctx.ciudad], ["Descripción del evento", ctx.causa],
      ]);
      llevaFirma = true;
      break;
    case "registro_civil_defuncion":
      encabezado(page, bold, "REGISTRO CIVIL DE DEFUNCIÓN", "República de Colombia · Registraduría Nacional del Estado Civil");
      y = campos(page, font, bold, [
        ["Indicativo serial", "09876543"], ["Nombres y apellidos del inscrito", asegurado.nombre],
        ["Documento de identificación", `C.C. ${asegurado.cedula}`], ["Fecha de la defunción", ctx.fechaEvento],
        ["Lugar de la defunción", ctx.ciudad], ["Notaría", "Notaría 12 del Círculo"],
      ]);
      break;
    case "certificado_medico_defuncion":
      encabezado(page, bold, "CERTIFICADO DE DEFUNCIÓN (ANTECEDENTE PARA EL REGISTRO CIVIL)", "Ministerio de Salud y Protección Social · DANE");
      y = campos(page, font, bold, [
        ["Nombre del fallecido", asegurado.nombre], ["Identificación", `C.C. ${asegurado.cedula}`],
        ["Fecha de defunción", ctx.fechaEvento], ["Causa básica de muerte", ctx.causa],
        ["Médico certificador", "Dra. Laura Méndez R. · RM 52-334"], ["Institución", "Clínica San Rafael"],
      ]);
      llevaFirma = true;
      break;
    case "documento_identidad_asegurado":
    case "documento_identidad_beneficiario": {
      const p = tipo === "documento_identidad_asegurado" ? asegurado : beneficiario;
      encabezado(page, bold, "CÉDULA DE CIUDADANÍA", "REPÚBLICA DE COLOMBIA · IDENTIFICACIÓN PERSONAL");
      page.drawRectangle({ x: 50, y: 520, width: 330, height: 210, borderWidth: 1.5, borderColor: rgb(0.2, 0.2, 0.5) });
      texto(page, bold, `NÚMERO ${p.cedula}`, 70, 700, 14);
      const partes = p.nombre.split(" ");
      texto(page, font, "APELLIDOS", 70, 670, 8);
      texto(page, bold, partes.slice(-2).join(" "), 70, 655, 12);
      texto(page, font, "NOMBRES", 70, 630, 8);
      texto(page, bold, partes.slice(0, -2).join(" "), 70, 615, 12);
      texto(page, font, "FECHA DE NACIMIENTO  14-MAR-1961   LUGAR  BOGOTÁ D.C.", 70, 585, 9);
      page.drawRectangle({ x: 290, y: 560, width: 70, height: 90, color: rgb(0.85, 0.85, 0.88) });
      y = 500;
      break;
    }
    case "formulario_sarlaft":
      encabezado(page, bold, "FORMULARIO DE CONOCIMIENTO DEL CLIENTE – SARLAFT", "Sistema de Administración del Riesgo de LA/FT");
      y = campos(page, font, bold, [
        ["Nombre", ctx.beneficiario.nombre], ["Identificación", `C.C. ${ctx.beneficiario.cedula}`],
        ["Actividad económica", "Empleado"], ["Ingresos mensuales", "$ 3.200.000"],
        ["¿Es PEP?", "No"], ["Origen de fondos", "Indemnización de seguro de vida"],
      ]);
      texto(page, font, "Declaro que la información suministrada es veraz y autorizo su verificación.", 50, y - 10, 10);
      y -= 20;
      llevaFirma = true;
      break;
    case "certificacion_bancaria":
      encabezado(page, bold, "CERTIFICACIÓN BANCARIA", "Banco Ejemplo S.A. · NIT 860.000.000-1");
      texto(page, font, "El Banco certifica que la persona relacionada a continuación posee el siguiente producto:", 50, 720, 11);
      y = campos(page, font, bold, [
        ["Titular", beneficiario.nombre], ["Identificación", `C.C. ${beneficiario.cedula}`],
        ["Tipo de cuenta", "Ahorros"], ["Número de cuenta", "0045-1234-5678"], ["Estado", "Activa"], ["Fecha de expedición", "2026-11-18"],
      ], 690);
      break;
    case "informe_autoridad":
      encabezado(page, bold, "INFORME POLICIAL DE ACCIDENTE DE TRÁNSITO / NOTICIA CRIMINAL", "Policía Nacional · Fiscalía General de la Nación");
      y = campos(page, font, bold, [
        ["Número de informe", "IPAT-A000981234"], ["Fecha del hecho", ctx.fechaEvento], ["Lugar", ctx.ciudad],
        ["Víctima", ctx.asegurado.nombre], ["Identificación víctima", `C.C. ${ctx.asegurado.cedula}`],
        ["Descripción", ctx.causa], ["Autoridad que conoce", "Fiscalía Seccional 34"],
      ]);
      break;
    case "dictamen_pcl":
      encabezado(page, bold, "DICTAMEN DE PÉRDIDA DE CAPACIDAD LABORAL", "Junta Regional de Calificación de Invalidez");
      y = campos(page, font, bold, [
        ["Calificado", asegurado.nombre], ["Identificación", `C.C. ${asegurado.cedula}`],
        ["Diagnóstico", ctx.causa], ["Porcentaje de PCL", "68,40 %"], ["Fecha de estructuración", ctx.fechaEvento], ["Origen", "Enfermedad común"],
      ]);
      llevaFirma = true;
      break;
    case "historia_clinica":
      encabezado(page, bold, "RESUMEN DE HISTORIA CLÍNICA", "Hospital Universitario · Servicio de Neurología");
      y = campos(page, font, bold, [
        ["Paciente", asegurado.nombre], ["Documento", `C.C. ${asegurado.cedula}`],
        ["Diagnóstico principal", ctx.causa], ["Fecha de ingreso", ctx.fechaEvento],
        ["Evolución", "Secuelas permanentes, dependencia funcional para actividades básicas."],
      ]);
      break;
    case "factura_servicios":
      encabezado(page, bold, "FACTURA DE SERVICIOS PÚBLICOS", "Empresa de Acueducto y Alcantarillado");
      y = campos(page, font, bold, [["Suscriptor", ctx.beneficiario.nombre], ["Periodo", "Octubre 2026"], ["Total a pagar", "$ 87.450"]]);
      break;
  }

  if (llevaFirma) {
    const yf = Math.min(y - 40, 300);
    texto(page, font, "Firma:", 50, yf, 11);
    page.drawLine({ start: { x: 95, y: yf - 2 }, end: { x: 300, y: yf - 2 }, thickness: 0.6 });
    if (variante !== "sin_firma") firma(page, 110, yf + 6);
    texto(page, font, variante === "sin_firma" ? "" : ctx.beneficiario.nombre, 95, yf - 16, 8);
  }

  return pdf.save();
}

/**
 * Simula una foto de celular movida/desenfocada de un documento: se ve que es
 * un papel con renglones, pero no se puede leer nada. Es un PNG real (sin capa
 * de texto), así que nadie puede "leer por debajo" lo que la imagen no muestra.
 */
export function generarFotoIlegible(semilla = 1): Uint8Array {
  const W = 600, H = 800;
  const px = new Float32Array(W * H).fill(225);
  let s = semilla * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const bloque = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++)
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) px[y * W + x] = v;
  };
  bloque(40, 40, 380, 26, 70); // título
  for (let r = 0; r < 18; r++) {
    const y = 110 + r * 34;
    bloque(40, y, 140, 12, 95);
    let x = 200;
    while (x < 540) { const w = 15 + rnd() * 45; bloque(x, y, w, 12, 80 + rnd() * 40); x += w + 8; }
  }
  // Desenfoque fuerte (caja 21x21, tres pasadas) + ruido de sensor
  const tmp = new Float32Array(W * H);
  const R = 10;
  for (let pasada = 0; pasada < 3; pasada++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let acc = 0, n = 0;
      for (let k = -R; k <= R; k += 2) { const xx = x + k; if (xx >= 0 && xx < W) { acc += px[y * W + xx]; n++; } }
      tmp[y * W + x] = acc / n;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let acc = 0, n = 0;
      for (let k = -R; k <= R; k += 2) { const yy = y + k; if (yy >= 0 && yy < H) { acc += tmp[yy * W + x]; n++; } }
      px[y * W + x] = acc / n;
    }
  }
  const crudo = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) {
    crudo[y * (W + 1)] = 0;
    for (let x = 0; x < W; x++) crudo[y * (W + 1) + 1 + x] = Math.max(0, Math.min(255, px[y * W + x] + (rnd() - 0.5) * 30));
  }
  return codificarPNG(W, H, crudo);
}

function codificarPNG(w: number, h: number, filas: Buffer): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require("node:zlib") as typeof import("node:zlib");
  const crcTabla = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTabla[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const trozo = (tipo: string, datos: Buffer) => {
    const t = Buffer.concat([Buffer.from(tipo), datos]);
    const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr), trozo("IDAT", zlib.deflateSync(filas)), trozo("IEND", Buffer.alloc(0)),
  ]));
}
