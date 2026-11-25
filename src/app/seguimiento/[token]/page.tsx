import { notFound } from "next/navigation";
import { db } from "@/lib/supabase/admin";
import { reclamacionPorToken } from "@/lib/radicacion";
import { evaluarExpediente, type DocumentoEvaluable } from "@/lib/expediente";
import { NOMBRE_DOCUMENTO, type TipoReclamacion } from "@/lib/dominio";
import SubirMas from "@/components/SubirMas";
import Refrescar from "@/components/Refrescar";

export const dynamic = "force-dynamic";

const ICONO = { recibido_valido: "✅", recibido_no_sirve: "⚠️", en_revision: "⏳", falta: "⬜" } as const;
const COLOR = {
  recibido_valido: "border-green-200 bg-green-50",
  recibido_no_sirve: "border-amber-300 bg-amber-50",
  en_revision: "border-gray-200 bg-gray-50",
  falta: "border-gray-200 bg-white",
} as const;

function fecha(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
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
    .select("radicado, estado, beneficiario_nombre, tipo_sugerido, tipo_final, fecha_vencimiento, radicado_at")
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
  // Casillas a mostrar primero al subir más documentos: lo que falta, lo que hay que corregir
  // y lo que el analista pidió adicionalmente.
  const solicitados: string[] = decision?.decision === "pedir_documentos" ? decision.documentos_solicitados ?? [] : [];
  const casillasPendientes = [...new Set([...pendientes.map((i) => i.tipo as string), ...solicitados])];
  const estadosCasilla = Object.fromEntries(
    pendientes.filter((i) => i.situacion === "recibido_no_sirve").map((i) => [i.tipo, i.detalle]),
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {enProceso && <Refrescar cadaMs={5000} />}

      {nuevo && (
        <div className="tarjeta mb-5 border-green-200 bg-green-50 text-green-900">
          <p className="font-semibold">Recibimos su reclamación.</p>
          <p className="mt-1 text-sm">
            Guarde esta página en sus favoritos: es su enlace personal para ver el avance y enviar documentos, sin usuario
            ni contraseña. También le enviaremos este enlace por correo.
          </p>
        </div>
      )}
      {rechazados && (
        <div className="tarjeta mb-5 border-red-200 bg-red-50 text-sm text-red-800">
          Algunos archivos no se pudieron recibir: {rechazados}
        </div>
      )}

      <p className="text-sm font-semibold uppercase tracking-wide text-marca">Reclamación {r.radicado}</p>
      <h1 className="mt-1 text-2xl font-bold text-gray-900">Hola, {r.beneficiario_nombre.split(" ")[0]}</h1>

      <section className="tarjeta mt-5">
        {r.estado === "cerrado" ? (
          <p>
            Su reclamación ya tiene una decisión. Le enviamos el detalle a su correo. Si tiene dudas, comuníquese con nuestra línea de atención.
          </p>
        ) : enProceso ? (
          <p className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-marca" />
            Estamos revisando sus documentos. Esto suele tardar menos de un minuto; esta página se actualiza sola.
          </p>
        ) : r.estado === "completo" ? (
          <div>
            <p className="font-semibold text-green-800">Su expediente está completo.</p>
            <p className="mt-1 text-sm text-gray-600">
              Un analista lo está estudiando. La aseguradora tiene plazo para darle una respuesta hasta el{" "}
              <strong>{r.fecha_vencimiento ? fecha(r.fecha_vencimiento) : "—"}</strong>. No necesita enviar nada más por ahora.
            </p>
          </div>
        ) : r.estado === "revision_manual" && !pendientes.length ? (
          <p>Un analista está revisando su caso personalmente. Le escribiremos si necesitamos algo más.</p>
        ) : (
          <div>
            <p className="font-semibold text-gray-900">
              Para continuar nos falta{pendientes.length > 1 ? "n" : ""} {pendientes.length} documento{pendientes.length > 1 ? "s" : ""}.
            </p>
            <p className="mt-1 text-sm text-gray-600">
              El plazo de respuesta de la aseguradora empieza a contar cuando su expediente esté completo.
            </p>
          </div>
        )}
      </section>

      {decision?.decision === "pedir_documentos" && r.estado !== "cerrado" && (
        <section className="tarjeta mt-4 border-amber-300 bg-amber-50 text-sm">
          <p className="font-semibold">El analista le solicitó documentos adicionales:</p>
          <ul className="mt-1 list-disc pl-5">
            {(decision.documentos_solicitados ?? []).map((t: keyof typeof NOMBRE_DOCUMENTO) => <li key={t}>{NOMBRE_DOCUMENTO[t]}</li>)}
          </ul>
        </section>
      )}

      {evaluacion && (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Sus documentos</h2>
          <ul className="space-y-2">
            {evaluacion.checklist.map((i) => (
              <li key={i.tipo} className={`rounded-lg border p-3 ${COLOR[i.situacion]}`}>
                <p className="font-medium">
                  <span className="mr-2" aria-hidden>{ICONO[i.situacion]}</span>
                  {i.nombre}
                </p>
                {i.situacion !== "recibido_valido" && <p className="mt-1 pl-7 text-sm text-gray-700">{i.detalle}</p>}
              </li>
            ))}
          </ul>
          {noReconocidos.length > 0 && (
            <p className="mt-3 text-sm text-gray-600">
              También recibimos {noReconocidos.length} archivo(s) que no logramos leer o identificar ({noReconocidos.map((d) => d.nombre_original).join(", ")}).
              Si era alguno de los documentos de la lista, vuelva a enviarlo en su casilla con una foto más nítida.
            </p>
          )}
        </section>
      )}

      {r.estado !== "cerrado" && (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Enviar más documentos</h2>
          <SubirMas token={token} pendientes={casillasPendientes} estados={estadosCasilla} />
        </section>
      )}

      <p className="mt-10 text-center text-xs text-gray-500">
        Radicada el {new Date(r.radicado_at).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })} · No comparta este enlace.
      </p>
    </main>
  );
}
