-- ═══════════════════════════════════════════════════════════════════════════
-- Módulo de vendas: busca e agregação no banco.
--
-- POR QUE ISTO EXISTE
--
-- As telas de vendas (Pedidos, Leads, Reembolsos, Dashboard, Vencimentos)
-- estavam escritas mas desligadas — sem rota. Ao ligá-las apareceram três
-- problemas que só dão errado em silêncio:
--
--  1. Teto de 1.000 linhas do PostgREST. Orders/Leads/Dashboard buscavam
--     `from("orders").select(...)` SEM limite e agregavam em JavaScript. A
--     partir do milésimo pedido a receita, a contagem de recorrentes e a
--     lista de compradores simplesmente param de crescer. Mesmo bug que já
--     foi corrigido nas métricas de disparo (20260827150000).
--
--  2. Busca por cliente impossível. Orders.tsx só filtrava
--     `external_order_id.ilike`. "Pesquisar quem comprou" na prática é buscar
--     por nome, telefone, e-mail e produto — três deles em OUTRA tabela.
--
--  3. Refunds.tsx tentava `or("external_order_id.ilike.%x%,leads.name.ilike.%x%")`.
--     PostgREST não aceita coluna de tabela embutida dentro de `or()` no nível
--     de cima: a requisição volta 400, o código ignorava o erro e a tela
--     mostrava "nenhum reembolso encontrado". Buscar por nome ali nunca
--     funcionou.
--
-- SEGURANÇA: as funções novas são SECURITY INVOKER (padrão) de propósito.
-- Assim a RLS de `orders`/`leads` continua valendo — nenhuma delas inventa
-- permissão. get_dashboard_stats, que já existia, era SECURITY DEFINER SEM
-- filtro nenhum: qualquer usuário autenticado (inclusive um trial) via a
-- receita e a contagem de leads da conta inteira. Corrigido no fim do arquivo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Índices ────────────────────────────────────────────────────────────────
-- `orders` cresce e a busca nova filtra por nome/telefone/e-mail/produto via
-- join com leads e products, sempre com ilike '%termo%'. Sem trigramas isso é
-- seq scan nas três tabelas a cada tecla digitada.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON public.orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_lead_id ON public.orders (lead_id);
CREATE INDEX IF NOT EXISTS idx_orders_product_id ON public.orders (product_id);
CREATE INDEX IF NOT EXISTS idx_orders_external_trgm
  ON public.orders USING gin (external_order_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_name_trgm ON public.leads USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_email_trgm ON public.leads USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_phone_trgm ON public.leads USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_checkout_name_trgm
  ON public.products USING gin (checkout_name gin_trgm_ops);


-- ── Valor líquido do pedido ────────────────────────────────────────────────
-- A Hubla manda o bruto em `amount` e o repasse do vendedor dentro do payload
-- (receivers[].role = 'seller'). O Dashboard já usava o líquido; get_dashboard_stats
-- também. Estava duplicado em três lugares — agora fica um só.
-- O guard de jsonb_typeof é necessário: pedido importado de planilha não tem
-- `receivers`, e jsonb_array_elements em não-array levanta exceção.
CREATE OR REPLACE FUNCTION public.order_net_amount(p_payload jsonb, p_amount numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT (r->>'totalCents')::numeric / 100
      FROM jsonb_array_elements(p_payload->'event'->'invoice'->'receivers') r
      WHERE jsonb_typeof(p_payload->'event'->'invoice'->'receivers') = 'array'
        AND r->>'role' = 'seller'
      LIMIT 1
    ),
    p_amount,
    0
  );
$$;


