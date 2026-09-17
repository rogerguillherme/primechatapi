-- Conferência pós-envio dos alvos de campanha do Prime Group.
--
-- O Evolution responder 200 na hora do envio não é garantia de que a
-- mensagem chegou — padrão de falha silenciosa já visto em outras partes
-- do Prime Chat. O pg-campaign-audit reconfere direto na Evolution depois
-- que a campanha termina: instância ainda no grupo, grupo virou "só admin",
-- grupo mudou de nome/descrição, e se a última mensagem do grupo bate com
-- o que foi mandado. Guarda o resultado por alvo aqui.
ALTER TABLE public.pg_campaign_targets
  ADD COLUMN IF NOT EXISTS check_status TEXT NOT NULL DEFAULT 'pendente',
    -- pendente | ok | fora_padrao | erro_checagem
  ADD COLUMN IF NOT EXISTS check_detail TEXT,
  ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
