-- =============================================================================
-- Reloj legal, vigilante automático y las cuatro respuestas operativas
-- =============================================================================

-- Umbrales del semáforo (días calendario restantes hasta el vencimiento)
create or replace function umbral_riesgo()  returns int language sql immutable as $$ select 10 $$;
create or replace function umbral_critico() returns int language sql immutable as $$ select 3 $$;

create or replace function hoy_bogota() returns date language sql stable as $$
  select (now() at time zone 'America/Bogota')::date
$$;

-- ---------------------------------------------------------------------------
-- Pregunta 1: casos abiertos, día del plazo, en riesgo y vencidos
-- ---------------------------------------------------------------------------
create or replace view v_casos_plazo as
select
  r.id,
  r.radicado,
  r.estado,
  coalesce(r.tipo_final, r.tipo_sugerido) as tipo,
  r.tipo_final is not null                 as tipo_confirmado,
  r.beneficiario_nombre,
  r.asegurado_nombre,
  r.radicado_at,
  r.completo_at,
  r.fecha_inicio_plazo,
  r.fecha_vencimiento,
  case when r.fecha_inicio_plazo is null then null
       else hoy_bogota() - r.fecha_inicio_plazo + 1 end              as dia_del_plazo,
  case when r.fecha_vencimiento is null then null
       else r.fecha_vencimiento - hoy_bogota() end                   as dias_restantes,
  case
    when r.estado = 'cerrado'                                         then 'cerrado'
    when r.fecha_vencimiento is null                                  then 'sin_reloj'
    when r.fecha_vencimiento <  hoy_bogota()                          then 'vencido'
    when r.fecha_vencimiento - hoy_bogota() <= umbral_critico()       then 'critico'
    when r.fecha_vencimiento - hoy_bogota() <= umbral_riesgo()        then 'en_riesgo'
    else 'en_plazo'
  end as semaforo,
  hoy_bogota() - (r.radicado_at at time zone 'America/Bogota')::date as dias_desde_radicacion
from reclamaciones r;

create or replace view v_resumen_plazos as
select
  count(*) filter (where estado <> 'cerrado')                              as abiertos,
  count(*) filter (where estado <> 'cerrado' and semaforo = 'sin_reloj')   as abiertos_sin_reloj,
  count(*) filter (where semaforo = 'en_plazo')                            as en_plazo,
  count(*) filter (where semaforo = 'en_riesgo')                           as en_riesgo,
  count(*) filter (where semaforo = 'critico')                             as criticos,
  count(*) filter (where semaforo = 'vencido')                             as vencidos_abiertos,
  (select count(*) from reclamaciones r
     where r.estado = 'cerrado' and r.fecha_vencimiento is not null
       and (r.cerrado_at at time zone 'America/Bogota')::date > r.fecha_vencimiento) as cerrados_fuera_de_plazo
from v_casos_plazo;

-- ---------------------------------------------------------------------------
-- Pregunta 2: ¿cuántas clasificaciones del modelo corrigió una persona?
-- ---------------------------------------------------------------------------
create or replace view v_correcciones_clasificacion as
select
  count(*) filter (where tipo_sugerido is not null)                                     as clasificadas_por_modelo,
  count(*) filter (where tipo_sugerido is not null and tipo_confirmado_por is not null) as revisadas_por_persona,
  count(*) filter (where tipo_sugerido is not null and tipo_confirmado_por is not null
                     and tipo_final <> tipo_sugerido)                                   as corregidas,
  round(100.0 * count(*) filter (where tipo_confirmado_por is not null and tipo_final <> tipo_sugerido)
        / nullif(count(*) filter (where tipo_sugerido is not null and tipo_confirmado_por is not null), 0), 1)
                                                                                        as pct_corregidas
from reclamaciones;

-- Correcciones a la validación de documentos (además de la clasificación)
create or replace view v_correcciones_documentos as
select
  count(*) filter (where revisado_at is not null)              as documentos_revisados_por_modelo,
  count(*) filter (where estado_corregido_por is not null)     as corregidos_por_persona
from documentos;

-- ---------------------------------------------------------------------------
-- Pregunta 3: tiempo desde la radicación hasta decirle al beneficiario qué falta
-- ---------------------------------------------------------------------------
create or replace view v_tiempo_primera_respuesta as
select
  count(*)                                                                        as casos_respondidos,
  round(avg(extract(epoch from primera_respuesta_at - radicado_at)) / 60, 1)      as promedio_minutos,
  round((percentile_cont(0.5) within group (order by extract(epoch from primera_respuesta_at - radicado_at)) / 60)::numeric, 1) as mediana_minutos,
  round((percentile_cont(0.9) within group (order by extract(epoch from primera_respuesta_at - radicado_at)) / 60)::numeric, 1) as p90_minutos,
  (select count(*) from reclamaciones where primera_respuesta_at is null and estado <> 'cerrado') as sin_respuesta_aun
from reclamaciones
where primera_respuesta_at is not null;

