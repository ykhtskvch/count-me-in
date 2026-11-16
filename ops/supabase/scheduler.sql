-- Count Me In clock (backlog 0.4). Run once in the Supabase SQL editor of the project
-- that holds Count Me In's sign-in. Not a D1 migration. Modelled on the Street
-- Noticeboard's scheduler; the signing key is generated here and never leaves Vault,
-- except that you copy it once into the site's SCHEDULER_SECRET.
--
-- Before running: replace https://YOUR-SITE with the site's address.
-- After running: copy the key into the site with
--   select decrypted_secret from vault.decrypted_secrets where name = 'count_me_in_scheduler_key';
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists count_me_in_internal;
revoke all on schema count_me_in_internal from public, anon, authenticated, service_role;

do $bootstrap$
begin
  if not exists (select 1 from vault.secrets where name = 'count_me_in_scheduler_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'count_me_in_scheduler_key', 'Signs Count Me In scheduler calls only');
  end if;
end;
$bootstrap$;

create or replace function count_me_in_internal.tick()
returns bigint language plpgsql security invoker set search_path = pg_catalog, pg_temp as $function$
declare
  signing_key text;
  stamp text;
begin
  -- Keep only a week of this job's own run history.
  delete from cron.job_run_details where jobid in
    (select jobid from cron.job where jobname = 'count-me-in-tick') and end_time < now() - interval '7 days';
  select decrypted_secret into strict signing_key from vault.decrypted_secrets where name = 'count_me_in_scheduler_key';
  stamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  return net.http_post(
    url := 'https://YOUR-SITE/api/internal/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cmi-time', stamp,
      'x-cmi-signature', encode(extensions.hmac(
        'count-me-in-tick-v1' || chr(10) || 'POST' || chr(10) || '/api/internal/tick' || chr(10) || stamp,
        signing_key, 'sha256'), 'hex')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end;
$function$;
revoke all on function count_me_in_internal.tick() from public, anon, authenticated, service_role;

select cron.schedule('count-me-in-tick', '*/5 * * * *', 'select count_me_in_internal.tick()');
