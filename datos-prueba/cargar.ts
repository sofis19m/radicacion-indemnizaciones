// Carga el conjunto de prueba a través de la API REAL (mismo camino que un
// beneficiario): radicar → subir con URL firmada → confirmar → motor con IA.
// Al final compara lo que determinó el sistema con lo esperado y genera un reporte.
//
// Uso:  npx tsx datos-prueba/cargar.ts            (todos)
//       npx tsx datos-prueba/cargar.ts E05 E12    (solo algunos)
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ESCENARIOS, type DocEscenario, type Escenario } from "./escenarios";
import { generarDocumento, generarFotoIlegible } from "./documentos";

const APP = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SALIDA = "datos-prueba/generados";
const PAUSA_MS = Number(process.env.PAUSA_MS ?? 7000); // respeta el límite gratuito del modelo

type Archivo = { nombre: string; mime: string; bytes: Uint8Array; casilla: string | null };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function archivosDe(e: Escenario, docs: DocEscenario[], sufijo = ""): Promise<Archivo[]> {
  const ctx = { asegurado: { nombre: e.asegurado.nombre, cedula: fmt(e.asegurado.cedula) }, beneficiario: { nombre: e.beneficiario.nombre, cedula: fmt(e.beneficiario.cedula) }, ...e.contexto };
  const lista: Archivo[] = [];
  mkdirSync(`${SALIDA}/${e.id}`, { recursive: true });
  for (const [i, d] of docs.entries()) {
    // Lo "ilegible" se envía como foto borrosa (PNG), igual que llega desde un celular.
    const foto = d.variante === "ilegible";
    const bytes = foto ? generarFotoIlegible(Number(e.id.slice(1)) * 10 + i) : await generarDocumento(d.tipo, ctx, d.variante ?? "ok");
    // Nombre genérico, como el de una foto o un escaneo real: el nombre no le "sopla" el tipo al modelo
    const nombre = `${foto ? "IMG" : "documento"}_${i + 1}${sufijo}.${foto ? "png" : "pdf"}`;
    writeFileSync(`${SALIDA}/${e.id}/${d.tipo}${d.variante && d.variante !== "ok" ? "_" + d.variante : ""}${sufijo}.${foto ? "png" : "pdf"}`, bytes);
    const casilla = d.casilla ?? (d.tipo === "factura_servicios" ? "otros" : d.tipo);
    lista.push({ nombre, mime: foto ? "image/png" : "application/pdf", bytes, casilla: casilla === "otros" ? null : casilla });
  }
  if (e.especial === "falso_pdf" && !sufijo) {
    lista.push({ nombre: "certificacion_bancaria.pdf", mime: "application/pdf", bytes: new TextEncoder().encode("MZ esto no es un PDF, es un ejecutable disfrazado"), casilla: "certificacion_bancaria" });
  }
  if (e.especial === "repetido_en_envio" && !sufijo) lista.push({ ...lista[3], nombre: `copia_${lista[3].nombre}` });
  return lista;
}

