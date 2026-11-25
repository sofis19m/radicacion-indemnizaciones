import { NextResponse } from "next/server";
import { clienteSesion } from "@/lib/supabase/sesion";
import { db } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Pregunta 4: historia completa de un caso, en orden cronológico. Requiere sesión de analista. */
export async function GET(_: Request, { params }: { params: Promise<{ radicado: string }> }) {
  const supabase = await clienteSesion();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  const { data: a } = await db().from("analistas").select("activo").eq("user_id", user.id).maybeSingle();
  if (!a?.activo) return NextResponse.json({ error: "sin permiso" }, { status: 403 });

  const { radicado } = await params;
  const { data: caso } = await db().from("reclamaciones").select("radicado, estado, radicado_at, completo_at, fecha_vencimiento, tipo_sugerido, tipo_final").eq("radicado", radicado).maybeSingle();
  if (!caso) return NextResponse.json({ error: "no existe" }, { status: 404 });
  const { data: historia } = await db().rpc("historia_caso", { p_radicado: radicado });
  return NextResponse.json({ caso, historia });
}
