import FormularioRadicacion from "@/components/FormularioRadicacion";

export default function Inicio() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-marca">Seguros de vida · Reclamaciones</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">Radique su reclamación</h1>
        <p className="mt-3 text-gray-600">
          Lamentamos lo que está viviendo. Este formulario toma unos 10 minutos y no necesita crear usuario ni contraseña.
          Si hoy no tiene todos los documentos, envíe los que tenga: le diremos con claridad qué falta y podrá
          completarlos después desde un enlace personal.
        </p>
      </header>

      <section className="tarjeta mb-6 bg-marca-claro/60 text-sm text-gray-700">
        <h2 className="mb-2 font-semibold text-gray-900">Antes de empezar, tenga a mano (si los tiene)</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Su cédula y la de la persona asegurada.</li>
          <li>Registro civil y certificado médico de defunción, o el dictamen de pérdida de capacidad laboral.</li>
          <li>Una certificación bancaria a su nombre.</li>
          <li>Fotos nítidas o PDF. Puede tomarlas con el celular.</li>
        </ul>
      </section>

      <FormularioRadicacion />

      <footer className="mt-10 text-center text-xs text-gray-500">
        ¿Necesita ayuda? Línea de atención 01 8000 000 000 · Sus datos se tratan según la Ley 1581 de 2012.
      </footer>
    </main>
  );
}
