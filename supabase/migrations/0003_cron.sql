-- =============================================================================
-- Programación automática (pg_cron + pg_net)
--  * Cada 15 min: el vigilante evalúa plazos dentro de la base (no depende de la app).
--  * Cada 15 min: se invoca /api/cron/tick en la app para enviar notificaciones
--    pendientes y reintentar casos que el modelo no pudo procesar.
-- La URL de la app y el secreto se guardan en Vault (ver README, paso "Activar el cron").
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('vigilar-plazos', '*/15 * * * *', $$ select vigilar_plazos(); $$);

select cron.schedule('tick-app', '*/15 * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/tick',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$$);
