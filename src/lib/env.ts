import "server-only";

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

export const env = {
  get supabaseUrl() { return requerida("NEXT_PUBLIC_SUPABASE_URL"); },
  get supabaseAnonKey() { return requerida("NEXT_PUBLIC_SUPABASE_ANON_KEY"); },
  get supabaseServiceKey() { return requerida("SUPABASE_SERVICE_ROLE_KEY"); },
  get geminiApiKey() { return requerida("GEMINI_API_KEY"); },
  get geminiModel() { return process.env.GEMINI_MODEL || "gemini-3.5-flash"; },
  /** Modelo de respaldo si el principal no responde, está saturado o fue retirado. */
  get geminiModelRespaldo() { return process.env.GEMINI_MODEL_RESPALDO || "gemini-3.5-flash-lite"; },
  get appUrl() { return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""); },
  get cronSecret() { return requerida("CRON_SECRET"); },
  get hashSalt() { return requerida("HASH_SALT"); },
  // Correo (Gmail u otro SMTP). Si falta, la notificación queda "omitida" y se ve en el panel.
  get smtpHost() { return process.env.SMTP_HOST || "smtp.gmail.com"; },
  get smtpPort() { return Number(process.env.SMTP_PORT || 587); },
  get smtpUser() { return process.env.SMTP_USER; },
  get smtpPass() { return process.env.SMTP_PASS?.replace(/\s/g, ""); },
  get emailFromName() { return process.env.EMAIL_FROM_NAME || "Reclamaciones Seguros de Vida"; },
  /** Destino de las alertas internas. Si está vacío, se usan los correos de los analistas activos. */
  get alertasEmail() { return process.env.ALERTAS_EMAIL; },
};
