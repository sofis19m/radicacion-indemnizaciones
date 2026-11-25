import { notFound } from "next/navigation";
import { db } from "@/lib/supabase/admin";
import { reclamacionPorToken } from "@/lib/radicacion";
import { evaluarExpediente, type DocumentoEvaluable } from "@/lib/expediente";
import { NOMBRE_DOCUMENTO, type TipoReclamacion } from "@/lib/dominio";
import SubirMas from "@/components/SubirMas";
import Refrescar from "@/components/Refrescar";
import { BarraAvance, IcoAlerta, IcoCheck, IcoDoc } from "@/components/Iconos";

export const dynamic = "force-dynamic";

function fechaLarga(d: string) {
  const f = d.length === 10 ? new Date(`${d}T12:00:00-05:00`) : new Date(d);
  return f.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" });
}

export default async function Seguimiento({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ nuevo?: string; rechazados?: string }>;
}) {
  const { token } = await params;
  const { nuevo, rechazados } = await searchParams;
  const id = await reclamacionPorToken(token);
  if (!id) notFound();

  const { data: r } = await db()
    .from("reclamaciones")
    .select("radicado, estado, beneficiario_nombre, beneficiario_email, tipo_sugerido, tipo_final, fecha_vencimiento, radicado_at")
    .eq("id", id)
    .single();
  if (!r) notFound();

  const { data: docs } = await db()
    .from("documentos")
    .select("id, nombre_original, tipo_detectado, estado, motivo, created_at, cara")
    .eq("reclamacion_id", id)
    .order("created_at");
  const documentos = (docs ?? []) as DocumentoEvaluable[];

  const { data: decision } = await db()
    .from("decisiones")
    .select("decision, documentos_solicitados, created_at")
    .eq("reclamacion_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tipo = (r.tipo_final ?? r.tipo_sugerido) as TipoReclamacion | null;
  const enProceso = r.estado === "recibido" || documentos.some((d) => d.estado === "pendiente_revision");
  const evaluacion = tipo ? evaluarExpediente(tipo, documentos) : null;
  const pendientes = evaluacion?.checklist.filter((i) => i.situacion === "recibido_no_sirve" || i.situacion === "falta") ?? [];
  const noReconocidos = documentos.filter((d) => !d.tipo_detectado && (d.estado === "no_reconocido" || d.estado === "ilegible"));
  // Casillas a mostrar primero al subir más documentos: lo que falta, lo que hay que
  // corregir y lo que el analista pidió adicionalmente.
  const solicitados: string[] = decision?.decision === "pedir_documentos" ? decision.documentos_solicitados ?? [] : [];
  const casillasPendientes = [...new Set([...pendientes.map((i) => i.tipo as string), ...solicitados])];
  const estadosCasilla = Object.fromEntries(pendientes.filter((i) => i.situacion === "recibido_no_sirve").map((i) => [i.tipo, i.detalle]));

  // Línea de tiempo: en qué paso va la persona
  const paso = r.estado === "cerrado" ? 4 : r.estado === "completo" ? 3 : enProceso ? 1 : 2;
  const pasos = [
    { t: "Recibimos su reclamación", d: `Radicada el ${fechaLarga(r.radicado_at)}.` },
    { t: "Revisamos sus documentos", d: paso === 2 ? "Le indicamos abajo qué falta o qué hay que corregir." : "Verificamos que cada documento esté completo y sea legible." },
    { t: "Expediente completo", d: r.fecha_vencimiento ? `La aseguradora tiene plazo para responderle hasta el ${fechaLarga(r.fecha_vencimiento)}.` : "Desde ese momento empieza a correr el plazo de respuesta." },
    { t: "Respuesta", d: "Le informamos la decisión sobre su reclamación por correo." },
  ];
  const nombre = r.beneficiario_nombre.split(" ")[0];
  const nombreBonito = nombre.charAt(0) + nombre.slice(1).toLowerCase();

  return (
    <div className="rad">
      <BarraAvance />
      {enProceso && <Refrescar cadaMs={5000} />}
      <main className="pagina">
        {rechazados && <div className="alerta">Algunos archivos no se pudieron recibir: {rechazados}</div>}

        <section className="tarjeta-rad fade">
          {nuevo ? (
            <>
              <div className="ok-ic"><IcoCheck /></div>
              <h2>Hemos recibido su reclamación</h2>
              <p style={{ color: "var(--muted)", margin: "0 0 14px" }}>
                Gracias por confiarnos este momento, {nombreBonito}. Le enviamos la confirmación a <b>{r.beneficiario_email}</b>.
              </p>
            </>
          ) : (
            <>
              <div className="eyebrow">Seguimiento de su reclamación</div>
              <h2 style={{ marginTop: 6 }}>Hola, {nombreBonito}</h2>
            </>
          )}
          <div className="eyebrow" style={{ marginTop: 8 }}>Número de radicado</div>
          <div className="radicado">{r.radicado}</div>

          {/* Estado actual en lenguaje claro */}
          {r.estado === "cerrado" ? (
            <div className="estado-box ok">Su reclamación ya tiene una decisión. Le enviamos el detalle a su correo.</div>
          ) : enProceso ? (
            <div className="estado-box info"><span className="pulso" />Estamos revisando sus documentos. Suele tardar menos de un minuto; esta página se actualiza sola.</div>
          ) : r.estado === "completo" ? (
            <div className="estado-box ok">
              <b>Su expediente está completo.</b> Un analista lo está estudiando. No necesita enviar nada más por ahora.
            </div>
          ) : r.estado === "revision_manual" && !pendientes.length ? (
            <div className="estado-box info">Un analista está revisando su caso personalmente. Le escribiremos si necesitamos algo más.</div>
          ) : (
            <div className="estado-box pend">
              <b>Para continuar nos falta{pendientes.length > 1 ? "n" : ""} {pendientes.length} documento{pendientes.length > 1 ? "s" : ""}.</b>{" "}
              Puede enviarlos abajo, cuando los tenga. El plazo de respuesta empieza a contar cuando su expediente esté completo.
            </div>
          )}

          <ol className="tl">
            {pasos.map((p, i) => {
              const n = i + 1;
              const clase = n < paso || paso === 4 ? "hecho" : n === paso ? "actual" : "";
              return (
                <li key={p.t} className={clase}>
                  <span className="n">{clase === "hecho" ? <IcoCheck /> : n}</span>
                  <span><b>{p.t}</b><span className="d">{p.d}</span></span>
                </li>
              );
            })}
          </ol>
        </section>

        {decision?.decision === "pedir_documentos" && r.estado !== "cerrado" && (
          <section className="tarjeta-rad">
            <h2 style={{ fontSize: 18 }}>El analista le solicitó documentos adicionales</h2>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              {(decision.documentos_solicitados ?? []).map((t: keyof typeof NOMBRE_DOCUMENTO) => <li key={t}>{NOMBRE_DOCUMENTO[t]}</li>)}
            </ul>
          </section>
        )}

        {evaluacion && !enProceso && (
          <section className="tarjeta-rad">
            <h2 style={{ fontSize: 19 }}>Sus documentos</h2>
            <p style={{ color: "var(--muted)", margin: "0 0 14px", fontSize: 14.5 }}>
              {evaluacion.checklist.filter((i) => i.situacion === "recibido_valido").length} de {evaluacion.checklist.length} recibidos y revisados.
            </p>
            {evaluacion.checklist.map((i) => (
              <div key={i.tipo} className={`item ${i.situacion === "recibido_valido" ? "ok" : i.situacion === "recibido_no_sirve" ? "mal" : ""}`}>
                <span className="st">{i.situacion === "recibido_valido" ? <IcoCheck /> : i.situacion === "recibido_no_sirve" ? <IcoAlerta /> : <IcoDoc />}</span>
                <span>
                  <b>{i.nombre}</b>
                  {i.situacion !== "recibido_valido" && <span className="d">{i.situacion === "falta" ? `Aún no lo recibimos. ${i.detalle}` : i.detalle}</span>}
                </span>
              </div>
            ))}
            {noReconocidos.length > 0 && (
              <div className="hint" style={{ marginTop: 12 }}>
                <span>
                  Si alguno de los documentos de la lista ya lo había enviado, por favor envíelo nuevamente en su casilla.
                </span>
              </div>
            )}
          </section>
        )}

        {r.estado !== "cerrado" && !enProceso && (
          <section className="tarjeta-rad">
            <h2 style={{ fontSize: 19 }}>Enviar documentos</h2>
            <p style={{ color: "var(--muted)", margin: "0 0 16px", fontSize: 14.5 }}>Súbalos en su casilla. Puede volver a esta página cuantas veces necesite.</p>
            <SubirMas token={token} pendientes={casillasPendientes} estados={estadosCasilla} />
          </section>
        )}

        <p className="pie">Este enlace es personal: no lo comparta. No necesita usuario ni contraseña.</p>
      </main>
    </div>
  );
}
