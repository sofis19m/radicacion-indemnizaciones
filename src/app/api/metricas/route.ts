import { NextResponse } from "next/server";
import { clienteSesion } from "@/lib/supabase/sesion";
import { db } from "@/lib/supabase/admin";
import { obtenerMetricas } from "@/lib/metricas";

export const dynamic = "force-dynamic";

/** Las cuatro respuestas del punto 7 en JSON. Requiere sesión de analista. */
export async function GET() {
  const supabase = await clienteSesion();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  const { data: a } = await db().from("analistas").select("activo").eq("user_id", user.id).maybeSingle();
  if (!a?.activo) return NextResponse.json({ error: "sin permiso" }, { status: 403 });
  return NextResponse.json(await obtenerMetricas());
}