function fmt(cedula: string) {
  return cedula.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function subir(cupos: { lote: string; secreto: string; cupos: { path: string; token: string }[] }, archivos: Archivo[]) {
  for (const [i, c] of cupos.cupos.entries()) {
    const { error } = await anon.storage.from("documentos").uploadToSignedUrl(c.path, c.token, archivos[i].bytes, { contentType: archivos[i].mime });
    if (error) console.warn("   ! subida", archivos[i].nombre, error.message);
  }
  const r = await fetch(`${APP}/api/cargas/confirmar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lote: cupos.lote, secreto: cupos.secreto }) });
  return r.json();
}

async function radicar(e: Escenario, archivos: Archivo[], llave: string) {
  const cuerpo = {
    beneficiario_nombre: e.beneficiario.nombre, beneficiario_tipo_doc: "CC", beneficiario_documento: e.beneficiario.cedula,
    beneficiario_email: e.beneficiario.email, beneficiario_telefono: "3001234567", parentesco: e.beneficiario.parentesco,
    asegurado_nombre: e.asegurado.nombre, asegurado_documento: e.asegurado.cedula, relato: e.relato,
    consentimiento: true, idempotency_key: llave,
    archivos: archivos.map((a) => ({ nombre: a.nombre, mime: a.mime, bytes: a.bytes.length, tipo_declarado: a.casilla })),
  };
  const r = await fetch(`${APP}/api/radicar`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(cuerpo) });
  const json = await r.json();
  if (!r.ok) throw new Error(`${e.id}: ${JSON.stringify(json)}`);
  const confirmacion = await subir(json, archivos);
  return { ...json, confirmacion };
}

async function esperarProcesamiento(radicado: string, maxMs = 90_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < maxMs) {
    const { data } = await admin.from("reclamaciones").select("id, estado").eq("radicado", radicado).single();
    const { count } = await admin.from("documentos").select("id", { count: "exact", head: true }).eq("reclamacion_id", data!.id).eq("estado", "pendiente_revision");
    if (data && data.estado !== "recibido" && !count) return data;
    await dormir(3000);
  }
  // Si after() no alcanzó, se fuerza el tick (lo mismo que haría el cron)
  await fetch(`${APP}/api/cron/tick`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  return null;
}

async function main() {
  const filtro = process.argv.slice(2);
  const escenarios = filtro.length ? ESCENARIOS.filter((e) => filtro.includes(e.id)) : ESCENARIOS;
  mkdirSync(SALIDA, { recursive: true });
  const resultados: Record<string, unknown>[] = [];

  for (const e of escenarios) {
    console.log(`\n▶ ${e.id} · ${e.descripcion}`);
    const archivos = await archivosDe(e, e.docs);
    const llave = randomUUID();
    const r1 = await radicar(e, archivos, llave);
    console.log(`   radicado ${r1.radicado} · aceptados ${r1.confirmacion.aceptados} · duplicados ${r1.confirmacion.duplicados} · rechazados ${r1.confirmacion.rechazados?.length ?? 0}`);

    if (e.duplicar === "mismo_envio") {
      const r2 = await radicar(e, archivos, llave);
      console.log(`   doble clic → ${r2.radicado} (repetido=${!!r2.repetido}) · aceptados ${r2.confirmacion.aceptados} · duplicados ${r2.confirmacion.duplicados}`);
    }
    await esperarProcesamiento(r1.radicado);

    if (e.duplicar === "nueva_radicacion") {
      const r2 = await radicar(e, archivos, randomUUID());
      console.log(`   reenvío → ${r2.radicado} (existente=${!!r2.existente}) · aceptados ${r2.confirmacion.aceptados} · duplicados ${r2.confirmacion.duplicados}`);
    }
    if (e.simular?.modo === "radicacion") {
      await admin.rpc("simular_radicacion_antigua", { p_radicado: r1.radicado, p_dias: e.simular.dias });
      console.log(`   radicación desplazada ${e.simular.dias} días atrás`);
    }
    if (e.luego?.length && !r1.token) {
      // Re-ejecución sobre un caso ya existente: el script emite un enlace como lo haría el correo.
      const { createHash, randomBytes } = await import("node:crypto");
      const t = randomBytes(32).toString("base64url");
      const { data: c } = await admin.from("reclamaciones").select("id").eq("radicado", r1.radicado).single();
      await admin.from("enlaces_seguimiento").insert({ token_hash: createHash("sha256").update(t).digest("hex"), reclamacion_id: c!.id });
      r1.token = t;
    }
    if (e.luego?.length && r1.token) {
      await dormir(PAUSA_MS);
      const tardios = await archivosDe(e, e.luego, "_tardio");
      const cupos = await fetch(`${APP}/api/seguimiento/${r1.token}/cupos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivos: tardios.map((a) => ({ nombre: a.nombre, mime: a.mime, bytes: a.bytes.length, tipo_declarado: a.casilla })) }),
      }).then((x) => x.json());
      const c = await subir(cupos, tardios);
      console.log(`   documentos tardíos desde el enlace de seguimiento · aceptados ${c.aceptados}`);
      await esperarProcesamiento(r1.radicado);
    }
    if (e.simular?.modo === "antiguedad") {
      await admin.rpc("simular_antiguedad", { p_radicado: r1.radicado, p_dias: e.simular.dias });
      console.log(`   antigüedad simulada: ${e.simular.dias} días`);
    }

    const { data: caso } = await admin.from("v_casos_plazo").select("*").eq("radicado", r1.radicado).single();
    const { data: rec } = await admin.from("reclamaciones").select("tipo_sugerido, tipo_confianza, completo_at, radicado_at").eq("radicado", r1.radicado).single();
    const { data: docs } = await admin.from("documentos").select("nombre_original, tipo_detectado, estado").eq("reclamacion_id", caso!.id);
    const { count: expedientes } = await admin.from("reclamaciones").select("id", { count: "exact", head: true }).eq("asegurado_documento", e.asegurado.cedula);

    const fila = {
      escenario: e.id, descripcion: e.descripcion, radicado: r1.radicado,
      tipo_esperado: e.esperado.tipo, tipo_modelo: rec?.tipo_sugerido, confianza: rec?.tipo_confianza,
      acierto_tipo: rec?.tipo_sugerido === e.esperado.tipo,
      completo_esperado: e.esperado.completo, estado: caso?.estado, completo_obtenido: !!rec?.completo_at,
      acierto_completitud: !!rec?.completo_at === e.esperado.completo,
      semaforo: caso?.semaforo, dia_del_plazo: caso?.dia_del_plazo, vence: caso?.fecha_vencimiento,
      expedientes_para_el_asegurado: expedientes, nota: e.esperado.nota ?? "",
      documentos: docs,
    };
    resultados.push(fila);
    console.log(`   → tipo ${fila.tipo_modelo} (${fila.acierto_tipo ? "✓" : "✗"} esperado ${fila.tipo_esperado}) · estado ${fila.estado} · completo ${fila.completo_obtenido} (${fila.acierto_completitud ? "✓" : "✗"}) · semáforo ${fila.semaforo}`);
    await dormir(PAUSA_MS);
  }

  const total = resultados.length;
  const okTipo = resultados.filter((r) => r.acierto_tipo).length;
  const okComp = resultados.filter((r) => r.acierto_completitud).length;
  const md = [
    `# Reporte del conjunto de prueba`, ``, `Generado: ${new Date().toISOString()} · ${total} escenarios`, ``,
    `- Clasificación del modelo correcta: **${okTipo}/${total}** (${((100 * okTipo) / total).toFixed(0)} %)`,
    `- Determinación de completitud correcta: **${okComp}/${total}** (${((100 * okComp) / total).toFixed(0)} %)`, ``,
    `| Esc. | Radicado | Descripción | Tipo esperado | Tipo modelo | Conf. | ✓ | Estado | Completo esp./obt. | ✓ | Semáforo | Nota |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|`,
    ...resultados.map((r) => `| ${r.escenario} | ${r.radicado} | ${r.descripcion} | ${r.tipo_esperado} | ${r.tipo_modelo ?? "—"} | ${r.confianza ?? "—"} | ${r.acierto_tipo ? "✓" : "✗"} | ${r.estado} | ${r.completo_esperado ? "sí" : "no"} / ${r.completo_obtenido ? "sí" : "no"} | ${r.acierto_completitud ? "✓" : "✗"} | ${r.semaforo} | ${r.nota} |`),
  ].join("\n");
  writeFileSync(`${SALIDA}/reporte.md`, md);
  writeFileSync(`${SALIDA}/resultados.json`, JSON.stringify(resultados, null, 2));
  console.log(`\nClasificación ${okTipo}/${total} · Completitud ${okComp}/${total} · Reporte en ${SALIDA}/reporte.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
