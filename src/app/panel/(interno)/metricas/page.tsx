import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase/admin";
import { obtenerMetricas } from "@/lib/metricas";
import { exigirAnalista } from "@/lib/supabase/sesion";

async function casoAlAzar() {
  "use server";
  await exigirAnalista();
  const { count } = await db().from("reclamaciones").select("id", { count: "exact", head: true });
  if (!count) return;
  const i = Math.floor(Math.random() * count);
  const { data } = await db().from("reclamaciones").select("id").order("radicado_at").range(i, i);
  if (data?.[0]) redirect(`/panel/casos/${data[0].id}`);
}

function Num({ v, sub }: { v: React.ReactNode; sub: string }) {
  return (
    <div>
      <p className="text-3xl font-bold text-gray-900">{v ?? "—"}</p>
      <p className="text-sm text-gray-500">{sub}</p>
    </div>
  );
}

function minutosLegibles(m: number | null | undefined) {
  if (m == null) return "—";
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 60 / 24).toFixed(1)} días`;
}

export default async function Metricas() {
  const m = await obtenerMetricas();
  const p1 = m.p1_plazos;
  const c = m.p2_correcciones.clasificacion;
  const d = m.p2_correcciones.documentos;
  const t = m.p3_tiempo_primera_respuesta;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Operación</h1>
          <p className="text-sm text-gray-500">Calculado en vivo desde la base · {new Date(m.generado_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })} · También en JSON: <a className="text-marca hover:underline" href="/api/metricas">/api/metricas</a></p>
        </div>
      </div>

      <section className="tarjeta">
        <h2 className="font-semibold">1 · ¿Cuántos casos hay abiertos, en qué día del plazo va cada uno, cuántos en riesgo y cuántos vencidos?</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-6">
          <Num v={p1?.abiertos} sub="abiertos" />
          <Num v={p1?.abiertos_sin_reloj} sub="sin reloj (incompletos)" />
          <Num v={p1?.en_plazo} sub="en plazo" />
          <Num v={p1?.en_riesgo} sub="en riesgo (≤10 días)" />
          <Num v={p1?.criticos} sub="críticos (≤3 días)" />
          <Num v={(p1?.vencidos_abiertos ?? 0) + (p1?.cerrados_fuera_de_plazo ?? 0)} sub={`vencidos (${p1?.vencidos_abiertos ?? 0} abiertos, ${p1?.cerrados_fuera_de_plazo ?? 0} cerrados tarde)`} />
        </div>
        <Link href="/panel?f=abiertos" className="mt-3 inline-block text-sm text-marca hover:underline">Ver el día del plazo de cada caso →</Link>
      </section>

      <section className="tarjeta">
        <h2 className="font-semibold">2 · De las clasificaciones del modelo, ¿cuántas tuvo que corregir una persona?</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">
          <Num v={c?.clasificadas_por_modelo} sub="clasificadas por el modelo" />
          <Num v={c?.revisadas_por_persona} sub="revisadas por una persona" />
          <Num v={c?.corregidas} sub="corregidas" />
          <Num v={c?.pct_corregidas != null ? `${c.pct_corregidas}%` : "—"} sub="tasa de corrección" />
          <Num v={`${d?.corregidos_por_persona ?? 0}/${d?.documentos_revisados_por_modelo ?? 0}`} sub="validaciones de documentos corregidas" />
        </div>
        <p className="mt-3 text-xs text-gray-500">La tasa se calcula solo sobre casos que una persona revisó: los no revisados no cuentan como aciertos.</p>
      </section>

      <section className="tarjeta">
        <h2 className="font-semibold">3 · ¿Cuánto tarda el sistema desde la radicación hasta decirle al beneficiario qué le falta?</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">
          <Num v={minutosLegibles(t?.promedio_minutos)} sub="promedio" />
          <Num v={minutosLegibles(t?.mediana_minutos)} sub="mediana" />
          <Num v={minutosLegibles(t?.p90_minutos)} sub="percentil 90" />
          <Num v={t?.casos_respondidos} sub="casos respondidos" />
          <Num v="4,5 días" sub="línea base (proceso manual)" />
        </div>
        {(t?.sin_respuesta_aun ?? 0) > 0 && <p className="mt-3 text-sm text-amber-700">{t.sin_respuesta_aun} caso(s) abiertos aún sin primera respuesta.</p>}
      </section>

      <section className="tarjeta">
        <h2 className="font-semibold">4 · Si escogemos un caso al azar, ¿se puede reconstruir su historia completa?</h2>
        <p className="mt-2 text-sm text-gray-600">Cada caso guarda en una bitácora inmutable qué llegó, qué determinó el modelo (con la entrada y la salida exactas), qué decidió cada persona y qué se le notificó al beneficiario.</p>
        <form action={casoAlAzar} className="mt-3"><button className="boton-sec">Abrir un caso al azar</button></form>
      </section>

      <section className="tarjeta text-sm">
        <h2 className="font-semibold">Salud del sistema</h2>
        <ul className="mt-2 space-y-1">
          {(m.operacion.ultimos_latidos ?? []).map((l) => (
            <li key={l.created_at + l.origen}>Último latido de <strong>{l.origen}</strong>: {new Date(l.created_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })}</li>
          ))}
          <li>Notificaciones: {Object.entries(m.operacion.notificaciones).map(([k, v]) => `${k} ${v}`).join(" · ") || "ninguna"}</li>
        </ul>
        <p className="mt-2 text-xs text-gray-500">Monitoreo externo sobre <a className="text-marca" href="/api/salud">/api/salud</a> (responde 503 si el cron se detiene o hay casos atascados).</p>
      </section>
    </div>
  );
}
