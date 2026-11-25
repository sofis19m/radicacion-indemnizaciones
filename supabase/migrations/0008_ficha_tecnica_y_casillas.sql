-- =============================================================================
-- Ficha técnica de documentos y carga por casillas
--  * Cada archivo sabe en qué casilla lo subió el beneficiario (tipo_declarado),
--    y el modelo verifica si de verdad es ese documento (tipo_detectado).
--  * Una cédula puede llegar en dos archivos (frente y reverso): se guarda la cara.
--  * Problemas del documento (lista cerrada) y alertas de fondo para el analista.
-- =============================================================================
alter type estado_documento add value if not exists 'incompleto';
alter type estado_documento add value if not exists 'vencido';

alter table cargas      add column if not exists tipo_declarado tipo_documento;

alter table documentos  add column if not exists tipo_declarado tipo_documento;
alter table documentos  add column if not exists cara text check (cara in ('frente', 'reverso', 'ambas', 'no_aplica'));
alter table documentos  add column if not exists problemas text[] not null default '{}';
alter table documentos  add column if not exists elementos_faltantes text[] not null default '{}';
alter table documentos  add column if not exists alertas_analista jsonb not null default '[]'::jsonb;

-- Alertas que surgen al cruzar documentos entre sí (fechas, nombres, vigencias)
alter table reclamaciones add column if not exists alertas_cruce jsonb not null default '[]'::jsonb;

-- Casos con alertas de fondo pendientes de revisión humana
create or replace view v_alertas_analista as
select r.id, r.radicado,
       jsonb_array_length(r.alertas_cruce)
       + coalesce((select sum(jsonb_array_length(d.alertas_analista)) from documentos d where d.reclamacion_id = r.id), 0) as total_alertas
  from reclamaciones r
 where r.estado <> 'cerrado';

revoke all on v_alertas_analista from anon, authenticated;
grant select on v_alertas_analista to service_role;
