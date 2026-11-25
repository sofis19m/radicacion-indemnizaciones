-- =============================================================================
-- Las alertas internas salen por correo (antes: Telegram).
-- =============================================================================
update notificaciones set canal = 'email' where canal = 'telegram';

alter table notificaciones drop constraint if exists notificaciones_canal_check;
alter table notificaciones add constraint notificaciones_canal_check check (canal in ('seguimiento_web', 'email'));

create or replace function vigilar_plazos() returns jsonb language plpgsql as $$
declare
  c record;
  n_alertas int := 0;
  n_recordatorios int := 0;
begin
  for c in select * from v_casos_plazo where semaforo in ('en_riesgo', 'critico', 'vencido') loop
    insert into notificaciones (reclamacion_id, destinatario, canal, tipo, llave_unica, asunto, cuerpo)
    values (
      c.id, 'analistas', 'email',
      case c.semaforo when 'en_riesgo' then 'alerta_riesgo' when 'critico' then 'alerta_critica' else 'alerta_vencido' end,
      c.semaforo || ':' || c.id,
      case c.semaforo
        when 'vencido' then 'VENCIDO · ' || c.radicado
        when 'critico' then 'CRÍTICO · ' || c.radicado || ' · quedan ' || c.dias_restantes || ' días'
        else 'En riesgo · ' || c.radicado || ' · quedan ' || c.dias_restantes || ' días'
      end,
      case c.semaforo
        when 'vencido' then 'El caso ' || c.radicado || ' venció el ' || to_char(c.fecha_vencimiento, 'DD/MM/YYYY') ||
                            ' sin una decisión de pago u objeción. Desde ese día corren intereses de mora (art. 1080 C. Co.). Requiere decisión inmediata.'
        else 'El caso ' || c.radicado || ' va en el día ' || c.dia_del_plazo || ' del plazo legal y vence el ' ||
             to_char(c.fecha_vencimiento, 'DD/MM/YYYY') || ' (quedan ' || c.dias_restantes || ' días).' || chr(10) || chr(10) ||
             'Tipo: ' || coalesce(replace(c.tipo::text, '_', ' '), 'sin clasificar') ||
             case when c.tipo_confirmado then ' (confirmado por analista)' else ' (sugerido por el modelo, sin confirmar)' end || chr(10) ||
             'Beneficiario: ' || c.beneficiario_nombre || ' · Asegurado: ' || c.asegurado_nombre
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

  for c in
    select r.id, r.radicado,
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

revoke execute on function vigilar_plazos() from anon, authenticated, public;
grant execute on function vigilar_plazos() to service_role;

-- Las notificaciones omitidas por falta de configuración vuelven a la cola
update notificaciones set estado = 'pendiente', intentos = 0, error = null where estado = 'omitida' and error like '%no configurado%';
