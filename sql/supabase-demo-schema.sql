-- ============================================================================
-- Supabase schema สำหรับเวอร์ชันสาธิต (Public Demo)  — รันใน Supabase SQL Editor (หรือ apply_migration)
-- หลักการ: เบราว์เซอร์ใช้ anon key ที่ "ทุกคนเห็นได้" ดังนั้นสิทธิ์ทั้งหมดต้องล็อกที่ฐานข้อมูล
--   1) anon ไล่อ่านได้เฉพาะ "โครงการตัวอย่างทางการ" ; โครงการที่ผู้ใช้แชร์อ่านได้ผ่าน RPC get_demo_project(uuid) เท่านั้น (ต้องรู้ UUID — ไล่ดูทั้งตารางไม่ได้)
--   2) anon เขียนได้เฉพาะคอลัมน์ที่อนุญาต (column grants) ตั้ง is_official_preset / creator_name / view_count / created_at เองไม่ได้
--   3) ทุกการเขียนผ่านตัวจำกัดอัตรา (ต่อ IP แบบแฮชเค็ม ไม่เก็บ IP ดิบ) และมี check constraint ขนาด/รูปแบบ
--   4) โครงการที่แชร์หมดอายุใน 30 วัน (ล้างด้วย purge_expired_demo_projects())
-- ห้ามนำ service_role key ไปใส่ใน public/js ไม่ว่ากรณีใด
-- ============================================================================

-- ---------- 1. ตาราง ----------
create table if not exists public.demo_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 300),
  project_data jsonb not null check (
    jsonb_typeof(project_data) = 'object'
    and project_data ? 'meta' and project_data ? 'panels' and project_data ? 'items'
    and jsonb_typeof(project_data -> 'panels') = 'array' and jsonb_typeof(project_data -> 'items') = 'array'
    and pg_column_size(project_data) <= 200000
  ),
  is_official_preset boolean not null default false,
  creator_name text not null default 'Photsawat Suksombat',
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz default (now() + interval '30 days'),
  check (is_official_preset or expires_at is not null)          -- ตัวอย่างทางการไม่หมดอายุ (expires_at = null) ; ที่ผู้ใช้แชร์ต้องมีวันหมดอายุ
);

create table if not exists public.demo_export_logs (
  id bigint generated always as identity primary key,
  attempted_format text not null check (attempted_format in ('PDF', 'CSV', 'XLSX', 'DXF', 'JSON', 'OTHER')),
  client_kind text not null default 'unknown' check (client_kind in ('desktop', 'mobile', 'unknown')),
  created_at timestamptz not null default now()
);

-- ตารางภายใน (anon/authenticated ไม่มีสิทธิ์ใด ๆ)
create table if not exists public.demo_private (k text primary key, v text not null);
insert into public.demo_private (k, v) values ('salt', gen_random_uuid()::text) on conflict (k) do nothing;
create table if not exists public.demo_rate_limit (
  bucket text not null, win timestamptz not null, cnt integer not null default 0,
  primary key (bucket, win)
);

-- ---------- 2. Row Level Security + สิทธิ์ระดับคอลัมน์ ----------
alter table public.demo_projects enable row level security;
alter table public.demo_export_logs enable row level security;
alter table public.demo_private enable row level security;
alter table public.demo_rate_limit enable row level security;

revoke all on public.demo_projects, public.demo_export_logs, public.demo_private, public.demo_rate_limit from anon, authenticated;
grant select (id, title, description, is_official_preset, created_at) on public.demo_projects to anon;
grant insert (id, title, project_data) on public.demo_projects to anon;
grant insert (attempted_format, client_kind) on public.demo_export_logs to anon;

drop policy if exists demo_projects_select_official on public.demo_projects;
create policy demo_projects_select_official on public.demo_projects
  for select to anon using (is_official_preset);

drop policy if exists demo_projects_insert_anon on public.demo_projects;
create policy demo_projects_insert_anon on public.demo_projects
  for insert to anon
  with check (is_official_preset = false and creator_name = 'Photsawat Suksombat' and view_count = 0 and expires_at is not null);

drop policy if exists demo_export_logs_insert_anon on public.demo_export_logs;
create policy demo_export_logs_insert_anon on public.demo_export_logs
  for insert to anon with check (true);          -- ค่าที่ยอมรับถูกจำกัดด้วย check constraint + column grant แล้ว (ไม่มีนโยบาย SELECT = anon อ่านล็อกไม่ได้)

-- ---------- 3. ตัวจำกัดอัตรา (ต่อ IP แบบแฮชเค็มรายชั่วโมง) ----------
create or replace function public.demo_rate_check(p_kind text, p_max integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ip text;
  salt text;
  b text;
  w timestamptz := date_trunc('hour', now());
  c integer;
begin
  if current_setting('role', true) is distinct from 'anon' then return; end if;   -- จำกัดเฉพาะคำขอจากเบราว์เซอร์ (anon) ; เจ้าของโปรเจกต์ที่ seed/ดูแลไม่ถูกจำกัด
  ip := coalesce(nullif(trim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), ''), 'unknown');
  select v into salt from public.demo_private where k = 'salt';
  b := p_kind || ':' || encode(sha256(convert_to(ip || ':' || coalesce(salt, ''), 'utf8')), 'hex');
  insert into public.demo_rate_limit as r (bucket, win, cnt) values (b, w, 1)
    on conflict (bucket, win) do update set cnt = r.cnt + 1
    returning r.cnt into c;
  if c > p_max then
    raise exception 'rate limit exceeded' using errcode = 'PT429';     -- PostgREST แปลงเป็น HTTP 429
  end if;
  if random() < 0.02 then delete from public.demo_rate_limit where win < now() - interval '2 days'; end if;
end $$;
revoke all on function public.demo_rate_check(text, integer) from public, anon, authenticated;

create or replace function public.demo_projects_rate() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.demo_rate_check('share', 10); return new; end $$;
create or replace function public.demo_logs_rate() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.demo_rate_check('log', 60); return new; end $$;
revoke all on function public.demo_projects_rate() from public, anon, authenticated;
revoke all on function public.demo_logs_rate() from public, anon, authenticated;

drop trigger if exists demo_projects_rate_trg on public.demo_projects;
create trigger demo_projects_rate_trg before insert on public.demo_projects for each row execute function public.demo_projects_rate();
drop trigger if exists demo_logs_rate_trg on public.demo_export_logs;
create trigger demo_logs_rate_trg before insert on public.demo_export_logs for each row execute function public.demo_logs_rate();

-- ---------- 4. RPC: ดึงโครงการตาม UUID (นับยอดดู) ----------
create or replace function public.get_demo_project(p_id uuid)
returns table (id uuid, title text, project_data jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.demo_projects d set view_count = d.view_count + 1
    where d.id = p_id and (d.expires_at is null or d.expires_at > now());
  return query select d.id, d.title, d.project_data from public.demo_projects d
    where d.id = p_id and (d.expires_at is null or d.expires_at > now());
end $$;
revoke all on function public.get_demo_project(uuid) from public;
grant execute on function public.get_demo_project(uuid) to anon;

-- ---------- 5. ล้างข้อมูลหมดอายุ (เรียกมือ หรือตั้ง pg_cron: select cron.schedule('purge-demo', '17 3 * * *', 'select public.purge_expired_demo_projects()');) ----------
create or replace function public.purge_expired_demo_projects() returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.demo_projects where expires_at is not null and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_expired_demo_projects() from public, anon, authenticated;
