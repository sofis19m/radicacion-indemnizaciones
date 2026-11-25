import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/supabase/admin";
import { crearCupos, MetaArchivo, reclamacionPorToken } from "@/lib/radicacion";
import { ipDe, LIMITES, permitirEnvio } from "@/lib/seguridad";

export const runtime = "nodejs";

const Cuerpo = z.object({ archivos: z.array(MetaArchivo).min(1).max(LIMITES.archivosPorEnvio) });

/** Desde su enlace de seguimiento, el beneficiario pide permiso para subir más documentos. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reclamacionId = await reclamacionPorToken(token);
  if (!reclamacionId) return NextResponse.json({ error: "Enlace no válido o vencido." }, { status: 404 });

  if (!(await permitirEnvio(ipDe(req)))) {
    return NextResponse.json({ error: "Ha enviado muchas solicitudes. Intente de nuevo en una hora." }, { status: 429 });
  }

  const datos = Cuerpo.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Revise los archivos: solo PDF o fotos de hasta 10 MB." }, { status: 400 });

  const { data: rec } = await db().from("reclamaciones").select("estado").eq("id", reclamacionId).single();
  if (rec?.estado === "cerrado") return NextResponse.json({ error: "Esta reclamación ya fue cerrada." }, { status: 409 });

  return NextResponse.json(await crearCupos(reclamacionId, datos.data.archivos));
}
