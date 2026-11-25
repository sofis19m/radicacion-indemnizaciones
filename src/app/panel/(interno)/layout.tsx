import Link from "next/link";
import { exigirAnalista } from "@/lib/supabase/sesion";
import { cerrarSesion } from "../acciones";
import { IcoCorazon } from "@/components/Iconos";
import "../../panel.css";

export const dynamic = "force-dynamic";

const MENU = [
  { href: "/panel#resumen", t: "Resumen" },
  { href: "/panel#plazos", t: "Plazos" },
  { href: "/panel#casos", t: "Casos" },
  { href: "/panel#desempeno", t: "Desempeño" },
  { href: "/panel#respuesta", t: "Respuesta" },
];

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  const analista = await exigirAnalista();
  return (
    <div className="pnl">
      <header className="top">
        <div className="top-in">
          <Link href="/panel" className="marca">
            <span className="logo"><IcoCorazon color="#fff" /></span>
            Seguros de Vida
          </Link>
          <nav className="menu">
            {MENU.map((m) => <Link key={m.href} href={m.href}>{m.t}</Link>)}
          </nav>
          <div className="usuario">
            <span>{analista.nombre} · <b>{analista.rol}</b></span>
            <form action={cerrarSesion}><button className="salir">Salir</button></form>
          </div>
        </div>
      </header>
      <div className="cont">{children}</div>
    </div>
  );
}
