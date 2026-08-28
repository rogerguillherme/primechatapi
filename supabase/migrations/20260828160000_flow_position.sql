-- Ordem dos fluxos escolhida pelo usuário.
--
-- A lista suspensa do chat vinha por nome, e o construtor por data de criação.
-- Quem usa dois ou três fluxos no dia a dia quer os dele no topo, não em ordem
-- alfabética.
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

-- Backfill preservando a ordem que a pessoa já enxergava no chat
-- (ativos primeiro, depois nome), para a lista não embaralhar na atualização.
WITH ordenados AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id ORDER BY active DESC, name
  ) AS pos
  FROM public.flows
)
UPDATE public.flows f SET position = o.pos
FROM ordenados o WHERE o.id = f.id;

CREATE INDEX IF NOT EXISTS idx_flows_user_position ON public.flows (user_id, position);
