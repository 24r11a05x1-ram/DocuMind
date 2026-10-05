create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  size bigint not null default 0,
  chunk_count int not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;
alter table public.documents enable row level security;
create policy "own documents" on public.documents for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  page int,
  content text not null,
  fts tsvector generated always as (to_tsvector('english', content)) stored
);
create index chunks_fts_idx on public.chunks using gin(fts);
grant select, insert, delete on public.chunks to authenticated;
grant all on public.chunks to service_role;
alter table public.chunks enable row level security;
create policy "own chunks" on public.chunks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text not null default 'New chat',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.threads to authenticated;
grant all on public.threads to service_role;
alter table public.threads enable row level security;
create policy "own threads" on public.threads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  ui_id text not null,
  role text not null,
  parts jsonb not null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy "own messages" on public.messages for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Retrieval: keyword-ranked chunks with OR semantics, scoped to caller
create or replace function public.search_chunks(q text, k int default 6)
returns table (id uuid, document_id uuid, document_name text, page int, content text, rank real)
language sql stable security invoker set search_path = public as $$
  select c.id, c.document_id, d.name, c.page, c.content,
    ts_rank(c.fts, query) as rank
  from public.chunks c
  join public.documents d on d.id = c.document_id,
  lateral (select to_tsquery('english', coalesce(nullif(array_to_string(
     array(select lexeme from unnest(to_tsvector('english', q))), ' | '), ''), 'zzzznomatch')) as query) qq
  where c.user_id = auth.uid() and c.fts @@ query
  order by rank desc
  limit k;
$$;
grant execute on function public.search_chunks(text, int) to authenticated;