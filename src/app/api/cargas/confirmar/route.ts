import { NextResponse, after } from "next/server";
import { procesarReclamacion } from "@/lib/motor";
import { ConfirmacionLote, confirmarLote } from "@/lib/radicacion";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Paso 2: el navegador avisa que terminó de subir; el servidor valida y procesa. */
export async function POST(req: Request) {
  const datos = ConfirmacionLote.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });

  try {
    const r = await confirmarLote(datos.data.lote, datos.data.secreto, "beneficiario");
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    // El análisis corre después de responder: el beneficiario no espera al modelo.
    // Si esta ejecución se corta, el cron lo retoma (documentos en pendiente_revision).
    if (r.aceptados > 0) after(() => procesarReclamacion(r.reclamacionId).catch((e) => console.error("[motor]", e)));
    return NextResponse.json({ aceptados: r.aceptados, duplicados: r.duplicados, rechazados: r.rechazados });
  } catch (e) {
    console.error("[confirmar]", e);
    return NextResponse.json({ error: "No pudimos guardar los archivos. Intente de nuevo." }, { status: 500 });
  }
}
