import { NextResponse, after } from "next/server";
import { db } from "@/lib/supabase/admin";
import { registrarEvento } from "@/lib/eventos";
import { despacharAhora, encolarNotificacion } from "@/lib/motor";
import { crearCupos, DatosRadicacion, normalizarNumero } from "@/lib/radicacion";
import { ipDe, nuevoToken, permitirEnvio } from "@/lib/seguridad";
import { clasificarPreliminar } from "@/lib/ia/base-conocimiento";

export const runtime = "nodejs";

/**
 * Paso 1 de la radicación: registra los datos y entrega URLs firmadas para subir
 * los archivos directo al almacenamiento. Paso 2: /api/cargas/confirmar.
 */
export async function POST(req: Request) {
  try {
    return await radicar(req);
  } catch (e) {
    // Falla pasajera (red, almacenamiento, base): se responde con un mensaje claro.
    // Reintentar es seguro: la llave de idempotencia evita un segundo expediente.
    console.error("[radicar] error inesperado", e);
    return NextResponse.json(
      { error: "Tuvimos un problema momentáneo al registrar su reclamación. Intente de nuevo: si ya había llegado, no se duplicará." },
      { status: 503 },
    );
  }
}

async function radicar(req: Request) {
  if (!(await permitirEnvio(ipDe(req)))) {
    return NextResponse.json({ error: "Ha enviado muchas solicitudes. Intente de nuevo en una hora." }, { status: 429 });
  }

  const cuerpo = await req.json().catch(() => null);
  const datos = DatosRadicacion.safeParse(cuerpo);
  if (!datos.success) {
    return NextResponse.json({ error: "Revise los datos del formulario.", campos: datos.error.flatten().fieldErrors }, { status: 400 });
  }
  const d = datos.data;
  if (d.sitio_web) return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });

  const aseguradoDoc = normalizarNumero(d.asegurado_documento);
  const beneficiarioDoc = normalizarNumero(d.beneficiario_documento);

  // 1) Mismo envío repetido (doble clic, recarga, reintento de red).
  //    La llave de idempotencia es aleatoria y solo la tiene ese navegador.
  const { data: mismoEnvio } = await db().from("reclamaciones").select("id, radicado").eq("idempotency_key", d.idempotency_key).maybeSingle();
  if (mismoEnvio) return await responderRepetido(mismoEnvio, d.archivos);

  // 2) Misma reclamación radicada de nuevo (otro día, otro navegador): no se abre un
  //    segundo expediente ni se reinicia el reloj; los documentos se suman al abierto.
  const abierto = await casoAbierto(aseguradoDoc, beneficiarioDoc);
  if (abierto) return await responderExistente(abierto, d.archivos);

  // Clasificación preliminar instantánea (sin IA): orienta al modelo y queda registrada.
  const preliminar = clasificarPreliminar(d.relato, d.archivos);

  const { data: rec, error } = await db()
    .from("reclamaciones")
    .insert({
      tipo_preliminar: preliminar.tipo,
      preliminar,
      idempotency_key: d.idempotency_key,
      beneficiario_nombre: d.beneficiario_nombre,
      beneficiario_tipo_doc: d.beneficiario_tipo_doc,
      beneficiario_documento: beneficiarioDoc,
      beneficiario_email: d.beneficiario_email,
      beneficiario_telefono: d.beneficiario_telefono || null,
      parentesco: d.parentesco || null,
      situacion_declarada: d.situacion_declarada ?? null,
      asegurado_nombre: d.asegurado_nombre,
      asegurado_documento: aseguradoDoc,
      relato: d.relato,
      consentimiento_datos_at: new Date().toISOString(),
    })
    .select("id, radicado")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Carrera entre dos envíos simultáneos: la restricción única de la base decide.
      const { data: ganador } = await db().from("reclamaciones").select("id, radicado").eq("idempotency_key", d.idempotency_key).maybeSingle();
      if (ganador) return await responderRepetido(ganador, d.archivos);
      const otro = await casoAbierto(aseguradoDoc, beneficiarioDoc);
      if (otro) return await responderExistente(otro, d.archivos);
    }
    console.error("[radicar]", error);
    return NextResponse.json({ error: "No pudimos registrar su reclamación. Intente de nuevo en unos minutos." }, { status: 500 });
  }

  await registrarEvento(rec.id, "radicacion_recibida", "beneficiario", {
    canal: "web",
    relato: d.relato,
    asegurado_documento: aseguradoDoc,
    beneficiario_documento: beneficiarioDoc,
    archivos_anunciados: d.archivos.map((a) => ({ nombre: a.nombre, mime: a.mime, bytes: a.bytes })),
  });
  await registrarEvento(rec.id, "clasificacion_preliminar", "sistema", {
    tipo: preliminar.tipo,
    puntajes: preliminar.puntajes,
    frases: preliminar.frasesEncontradas,
    pistas_archivos: preliminar.pistasArchivos,
    explicacion: preliminar.explicacion,
  });

  const token = await nuevoEnlace(rec.id);
  const carga = await crearCupos(rec.id, d.archivos);

  // Confirmación de recibido, al instante (lo que promete la pantalla de éxito). Lo que
  // falta se le escribe en un segundo correo, apenas el motor termina de revisar.
  const primerNombre = d.beneficiario_nombre.trim().split(/\s+/)[0];
  await encolarNotificacion({
    reclamacionId: rec.id, destinatario: "beneficiario", canal: "email", tipo: "acuse_recibo",
    llave: `acuse_recibo:${rec.id}`,
    asunto: `Recibimos su reclamación ${rec.radicado}`,
    cuerpo:
      `${primerNombre.charAt(0)}${primerNombre.slice(1).toLowerCase()}, recibimos su reclamación. Su número de radicado es ${rec.radicado}.\n\n` +
      `Estamos revisando sus documentos. En unos minutos le escribiremos para contarle si su expediente quedó completo o qué le falta.\n\n` +
      `Lamentamos lo que está viviendo y estaremos acompañándole durante el proceso.`,
  });
  after(() => despacharAhora(rec.id));

  return NextResponse.json({ radicado: rec.radicado, token, ...carga });
}

