-- 在 Supabase SQL Editor 執行一次。可重複執行。

create table if not exists public.nz_sync (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.nz_sync enable row level security;

drop policy if exists "public read" on public.nz_sync;
drop policy if exists "public write" on public.nz_sync;
drop policy if exists "public update" on public.nz_sync;
create policy "public read" on public.nz_sync for select using (true);
create policy "public write" on public.nz_sync for insert with check (true);
create policy "public update" on public.nz_sync for update using (true) with check (true);

-- 建立公開圖片空間。網站只把圖片網址放進同步資料，不再把 Base64 塞進 localStorage。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-media', 'trip-media', true, 15728640, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public=true, file_size_limit=15728640;

drop policy if exists "trip media public read" on storage.objects;
drop policy if exists "trip media public insert" on storage.objects;
drop policy if exists "trip media public update" on storage.objects;
drop policy if exists "trip media public delete" on storage.objects;

create policy "trip media public read" on storage.objects
for select using (bucket_id = 'trip-media');

create policy "trip media public insert" on storage.objects
for insert with check (bucket_id = 'trip-media');

create policy "trip media public update" on storage.objects
for update using (bucket_id = 'trip-media') with check (bucket_id = 'trip-media');

create policy "trip media public delete" on storage.objects
for delete using (bucket_id = 'trip-media');
