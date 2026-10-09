-- Minimal stand-ins for the parts of a Supabase project the migrations
-- depend on (auth and storage schemas, API roles, the realtime
-- publication), so the migrations can be applied and tested in an embedded
-- Postgres (PGlite). Not used in real deployments.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema storage;
create schema extensions;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  invited_at timestamptz,
  email_confirmed_at timestamptz
);

create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade
);

-- Supabase reads the caller from request.jwt.claims; tests set it with
-- set_config('request.jwt.claims', '{"sub": "..."}', true)
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null
);

alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[]
language sql immutable
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

create publication supabase_realtime;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
