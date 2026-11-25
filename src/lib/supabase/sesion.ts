import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";

export async function clienteSesion() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // En Server Components no se pueden escribir cookies; el middleware las refresca.
        }
      },
    },
  });
}

export type Analista = { user_id: string; nombre: string; email: string; rol: "analista" | "supervisor" };

/**
 * Exige una sesión válida Y que el usuario esté registrado como analista activo.
 * Tener cuenta en Supabase Auth no basta para entrar al panel.
 */
export async function exigirAnalista(): Promise<Analista> {
  const supabase = await clienteSesion();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/panel/login");

  const { data: analista } = await db()
    .from("analistas")
    .select("user_id, nombre, email, rol, activo")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!analista || !analista.activo) redirect("/panel/login?error=sin_permiso");
  return analista as Analista;
}
