-- =============================================================================
-- Lo que el beneficiario indicó en "¿Qué ocurrió?" (sección 1 del formulario).
-- Sirve para mostrarle solo los documentos de su caso. NO es la clasificación
-- oficial: el tipo lo sigue determinando el sistema con el relato y los
-- documentos. Si no coinciden, se genera una alerta para el analista.
-- =============================================================================
alter table reclamaciones add column if not exists situacion_declarada text
  check (situacion_declarada in ('fallecimiento', 'accidente', 'incapacidad'));

-- ¿Qué tan seguido lo que indicó la persona coincide con lo que determinó el modelo?
create or replace view v_declarado_vs_modelo as
select
  count(*) filter (where situacion_declarada is not null and tipo_sugerido is not null) as comparables,
  count(*) filter (where (situacion_declarada, tipo_sugerido::text) in (('fallecimiento', 'muerte_natural'), ('accidente', 'muerte_accidental'), ('incapacidad', 'incapacidad_total_permanente'))) as coinciden
from reclamaciones;

revoke all on v_declarado_vs_modelo from anon, authenticated;
grant select on v_declarado_vs_modelo to service_role;