-- ---------------------------------------------------------------------------
-- Pregunta 4: historia completa de un caso, en orden
-- ---------------------------------------------------------------------------
create or replace function historia_caso(p_radicado text)
returns table (momento timestamptz, fuente text, tipo text, actor text, detalle jsonb)
language sql stable as $$
  with r as (select id from reclamaciones where radicado = p_radicado)
  select e.created_at, 'evento', e.tipo, e.actor, e.detalle
    from eventos e join r on e.reclamacion_id = r.id
  union all
  select x.created_at, 'ejecucion_ia', case when x.ok then 'ia_ok' else 'ia_error' end, 'ia',
         jsonb_build_object('modelo', x.modelo, 'version_prompt', x.version_prompt,
                            'entrada', x.entrada_resumen, 'salida', x.salida, 'error', x.error,
                            'latencia_ms', x.latencia_ms)
    from ejecuciones_ia x join r on x.reclamacion_id = r.id
  union all
  select d.created_at, 'decision', d.decision::text, 'analista:' || d.analista_email,
         jsonb_build_object('justificacion', d.justificacion, 'documentos_solicitados', d.documentos_solicitados)
    from decisiones d join r on d.reclamacion_id = r.id
  union all
  select n.created_at, 'notificacion', n.tipo, n.destinatario,
         jsonb_build_object('canal', n.canal, 'estado', n.estado, 'asunto', n.asunto, 'enviada_at', n.enviada_at)
    from notificaciones n join r on n.reclamacion_id = r.id
  order by 1
$$;

-- ---------------------------------------------------------------------------
-- El vigilante: corre solo (pg_cron), sin que nadie le pregunte.
-- Genera alertas ANTES del vencimiento y recordatorios al beneficiario.
-- Es idempotente: la llave_unica impide alertas repetidas.
-- ---------------------------------------------------------------------------
create or replace function vigilar_plazos() returns jsonb language plpgsql as $$
declare
  c record;
  n_alertas int := 0;
  n_recordatorios int := 0;
begin
  for c in select * from v_casos_plazo where semaforo in ('en_riesgo', 'critico', 'vencido') loop
    insert into notificaciones (reclamacion_id, destinatario, canal, tipo, llave_unica, asunto, cuerpo)
    values (
      c.id, 'analistas', 'telegram',
      case c.semaforo when 'en_riesgo' then 'alerta_riesgo' when 'critico' then 'alerta_critica' else 'alerta_vencido' end,
      c.semaforo || ':' || c.id,
      'Caso ' || c.radicado || ' · ' || c.semaforo,
      case c.semaforo
        when 'vencido' then '⛔ ' || c.radicado || ' VENCIÓ el ' || to_char(c.fecha_vencimiento, 'DD/MM/YYYY') ||
                            '. Corren intereses de mora (art. 1080 C. Co.). Requiere decisión inmediata.'
        else '⚠️ ' || c.radicado || ' va en el día ' || c.dia_del_plazo || ' del plazo. Quedan ' || c.dias_restantes ||
             ' días (vence el ' || to_char(c.fecha_vencimiento, 'DD/MM/YYYY') || '). Tipo: ' || coalesce(c.tipo::text, 'sin clasificar') || '.'
      end
    )
    on conflict (llave_unica) do nothing;
    if found then
      n_alertas := n_alertas + 1;
      insert into eventos (reclamacion_id, tipo, actor, detalle)
      values (c.id, 'alerta_generada', 'cron',
              jsonb_build_object('semaforo', c.semaforo, 'dia_del_plazo', c.dia_del_plazo, 'dias_restantes', c.dias_restantes));
    end if;
  end loop;

  -- Expedientes incompletos sin movimiento: recordatorio al beneficiario a los 3, 7 y 15 días
  -- desde la última actividad. Ataca el "si no responde, el caso se queda quieto".
  for c in
    select r.id, r.radicado, r.beneficiario_email,
           hoy_bogota() - (greatest(r.primera_respuesta_at,
                                    (select max(d.created_at) from documentos d where d.reclamacion_id = r.id))
                           at time zone 'America/Bogota')::date as dias_quieto
      from reclamaciones r
     where r.estado = 'incompleto' and r.primera_respuesta_at is not null
  loop
    if c.dias_quieto in (3, 7, 15) or c.dias_quieto > 15 and c.dias_quieto % 7 = 1 then
      insert into notificaciones (reclamacion_id, destinatario, canal, tipo, llave_unica, asunto, cuerpo)
      values (c.id, 'beneficiario', 'email', 'recordatorio_documentos',
              'recordatorio:' || c.id || ':' || c.dias_quieto,
              'Su reclamación ' || c.radicado || ' sigue pendiente de documentos',
              'recordatorio')
      on conflict (llave_unica) do nothing;
      if found then
        n_recordatorios := n_recordatorios + 1;
        insert into eventos (reclamacion_id, tipo, actor, detalle)
        values (c.id, 'recordatorio_generado', 'cron', jsonb_build_object('dias_sin_movimiento', c.dias_quieto));
      end if;
    end if;
  end loop;

  insert into latidos (origen, detalle)
  values ('vigilar_plazos', jsonb_build_object('alertas', n_alertas, 'recordatorios', n_recordatorios));

  return jsonb_build_object('alertas', n_alertas, 'recordatorios', n_recordatorios);
end $$;

-- Ninguna vista ni función de métricas es accesible con la llave pública
revoke all on v_casos_plazo, v_resumen_plazos, v_correcciones_clasificacion,
              v_correcciones_documentos, v_tiempo_primera_respuesta from anon, authenticated;
revoke execute on function historia_caso(text), vigilar_plazos() from anon, authenticated, public;
