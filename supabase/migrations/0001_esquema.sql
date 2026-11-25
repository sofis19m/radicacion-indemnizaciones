-- =============================================================================
-- Radicación de reclamaciones de vida · Esquema base
-- Zona horaria del negocio: America/Bogota. Todas las marcas se guardan en UTC
-- (timestamptz) y las fechas del plazo legal se calculan en hora de Colombia.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------------
create type tipo_reclamacion as enum ('muerte_natural', 'muerte_accidental', 'incapacidad_total_permanente');

create type tipo_documento as enum (
  'formato_reclamacion',
  'registro_civil_defuncion',
  'certificado_medico_defuncion',
  'documento_identidad_asegurado',
  'documento_identidad_beneficiario',
  'formulario_sarlaft',
  'certificacion_bancaria',
  'informe_autoridad',
  'dictamen_pcl',
  'historia_clinica',
  'otro'
);

-- Estado de un documento que SÍ llegó. "Falta" no es un estado de documento:
-- se deriva de la ausencia de un documento válido del tipo requerido.
create type estado_documento as enum (
  'pendiente_revision',  -- aún no lo revisa el motor
  'valido',
  'sin_firma',
  'ilegible',
  'no_corresponde',      -- p. ej. cédula de otra persona
  'vencido_o_incompleto',
  'no_reconocido'        -- el motor no logró identificar qué documento es
);

create type estado_caso as enum (
  'recibido',            -- guardado, esperando motor
  'incompleto',          -- motor corrió: falta algo o algo no sirve
  'completo',            -- expediente completo: el reloj corre
  'revision_manual',     -- el motor no pudo concluir (IA caída, baja confianza)
  'cerrado'              -- un analista pagó u objetó
);

create type decision_analista as enum ('pagar', 'objetar', 'pedir_documentos');

-- Tipos requeridos por tipo de reclamación (sección 5 del enunciado).
create table requisitos (
  tipo_reclamacion tipo_reclamacion not null,
  tipo_documento   tipo_documento   not null,
  primary key (tipo_reclamacion, tipo_documento)
);

insert into requisitos (tipo_reclamacion, tipo_documento)
select 'muerte_natural'::tipo_reclamacion, d::tipo_documento from unnest(array[
  'formato_reclamacion','registro_civil_defuncion','certificado_medico_defuncion',
  'documento_identidad_asegurado','documento_identidad_beneficiario',
  'formulario_sarlaft','certificacion_bancaria']) d
union all
select 'muerte_accidental', d::tipo_documento from unnest(array[
  'formato_reclamacion','registro_civil_defuncion','certificado_medico_defuncion',
  'documento_identidad_asegurado','documento_identidad_beneficiario',
  'formulario_sarlaft','certificacion_bancaria','informe_autoridad']) d
union all
select 'incapacidad_total_permanente', d::tipo_documento from unnest(array[
  'formato_reclamacion','dictamen_pcl','historia_clinica',
  'documento_identidad_asegurado','formulario_sarlaft','certificacion_bancaria']) d;

