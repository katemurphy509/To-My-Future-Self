create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'tmfs_project_url');
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'tmfs_service_role_key');

select cron.schedule(
  'notify-unlocked-letters',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'tmfs_project_url')
        || '/functions/v1/notify-unlocked',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tmfs_service_role_key'),
        'apikey',
        (select decrypted_secret from vault.decrypted_secrets where name = 'tmfs_service_role_key'),
        'Content-Type',
        'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