async function nuevoEnlace(reclamacionId: string) {
  const { token, hash } = nuevoToken();
  await db().from("enlaces_seguimiento").insert({ token_hash: hash, reclamacion_id: reclamacionId });
  return token;
}

async function casoAbierto(aseguradoDoc: string, beneficiarioDoc: string) {
  const { data } = await db()
    .from("reclamaciones")
    .select("id, radicado")
    .eq("asegurado_documento", aseguradoDoc)
    .eq("beneficiario_documento", beneficiarioDoc)
    .neq("estado", "cerrado")
    .maybeSingle();
  return data;
}

async function responderRepetido(caso: { id: string; radicado: string }, archivos: DatosRadicacion["archivos"]) {
  await registrarEvento(caso.id, "envio_repetido_ignorado", "beneficiario", { motivo: "idempotency_key repetida" });
  const token = await nuevoEnlace(caso.id);
  // Si el primer intento se cortó antes de subir archivos, se permite subirlos ahora;
  // si alguno ya estaba, el SHA-256 lo detecta como duplicado al confirmar.
  const carga = await crearCupos(caso.id, archivos);
  return NextResponse.json({ radicado: caso.radicado, token, repetido: true, ...carga });
}

async function responderExistente(caso: { id: string; radicado: string }, archivos: DatosRadicacion["archivos"]) {
  await registrarEvento(caso.id, "radicacion_repetida_unificada", "beneficiario", { archivos: archivos.length });
  // Por seguridad el enlace del caso existente NO se muestra en pantalla: se envía al
  // correo registrado. Conocer dos números de cédula no debe dar acceso a un expediente.
  await encolarNotificacion({
    reclamacionId: caso.id, destinatario: "beneficiario", canal: "email", tipo: "radicacion_repetida",
    llave: `radicacion_repetida:${caso.id}:${Date.now()}`,
    asunto: `Recibimos nuevos documentos para su reclamación ${caso.radicado}`,
    cuerpo: `Ya existía una reclamación abierta (${caso.radicado}) para esta persona asegurada. No abrimos una nueva: los documentos que envió se agregaron a la existente y el plazo no se reinició.`,
  });
  const carga = await crearCupos(caso.id, archivos);
  after(() => despacharAhora(caso.id));
  return NextResponse.json({ radicado: caso.radicado, existente: true, ...carga });
}
