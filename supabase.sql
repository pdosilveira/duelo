-- Duelo de Faixas: banco do ranking unificado. Cole tudo no SQL Editor do Supabase e toque em Run.
create table if not exists public.songs (
  seq bigint generated always as identity unique,
  id text primary key,
  title text not null,
  artist text not null,
  album text,
  art text,
  preview text,
  link text,
  itunes_id bigint,
  added_at bigint,
  added_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.votes (
  seq bigint generated always as identity unique,
  id text primary key,
  a text not null,
  b text not null,
  r text not null check (r in ('A', 'B', 'D')),
  t bigint not null,
  voter text not null check (char_length(voter) between 1 and 40),
  created_at timestamptz not null default now(),
  check (a <> b)
);

alter table public.songs enable row level security;
alter table public.votes enable row level security;

-- Qualquer pessoa com o link pode ler e inserir; ninguém pode alterar nem apagar.
create policy "ler musicas" on public.songs for select to anon using (true);
create policy "inserir musicas" on public.songs for insert to anon with check (true);
create policy "ler votos" on public.votes for select to anon using (true);
create policy "inserir votos" on public.votes for insert to anon with check (true);

grant select, insert on public.songs, public.votes to anon;
