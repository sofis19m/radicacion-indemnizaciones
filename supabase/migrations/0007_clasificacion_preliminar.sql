-- =============================================================================
-- Clasificación preliminar (sin IA) calculada al radicar, a partir de las frases
-- del relato y de los archivos recibidos. Orienta al modelo y permite comparar
-- después qué tan seguido el relato apuntaba a un tipo distinto al final.
-- =============================================================================
alter table reclamaciones add column if not exists tipo_preliminar tipo_reclamacion;
alter table reclamaciones add column if not exists preliminar jsonb;

-- Cuántas veces la clasificación del modelo coincidió con la pista preliminar
create or replace view v_preliminar_vs_modelo as
select
  count(*) filter (where tipo_preliminar is not null and tipo_sugerido is not null)                              as con_pista,
  count(*) filter (where tipo_preliminar is not null and tipo_sugerido = tipo_preliminar)                        as coinciden,
  count(*) filter (where tipo_preliminar is not null and tipo_sugerido is not null and tipo_sugerido <> tipo_preliminar) as difieren,
  count(*) filter (where tipo_preliminar is null and tipo_sugerido is not null)                                  as sin_pista
from reclamaciones;

revoke all on v_preliminar_vs_modelo from anon, authenticated;
grant select on v_preliminar_vs_modelo to service_role;