-- ── 1. Busca de pedidos ────────────────────────────────────────────────────
-- Filtra e conta NO BANCO. `total_count` vem por window function sobre o
-- conjunto filtrado, então a tela sabe o total real mesmo paginando.
--
-- Telefone: `leads.phone` é guardado só com dígitos (normalizePhone do
-- hubla-webhook). Quem digita "(11) 99999-8888" não acharia nada, então o
-- termo é reduzido a dígitos ANTES da comparação — no termo, nunca na coluna,
-- senão o índice trigram não serve para nada.
--
-- LEFT JOIN em leads de propósito: com INNER, um pedido cujo lead a RLS não
-- deixa ver sumiria da lista inteira em vez de aparecer sem nome.
CREATE OR REPLACE FUNCTION public.search_orders(
  p_search text DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  external_order_id text,
  amount numeric,
  net_amount numeric,
  status text,
  payment_method text,
  created_at timestamptz,
  updated_at timestamptz,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  lead_email text,
  product_id uuid,
  product_name text,
  total_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH term AS (
    SELECT
      nullif(btrim(coalesce(p_search, '')), '') AS txt,
      nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '') AS digits
  ),
  filtered AS (
    SELECT
      o.id,
      o.external_order_id,
      o.amount,
      public.order_net_amount(o.webhook_payload, o.amount) AS net_amount,
      o.status,
      o.payment_method,
      o.created_at,
      o.updated_at,
      o.lead_id,
      l.name  AS lead_name,
      l.phone AS lead_phone,
      l.email AS lead_email,
      o.product_id,
      -- Pedido importado de planilha pode não casar com nenhum produto
      -- cadastrado; o nome fica no payload da importação.
      coalesce(p.checkout_name, o.webhook_payload->>'product_name') AS product_name
    FROM public.orders o
    LEFT JOIN public.leads l ON l.id = o.lead_id
    LEFT JOIN public.products p ON p.id = o.product_id
    CROSS JOIN term t
    WHERE (p_statuses IS NULL OR o.status = ANY(p_statuses))
      AND (p_from IS NULL OR o.created_at >= p_from)
      AND (p_to   IS NULL OR o.created_at <= p_to)
      AND (
        t.txt IS NULL
        OR o.external_order_id ILIKE '%' || t.txt || '%'
        OR l.name  ILIKE '%' || t.txt || '%'
        OR l.email ILIKE '%' || t.txt || '%'
        OR p.checkout_name ILIKE '%' || t.txt || '%'
        OR o.webhook_payload->>'product_name' ILIKE '%' || t.txt || '%'
        OR (t.digits IS NOT NULL AND l.phone LIKE '%' || t.digits || '%')
      )
  )
  SELECT f.*, count(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.created_at DESC
  LIMIT greatest(coalesce(p_limit, 50), 1)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.search_orders(text, text[], timestamptz, timestamptz, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_orders(text, text[], timestamptz, timestamptz, integer, integer)
  TO authenticated, service_role;


-- ── 2. Compradores ─────────────────────────────────────────────────────────
-- A tela de Leads buscava TODOS os pedidos só para descobrir quais leads
-- compraram, e de novo para contar compras e produtos preferidos: dois
-- select sem limite, ambos cortados em 1.000 linhas.
--
-- "Compra" aqui é pedido aprovado que não é order bump (-offer) nem teste
-- (-tester) — mesma regra de get_dashboard_stats.
CREATE OR REPLACE FUNCTION public.list_buyers(
  p_search text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  hubla_id text,
  name text,
  email text,
  phone text,
  created_at timestamptz,
  purchase_count bigint,
  top_products text[],
  total_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH term AS (
    SELECT
      nullif(btrim(coalesce(p_search, '')), '') AS txt,
      nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '') AS digits
  ),
  main_orders AS (
    SELECT o.lead_id,
           o.status,
           coalesce(p.checkout_name, o.webhook_payload->>'product_name') AS product_name
    FROM public.orders o
    LEFT JOIN public.products p ON p.id = o.product_id
    WHERE o.external_order_id NOT LIKE '%-offer%'
      AND o.external_order_id NOT LIKE '%-tester%'
  ),
  stats AS (
    SELECT lead_id, count(*) FILTER (WHERE status = 'approved') AS purchase_count
    FROM main_orders
    GROUP BY lead_id
  ),
  per_product AS (
    SELECT lead_id, product_name, count(*) AS qty
    FROM main_orders
    WHERE status = 'approved' AND product_name IS NOT NULL
    GROUP BY lead_id, product_name
  ),
  top3 AS (
    SELECT lead_id, array_agg(product_name ORDER BY qty DESC, product_name) AS top_products
    FROM (
      SELECT *, row_number() OVER (PARTITION BY lead_id ORDER BY qty DESC, product_name) AS rn
      FROM per_product
    ) ranked
    WHERE rn <= 3
    GROUP BY lead_id
  ),
  filtered AS (
    SELECT
      l.id, l.hubla_id, l.name, l.email, l.phone, l.created_at,
      coalesce(s.purchase_count, 0) AS purchase_count,
      coalesce(t3.top_products, ARRAY[]::text[]) AS top_products
    FROM public.leads l
    JOIN stats s ON s.lead_id = l.id
    LEFT JOIN top3 t3 ON t3.lead_id = l.id
    CROSS JOIN term t
    WHERE (p_from IS NULL OR l.created_at >= p_from)
      AND (p_to   IS NULL OR l.created_at <= p_to)
      AND (
        t.txt IS NULL
        OR l.name  ILIKE '%' || t.txt || '%'
        OR l.email ILIKE '%' || t.txt || '%'
        OR (t.digits IS NOT NULL AND l.phone LIKE '%' || t.digits || '%')
      )
  )
  SELECT f.*, count(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.created_at DESC
  LIMIT greatest(coalesce(p_limit, 50), 1)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.list_buyers(text, timestamptz, timestamptz, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_buyers(text, timestamptz, timestamptz, integer, integer)
  TO authenticated, service_role;


-- ── 3. Resumo de vendas do período ─────────────────────────────────────────
-- Substitui TRÊS varreduras que o Dashboard fazia em JavaScript (stats,
-- recorrência e ranking por produto), todas cortadas em 1.000 pedidos.
-- O ranking sai como jsonb porque é uma lista dentro de uma linha só — evita
-- uma segunda chamada.
CREATE OR REPLACE FUNCTION public.get_sales_summary(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  total_buyers bigint,
  total_orders bigint,
  approved_revenue numeric,
  returning_buyers bigint,
  by_product jsonb
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH main_orders AS (
    SELECT
      o.lead_id,
      o.product_id,
      public.order_net_amount(o.webhook_payload, o.amount) AS net_amount,
      coalesce(p.checkout_name, o.webhook_payload->>'product_name', 'Sem produto') AS product_name
    FROM public.orders o
    LEFT JOIN public.products p ON p.id = o.product_id
    WHERE o.status = 'approved'
      AND o.external_order_id NOT LIKE '%-offer%'
      AND o.external_order_id NOT LIKE '%-tester%'
      AND (p_from IS NULL OR o.created_at >= p_from)
      AND (p_to   IS NULL OR o.created_at <= p_to)
  ),
  per_lead AS (
    SELECT lead_id, count(*) AS n FROM main_orders GROUP BY lead_id
  ),
  per_product AS (
    SELECT product_name, count(*) AS sales, sum(net_amount) AS revenue
    FROM main_orders
    GROUP BY product_name
  )
  SELECT
    (SELECT count(*) FROM per_lead),
    (SELECT count(*) FROM main_orders),
    (SELECT coalesce(sum(net_amount), 0) FROM main_orders),
    (SELECT count(*) FROM per_lead WHERE n >= 2),
    (SELECT coalesce(
       jsonb_agg(jsonb_build_object('name', product_name, 'count', sales, 'revenue', revenue)
                 ORDER BY sales DESC, revenue DESC),
       '[]'::jsonb)
     FROM per_product);
$$;

REVOKE ALL ON FUNCTION public.get_sales_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_summary(timestamptz, timestamptz)
  TO authenticated, service_role;


-- ── 4. get_dashboard_stats: fechar o vazamento entre contas ────────────────
-- Era SECURITY DEFINER e contava `leads`, `orders` e `products` do banco
-- INTEIRO, sem olhar quem chamou. Como o Dashboard estava sem rota, ninguém
-- alcançava — ao ligar a rota isso viraria receita de uma conta aparecendo
-- para outra. Passa a usar a mesma regra da RLS das tabelas
-- (dono OU admin), então para o admin os números continuam idênticos.
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS TABLE(
  total_leads bigint,
  total_orders bigint,
  approved_revenue numeric,
  total_products bigint,
  expiring_soon_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid, public.has_role(auth.uid(), 'admin'::public.app_role) AS is_admin
  ),
  visible_orders AS (
    SELECT o.*
    FROM public.orders o, me
    WHERE (me.is_admin OR o.user_id = me.uid)
      AND o.external_order_id NOT LIKE '%-offer%'
      AND o.external_order_id NOT LIKE '%-tester%'
  ),
  latest_approved AS (
    SELECT DISTINCT ON (lead_id) lead_id, created_at
    FROM visible_orders
    WHERE status = 'approved'
    ORDER BY lead_id, created_at DESC
  )
  SELECT
    (SELECT count(*) FROM public.leads l, me WHERE me.is_admin OR l.user_id = me.uid),
    (SELECT count(*) FROM visible_orders WHERE status = 'approved'),
    (SELECT coalesce(sum(public.order_net_amount(webhook_payload, amount)), 0)
       FROM visible_orders WHERE status = 'approved'),
    (SELECT count(*) FROM public.products p, me WHERE me.is_admin OR p.user_id = me.uid),
    (SELECT count(*) FROM latest_approved
      WHERE (created_at + interval '1 month') - now() <= interval '15 days');
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated, service_role;