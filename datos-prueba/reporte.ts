// Compara el estado ACTUAL de la base con lo esperado en cada escenario y
// genera datos-prueba/generados/reporte.md (clasificación, completitud y
// validación de documentos). Uso: npx tsx datos-prueba/reporte.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ESCENARIOS } from "./escenarios";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Qué estado de documento se espera según la variante del escenario
const ESPERADO_VARIANTE: Record<string, string> = { ok: "valido", sin_firma: "sin_firma", ilegible: "ilegible", otra_persona: "no_corresponde", frente: "valido", reverso: "valido", vencido: "vencido" };

async function main() {
  const filas: string[] = [];
  let okTipo = 0, okComp = 0, docsOk = 0, docsTotal = 0, procesados = 0;
  const erroresDocs: string[] = [];

  for (const e of ESCENARIOS) {
    const { data: r } = await admin
      .from("reclamaciones")
      .select("id, radicado, estado, tipo_sugerido, tipo_confianza, completo_at")
      .eq("asegurado_documento", e.asegurado.cedula)
      .eq("beneficiario_documento", e.beneficiario.cedula)
      .order("radicado_at")
      .limit(1)
      .maybeSingle();
    if (!r) { filas.push(`| ${e.id} | — | ${e.descripcion} | no cargado |||||||`); continue; }
    const { data: plazo } = await admin.from("v_casos_plazo").select("semaforo, dia_del_plazo").eq("id", r.id).single();
    const { data: docs } = await admin.from("documentos").select("nombre_original, tipo_detectado, estado").eq("reclamacion_id", r.id);
    const { count: expedientes } = await admin.from("reclamaciones").select("id", { count: "exact", head: true }).eq("asegurado_documento", e.asegurado.cedula);

    const procesado = !!r.tipo_sugerido;
    if (procesado) procesados++;
    const aTipo = r.tipo_sugerido === e.esperado.tipo;
    const aComp = !!r.completo_at === e.esperado.completo;
    if (aTipo) okTipo++;
    if (aComp) okComp++;

    // Validación de cada documento esperado vs. lo que determinó el sistema
    for (const d of [...e.docs, ...(e.luego ?? [])]) {
      if (d.tipo === "factura_servicios") continue;
      const esperado = ESPERADO_VARIANTE[d.variante ?? "ok"];
      const candidato = (docs ?? []).find((x) => x.tipo_detectado === d.tipo && x.estado === esperado)
        ?? (docs ?? []).find((x) => x.tipo_detectado === d.tipo);
      docsTotal++;
      if (candidato?.estado === esperado) docsOk++;
      else erroresDocs.push(`${e.id} · ${d.tipo}: esperado **${esperado}**, obtenido **${candidato ? candidato.estado : "no identificado"}**`);
    }

    filas.push(`| ${e.id} | ${r.radicado} | ${e.descripcion} | ${e.esperado.tipo} | ${r.tipo_sugerido ?? "—"} | ${r.tipo_confianza ?? "—"} | ${aTipo ? "✓" : "✗"} | ${r.estado} | ${e.esperado.completo ? "sí" : "no"} / ${r.completo_at ? "sí" : "no"} | ${aComp ? "✓" : "✗"} | ${plazo?.semaforo ?? "—"} | ${expedientes} |`);
  }

  const total = ESCENARIOS.length;
  const pct = (a: number, b: number) => `${((100 * a) / Math.max(b, 1)).toFixed(0)} %`;
  const md = [
    "# Reporte del conjunto de prueba",
    "",
    `Generado: ${new Date().toISOString()} · ${total} escenarios · estado actual de la base`,
    "",
    "| Métrica | Resultado |",
    "|---|---|",
    `| Clasificación del tipo de reclamación | **${okTipo}/${total}** (${pct(okTipo, total)}) |`,
    `| Determinación de expediente completo / incompleto | **${okComp}/${total}** (${pct(okComp, total)}) |`,
    `| Validación de documentos (válido, sin firma, ilegible, no corresponde) | **${docsOk}/${docsTotal}** (${pct(docsOk, docsTotal)}) |`,
    `| Casos procesados por el modelo | ${procesados}/${total} |`,
    "",
    "La columna *Exp.* cuenta los expedientes que existen para ese asegurado: debe ser 1 incluso en los escenarios de duplicados (E13, E14, E32).",
    "",
    "| Esc. | Radicado | Descripción | Tipo esperado | Tipo modelo | Conf. | ✓ | Estado | Completo esp./obt. | ✓ | Semáforo | Exp. |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...filas,
    "",
    "## Documentos donde el sistema difiere de lo esperado",
    "",
    ...(erroresDocs.length ? erroresDocs.map((x) => `- ${x}`) : ["Ninguno."]),
  ].join("\n");

  mkdirSync("datos-prueba/generados", { recursive: true });
  writeFileSync("datos-prueba/generados/reporte.md", md);
  console.log(`Clasificación ${okTipo}/${total} · Completitud ${okComp}/${total} · Documentos ${docsOk}/${docsTotal} · Procesados ${procesados}/${total}`);
  if (erroresDocs.length) console.log("Diferencias:\n  " + erroresDocs.join("\n  "));
}

main().catch((e) => { console.error(e); process.exit(1); });
