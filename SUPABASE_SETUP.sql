-- 京都家庭旅行網站安全設定。請在 Supabase SQL Editor 執行一次；可重複執行。
create table if not exists public.kyoto_sync (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.kyoto_sync enable row level security;

drop policy if exists "kyoto public read" on public.kyoto_sync;
drop policy if exists "kyoto public write" on public.kyoto_sync;
drop policy if exists "kyoto public update" on public.kyoto_sync;
drop policy if exists "kyoto family read" on public.kyoto_sync;
drop policy if exists "kyoto family insert" on public.kyoto_sync;
drop policy if exists "kyoto family update" on public.kyoto_sync;
drop policy if exists "kyoto family delete" on public.kyoto_sync;

create policy "kyoto family read" on public.kyoto_sync
for select to authenticated using (true);
create policy "kyoto family insert" on public.kyoto_sync
for insert to authenticated with check (true);
create policy "kyoto family update" on public.kyoto_sync
for update to authenticated using (true) with check (true);
create policy "kyoto family delete" on public.kyoto_sync
for delete to authenticated using (true);

revoke all on table public.kyoto_sync from anon;
grant select, insert, update, delete on table public.kyoto_sync to authenticated;

-- 圖片網址維持可直接顯示，但只有已登入的家人可以上傳、替換或刪除。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-media', 'trip-media', true, 15728640, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public=true, file_size_limit=15728640,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif'];

drop policy if exists "trip media authenticated insert" on storage.objects;
drop policy if exists "trip media authenticated update" on storage.objects;
drop policy if exists "trip media authenticated delete" on storage.objects;
drop policy if exists "trip media public read" on storage.objects;
drop policy if exists "trip media public insert" on storage.objects;
drop policy if exists "trip media public update" on storage.objects;
drop policy if exists "trip media public delete" on storage.objects;

create policy "trip media authenticated insert" on storage.objects
for insert to authenticated with check (bucket_id='trip-media');
create policy "trip media authenticated update" on storage.objects
for update to authenticated using (bucket_id='trip-media') with check (bucket_id='trip-media');
create policy "trip media authenticated delete" on storage.objects
for delete to authenticated using (bucket_id='trip-media');
