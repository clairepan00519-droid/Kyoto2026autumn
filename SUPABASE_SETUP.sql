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
drop policy if exists "family authenticated read" on public.nz_sync;
drop policy if exists "family authenticated write" on public.nz_sync;
drop policy if exists "family authenticated update" on public.nz_sync;

-- v19：只有已登入 Supabase Auth 的家人帳號可以讀寫共用資料。
create policy "family authenticated read" on public.nz_sync
for select to authenticated using (true);
create policy "family authenticated write" on public.nz_sync
for insert to authenticated with check (true);
create policy "family authenticated update" on public.nz_sync
for update to authenticated using (true) with check (true);

-- 建立公開圖片空間。網站只把圖片網址放進同步資料，不再把 Base64 塞進 localStorage。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-media', 'trip-media', true, 15728640, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public=true, file_size_limit=15728640;

drop policy if exists "trip media public read" on storage.objects;
drop policy if exists "trip media family read" on storage.objects;
drop policy if exists "trip media public insert" on storage.objects;
drop policy if exists "trip media public update" on storage.objects;
drop policy if exists "trip media public delete" on storage.objects;
drop policy if exists "trip media family insert" on storage.objects;
drop policy if exists "trip media family update" on storage.objects;
drop policy if exists "trip media family delete" on storage.objects;

-- 圖片使用不可猜測的 UUID 路徑；物件清單與 Storage API 讀取僅限已登入家人。
-- bucket 保持 public 是為了讓已同步的既有圖片網址可以離線快取，不必整批搬遷。
create policy "trip media family read" on storage.objects
for select to authenticated using (bucket_id = 'trip-media');

create policy "trip media family insert" on storage.objects
for insert to authenticated with check (bucket_id = 'trip-media');

create policy "trip media family update" on storage.objects
for update to authenticated using (bucket_id = 'trip-media') with check (bucket_id = 'trip-media');

create policy "trip media family delete" on storage.objects
for delete to authenticated using (bucket_id = 'trip-media');
