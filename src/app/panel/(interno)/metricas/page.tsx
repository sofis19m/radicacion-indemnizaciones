import { redirect } from "next/navigation";

// Las métricas (las cuatro respuestas del punto 7) ahora viven en el panel principal.
export default function Metricas() {
  redirect("/panel#desempeno");
}
