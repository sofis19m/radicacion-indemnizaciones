import Link from "next/link";
import { exigirAnalista } from "@/lib/supabase/sesion";
import { cerrarSesion } from "../acciones";

export const dynamic = "force-dynamic";

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  const analista = await exigirAnalista();
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <nav className="flex items-center gap-5 text-sm font-medium">
            <span className="font-bold text-marca">Reclamaciones</span>
            <Link href="/panel" className="text-gray-700 hover:text-marca">Casos</Link>
            <Link href="/panel/metricas" className="text-gray-700 hover:text-marca">Operación</Link>
          </nav>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>{analista.nombre} · {analista.rol}</span>
            <form action={cerrarSesion}><button className="boton-sec">Salir</button></form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
    </div>
  );
}