-- ---------------------------------------------------------------------------
-- Analistas (vinculados a auth.users de Supabase)
-- ---------------------------------------------------------------------------
create table analistas (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  email      text not null,
  rol        text not null default 'analista' check (rol in ('analista', 'supervisor')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reclamaciones
-- ---------------------------------------------------------------------------
create sequence radicado_seq start 1000;

create table reclamaciones (
  id                    uuid primary key default gen_random_uuid(),
  radicado              text not null unique
                          default 'RAD-' || to_char(now() at time zone 'America/Bogota', 'YYYY') || '-' || nextval('radicado_seq'),
  -- Idempotencia del envío: el formulario genera la llave una vez por sesión.
  -- Un doble clic o un reintento de red devuelve el mismo caso.
  idempotency_key       text not null unique,

  beneficiario_nombre    text not null,
  beneficiario_tipo_doc  text not null,
  beneficiario_documento text not null,
  beneficiario_email     text not null,
  beneficiario_telefono  text,
  parentesco             text,
  asegurado_nombre       text not null,
  asegurado_documento    text not null,
  relato                 text not null,
  consentimiento_datos_at timestamptz not null,  -- Ley 1581 de 2012

  estado                 estado_caso not null default 'recibido',

  -- Lo que sugirió el modelo y lo que quedó (posiblemente corregido por una persona)
  tipo_sugerido          tipo_reclamacion,
  tipo_confianza         numeric(3,2),
  tipo_evidencia         text,
  tipo_final             tipo_reclamacion,
  tipo_confirmado_por    uuid references analistas(user_id),
  tipo_confirmado_at     timestamptz,

  -- Reloj legal (art. 1080 C. Co.): corre desde que el expediente queda COMPLETO.
  completo_at            timestamptz,
  fecha_inicio_plazo     date,
  fecha_vencimiento      date,

  radicado_at            timestamptz not null default now(),
  primera_respuesta_at   timestamptz,  -- primer "qué te falta / quedó completo"
  intentos_ia            int not null default 0,
  -- Candado de procesamiento: evita que dos procesos analicen el mismo caso a la vez
  procesando_hasta       timestamptz,
  ultimo_error_ia        text,
  cerrado_at             timestamptz,
  updated_at             timestamptz not null default now()
);

-- Un mismo beneficiario no puede tener dos expedientes abiertos por el mismo asegurado.
-- Si vuelve a radicar, el caso existente recibe los documentos nuevos.
create unique index reclamacion_abierta_unica
  on reclamaciones (asegurado_documento, beneficiario_documento)
  where estado <> 'cerrado';

create index reclamaciones_estado_idx on reclamaciones (estado);
create index reclamaciones_vencimiento_idx on reclamaciones (fecha_vencimiento) where estado <> 'cerrado';

-- El reloj solo se fija una vez: un duplicado, una reclasificación o un reproceso
-- nunca lo reinician.
create or replace function proteger_reloj() returns trigger language plpgsql as $$
declare
  simulacion boolean := coalesce(current_setting('app.simulacion', true), '') = 'on';
begin
  if old.completo_at is not null and new.completo_at is distinct from old.completo_at and not simulacion then
    raise exception 'El reloj legal ya arrancó para % y no se puede reiniciar', old.radicado;
  end if;
  if new.completo_at is not null and (old.completo_at is null or new.completo_at is distinct from old.completo_at) then
    new.fecha_inicio_plazo := (new.completo_at at time zone 'America/Bogota')::date;
    -- "un mes" calendario (art. 67 Código Civil / art. 829 C. Co.)
    new.fecha_vencimiento  := (new.fecha_inicio_plazo + interval '1 month')::date;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger reclamaciones_reloj before update on reclamaciones
  for each row execute function proteger_reloj();

-- Enlaces de seguimiento del beneficiario (sin usuario ni contraseña).
-- Se guarda solo el hash del token; el token en claro solo existe en el enlace.
create table enlaces_seguimiento (
  token_hash      text primary key,
  reclamacion_id  uuid not null references reclamaciones(id),
  created_at      timestamptz not null default now(),
  expira_at       timestamptz not null default now() + interval '180 days'
);

create index enlaces_reclamacion_idx on enlaces_seguimiento (reclamacion_id);

-- ---------------------------------------------------------------------------
-- Documentos
-- ---------------------------------------------------------------------------
create table documentos (
  id                uuid primary key default gen_random_uuid(),
  reclamacion_id    uuid not null references reclamaciones(id),
  sha256            text not null,
  storage_path      text not null,
  nombre_original   text not null,
  mime              text not null,
  bytes             int not null,
  tipo_detectado    tipo_documento,
  estado            estado_documento not null default 'pendiente_revision',
  motivo            text,          -- explicación en lenguaje claro
  datos_extraidos   jsonb,         -- nombres, números de documento, fechas
  confianza         numeric(3,2),
  revisado_at       timestamptz,
  -- Si un analista corrige el resultado del motor
  estado_corregido_por uuid references analistas(user_id),
  created_at        timestamptz not null default now(),
  -- El mismo archivo dos veces en el mismo caso no se guarda dos veces.
  unique (reclamacion_id, sha256)
);

create index documentos_reclamacion_idx on documentos (reclamacion_id);

-- Cargas: el navegador sube cada archivo directo al almacenamiento con una URL
-- firmada de un solo uso, a una zona de cuarentena ("entrantes/"). El servidor
-- lo valida (tipo real, tamaño, hash) antes de convertirlo en documento.
create table cargas (
  id               uuid primary key default gen_random_uuid(),
  reclamacion_id   uuid not null references reclamaciones(id),
  lote             uuid not null,
  secreto_hash     text not null,
  storage_path     text not null unique,
  nombre_original  text not null,
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'duplicada', 'rechazada')),
  motivo_rechazo   text,
  documento_id     uuid references documentos(id),
  created_at       timestamptz not null default now()
);

create index cargas_lote_idx on cargas (lote);

