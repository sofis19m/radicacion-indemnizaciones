import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase/admin";
import { exigirAnalista } from "@/lib/supabase/sesion";
import { obtenerMetricas } from "@/lib/metricas";
import { NOMBRE_TIPO_RECLAMACION, SEMAFORO_ETIQUETA, type TipoReclamacion } from "@/lib/dominio";

export const dynamic = "force-dynamic";

const ESTADO: Record<string, string> = {
  recibido: "En análisis", incompleto: "Incompleto", completo: "Completo", revision_manual: "Revisión manual", cerrado: "Cerrado",
};
const COLOR_SEMAFORO: Record<string, string> = {
  en_plazo: "#0cb4f4", en_riesgo: "#f5a623", critico: "#ea580c", vencido: "#b3261e", sin_reloj: "#bcd4dc",
};
const LEYENDA: Record<string, string> = {
  en_plazo: "con el reloj corriendo", en_riesgo: "10 días o menos", critico: "3 días o menos", vencido: "fuera de plazo", sin_reloj: "documentación incompleta",
};
const FILTROS = [
  { v: "todos", t: "Todos" }, { v: "en_plazo", t: "En plazo" }, { v: "en_riesgo", t: "En riesgo" }, { v: "vencido", t: "Vencidos" },
  { v: "sin_reloj", t: "Sin reloj" }, { v: "revision_manual", t: "Revisión manual" }, { v: "cerrado", t: "Cerrados" },
];

type Caso = {
  id: string; radicado: string; estado: string; tipo: TipoReclamacion | null; tipo_confirmado: boolean;
  beneficiario_nombre: string; asegurado_nombre: string; radicado_at: string; fecha_inicio_plazo: string | null;
  fecha_vencimiento: string | null; dia_del_plazo: number | null; dias_restantes: number | null; semaforo: string;
};

async function casoAlAzar() {
  "use server";
  await exigirAnalista();
  const { count } = await db().from("reclamaciones").select("id", { count: "exact", head: true });
  if (!count) return;
  const i = Math.floor(Math.random() * count);
  const { data } = await db().from("reclamaciones").select("id").order("radicado_at").range(i, i);
  if (data?.[0]) redirect(`/panel/casos/${data[0].id}`);
}

function tiempo(min: number | null | undefined): { v: string; u: string } {
  if (min == null) return { v: "—", u: "" };
  const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
  if (min < 60) return { v: fmt(min), u: "min" };
  if (min < 60 * 24) return { v: fmt(min / 60), u: "horas" };
  return { v: fmt(min / 1440), u: "días" };
}

function textoAlerta(tipo: string, asunto: string | null, radicado: string) {
  const limpio = (asunto ?? "").replace(radicado, "").replace(/^[\s·-]+|[\s·-]+$/g, "").replace(/\s·\s·/g, " ·");
  switch (tipo) {
    case "alerta_riesgo": return `Entró en riesgo · ${limpio.replace(/^En riesgo\s*·?\s*/i, "")}`;
    case "alerta_critica": return `Crítico · ${limpio.replace(/^CRÍTICO\s*·?\s*/i, "")}`;
    case "alerta_vencido": return "Venció sin decisión: corren intereses de mora.";
    case "ia_no_disponible": return "El modelo no pudo analizarlo: pasó a revisión manual.";
    case "recordatorio_documentos": return "Recordatorio enviado al beneficiario: su expediente sigue incompleto.";
    default: return limpio || tipo.replaceAll("_", " ");
  }
}

