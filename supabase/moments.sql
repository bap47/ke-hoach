-- Bảng lưu "Khoảnh khắc" (ảnh chia sẻ với bạn bè) cho web Kế hoạch.
-- Chạy một lần trong Supabase → SQL Editor.

create table if not exists public.moments (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null,
  img         text not null,
  caption     text not null default '',
  audience    text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists moments_created_idx on public.moments (created_at desc);

alter table public.moments enable row level security;

-- Tên đăng nhập = phần trước @ của email (vd: bap123@users.kehoach.app -> bap123)
drop policy if exists "moments_select" on public.moments;
create policy "moments_select" on public.moments for select to authenticated
  using (
    author_id = auth.uid()
    or lower(split_part(auth.jwt() ->> 'email', '@', 1)) = any (audience)
  );

drop policy if exists "moments_insert" on public.moments;
create policy "moments_insert" on public.moments for insert to authenticated
  with check (
    author_id = auth.uid()
    and author_name = lower(split_part(auth.jwt() ->> 'email', '@', 1))
  );

drop policy if exists "moments_delete" on public.moments;
create policy "moments_delete" on public.moments for delete to authenticated
  using (author_id = auth.uid());

notify pgrst, 'reload schema';