-- ---------------------------------------------------------------------------
-- Ejecuciones del modelo: con qué información determinó lo que determinó
-- ---------------------------------------------------------------------------
create table ejecuciones_ia (
  id               uuid primary key default gen_random_uuid(),
  reclamacion_id   uuid not null references reclamaciones(id),
  modelo           text not null,
  version_prompt   text not null,
  entrada_resumen  jsonb not null,   -- relato, documentos (id + sha256) enviados
  salida           jsonb,            -- respuesta estructurada tal como llegó
  ok               boolean not null,
  error            text,
  latencia_ms      int,
  created_at       timestamptz not null default now()
);

create index ejecuciones_reclamacion_idx on ejecuciones_ia (reclamacion_id);

-- ---------------------------------------------------------------------------
-- Decisiones humanas
-- ---------------------------------------------------------------------------
create table decisiones (
  id               uuid primary key default gen_random_uuid(),
  reclamacion_id   uuid not null references reclamaciones(id),
  decision         decision_analista not null,
  justificacion    text not null check (length(trim(justificacion)) >= 10),
  documentos_solicitados tipo_documento[],
  analista_id      uuid not null references analistas(user_id),
  analista_email   text not null,
  created_at       timestamptz not null default now()
);

create index decisiones_reclamacion_idx on decisiones (reclamacion_id);

-- ---------------------------------------------------------------------------
-- Notificaciones (al beneficiario y alertas internas)
-- ---------------------------------------------------------------------------
create table notificaciones (
  id              uuid primary key default gen_random_uuid(),
  reclamacion_id  uuid references reclamaciones(id),
  destinatario    text not null check (destinatario in ('beneficiario', 'analistas')),
  canal           text not null check (canal in ('seguimiento_web', 'email', 'telegram')),
  tipo            text not null,     -- estado_expediente, alerta_riesgo, alerta_critica, vencido, ...
  -- Evita mandar la misma alerta dos veces (p. ej. "riesgo" una sola vez por caso)
  llave_unica     text not null unique,
  asunto          text,
  cuerpo          text not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'enviada', 'fallida', 'omitida')),
  intentos        int not null default 0,
  error           text,
  enviada_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index notificaciones_pendientes_idx on notificaciones (estado) where estado in ('pendiente', 'fallida');

-- ---------------------------------------------------------------------------
-- Bitácora de eventos: append-only. Permite reconstruir cualquier caso.
-- ---------------------------------------------------------------------------
create table eventos (
  id              bigserial primary key,
  reclamacion_id  uuid references reclamaciones(id),
  tipo            text not null,
  actor           text not null,   -- 'beneficiario', 'sistema', 'ia', 'cron', 'analista:<email>'
  detalle         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index eventos_reclamacion_idx on eventos (reclamacion_id, created_at);

create or replace function eventos_inmutables() returns trigger language plpgsql as $$
begin
  raise exception 'La bitácora de eventos es de solo inserción';
end $$;

create trigger eventos_no_update before update or delete on eventos
  for each row execute function eventos_inmutables();
create trigger decisiones_no_update before update or delete on decisiones
  for each row execute function eventos_inmutables();
create trigger ejecuciones_no_update before update or delete on ejecuciones_ia
  for each row execute function eventos_inmutables();

-- ---------------------------------------------------------------------------
-- Latidos del vigilante: para saber si el cron dejó de correr
-- ---------------------------------------------------------------------------
create table latidos (
  id          bigserial primary key,
  origen      text not null,
  detalle     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Límite de envíos por IP en el canal público
create table limites_ip (
  ip_hash     text not null,
  ventana     timestamptz not null,
  conteo      int not null default 1,
  primary key (ip_hash, ventana)
);

-- ---------------------------------------------------------------------------
-- Seguridad: nada es accesible con la llave pública (anon). El servidor usa la
-- service role; el panel valida la sesión y el rol de analista en el servidor.
-- ---------------------------------------------------------------------------
alter table requisitos     enable row level security;
alter table analistas      enable row level security;
alter table reclamaciones  enable row level security;
alter table documentos     enable row level security;
alter table enlaces_seguimiento enable row level security;
alter table cargas         enable row level security;
alter table ejecuciones_ia enable row level security;
alter table decisiones     enable row level security;
alter table notificaciones enable row level security;
alter table eventos        enable row level security;
alter table latidos        enable row level security;
alter table limites_ip     enable row level security;

-- Un analista autenticado puede leer su propio registro (para validar rol)
create policy analista_lee_su_registro on analistas
  for select to authenticated using (user_id = auth.uid());

-- Bucket privado para documentos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
