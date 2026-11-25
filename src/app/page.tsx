import FormularioRadicacion from "@/components/FormularioRadicacion";

export default function Inicio() {
  return (
    <div className="rad">
      <main className="pagina" style={{ paddingTop: 84 }}>
        <div className="eyebrow">Seguros de vida · Reclamaciones</div>
        <h1>Radique su reclamación</h1>
        <p className="lead">
          Comprendemos que atraviesa un momento difícil y queremos acompañarle con respeto y diligencia. A continuación le
          solicitamos la información necesaria para dar trámite a su reclamación. El diligenciamiento toma aproximadamente 10 minutos.
        </p>

        <FormularioRadicacion />

        <p className="pie">¿Necesita ayuda? Línea de atención 01 8000 000 000 · Sus datos se tratan según la Ley 1581 de 2012.</p>
      </main>
    </div>
  );
}
