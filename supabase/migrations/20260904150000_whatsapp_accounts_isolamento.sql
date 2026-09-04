-- Isolamento entre contas de WhatsApp (Evolution e Cloud API).
--
-- 1) phone_number_id sem UNIQUE já causou o número ficar cadastrado em duas
-- contas de donos diferentes (ver comentário em whatsapp-cloud-webhook) — o
-- webhook passou a detectar e recusar resolver o dono nesse caso, mas nada no
-- banco impedia a duplicata de acontecer de novo. Composta com
-- business_account_id (WABA real na Cloud API; URL do servidor Evolution na
-- Evolution) porque dois clientes diferentes podem legitimamente nomear a
-- instância Evolution igual em servidores diferentes — só o par conta.
-- Se já existir duplicata em produção, este ALTER falha alto (não corrompe
-- nada) e aponta exatamente qual phone_number_id colidiu.
ALTER TABLE public.whatsapp_accounts
  ADD CONSTRAINT whatsapp_accounts_phone_business_unique
  UNIQUE (phone_number_id, business_account_id);

-- 2) Segredo de webhook POR CONTA. Até aqui toda instância Evolution de todo
-- cliente autenticava com o mesmo EVOLUTION_WEBHOOK_SECRET (env var global) —
-- provava só "conhece o segredo geral", não "essa instância é dona desse
-- account_id". Null nas contas existentes: continuam caindo no segredo
-- global até serem reconfiguradas (trocar exigiria reregistrar o webhook em
-- cada servidor Evolution de cada cliente).
ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS webhook_secret text;
