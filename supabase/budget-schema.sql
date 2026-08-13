-- ============================================================
-- accounts
-- ============================================================
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,
  kind        text not null default 'checking',   -- checking | savings | cash | credit
  on_budget   boolean not null default true,
  archived    boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- envelopes
-- `kind = payment` rows are created automatically for credit accounts in
-- phase 2; phase 1 never creates them but the column exists so there is
-- no migration later.
-- ============================================================
create table if not exists public.envelopes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade,
  name               text not null,
  icon               text,
  kind               text not null default 'normal',  -- normal | payment
  linked_account_id  uuid references public.accounts on delete cascade,
  sort_order         int not null default 0,
  archived           boolean not null default false,
  limit_cents        bigint,                          -- null = no limit set
  created_at         timestamptz not null default now()
);

-- For installs created before limits existed.
alter table public.envelopes add column if not exists limit_cents bigint;

-- ============================================================
-- transactions
--   normal   — real income or spending
--   transfer — between own accounts; neither income nor expense
--   starting — pre-existing balance, predates budgeting
-- amount_cents is signed: negative is an outflow.
-- ============================================================
create table if not exists public.transactions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users on delete cascade,
  account_id           uuid not null references public.accounts on delete cascade,
  date                 date not null,
  amount_cents         bigint not null,
  payee                text,
  note                 text,
  envelope_id          uuid references public.envelopes on delete set null,
  transfer_account_id  uuid references public.accounts on delete cascade,
  kind                 text not null default 'normal',
  cleared              boolean not null default false,
  import_hash          text,
  created_at           timestamptz not null default now()
);

-- ============================================================
-- allocations — unused in phase 1, created now to avoid a migration
-- ============================================================
create table if not exists public.allocations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  month        text not null,                       -- 'YYYY-MM'
  envelope_id  uuid not null references public.envelopes on delete cascade,
  amount_cents bigint not null,
  created_at   timestamptz not null default now(),
  unique (user_id, month, envelope_id)
);

-- ============================================================
-- paychecks — one recurring income stream per user, split across accounts
-- by percentage on fixed days of the month. Posting is explicit; these rows
-- are the template, not the ledger.
--   pay_days [{ day: 15, amount_cents: 240000 }, ...]
--   splits   [{ account_id: uuid, percent: 60 }, ...]
-- ============================================================
create table if not exists public.paychecks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users on delete cascade,
  payee       text not null default 'Paycheck',
  start_date  date,                                -- never back-fill before this
  pay_days    jsonb not null default '[]'::jsonb,
  splits      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- indexes
-- ============================================================
create index if not exists transactions_user_date_idx
  on public.transactions (user_id, date desc);
create index if not exists transactions_user_envelope_idx
  on public.transactions (user_id, envelope_id);
create index if not exists transactions_user_account_idx
  on public.transactions (user_id, account_id);

-- This is what makes re-importing an overlapping bank export safe.
--
-- Deliberately NOT partial. `on_conflict=user_id,import_hash` (what the client
-- sends for an upsert) can only be inferred against a plain unique index — a
-- partial one additionally requires the statement to repeat its WHERE
-- predicate, which PostgREST does not emit, and the import fails with
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
-- Nothing is lost: Postgres treats NULLs as distinct, so hand-entered rows
-- (import_hash is null) are still unconstrained.
drop index if exists public.transactions_user_import_hash_idx;
create unique index if not exists transactions_user_import_hash_uniq
  on public.transactions (user_id, import_hash);

-- ============================================================
-- row level security
-- ============================================================
alter table public.accounts     enable row level security;
alter table public.envelopes    enable row level security;
alter table public.transactions enable row level security;
alter table public.allocations  enable row level security;
alter table public.paychecks    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['accounts','envelopes','transactions','allocations','paychecks'] loop
    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format(
      'create policy %I_owner on public.%I for all
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
  end loop;
end $$;

-- ============================================================
-- aggregates
-- The client never loads every transaction. These two return compact
-- summaries so balances stay derived without shipping the whole ledger.
-- ============================================================

create or replace function public.budget_monthly_totals(p_user uuid)
returns table (envelope_id uuid, month text, total_cents bigint)
language sql stable security invoker as $$
  select t.envelope_id,
         to_char(t.date, 'YYYY-MM') as month,
         sum(t.amount_cents)::bigint as total_cents
  from public.transactions t
  where t.user_id = p_user
    and t.kind = 'normal'
  group by t.envelope_id, to_char(t.date, 'YYYY-MM');
$$;

-- A transfer is a single row on the account the money left, so the receiving
-- account only appears on it as transfer_account_id. Both ends have to be
-- counted or paying a credit card off checking never reduces the card's debt.
create or replace function public.budget_account_totals(p_user uuid)
returns table (account_id uuid, total_cents bigint)
language sql stable security invoker as $$
  select s.acct as account_id, sum(s.delta)::bigint as total_cents
  from (
    select t.account_id as acct, t.amount_cents as delta
    from public.transactions t
    where t.user_id = p_user
    union all
    select t.transfer_account_id as acct, -t.amount_cents as delta
    from public.transactions t
    where t.user_id = p_user
      and t.kind = 'transfer'
      and t.transfer_account_id is not null
  ) s
  group by s.acct;
$$;

grant execute on function public.budget_monthly_totals(uuid) to authenticated;
grant execute on function public.budget_account_totals(uuid) to authenticated;
