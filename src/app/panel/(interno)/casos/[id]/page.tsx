import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/supabase/admin";
import { evaluarExpediente, type DocumentoEvaluable } from "@/lib/expediente";
import { NOMBRE_DOCUMENTO, NOMBRE_TIPO_RECLAMACION, type TipoDocumento, type TipoReclamacion } from "@/lib/dominio";
import Semaforo from "@/components/panel/Semaforo";
import { FormDecision, FormDocumento, FormReintentar, FormTipo } from "@/components/panel/Formularios";

const ETIQUETA_ESTADO_DOC: Record<string, string> = {
  pendiente_revision: "⏳ Pendiente", valido: "✅ Válido", sin_firma: "✍️ Sin firma/huella", ilegible: "🔍 Ilegible", incompleto: "⬜ Incompleto", vencido: "📅 Vencido",
  no_corresponde: "🚫 No corresponde", vencido_o_incompleto: "📅 Vencido/incompleto", no_reconocido: "❓ No reconocido",
};

function fechaHora(s: string) {
  return new Date(s).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
}

export default async function Caso({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [{ data: r }, { data: plazo }, { data: docs }, { data: historia }, { data: decisiones }] = await Promise.all([
    db().from("reclamaciones").select("*").eq("id", id).maybeSingle(),
    db().from("v_casos_plazo").select("semaforo, dia_del_plazo, dias_restantes").eq("id", id).maybeSingle(),
    db().from("documentos").select("*").eq("reclamacion_id", id).order("created_at"),
    db().from("reclamaciones").select("radicado").eq("id", id).maybeSingle().then(async ({ data }) =>
      data ? db().rpc("historia_caso", { p_radicado: data.radicado }) : { data: [] }),
    db().from("decisiones").select("*").eq("reclamacion_id", id).order("created_at", { ascending: false }),
  ]);
  if (!r) notFound();

  // Enlaces temporales (5 min) para ver los archivos: el bucket es privado.
  const documentos = await Promise.all(
    (docs ?? []).map(async (d) => {
      const { data } = await db().storage.from("documentos").createSignedUrl(d.storage_path, 300);
      return { ...d, url: data?.signedUrl ?? null };
    }),
  );

  const tipo = (r.tipo_final ?? r.tipo_sugerido) as TipoReclamacion | null;
  const evaluacion = tipo ? evaluarExpediente(tipo, documentos as DocumentoEvaluable[]) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/panel" className="text-sm text-gray-500 hover:underline">← Casos</Link>
          <h1 className="text-2xl font-bold">{r.radicado}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Semaforo valor={plazo?.semaforo ?? "sin_reloj"} />
          {plazo?.dia_del_plazo != null && (
            <span className="text-sm text-gray-700">
              Día <strong>{plazo.dia_del_plazo}</strong> del plazo · vence <strong>{r.fecha_vencimiento}</strong>
              {plazo.dias_restantes != null && plazo.dias_restantes >= 0 && <> · quedan {plazo.dias_restantes} días</>}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {(() => {
            const alertas = [
              ...((r.alertas_cruce ?? []) as string[]).map((a) => ({ a, origen: "Cruce entre documentos" })),
              ...documentos.flatMap((d) => ((d.alertas_analista ?? []) as string[]).map((a) => ({ a, origen: d.tipo_detectado ? NOMBRE_DOCUMENTO[d.tipo_detectado as TipoDocumento] : d.nombre_original }))),
            ];
            return alertas.length ? (
              <section className="tarjeta border-amber-300 bg-amber-50">
                <h2 className="font-semibold text-amber-900">⚠️ Alertas para revisar ({alertas.length})</h2>
                <p className="text-xs text-amber-800">No bloquean el expediente: son asuntos de fondo que decide una persona.</p>
                <ul className="mt-2 space-y-1 text-sm text-amber-900">
                  {alertas.map((x, i) => <li key={i}><span className="font-medium">{x.origen}:</span> {x.a}</li>)}
                </ul>
              </section>
            ) : null;
          })()}

          {/* Lo que determinó el sistema y con qué información */}
          <section className="tarjeta">
            <h2 className="font-semibold">Clasificación</h2>
            <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-gray-500">Sugerida por el modelo</p>
                <p className="font-medium">
                  {r.tipo_sugerido ? NOMBRE_TIPO_RECLAMACION[r.tipo_sugerido as TipoReclamacion] : "—"}
                  {r.tipo_confianza != null && <span className="ml-2 text-gray-500">confianza {Math.round(Number(r.tipo_confianza) * 100)}%</span>}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Confirmada por una persona</p>
                <p className="font-medium">{r.tipo_final ? `${NOMBRE_TIPO_RECLAMACION[r.tipo_final as TipoReclamacion]} · ${fechaHora(r.tipo_confirmado_at)}` : "Pendiente"}</p>
              </div>
            </div>
            {r.tipo_evidencia && <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700"><span className="font-medium">Por qué: </span>{r.tipo_evidencia}</p>}
            {r.estado !== "cerrado" && <FormTipo id={r.id} sugerido={r.tipo_sugerido} final={r.tipo_final} />}
            {r.ultimo_error_ia && (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                Último error del modelo ({r.intentos_ia} intento(s)): {r.ultimo_error_ia}
                <div className="mt-2"><FormReintentar id={r.id} /></div>
              </div>
            )}
          </section>

          <section className="tarjeta">
            <h2 className="font-semibold">Relato del beneficiario</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{r.relato}</p>
          </section>

          {evaluacion && (
            <section className="tarjeta">
              <h2 className="font-semibold">Expediente según «{NOMBRE_TIPO_RECLAMACION[tipo!]}»</h2>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                {evaluacion.checklist.map((i) => (
                  <li key={i.tipo}>
                    {{ recibido_valido: "✅", recibido_no_sirve: "⚠️", en_revision: "⏳", falta: "⬜" }[i.situacion]} {i.nombre}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="tarjeta">
            <h2 className="font-semibold">Documentos recibidos ({documentos.length})</h2>
            <ul className="mt-3 divide-y divide-gray-100">
              {documentos.map((d) => {
                const x = d.datos_extraidos as Record<string, unknown> | null;
                return (
                  <li key={d.id} className="py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{d.tipo_detectado ? NOMBRE_DOCUMENTO[d.tipo_detectado as TipoDocumento] : "Sin identificar"}</p>
                        <p className="text-xs text-gray-500">
                          {d.tipo_declarado ? <>Subido en «{NOMBRE_DOCUMENTO[d.tipo_declarado as TipoDocumento]}»{d.tipo_detectado && d.tipo_detectado !== d.tipo_declarado && <span className="font-semibold text-amber-700"> (no coincide)</span>} · </> : "Subido en «Otros» · "}
                          {d.cara && d.cara !== "no_aplica" && <>cara: {d.cara} · </>}
                          {d.nombre_original} · recibido {fechaHora(d.created_at)}
                          {d.confianza != null && ` · confianza ${Math.round(Number(d.confianza) * 100)}%`}
                          {d.estado_corregido_por && " · corregido por analista"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span>{ETIQUETA_ESTADO_DOC[d.estado] ?? d.estado}</span>
                        {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-marca hover:underline">Ver</a>}
                        {r.estado !== "cerrado" && <FormDocumento id={d.id} reclamacionId={r.id} tipo={d.tipo_detectado} estado={d.estado} />}
                      </div>
                    </div>
                    {(d.motivo || x || (d.problemas ?? []).length > 0) && (
                      <div className="mt-1 text-xs text-gray-600">
                        {d.motivo && <p>{d.motivo}</p>}
                        {(d.problemas ?? []).length > 0 && <p>Problemas: {(d.problemas as string[]).map((c) => c.replaceAll("_", " ")).join(", ")}</p>}
                        {(d.elementos_faltantes ?? []).length > 0 && <p>Le falta según la ficha: {(d.elementos_faltantes as string[]).join("; ")}</p>}
                        {x && (
                          <p>
                            Extraído: titular {String(x.nombre_titular ?? "—")} · doc. {String(x.numero_documento_titular ?? "—")}
                            {x.tiene_firma != null && ` · firma: ${x.tiene_firma ? "sí" : "no"}`} · {String(x.observacion ?? "")}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Pregunta 4: la historia completa del caso */}
          <section className="tarjeta">
            <h2 className="font-semibold">Historia del caso</h2>
            <ol className="mt-3 space-y-2 border-l-2 border-gray-200 pl-4 text-sm">
              {(historia ?? []).map((h: { momento: string; fuente: string; tipo: string; actor: string; detalle: Record<string, unknown> }, i: number) => (
                <li key={i}>
                  <p>
                    <span className="text-gray-400">{fechaHora(h.momento)}</span> · <span className="font-medium">{h.tipo.replaceAll("_", " ")}</span>{" "}
                    <span className="text-gray-500">({h.actor})</span>
                  </p>
                  <details className="text-xs text-gray-600">
                    <summary className="cursor-pointer">detalle</summary>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2">{JSON.stringify(h.detalle, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="tarjeta">
            <h2 className="mb-3 font-semibold">Decisión del analista</h2>
            {r.estado === "cerrado" ? (
              <p className="text-sm text-gray-600">Caso cerrado el {fechaHora(r.cerrado_at)}.</p>
            ) : (
              <FormDecision id={r.id} puedePagar={r.estado === "completo"} tipoConfirmado={!!r.tipo_final} />
            )}
            <p className="mt-3 text-xs text-gray-500">El sistema no decide pagos ni objeciones, ni calcula el valor. Esta decisión queda registrada a su nombre.</p>
            {decisiones && decisiones.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-gray-100 pt-3 text-sm">
                {decisiones.map((d) => (
                  <li key={d.id}>
                    <p className="font-medium">{d.decision.replace("_", " ")} · {d.analista_email}</p>
                    <p className="text-xs text-gray-500">{fechaHora(d.created_at)}</p>
                    <p className="text-gray-700">{d.justificacion}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="tarjeta text-sm">
            <h2 className="mb-2 font-semibold">Datos</h2>
            <dl className="space-y-1">
              <div><dt className="text-gray-500">Beneficiario</dt><dd>{r.beneficiario_nombre} · {r.beneficiario_tipo_doc} {r.beneficiario_documento}</dd></div>
              <div><dt className="text-gray-500">Contacto</dt><dd>{r.beneficiario_email}{r.beneficiario_telefono && ` · ${r.beneficiario_telefono}`}</dd></div>
              <div><dt className="text-gray-500">Parentesco</dt><dd>{r.parentesco ?? "—"}</dd></div>
              <div><dt className="text-gray-500">Asegurado</dt><dd>{r.asegurado_nombre} · {r.asegurado_documento}</dd></div>
              <div><dt className="text-gray-500">Radicado</dt><dd>{fechaHora(r.radicado_at)}</dd></div>
              <div><dt className="text-gray-500">Primera respuesta al beneficiario</dt><dd>{r.primera_respuesta_at ? fechaHora(r.primera_respuesta_at) : "—"}</dd></div>
              <div><dt className="text-gray-500">Expediente completo desde</dt><dd>{r.completo_at ? fechaHora(r.completo_at) : "—"}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
