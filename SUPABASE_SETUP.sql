-- 在 Supabase SQL Editor 執行一次；可重複執行。
create table if not exists public.kyoto_sync (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.kyoto_sync enable row level security;

drop policy if exists "kyoto public read" on public.kyoto_sync;
drop policy if exists "kyoto public write" on public.kyoto_sync;
drop policy if exists "kyoto public update" on public.kyoto_sync;

create policy "kyoto public read" on public.kyoto_sync
for select using (true);

create policy "kyoto public write" on public.kyoto_sync
for insert with check (true);

create policy "kyoto public update" on public.kyoto_sync
for update using (true) with check (true);

-- 共用既有圖片 bucket；若尚未建立則建立。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-media', 'trip-media', true, 15728640, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public=true, file_size_limit=15728640;
