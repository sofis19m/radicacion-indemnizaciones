-- =============================================================================
-- Permisos explícitos. Solo el servidor (service_role) accede a los datos.
-- anon y authenticated no reciben nada: la llave pública no lee ni escribe tablas.
-- =============================================================================
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- La bitácora, las decisiones y las ejecuciones del modelo siguen siendo de solo
-- inserción: los triggers bloquean UPDATE/DELETE aunque el rol tenga el permiso.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
