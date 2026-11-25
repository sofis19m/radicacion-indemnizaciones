// Generador de documentos sintéticos para el conjunto de prueba.
// Todos los datos son ficticios. Cada documento se genera con TODOS los
// elementos que exige la ficha técnica (src/lib/ia/fichas-documentos.ts), y
// puede salir en una "variante" que simula un problema real.
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";

export type Persona = { nombre: string; cedula: string };
export type Variante =
  | "ok"
  | "sin_firma"      // sin firma ni huella del firmante
  | "ilegible"       // foto borrosa (se genera como PNG, ver generarFotoIlegible)
  | "otra_persona"   // a nombre de alguien distinto
  | "frente"         // documento de identidad: solo la cara frontal
  | "reverso"        // documento de identidad: solo la cara posterior
  | "vencido";       // certificación bancaria de hace más de 30 días

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
  | "factura_servicios"; // documento que no es ningún soporte

export type Contexto = {
  asegurado: Persona;
  beneficiario: Persona;
  fechaEvento: string;
  causa: string;
  ciudad: string;
};

const EXTRAÑO: Persona = { nombre: "RODRIGO ALBERTO PINEDA SUÁREZ", cedula: "79.555.321" };

function hoyMenos(dias: number) {
  const d = new Date(Date.now() - dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function texto(page: PDFPage, font: PDFFont, s: string, x: number, y: number, size = 10, color = rgb(0.1, 0.1, 0.1)) {
  page.drawText(s, { x, y, size, font, color });
}

function firma(page: PDFPage, x: number, y: number) {
  const puntos = [0, 6, -4, 10, -2, 8, 3, -5, 7, 2, -6, 4, 9, -3, 5];
  for (let i = 0; i < puntos.length - 1; i++) {
    page.drawLine({ start: { x: x + i * 8, y: y + puntos[i] }, end: { x: x + (i + 1) * 8, y: y + puntos[i + 1] }, thickness: 1.5, color: rgb(0.05, 0.1, 0.45) });
  }
}

function huella(page: PDFPage, font: PDFFont, x: number, y: number) {
  for (let r = 4; r <= 22; r += 3) page.drawEllipse({ x, y, xScale: r * 0.75, yScale: r, borderColor: rgb(0.25, 0.25, 0.3), borderWidth: 0.8 });
  texto(page, font, "Huella índice derecho", x - 38, y - 32, 7);
}

function sello(page: PDFPage, bold: PDFFont, x: number, y: number, entidad: string) {
  page.drawCircle({ x, y, size: 38, borderColor: rgb(0.55, 0.1, 0.15), borderWidth: 2, opacity: 0.9 });
  page.drawCircle({ x, y, size: 30, borderColor: rgb(0.55, 0.1, 0.15), borderWidth: 0.8 });
  texto(page, bold, "SELLO", x - 14, y + 4, 9, rgb(0.55, 0.1, 0.15));
  texto(page, bold, entidad.slice(0, 16), x - 30, y - 9, 6, rgb(0.55, 0.1, 0.15));
}

function encabezado(page: PDFPage, bold: PDFFont, titulo: string, entidad: string) {
  texto(page, bold, entidad, 50, 795, 9, rgb(0.3, 0.3, 0.3));
  texto(page, bold, titulo, 50, 770, 15);
  page.drawLine({ start: { x: 50, y: 760 }, end: { x: 545, y: 760 }, thickness: 1 });
}

function campos(page: PDFPage, font: PDFFont, bold: PDFFont, lista: [string, string][], yInicial = 735) {
  let y = yInicial;
  for (const [k, v] of lista) {
    texto(page, bold, `${k}:`, 50, y, 10);
    texto(page, font, v, 245, y, 10);
    y -= 20;
  }
  return y;
}

/** Bloque de firma (+ huella opcional) de quien firma el documento. */
function bloqueFirma(page: PDFPage, font: PDFFont, y: number, quien: string, conFirma: boolean, conHuella: boolean, detalle?: string) {
  texto(page, font, "Firma:", 50, y, 10);
  page.drawLine({ start: { x: 90, y: y - 2 }, end: { x: 290, y: y - 2 }, thickness: 0.6 });
  if (conFirma) firma(page, 105, y + 6);
  texto(page, font, quien, 90, y - 14, 8);
  if (detalle) texto(page, font, detalle, 90, y - 25, 8);
  if (conHuella) huella(page, font, 360, y + 4);
  else {
    page.drawRectangle({ x: 335, y: y - 18, width: 50, height: 46, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.6 });
    texto(page, font, "Huella", 345, y - 30, 7);
  }
}

export async function generarDocumento(tipo: TipoDocPrueba, ctx: Contexto, variante: Variante = "ok"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const otra = variante === "otra_persona";
  const asegurado = otra && ["documento_identidad_asegurado", "registro_civil_defuncion", "certificado_medico_defuncion", "dictamen_pcl", "historia_clinica"].includes(tipo) ? EXTRAÑO : ctx.asegurado;
  const beneficiario = otra && ["documento_identidad_beneficiario", "certificacion_bancaria"].includes(tipo) ? EXTRAÑO : ctx.beneficiario;
  const firmado = variante !== "sin_firma";
  let y = 0;

  switch (tipo) {
    case "formato_reclamacion":
      encabezado(page, bold, "FORMATO DE RECLAMACIÓN – SEGURO DE VIDA", "Aseguradora · Gerencia de Indemnizaciones");
      y = campos(page, font, bold, [
        ["Número de póliza", "VG-2019-004587"],
        ["Tomador", "Empresa Ejemplo S.A.S. · NIT 900.123.456-7"],
        ["Asegurado", `${ctx.asegurado.nombre} · C.C. ${ctx.asegurado.cedula}`],
        ["Beneficiario / reclamante", `${ctx.beneficiario.nombre} · C.C. ${ctx.beneficiario.cedula}`],
        ["Fecha del siniestro", ctx.fechaEvento],
        ["Lugar del siniestro", ctx.ciudad],
        ["Causa", ctx.causa],
        ["Cobertura reclamada", "Amparo básico de vida"],
        ["Fecha de diligenciamiento", hoyMenos(2)],
      ]);
      bloqueFirma(page, font, y - 40, ctx.beneficiario.nombre, firmado, firmado, `C.C. ${ctx.beneficiario.cedula}`);
      break;

    case "registro_civil_defuncion":
      encabezado(page, bold, "REGISTRO CIVIL DE DEFUNCIÓN", "República de Colombia · Registraduría Nacional del Estado Civil");
      y = campos(page, font, bold, [
        ["Indicativo serial", "09876543"],
        ["Nombres y apellidos del inscrito", asegurado.nombre],
        ["Documento de identificación", `C.C. ${asegurado.cedula}`],
        ["Fecha de la defunción", ctx.fechaEvento],
        ["Hora de la defunción", "04:35"],
        ["Lugar de la defunción", ctx.ciudad],
        ["Declarante", `${ctx.beneficiario.nombre} · C.C. ${ctx.beneficiario.cedula}`],
        ["Oficina de registro", "Notaría 12 del Círculo"],
      ]);
      bloqueFirma(page, font, y - 40, "Funcionario registrador", firmado, false, "Notaría 12 del Círculo");
      sello(page, bold, 470, y - 40, "NOTARÍA 12");
      break;

    case "certificado_medico_defuncion":
      encabezado(page, bold, "CERTIFICADO DE DEFUNCIÓN · ANTECEDENTE PARA EL REGISTRO CIVIL", "Ministerio de Salud y Protección Social · DANE");
      y = campos(page, font, bold, [
        ["Nombre del fallecido", asegurado.nombre],
        ["Identificación", `C.C. ${asegurado.cedula}`],
        ["Fecha de defunción", ctx.fechaEvento],
        ["Hora de defunción", "04:35"],
        ["Causa directa", ctx.causa],
        ["Causa básica", ctx.causa],
        ["Médico certificador", "Dra. Laura Méndez Rojas"],
        ["Registro médico", "RM 52-334"],
        ["Institución", "Clínica San Rafael"],
      ]);
      bloqueFirma(page, font, y - 40, "Dra. Laura Méndez Rojas", firmado, false, "Registro médico RM 52-334");
      break;

    case "documento_identidad_asegurado":
    case "documento_identidad_beneficiario": {
      const p = tipo === "documento_identidad_asegurado" ? asegurado : beneficiario;
      const partes = p.nombre.split(" ");
      const verFrente = variante !== "reverso";
      const verReverso = variante !== "frente";
      encabezado(page, bold, "CÉDULA DE CIUDADANÍA", "REPÚBLICA DE COLOMBIA · IDENTIFICACIÓN PERSONAL");
      if (verFrente) {
        texto(page, font, "FRENTE", 50, 740, 8);
        page.drawRectangle({ x: 50, y: 530, width: 330, height: 200, borderWidth: 1.5, borderColor: rgb(0.2, 0.2, 0.5) });
        texto(page, bold, "REPÚBLICA DE COLOMBIA", 70, 710, 9);
        texto(page, bold, `NÚMERO ${p.cedula}`, 70, 690, 13);
        texto(page, font, "APELLIDOS", 70, 665, 7);
        texto(page, bold, partes.slice(-2).join(" "), 70, 652, 11);
        texto(page, font, "NOMBRES", 70, 630, 7);
        texto(page, bold, partes.slice(0, -2).join(" "), 70, 617, 11);
        page.drawRectangle({ x: 290, y: 570, width: 70, height: 90, color: rgb(0.85, 0.85, 0.88) });
        page.drawLine({ start: { x: 70, y: 560 }, end: { x: 230, y: 560 }, thickness: 0.5 });
        firma(page, 80, 566);
        texto(page, font, "FIRMA", 70, 548, 7);
      }
      if (verReverso) {
        const base = verFrente ? 280 : 530;
        texto(page, font, "REVERSO", 50, base + 210, 8);
        page.drawRectangle({ x: 50, y: base, width: 330, height: 200, borderWidth: 1.5, borderColor: rgb(0.2, 0.2, 0.5) });
        texto(page, font, "FECHA DE NACIMIENTO  14-MAR-1961", 70, base + 170, 9);
        texto(page, font, "LUGAR DE NACIMIENTO  BOGOTÁ D.C.", 70, base + 152, 9);
        texto(page, font, "ESTATURA 1.68   G.S. RH O+   SEXO M", 70, base + 134, 9);
        texto(page, font, "FECHA Y LUGAR DE EXPEDICIÓN  02-JUN-1983 BOGOTÁ D.C.", 70, base + 116, 9);
        huella(page, font, 320, base + 140);
        texto(page, font, `${p.cedula.replace(/\D/g, "")}<<<<<<<<<COL<<<<<<<<<<<<<<<`, 70, base + 30, 9);
      }
      break;
    }

    case "formulario_sarlaft":
      encabezado(page, bold, "FORMULARIO DE CONOCIMIENTO DEL CLIENTE – SARLAFT", "Sistema de Administración del Riesgo de LA/FT · Versión 2026");
      y = campos(page, font, bold, [
        ["Nombre completo", ctx.beneficiario.nombre],
        ["Identificación", `C.C. ${ctx.beneficiario.cedula}`],
        ["Dirección y teléfono", "Calle 45 # 12-30 · 300 123 4567"],
        ["Actividad económica", "Empleado"],
        ["Ingresos mensuales", "$ 3.200.000"],
        ["Egresos mensuales", "$ 2.100.000"],
        ["Activos / Pasivos", "$ 85.000.000 / $ 12.000.000"],
        ["Origen de fondos", "Indemnización de seguro de vida"],
        ["¿Es PEP?", "No"],
        ["Fecha de diligenciamiento", hoyMenos(2)],
      ]);
      texto(page, font, "Declaro que la información suministrada es veraz y autorizo su verificación.", 50, y - 5, 9);
      bloqueFirma(page, font, y - 50, ctx.beneficiario.nombre, firmado, firmado, `C.C. ${ctx.beneficiario.cedula}`);
      break;

    case "certificacion_bancaria":
      encabezado(page, bold, "CERTIFICACIÓN BANCARIA", "Banco Ejemplo S.A. · NIT 860.000.000-1");
      texto(page, font, "El Banco certifica que la persona relacionada a continuación posee el siguiente producto:", 50, 735, 10);
      y = campos(page, font, bold, [
        ["Titular", beneficiario.nombre],
        ["Identificación", `C.C. ${beneficiario.cedula}`],
        ["Tipo de cuenta", "Ahorros"],
        ["Número de cuenta", "0045-1234-5678"],
        ["Estado", "Activa"],
        ["Fecha de expedición", variante === "vencido" ? hoyMenos(75) : hoyMenos(5)],
      ], 705);
      bloqueFirma(page, font, y - 40, "Gerente de oficina", true, false, "Banco Ejemplo S.A. · Oficina Centro");
      sello(page, bold, 470, y - 40, "BANCO EJEMPLO");
      break;

    case "informe_autoridad":
      encabezado(page, bold, "INFORME DE POLICÍA / NOTICIA CRIMINAL", "Policía Nacional · Fiscalía General de la Nación");
      y = campos(page, font, bold, [
        ["Número de radicado (SPOA)", "110016000050202612345"],
        ["Informe policial (IPAT)", "A000981234"],
        ["Fecha y hora del hecho", `${ctx.fechaEvento} · 18:40`],
        ["Lugar", ctx.ciudad],
        ["Víctima", `${ctx.asegurado.nombre} · C.C. ${ctx.asegurado.cedula}`],
        ["Descripción de los hechos", ctx.causa],
        ["Anexos", "Croquis del lugar y acta de inspección técnica a cadáver"],
        ["Funcionario", "Patrullero Andrés Gómez · Placa 08765"],
      ]);
      bloqueFirma(page, font, y - 40, "Patrullero Andrés Gómez", firmado, false, "Policía Nacional · Placa 08765");
      sello(page, bold, 470, y - 40, "POLICÍA NAL.");
      break;

    case "dictamen_pcl":
      encabezado(page, bold, "DICTAMEN DE PÉRDIDA DE CAPACIDAD LABORAL", "Junta Regional de Calificación de Invalidez");
      y = campos(page, font, bold, [
        ["Calificado", asegurado.nombre],
        ["Identificación", `C.C. ${asegurado.cedula}`],
        ["Diagnósticos", ctx.causa],
        ["Porcentaje de PCL", "68,40 %"],
        ["Fecha de estructuración", ctx.fechaEvento],
        ["Origen", "Enfermedad común"],
        ["Notificación y ejecutoria", "Notificado el 2026-09-01 · en firme el 2026-09-15"],
      ]);
      bloqueFirma(page, font, y - 40, "Médico ponente · Junta Regional", firmado, false, "Firmas de los tres miembros de la junta");
      if (firmado) firma(page, 105, y - 85);
      sello(page, bold, 470, y - 40, "JUNTA REGIONAL");
      break;

    case "historia_clinica":
      encabezado(page, bold, "RESUMEN DE HISTORIA CLÍNICA (EPICRISIS)", "Hospital Universitario · Servicio de Neurología");
      y = campos(page, font, bold, [
        ["Paciente", asegurado.nombre],
        ["Documento", `C.C. ${asegurado.cedula}`],
        ["Fechas de atención", `${ctx.fechaEvento} a 2026-08-20`],
        ["Diagnóstico principal", ctx.causa],
        ["Procedimientos", "Imágenes diagnósticas, manejo intrahospitalario, rehabilitación"],
        ["Evolución", "Secuelas permanentes, dependencia funcional"],
        ["Médico tratante", "Dr. Felipe Arango · RM 76-118"],
      ]);
      bloqueFirma(page, font, y - 40, "Dr. Felipe Arango", firmado, false, "Registro médico RM 76-118");
      sello(page, bold, 470, y - 40, "HOSP. UNIVERSIT.");
      break;

    case "factura_servicios":
      encabezado(page, bold, "FACTURA DE SERVICIOS PÚBLICOS", "Empresa de Acueducto y Alcantarillado");
      campos(page, font, bold, [["Suscriptor", ctx.beneficiario.nombre], ["Periodo", "Octubre 2026"], ["Total a pagar", "$ 87.450"]]);
      break;
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
  bloque(40, 40, 380, 26, 70);
  for (let r = 0; r < 18; r++) {
    const y = 110 + r * 34;
    bloque(40, y, 140, 12, 95);
    let x = 200;
    while (x < 540) { const w = 15 + rnd() * 45; bloque(x, y, w, 12, 80 + rnd() * 40); x += w + 8; }
  }
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
