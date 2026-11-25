// Íconos SVG en línea (sin librerías externas).
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const IcoCheck = () => <svg {...base} strokeWidth={2.6}><path d="M5 12l5 5 9-10" /></svg>;
export const IcoX = () => <svg {...base} strokeWidth={3}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const IcoDoc = () => <svg {...base} strokeWidth={2}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>;
export const IcoInfo = () => <svg {...base} strokeWidth={2}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
export const IcoCorazon = ({ color = "currentColor" }: { color?: string }) => (
  <svg {...base} stroke={color} strokeWidth={2.2}><path d="M12 21s-7-4.4-7-10.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 16.6 12 21 12 21z" /></svg>
);
export const IcoCandado = () => <svg {...base} strokeWidth={2}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const IcoAlerta = () => <svg {...base} strokeWidth={2}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>;
export const IcoPersona = () => <svg {...base} strokeWidth={2}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>;
export const IcoChulito = () => <svg {...base} strokeWidth={2.4}><path d="M5 12l5 5 9-10" /></svg>;

/** Barra superior con la marca y el porcentaje de avance. */
export function BarraAvance({ pct }: { pct?: number }) {
  return (
    <div className="prog">
      <div className="prog-in">
        <div className="marca">
          <div className="logo"><IcoCorazon color="#fff" /></div>
          <span>Seguros de Vida</span>
        </div>
        {pct != null ? (
          <>
            <div className="track" role="progressbar" aria-label="Avance del formulario" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="pct">{pct}%</div>
          </>
        ) : (
          <div style={{ flex: 1 }} />
        )}
      </div>
    </div>
  );
}
