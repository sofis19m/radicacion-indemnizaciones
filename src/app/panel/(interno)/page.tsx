import Link from "next/link";
import { db } from "@/lib/supabase/admin";
import { NOMBRE_TIPO_RECLAMACION, type TipoReclamacion } from "@/lib/dominio";
import Semaforo from "@/components/panel/Semaforo";

const ESTADO: Record<string, string> = {
  recibido: "En análisis",
  incompleto: "Incompleto",
  completo: "Completo",
  revision_manual: "Revisión manual",
  cerrado: "Cerrado",
};

const FILTROS = [
  { v: "abiertos", t: "Abiertos" },
  { v: "en_riesgo", t: "En riesgo / críticos" },
  { v: "vencido", t: "Vencidos" },
  { v: "sin_reloj", t: "Sin reloj" },
  { v: "revision_manual", t: "Revisión manual" },
  { v: "cerrado", t: "Cerrados" },
];

type Fila = {
  id: string; radicado: string; estado: string; tipo: TipoReclamacion | null; tipo_confirmado: boolean;
  beneficiario_nombre: string; asegurado_nombre: string; radicado_at: string; fecha_vencimiento: string | null;
  dia_del_plazo: number | null; dias_restantes: number | null; semaforo: string; dias_desde_radicacion: number;
};

export default async function Casos({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const { f = "abiertos", q } = await searchParams;

  let consulta = db().from("v_casos_plazo").select("*");
  if (f === "abiertos") consulta = consulta.neq("estado", "cerrado");
  else if (f === "en_riesgo") consulta = consulta.in("semaforo", ["en_riesgo", "critico"]);
  else if (f === "revision_manual") consulta = consulta.eq("estado", "revision_manual");
  else consulta = consulta.eq("semaforo", f);
  if (q) consulta = consulta.or(`radicado.ilike.%${q.replace(/[%,()]/g, "")}%,beneficiario_nombre.ilike.%${q.replace(/[%,()]/g, "")}%,asegurado_nombre.ilike.%${q.replace(/[%,()]/g, "")}%`);

  // Orden: lo más urgente primero (menos días restantes), luego lo más antiguo sin reloj.
  const { data } = await consulta.order("dias_restantes", { ascending: true, nullsFirst: false }).order("radicado_at").limit(200);
  const filas = (data ?? []) as Fila[];

  const { data: resumen } = await db().from("v_resumen_plazos").select("*").single();
  const { data: alertas } = await db()
    .from("notificaciones")
    .select("id, reclamacion_id, tipo, cuerpo, estado, created_at")
    .eq("destinatario", "analistas")
    .order("created_at", { ascending: false })
    .limit(5);

  const tarjetas = [
    { t: "Abiertos", v: resumen?.abiertos, f: "abiertos" },
    { t: "Sin reloj (incompletos)", v: resumen?.abiertos_sin_reloj, f: "sin_reloj" },
    { t: "En riesgo", v: (resumen?.en_riesgo ?? 0) + (resumen?.criticos ?? 0), f: "en_riesgo", c: "text-amber-700" },
    { t: "Vencidos", v: resumen?.vencidos_abiertos, f: "vencido", c: "text-red-700" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tarjetas.map((t) => (
          <Link key={t.t} href={`/panel?f=${t.f}`} className="tarjeta hover:border-marca">
            <p className="text-sm text-gray-600">{t.t}</p>
            <p className={`mt-1 text-3xl font-bold ${t.c ?? "text-gray-900"}`}>{t.v ?? 0}</p>
          </Link>
        ))}
      </div>

      {alertas && alertas.length > 0 && (
        <section className="tarjeta">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Últimas alertas automáticas</h2>
          <ul className="space-y-1 text-sm">
            {alertas.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-2">
                <span className="text-gray-400">{new Date(a.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>
                {a.reclamacion_id ? <Link className="hover:underline" href={`/panel/casos/${a.reclamacion_id}`}>{a.cuerpo}</Link> : <span>{a.cuerpo}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTROS.map((x) => (
            <Link key={x.v} href={`/panel?f=${x.v}`} className={`rounded-full px-3 py-1 text-sm ${f === x.v ? "bg-marca text-white" : "bg-white text-gray-700 ring-1 ring-gray-200"}`}>
              {x.t}
            </Link>
          ))}
        </div>
        <form className="flex gap-2">
          <input type="hidden" name="f" value={f} />
          <input name="q" defaultValue={q} placeholder="Radicado o nombre" className="campo !py-1.5 text-sm" />
          <button className="boton-sec">Buscar</button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Radicado</th>
              <th className="px-4 py-3">Plazo</th>
              <th className="px-4 py-3">Día del plazo</th>
              <th className="px-4 py-3">Vence</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Beneficiario / asegurado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium"><Link className="text-marca hover:underline" href={`/panel/casos/${c.id}`}>{c.radicado}</Link></td>
                <td className="px-4 py-3"><Semaforo valor={c.semaforo} /></td>
                <td className="px-4 py-3">
                  {c.dia_del_plazo != null ? (
                    <span>Día {c.dia_del_plazo} · {c.dias_restantes! >= 0 ? `quedan ${c.dias_restantes}` : `${-c.dias_restantes!} vencido`}</span>
                  ) : (
                    <span className="text-gray-500">— ({c.dias_desde_radicacion} d desde radicación)</span>
                  )}
                </td>
                <td className="px-4 py-3">{c.fecha_vencimiento ?? "—"}</td>
                <td className="px-4 py-3">
                  {c.tipo ? NOMBRE_TIPO_RECLAMACION[c.tipo] : "—"}
                  {c.tipo && !c.tipo_confirmado && <span className="ml-1 text-xs text-gray-400">(sugerido)</span>}
                </td>
                <td className="px-4 py-3">{ESTADO[c.estado] ?? c.estado}</td>
                <td className="px-4 py-3 text-gray-600">{c.beneficiario_nombre}<br /><span className="text-xs">por {c.asegurado_nombre}</span></td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No hay casos con este filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
