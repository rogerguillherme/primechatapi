-- ═══════════════════════════════════════════════════════════════════════════
-- Métricas de disparo: agregação no banco, separada por origem.
--
-- O QUE ESTAVA ERRADO
--
--  1. Teto silencioso de 1.000 linhas. O front buscava campaign_events sem
--     limite nenhum e somava em JavaScript. O PostgREST devolve no máximo
--     1.000 linhas por requisição, então a partir do milésimo evento os
--     números de "entregue" e "lido" simplesmente paravam de crescer — sem
--     erro, sem aviso. Mesmo problema com .limit(1000) em flow_executions.
--
--  2. Universos misturados. O resumo fazia
--     Math.max(contador_do_broadcast, todas_as_mensagens_outbound), o que
--     junta disparo em massa, mensagem de fluxo e envio manual do atendente
--     e escolhe o maior. E getEffectiveJobCounts fazia
--     Math.max(job.delivered_count, eventos_delivered): quando os dois
--     divergiam (webhook perdido, evento duplicado) o maior escondia a
--     divergência em vez de mostrá-la.
--
-- O QUE MUDA
--
--  A contagem passa a ser feita no Postgres, uma linha por (origem, conta).
--  A fonte da verdade do disparo em massa passa a ser message_logs — uma
--  linha por tentativa, com user_id, job_id e o status real vindo do webhook
--  da Meta — e não mais campaign_events nem os contadores do job.
--
-- ORIGENS QUE OS DADOS PERMITEM SEPARAR COM SEGURANÇA
--
--   broadcast — message_logs (só broadcast-processor, evolution-bulk-broadcast
--               e evolution-recovery-broadcast escrevem nessa tabela)
--   flow      — flow_executions (uma linha por execução de fluxo)
--   chat      — chat_messages outbound que NÃO vieram de disparo em massa
--
--  O QUE NÃO DEU PARA SEPARAR: fluxo x envio manual dentro de "chat".
--  chat_messages não tem coluna de origem, e o executor de fluxo
--  (flow-processor) manda pela MESMA edge function do chat manual
--  (whatsapp-cloud-send) — as linhas gravadas são idênticas. Qualquer
--  separação hoje seria heurística de janela de tempo, que erra em silêncio.
--  Para separar de verdade: coluna `source text` em chat_messages preenchida
--  no envio ('broadcast' | 'flow' | 'manual').
--
--  Já o disparo em massa dá para excluir de "chat" sem heurística: o
--  broadcast-processor grava a mesma wa_message_id em message_logs e em
--  chat_messages.zapi_message_id, então basta o anti-join.
--
-- SEMÂNTICA WHATSAPP: "entregue" e "lido" são acumulativos — lido implica
-- entregue. As contagens abaixo respeitam isso (read ⊆ delivered ⊆ sent) e
-- NUNCA são somadas entre si.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Índices ────────────────────────────────────────────────────────────────
-- Faltava índice em wa_message_id. Além do anti-join novo, TODO callback de
-- status da Meta faz `update message_logs ... where wa_message_id = ?` — isso
-- era seq scan em produção.
CREATE INDEX IF NOT EXISTS idx_message_logs_wa_message_id
  ON public.message_logs (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_logs_user_account
  ON public.message_logs (user_id, account_id);

CREATE INDEX IF NOT EXISTS idx_flow_executions_flow_started
  ON public.flow_executions (flow_id, started_at);

CREATE INDEX IF NOT EXISTS idx_flows_user_id
  ON public.flows (user_id);


-- ── 1. Resumo por origem (e por conta) ─────────────────────────────────────
-- Uma linha por (source, account_id). O cliente soma dezenas de linhas, não
-- centenas de milhares — o teto de 1.000 do PostgREST deixa de existir.
--
-- delivered/read vêm NULL para 'flow': flow_executions não guarda o id da
-- mensagem, então não há como saber o que a Meta entregou/leu. NULL é
-- deliberado — a tela mostra "—" em vez de fingir zero.
CREATE OR REPLACE FUNCTION public.get_sending_metrics_by_source(
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL
)
RETURNS TABLE (
  source text,
  account_id uuid,
  sent bigint,
  delivered bigint,
  read bigint,
  failed bigint,
  skipped bigint,
  pending bigint,
  tracks_delivery boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- DISPARO EM MASSA
  SELECT
    'broadcast'::text,
    ml.account_id,
    count(*) FILTER (WHERE ml.status IN ('sent', 'accepted', 'delivered', 'read')),
    count(*) FILTER (WHERE ml.status IN ('delivered', 'read')
                        OR ml.delivered_at IS NOT NULL
                        OR ml.read_at IS NOT NULL),
    count(*) FILTER (WHERE ml.status = 'read' OR ml.read_at IS NOT NULL),
    count(*) FILTER (WHERE ml.status IN ('failed', 'error', 'blocked_by_meta',
                                         'payment_issue', 'rate_limited',
                                         'invalid_number')),
    count(*) FILTER (WHERE ml.status = 'skipped'),
    0::bigint,
    true
  FROM public.message_logs ml
  WHERE ml.user_id = auth.uid()
    AND (p_since IS NULL OR ml.created_at >= p_since)
    AND (p_until IS NULL OR ml.created_at <= p_until)
  GROUP BY ml.account_id

  UNION ALL

  -- FLUXOS
  SELECT
    'flow'::text,
    NULL::uuid,
    count(*) FILTER (WHERE fe.status IN ('waiting_reply', 'completed', 'finished', 'done')),
    NULL::bigint,
    NULL::bigint,
    count(*) FILTER (WHERE fe.status IN ('failed', 'error')),
    count(*) FILTER (WHERE fe.status IN ('cancelled', 'canceled', 'skipped', 'stopped')),
    count(*) FILTER (WHERE fe.status IN ('waiting_delay', 'pending', 'queued',
                                         'scheduled', 'running')),
    false
  FROM public.flow_executions fe
  JOIN public.flows f ON f.id = fe.flow_id
  WHERE f.user_id = auth.uid()
    AND (p_since IS NULL OR fe.started_at >= p_since)
    AND (p_until IS NULL OR fe.started_at <= p_until)
  HAVING count(*) > 0

  UNION ALL

  -- CHAT (fluxo + manual — ver cabeçalho)
  SELECT
    'chat'::text,
    cm.account_id,
    count(*) FILTER (WHERE cm.status IN ('sent', 'accepted', 'delivered', 'read')),
    count(*) FILTER (WHERE cm.status IN ('delivered', 'read')
                        OR cm.delivered_at IS NOT NULL
                        OR cm.read_at IS NOT NULL),
    count(*) FILTER (WHERE cm.status = 'read' OR cm.read_at IS NOT NULL),
    count(*) FILTER (WHERE cm.status IN ('failed', 'error') OR cm.error_code IS NOT NULL),
    0::bigint,
    count(*) FILTER (WHERE cm.status IN ('pending', 'queued')),
    true
  FROM public.chat_messages cm
  JOIN public.leads l ON l.id = cm.lead_id
  WHERE l.user_id = auth.uid()
    AND cm.direction = 'outbound'
    AND (p_since IS NULL OR cm.created_at >= p_since)
    AND (p_until IS NULL OR cm.created_at <= p_until)
    AND NOT EXISTS (
      SELECT 1
      FROM public.message_logs bl
      WHERE bl.wa_message_id = cm.zapi_message_id
    )
  GROUP BY cm.account_id
$$;

REVOKE ALL ON FUNCTION public.get_sending_metrics_by_source(timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sending_metrics_by_source(timestamptz, timestamptz)
  TO authenticated, service_role;


-- ── 2. Progresso por disparo em massa ──────────────────────────────────────
-- Alimenta a barra de progresso: enviadas / entregues / lidas / erros, com
-- total e fila. sent/delivered/read/failed vêm de message_logs (uma linha por
-- mensagem). job_delivered/job_read são os contadores gravados em
-- broadcast_jobs pelo webhook: devolvidos SÓ para a tela poder mostrar
-- divergência. O código antigo fazia Math.max entre os dois, que escondia.
CREATE OR REPLACE FUNCTION public.get_broadcast_progress(
  p_since timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  job_id uuid,
  campaign_name text,
  template_name text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  audience bigint,
  sent bigint,
  delivered bigint,
  read bigint,
  failed bigint,
  skipped bigint,
  pending bigint,
  job_delivered bigint,
  job_read bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH agg AS (
    SELECT
      ml.job_id AS jid,
      count(*) FILTER (WHERE ml.status IN ('sent', 'accepted', 'delivered', 'read')) AS n_sent,
      count(*) FILTER (WHERE ml.status IN ('delivered', 'read')
                          OR ml.delivered_at IS NOT NULL
                          OR ml.read_at IS NOT NULL) AS n_delivered,
      count(*) FILTER (WHERE ml.status = 'read' OR ml.read_at IS NOT NULL) AS n_read,
      count(*) FILTER (WHERE ml.status IN ('failed', 'error', 'blocked_by_meta',
                                           'payment_issue', 'rate_limited',
                                           'invalid_number')) AS n_failed,
      count(*) FILTER (WHERE ml.status = 'skipped') AS n_skipped
    FROM public.message_logs ml
    WHERE ml.user_id = auth.uid()
    GROUP BY ml.job_id
  )
  SELECT
    j.id,
    j.campaign_name,
    j.template_name,
    j.status,
    j.created_at,
    j.updated_at,
    COALESCE(j.total_leads, 0)::bigint,
    COALESCE(a.n_sent, 0),
    COALESCE(a.n_delivered, 0),
    COALESCE(a.n_read, 0),
    COALESCE(a.n_failed, 0),
    COALESCE(a.n_skipped, 0),
    GREATEST(
      COALESCE(j.total_leads, 0)
        - COALESCE(a.n_sent, 0)
        - COALESCE(a.n_failed, 0)
        - COALESCE(a.n_skipped, 0),
      0
    )::bigint,
    COALESCE(j.delivered_count, 0)::bigint,
    COALESCE(j.read_count, 0)::bigint
  FROM public.broadcast_jobs j
  LEFT JOIN agg a ON a.jid = j.id
  WHERE j.user_id = auth.uid()
    AND (p_since IS NULL OR j.created_at >= p_since)
  ORDER BY j.created_at DESC
  LIMIT p_limit
$$;

REVOKE ALL ON FUNCTION public.get_broadcast_progress(timestamptz, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_progress(timestamptz, integer)
  TO authenticated, service_role;


-- ── 3. Progresso por lote de fluxo ─────────────────────────────────────────
-- Dois disparos do mesmo fluxo no mesmo dia são lotes diferentes: um novo
-- lote começa quando o intervalo entre duas execuções passa de p_gap_minutes.
-- (O front fazia esse agrupamento em JS sobre no máximo 1.000/20.000 linhas.)
CREATE OR REPLACE FUNCTION public.get_flow_progress(
  p_since timestamptz DEFAULT NULL,
  p_gap_minutes integer DEFAULT 30,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  flow_id uuid,
  flow_name text,
  batch_started_at timestamptz,
  last_activity timestamptz,
  total bigint,
  sent bigint,
  failed bigint,
  skipped bigint,
  pending bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH e AS (
    SELECT
      fe.flow_id AS fid,
      f.name AS fname,
      fe.status AS st,
      fe.started_at AS started,
      fe.updated_at AS touched,
      CASE
        WHEN fe.started_at
             - lag(fe.started_at) OVER (PARTITION BY fe.flow_id ORDER BY fe.started_at)
             > make_interval(mins => GREATEST(p_gap_minutes, 1))
        THEN 1 ELSE 0
      END AS new_batch
    FROM public.flow_executions fe
    JOIN public.flows f ON f.id = fe.flow_id
    WHERE f.user_id = auth.uid()
      AND (p_since IS NULL OR fe.started_at >= p_since)
  ),
  b AS (
    SELECT e.*,
           sum(e.new_batch) OVER (
             PARTITION BY e.fid ORDER BY e.started ROWS UNBOUNDED PRECEDING
           ) AS batch_no
    FROM e
  )
  SELECT
    b.fid,
    b.fname,
    min(b.started),
    max(COALESCE(b.touched, b.started)),
    count(*),
    count(*) FILTER (WHERE b.st IN ('waiting_reply', 'completed', 'finished', 'done')),
    count(*) FILTER (WHERE b.st IN ('failed', 'error')),
    count(*) FILTER (WHERE b.st IN ('cancelled', 'canceled', 'skipped', 'stopped')),
    count(*) FILTER (WHERE b.st IN ('waiting_delay', 'pending', 'queued',
                                    'scheduled', 'running'))
  FROM b
  GROUP BY b.fid, b.fname, b.batch_no
  ORDER BY min(b.started) DESC
  LIMIT p_limit
$$;

REVOKE ALL ON FUNCTION public.get_flow_progress(timestamptz, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_flow_progress(timestamptz, integer, integer)
  TO authenticated, service_role;
