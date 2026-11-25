"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { IcoCandado, IcoCorazon } from "@/components/Iconos";

function Formulario() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(params.get("error") === "sin_permiso" ? "Su usuario no tiene permiso para el panel." : null);
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await supabase.auth.signInWithPassword({ email: String(fd.get("email")), password: String(fd.get("password")) });
    setCargando(false);
    if (error) return setError("Correo o contraseña incorrectos.");
    router.replace("/panel");
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="sec fade" style={{ width: "100%", maxWidth: 420 }}>
      <div className="marca" style={{ marginBottom: 18 }}>
        <div className="logo"><IcoCorazon color="#fff" /></div>
        <span>Seguros de Vida</span>
      </div>
      <div className="eyebrow">Uso interno</div>
      <h1 style={{ fontSize: 28, margin: "6px 0 20px" }}>Panel de analistas</h1>
      <div className="field" style={{ marginBottom: 16 }}>
        <label htmlFor="email">Correo</label>
        <input id="email" name="email" type="email" className="inp" autoComplete="username" required />
      </div>
      <div className="field" style={{ marginBottom: 18 }}>
        <label htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" className="inp" autoComplete="current-password" required />
      </div>
      {error && <div className="alerta" role="alert">{error}</div>}
      <button className="btn primary" disabled={cargando}>{cargando ? "Entrando…" : "Entrar"}</button>
      <div className="seguro"><IcoCandado /><span>Acceso solo para analistas autorizados. Las decisiones quedan registradas a su nombre.</span></div>
    </form>
  );
}

export default function Login() {
  return (
    <div className="rad">
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px 16px" }}>
        <Suspense>
          <Formulario />
        </Suspense>
      </main>
    </div>
  );
}
