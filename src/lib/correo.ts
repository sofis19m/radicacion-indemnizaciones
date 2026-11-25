import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

let transporte: Transporter | null = null;

export function correoConfigurado(): boolean {
  return !!(env.smtpUser && env.smtpPass);
}

function smtp(): Transporter {
  transporte ??= nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    requireTLS: env.smtpPort !== 465, // 587: STARTTLS obligatorio, nunca texto plano
    auth: { user: env.smtpUser, pass: env.smtpPass },
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return transporte;
}

function escapar(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Plantilla sobria y legible en cualquier cliente de correo (también en celular). */
function html(cuerpo: string, enlace?: { texto: string; url: string }, pie?: string) {
  const parrafos = escapar(cuerpo)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const boton = enlace
    ? `<p style="margin:22px 0"><a href="${escapar(enlace.url)}" style="background:#0b3d91;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapar(enlace.texto)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
      <p style="margin:0 0 16px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#0b3d91">Seguros de vida · Reclamaciones</p>
      ${parrafos}${boton}
    </div>
    <p style="font-size:11px;color:#6b7280;margin:14px 4px">${escapar(pie ?? "Este es un mensaje automático. Si necesita ayuda, responda este correo.")}</p>
  </div></body></html>`;
}

export async function enviarCorreo(opts: {
  para: string | string[];
  asunto: string;
  texto: string;
  enlace?: { texto: string; url: string };
  pie?: string;
}) {
  const textoPlano = opts.enlace ? `${opts.texto}\n\n${opts.enlace.texto}: ${opts.enlace.url}` : opts.texto;
  await smtp().sendMail({
    from: { name: env.emailFromName, address: env.smtpUser! },
    to: opts.para,
    subject: opts.asunto,
    text: textoPlano,
    html: html(opts.texto, opts.enlace, opts.pie),
  });
}