export default async function Panel({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const { f = "todos", q } = await searchParams;

  // Casos abiertos (para el resumen y los plazos)
  const { data: abiertosData } = await db().from("v_casos_plazo").select("*").neq("estado", "cerrado").order("dias_restantes", { ascending: true, nullsFirst: false });
  const abiertos = (abiertosData ?? []) as Caso[];
  const cuenta = (s: string) => abiertos.filter((c) => c.semaforo === s).length;
  const conteo = { en_plazo: cuenta("en_plazo"), en_riesgo: cuenta("en_riesgo"), critico: cuenta("critico"), vencido: cuenta("vencido"), sin_reloj: cuenta("sin_reloj") };
  const conReloj = abiertos.filter((c) => c.dia_del_plazo != null);
  const sinReloj = abiertos.filter((c) => c.dia_del_plazo == null);

  // Tabla de casos con filtro y búsqueda
  let consulta = db().from("v_casos_plazo").select("*");
  if (f === "cerrado") consulta = consulta.eq("estado", "cerrado");
  else if (f === "revision_manual") consulta = consulta.eq("estado", "revision_manual");
  else if (f === "en_riesgo") consulta = consulta.in("semaforo", ["en_riesgo", "critico"]);
  else if (f !== "todos") consulta = consulta.eq("semaforo", f);
  else consulta = consulta.neq("estado", "cerrado");
  if (q) {
    const s = q.replace(/[%,()]/g, "");
    consulta = consulta.or(`radicado.ilike.%${s}%,beneficiario_nombre.ilike.%${s}%,asegurado_nombre.ilike.%${s}%`);
  }
  const { data: filas } = await consulta.order("dias_restantes", { ascending: true, nullsFirst: false }).order("radicado_at").limit(200);
  const casos = (filas ?? []) as Caso[];

  // Últimas alertas automáticas del vigilante
  const { data: alertas } = await db()
    .from("notificaciones")
    .select("id, tipo, asunto, created_at, reclamacion_id, reclamaciones(radicado)")
    .in("tipo", ["alerta_riesgo", "alerta_critica", "alerta_vencido", "ia_no_disponible", "recordatorio_documentos"])
    .order("created_at", { ascending: false })
    .limit(6);

  const m = await obtenerMetricas();
  const c = m.p2_correcciones.clasificacion;
  const t = m.p3_tiempo_primera_respuesta;
  const promedio = t?.promedio_minutos != null ? Number(t.promedio_minutos) : null;
  const lineaBaseMin = 4.5 * 1440;
  const veces = promedio ? Math.round(lineaBaseMin / Math.max(promedio, 0.1)) : null;

  // Dona: segmentos por semáforo
  let acumulado = 0;
  const total = abiertos.length || 1;
  const segmentos = (["en_plazo", "en_riesgo", "critico", "vencido", "sin_reloj"] as const)
    .filter((s) => conteo[s] > 0)
    .map((s) => {
      const desde = (acumulado / total) * 100;
      acumulado += conteo[s];
      return `${COLOR_SEMAFORO[s]} ${desde}% ${(acumulado / total) * 100}%`;
    });
  const fondoDona = abiertos.length ? `conic-gradient(${segmentos.join(", ")})` : "#e3eef2";

  const kpi = (clave: "en_riesgo" | "critico" | "vencido") => (conteo[clave] === 0 ? "cero" : clave === "en_riesgo" ? "riesgo" : clave);

  return (
    <>
      <div id="resumen" className="eyebrow">Seguros de vida · Reclamaciones</div>
      <h1>Panel de operación</h1>
      <p className="intro">
        Hay <b>{abiertos.length}</b> casos abiertos: <b>{conReloj.length}</b> con el plazo en curso y <b>{sinReloj.length}</b> sin reloj porque su documentación está incompleta
        {conteo.en_riesgo + conteo.critico + conteo.vencido > 0 && <>. <b>{conteo.en_riesgo + conteo.critico}</b> en riesgo y <b>{conteo.vencido}</b> vencidos</>}.
      </p>

      <div className="kpis">
        <div className="kpi dest"><div className="t">Abiertos</div><div className="v">{abiertos.length}</div><div className="s">casos en gestión</div></div>
        <div className="kpi"><div className="t">En plazo</div><div className="v">{conteo.en_plazo}</div><div className="s">con el reloj corriendo</div></div>
        <div className="kpi"><div className="t">Sin reloj</div><div className="v">{conteo.sin_reloj}</div><div className="s">incompletos</div></div>
        <div className={`kpi ${kpi("en_riesgo")}`}><div className="t">En riesgo</div><div className="v">{conteo.en_riesgo}</div><div className="s">10 días o menos</div></div>
        <div className={`kpi ${kpi("critico")}`}><div className="t">Críticos</div><div className="v">{conteo.critico}</div><div className="s">3 días o menos</div></div>
        <div className={`kpi ${kpi("vencido")}`}><div className="t">Vencidos</div><div className="v">{conteo.vencido}</div><div className="s">fuera de plazo</div></div>
      </div>

      <section className="sec">
        <h2>🔔 Últimas alertas automáticas</h2>
        <p className="sub sin-num">
          El vigilante revisa los plazos cada 15 minutos y avisa antes del vencimiento: cuando un caso entra en riesgo (10 días o menos)
          y cuando queda crítico (3 días o menos). Seleccione una alerta para abrir el caso.
        </p>
        {alertas?.length ? (
          alertas.map((a) => {
            const radicado = (a.reclamaciones as unknown as { radicado: string } | null)?.radicado ?? "";
            const color = a.tipo === "alerta_critica" || a.tipo === "alerta_vencido" ? "roja" : a.tipo === "recordatorio_documentos" ? "" : "amarilla";
            return (
              <Link key={a.id} href={a.reclamacion_id ? `/panel/casos/${a.reclamacion_id}` : "/panel"} className={`alerta-fila ${color}`}>
                <span className="f">{new Date(a.created_at).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" })}</span>
                <span className="r">{radicado}</span>
                <span>{textoAlerta(a.tipo, a.asunto, radicado)}</span>
              </Link>
            );
          })
        ) : (
          <div className="nota" style={{ marginTop: 0 }}>Sin alertas por ahora: ningún caso ha entrado en riesgo ni ha necesitado intervención.</div>
        )}
      </section>

      {/* 1 · Plazos */}
      <section className="sec" id="plazos">
        <div className="sec-h"><span className="num">1</span><h2>Plazos de los casos abiertos</h2></div>
        <p className="sub">En qué día del plazo va cada caso y cuántos están en riesgo o vencidos.</p>
        <div className="plazos">
          <div className="dona" style={{ background: fondoDona }}>
            <div><div><b>{abiertos.length}</b><span>abiertos</span></div></div>
          </div>
          <div className="leyenda">
            {(["en_plazo", "en_riesgo", "critico", "vencido", "sin_reloj"] as const).filter((s) => conteo[s] > 0).map((s) => (
              <div className="ley" key={s}>
                <i style={{ background: COLOR_SEMAFORO[s] }} />
                <div><b>{SEMAFORO_ETIQUETA[s]}</b><strong>{conteo[s]}</strong><span>{LEYENDA[s]}</span></div>
              </div>
            ))}
            {!abiertos.length && <div className="nota" style={{ marginTop: 0 }}>No hay casos abiertos.</div>}
          </div>
        </div>

        {conReloj.length > 0 && (
          <>
            <div className="rotulo">Día del plazo de cada caso con reloj</div>
            {conReloj.map((x) => {
              const totalDias = x.fecha_inicio_plazo && x.fecha_vencimiento
                ? (new Date(x.fecha_vencimiento).getTime() - new Date(x.fecha_inicio_plazo).getTime()) / 86_400_000 + 1 : 31;
              const avance = Math.min(100, Math.max(3, ((x.dia_del_plazo ?? 0) / totalDias) * 100));
              return (
                <Link key={x.id} href={`/panel/casos/${x.id}`} className="barra-caso">
                  <div className="cab"><span>{x.radicado}</span><span className={`badge b-${x.semaforo}`}>{SEMAFORO_ETIQUETA[x.semaforo]}</span></div>
                  <div className="pista"><i style={{ width: `${avance}%`, background: `linear-gradient(90deg, ${COLOR_SEMAFORO[x.semaforo]}, #055d7e)` }} /></div>
                  <div className="det">
                    Día <b>{x.dia_del_plazo}</b> · {x.dias_restantes! >= 0 ? <>quedan <b>{x.dias_restantes}</b></> : <><b>{-x.dias_restantes!}</b> días vencido</>} · vence <b>{x.fecha_vencimiento}</b>
                  </div>
                </Link>
              );
            })}
          </>
        )}
        {sinReloj.length > 0 && (
          <>
            <div className="rotulo">Sin reloj: documentación incompleta, el plazo aún no corre</div>
            <div className="chips">
              {sinReloj.map((x) => <Link key={x.id} href={`/panel/casos/${x.id}`} className="chip">{x.radicado}</Link>)}
            </div>
          </>
        )}
      </section>

      {/* 2 · Casos */}
      <section className="sec" id="casos">
        <div className="sec-h"><span className="num">2</span><h2>Casos</h2></div>
        <p className="sub">Todos los casos con su plazo, tipo y estado. Seleccione una fila, o abra un caso al azar, para ver su ficha.</p>
        <div className="barra-filtros">
          {FILTROS.map((x) => (
            <Link key={x.v} href={`/panel?f=${x.v}#casos`} className={`filtro ${f === x.v ? "on" : ""}`}>{x.t}</Link>
          ))}
          <div className="buscar">
            <form action="/panel#casos" style={{ display: "flex", gap: 10 }}>
              <input type="hidden" name="f" value={f} />
              <input name="q" defaultValue={q} placeholder="Radicado o nombre" className="inp" />
            </form>
            <form action={casoAlAzar}><button className="btn">Abrir un caso al azar</button></form>
          </div>
        </div>
        <div className="tabla-caja">
          <table>
            <thead>
              <tr><th>Radicado</th><th>Plazo</th><th>Día</th><th>Quedan</th><th>Vence</th><th>Tipo</th><th>Estado</th><th>Beneficiario</th></tr>
            </thead>
            <tbody>
              {casos.map((x) => (
                <tr key={x.id}>
                  <td><Link href={`/panel/casos/${x.id}`} className="fila-link">{x.radicado}</Link></td>
                  <td><span className={`badge b-${x.semaforo}`}>{x.semaforo === "sin_reloj" ? "Sin reloj (incompleto)" : SEMAFORO_ETIQUETA[x.semaforo]}</span></td>
                  <td>{x.dia_del_plazo ?? "—"}</td>
                  <td>{x.dias_restantes ?? "—"}</td>
                  <td>{x.fecha_vencimiento ?? "—"}</td>
                  <td>{x.tipo ? NOMBRE_TIPO_RECLAMACION[x.tipo] : "—"} <span className="peq">· {x.tipo_confirmado ? "confirmado" : "sugerido"}</span></td>
                  <td>{ESTADO[x.estado] ?? x.estado}</td>
                  <td>{x.beneficiario_nombre}<div className="peq">por {x.asegurado_nombre}</div></td>
                </tr>
              ))}
              {!casos.length && <tr><td colSpan={8} className="vacio">No hay casos con este filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3 · Desempeño del modelo */}
      <section className="sec" id="desempeno">
        <div className="sec-h"><span className="num">3</span><h2>Desempeño del modelo</h2></div>
        <p className="sub">De las clasificaciones del modelo, cuántas tuvo que corregir una persona.</p>
        <div className="kpis k4" style={{ marginBottom: 0 }}>
          <div className="kpi dest"><div className="t">Clasificadas por el modelo</div><div className="v">{c?.clasificadas_por_modelo ?? 0}</div><div className="s">casos con clasificación automática</div></div>
          <div className="kpi"><div className="t">Revisadas por una persona</div><div className="v">{c?.revisadas_por_persona ?? 0}</div><div className="s">confirmadas o corregidas</div></div>
          <div className="kpi"><div className="t">Corregidas</div><div className="v">{c?.corregidas ?? 0}</div><div className="s">el analista cambió la clasificación</div></div>
          <div className="kpi"><div className="t">Tasa de corrección</div><div className="v">{c?.pct_corregidas != null ? `${String(c.pct_corregidas).replace(".", ",")} %` : "—"}</div><div className="s">corregidas sobre revisadas</div></div>
        </div>
        <div className="nota">
          La tasa se calcula solo sobre los casos que una persona revisó: los no revisados no cuentan como aciertos. Cada confirmación o
          corrección en la ficha de un caso actualiza estas tarjetas.
        </div>
      </section>

      {/* 4 · Tiempo de respuesta */}
      <section className="sec" id="respuesta">
        <div className="sec-h"><span className="num">4</span><h2>Tiempo de respuesta</h2></div>
        <p className="sub">Cuánto tarda el sistema desde la radicación hasta decirle al beneficiario qué le falta, frente al proceso manual.</p>
        <div className="vs">
          <div className="grande sis"><div className="t">Este sistema · promedio</div><div className="v">{tiempo(promedio).v}</div><div className="u">{tiempo(promedio).u}</div></div>
          <div className="x">vs.</div>
          <div className="grande man"><div className="t">Proceso manual · línea base</div><div className="v">4,5</div><div className="u">días</div></div>
        </div>
        <div className="comp">
          <span>Este sistema (promedio)</span>
          <div className="pista"><i style={{ width: `${promedio ? Math.max(1.5, Math.min(100, (promedio / lineaBaseMin) * 100)) : 0}%`, background: "#0cb4f4" }} /></div>
          <b>{tiempo(promedio).v} {tiempo(promedio).u}</b>
        </div>
        <div className="comp">
          <span>Proceso manual (línea base)</span>
          <div className="pista"><i style={{ width: "100%", background: "#bcd4dc" }} /></div>
          <b>4,5 días</b>
        </div>
        <div className="minis">
          <div className="mini"><b>{tiempo(promedio).v}</b><span>{tiempo(promedio).u} · promedio</span></div>
          <div className="mini"><b>{tiempo(t?.mediana_minutos != null ? Number(t.mediana_minutos) : null).v}</b><span>{tiempo(t?.mediana_minutos != null ? Number(t.mediana_minutos) : null).u} · mediana</span></div>
          <div className="mini"><b>{tiempo(t?.p90_minutos != null ? Number(t.p90_minutos) : null).v}</b><span>{tiempo(t?.p90_minutos != null ? Number(t.p90_minutos) : null).u} · percentil 90</span></div>
          <div className="mini"><b>{t?.casos_respondidos ?? 0}</b><span>casos respondidos</span></div>
          <div className="mini"><b>{t?.sin_respuesta_aun ?? 0}</b><span>abiertos sin primera respuesta</span></div>
        </div>
        {veces && (
          <p className="pie-nota">
            El sistema responde unas <b>{veces.toLocaleString("es-CO")}</b> veces más rápido que el proceso manual.
            {(t?.casos_respondidos ?? 0) < 10 && <> Con solo <b>{t?.casos_respondidos}</b> casos respondidos, tómelo como una referencia inicial.</>}
          </p>
        )}
        <p className="pie-nota">
          Datos calculados en vivo desde la base · también en JSON: <a href="/api/metricas" style={{ color: "var(--deep)", fontWeight: 700 }}>/api/metricas</a> ·
          salud del sistema: <a href="/api/salud" style={{ color: "var(--deep)", fontWeight: 700 }}>/api/salud</a>
        </p>
      </section>
    </>
  );
}
