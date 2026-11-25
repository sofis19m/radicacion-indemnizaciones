import { SEMAFORO_ETIQUETA } from "@/lib/dominio";

const ESTILO: Record<string, string> = {
  sin_reloj: "bg-gray-100 text-gray-700",
  en_plazo: "bg-green-100 text-green-800",
  en_riesgo: "bg-amber-100 text-amber-800",
  critico: "bg-orange-200 text-orange-900",
  vencido: "bg-red-600 text-white",
  cerrado: "bg-slate-200 text-slate-700",
};

export default function Semaforo({ valor }: { valor: string }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTILO[valor] ?? ESTILO.sin_reloj}`}>
      {SEMAFORO_ETIQUETA[valor] ?? valor}
    </span>
  );
}
