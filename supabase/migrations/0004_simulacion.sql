-- =============================================================================
-- Simulación de antigüedad (SOLO para el conjunto de datos de prueba)
-- Permite mostrar casos en riesgo / vencidos sin esperar 30 días reales.
-- Deja constancia en la bitácora: la simulación nunca se confunde con un hecho real.
-- =============================================================================
create or replace function simular_antiguedad(p_radicado text, p_dias int)
returns void language plpgsql security definer set search_path = public as $$
declare
  r reclamaciones%rowtype;
  delta interval := make_interval(days => p_dias);
begin
  select * into r from reclamaciones where radicado = p_radicado;
  if not found then raise exception 'No existe %', p_radicado; end if;

  perform set_config('app.simulacion', 'on', true);
  update reclamaciones
     set radicado_at          = radicado_at - delta,
         primera_respuesta_at = primera_respuesta_at - delta,
         completo_at          = completo_at - delta,
         tipo_confirmado_at   = tipo_confirmado_at - delta
   where id = r.id;
  update documentos set created_at = created_at - delta, revisado_at = revisado_at - delta where reclamacion_id = r.id;
  perform set_config('app.simulacion', 'off', true);

  insert into eventos (reclamacion_id, tipo, actor, detalle)
  values (r.id, 'simulacion_antiguedad', 'script_datos_prueba',
          jsonb_build_object('dias', p_dias, 'nota', 'Fechas desplazadas para el conjunto de prueba; los demás eventos conservan su hora real.'));
end $$;

revoke execute on function simular_antiguedad(text, int) from anon, authenticated, public;

-- Simular "radicado hace N días, completado hoy" (regla del reloj desde completitud)
create or replace function simular_radicacion_antigua(p_radicado text, p_dias int)
returns void language plpgsql security definer set search_path = public as $$
declare r reclamaciones%rowtype;
begin
  select * into r from reclamaciones where radicado = p_radicado;
  update reclamaciones set radicado_at = radicado_at - make_interval(days => p_dias) where id = r.id;
  insert into eventos (reclamacion_id, tipo, actor, detalle)
  values (r.id, 'simulacion_antiguedad', 'script_datos_prueba',
          jsonb_build_object('dias', p_dias, 'campo', 'radicado_at', 'nota', 'Solo la fecha de radicación se desplazó.'));
end $$;

revoke execute on function simular_radicacion_antigua(text, int) from anon, authenticated, public;
