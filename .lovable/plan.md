
# Avaliação Anti-Ban v2 — Prime

## Avaliação do estado atual vs. proposta

Base já implementada (Fase 1 do plano anterior + core multi-WABA):

- Warmup, delays randômicos, throttling por job, snapshots de qualidade, `waba_health_events`, `waba-protect-account`, auto unsubscribe engine, blacklist, filtro `unsubscribed` no broadcast/flow processor, delivery tracking via `message_logs`.
- Falta totalmente: memória histórica por campanha, análise de conteúdo, reputação de domínio, freio global, balanceador multi-WABA, recovery progressivo, isolamento por tenant, padrões de warning Meta.

Os 9 itens propostos são complementares (não conflitam com nada existente) e cobrem exatamente os pontos cegos que sobram. Recomendo implementar — com 2 ressalvas:

- **Item 5 (Load Balancer)** já tem semente (`broadcast_jobs.account_ids` + `multi_number`), então é evolução, não rewrite.
- **Item 8 (Anti-cross-tenant)** parcialmente coberto por `user_plan_limits`; vamos estender, não duplicar.

Risco principal sem isso: 1 campanha tóxica de 1 tenant degrada WABA inteira, sem aprendizado nem freio automático.

---

## Plano em 4 fases (incremental, retrocompatível)

### Fase 1 — Memória e Conteúdo (Semana 1)
**Foco: aprender com o passado e bloquear conteúdo ruim antes do envio.**

- **1.1 `campaign_risk_profiles`**: tabela com `campaign_id`, `template_ids[]`, métricas agregadas (delivery/read/reply/unsubscribe/block rate), `spam_signal_count`, `quality_impact_score`, `risk_level`, `last_calculated_at`. Recalculada por edge function `campaign-risk-recalc` (cron 5 min) lendo `message_logs` + `campaign_events` + `unsubscribe_logs`.
  - Regras: unsub > 5% → high; block > 3% → critical; reply < 1% c/ volume > 1000 → medium.
  - `broadcast-processor` consulta histórico do template antes de iniciar e: reduz `messages_per_second` (-50% medium / -80% high) ou bloqueia (critical com `pause_reason='critical_risk_profile'`).

- **1.2 `template_spam_analysis` + analisador**: tabela `template_id`, `spam_score 0-100`, `warnings jsonb`, `risk_level`, `analyzed_at`. Analisador puro TS rodando no client (`src/lib/spamAnalyzer.ts`) + edge `template-spam-scan` para reanálise em lote. Heurísticas: ratio caps, ratio emojis, lista de palavras gatilho PT/EN, contagem de links, repetição de domínio, length, CTA agressivo.
  - `BulkBroadcastDialog`: badge visual (verde/amarelo/vermelho), modal de warning com lista de problemas, bloqueio hard se `score >= 85` (admin pode override).

### Fase 2 — Domínio, Freio e Recovery (Semana 2)

- **2.1 `domain_reputation`**: extrai domínios de `template_params` + `chat_templates.content` no momento do envio. Agrega `sent_count`, `click_rate` (via `click_tracking_links`), `unsubscribe_rate`, `block_rate`, `spam_score`, `reputation_level`. Cron `domain-reputation-recalc` (10 min). Usado pelo spam analyzer como sinal extra; domínio `blacklisted` → bloqueia broadcast.

- **2.2 `system_protection_state` (Global Emergency Brake)**: tabela singleton com `state` (`normal`/`degraded`/`emergency`), `triggered_by`, `triggered_at`, `auto_resume_at`, `metadata`. Edge `system-guardian` (cron 1 min) avalia:
  - `failed_rate_5min > 15%` global → degraded
  - `block_spike` (z-score > 3 vs baseline 24h) → emergency
  - `unsubscribe_spike > 8%/h` global → degraded
  - webhook 5xx rate > 10% → emergency
  - Ação `emergency`: UPDATE em `broadcast_jobs` ativos → `paused` + `pause_reason='system_emergency_brake'`; bloqueia inserts via trigger checando o estado; toast/notification para todos admins; audit log.

- **2.3 Progressive Recovery Engine**: novas colunas em `whatsapp_accounts`: `recovery_stage` (0-100), `recovery_started_at`, `recovery_last_success_at`. Cron `recovery-advance` (1h): RED→10%, +24h ok→25%, +24h→50%, +24h→75%, +24h→100%. Qualquer warning durante recovery → volta um estágio. `broadcast-processor` usa `recovery_stage/100` como multiplicador de throughput.

### Fase 3 — Distribuição e Webhook Intel (Semana 3)

- **3.1 Multi-WABA Load Balancer (`waba_distribution_engine`)**: função Postgres `pick_best_account(p_user_id, p_excluded uuid[])` retorna `account_id` com peso = `health_score * (recovery_stage/100) * quality_factor * (1 - active_load)`. `broadcast-processor` quando `multi_number=true` ignora `account_id` fixo do batch e chama `pick_best_account` por mensagem; RED é excluído automaticamente.
  - Failover: erro 131048/131056/368 → marca conta como degradada por 15min e re-roteia restante do job.

- **3.2 `meta_warning_patterns` + Webhook Intelligence v2**: tabela com `account_id`, `error_code`, `count_1h`, `count_24h`, `trend` (`stable/rising/critical`), `first_seen_at`, `last_seen_at`. `whatsapp-cloud-webhook` insere/incrementa para códigos 131048, 131049, 130429, 80007, 131056, 368. Detecção de tendência: comparação janela 1h vs média 24h. `trend=rising` 2x consecutivos → cria `waba_health_event severity=critical` e dispara recovery downgrade preventivo.

### Fase 4 — Isolamento de Tenant e Observabilidade (Semana 4)

- **4.1 Tenant Isolation**: estender `user_plan_limits` com `tenant_risk_score`, `current_throughput_multiplier`, `burst_credits`, `burst_credits_max`. Cron `tenant-risk-recalc` (15 min) calcula score por tenant agregando `campaign_risk_profiles`. Tenant `risk_score > 70`: `current_throughput_multiplier = 0.3`, bloqueia campanhas > 5k contatos, exige aprovação admin. Aplicado em `broadcast-processor` como último multiplicador (ortogonal aos throttles de qualidade da WABA). Burst credits: token bucket por hora — evita um tenant monopolizar a fila.

- **4.2 Observabilidade `/whatsapp/health` v2**: novas seções no `WabaHealth.tsx`:
  - Heatmap reputação (grid contas × hora últimas 48h, cor = health_score)
  - Timeline de degradação (eventos críticos + recovery_stage por conta)
  - Cards: top 10 campanhas por risk_level, top 10 templates por spam_score, top 10 domínios por block_rate
  - Recovery tracker (barra de progresso por conta em recovery)
  - Filtros por conta, período, severidade

---

## Detalhes técnicos (resumo)

**Novas tabelas (todas com GRANT explícito + RLS por `user_id` exceto as globais):**
- `campaign_risk_profiles` (RLS user_id)
- `template_spam_analysis` (RLS user_id via `chat_templates`)
- `domain_reputation` (RLS user_id; uma row por user+domain)
- `system_protection_state` (singleton, SELECT autenticado, manage só service_role)
- `meta_warning_patterns` (RLS user_id via `whatsapp_accounts`)

**Novas colunas:**
- `whatsapp_accounts`: `recovery_stage int default 100`, `recovery_started_at`, `recovery_last_success_at`
- `user_plan_limits`: `tenant_risk_score`, `current_throughput_multiplier`, `burst_credits`, `burst_credits_max`
- `chat_templates`: `spam_score` cache + `spam_risk_level`
- `broadcast_jobs`: `risk_check_passed bool`, `risk_check_reason text`

**Novas edge functions:**
- `campaign-risk-recalc` (cron 5 min)
- `template-spam-scan` (on-demand + cron diário)
- `domain-reputation-recalc` (cron 10 min)
- `system-guardian` (cron 1 min)
- `recovery-advance` (cron 1h)
- `tenant-risk-recalc` (cron 15 min)

**Mudanças em código existente:**
- `broadcast-processor`: pipeline de checks (risk profile → spam score → domain rep → recovery stage → tenant multiplier → quality multiplier → load balancer pick) antes de cada envio
- `whatsapp-cloud-webhook`: incrementar `meta_warning_patterns`
- `BulkBroadcastDialog`: badge spam + warning modal + bloqueio
- `WabaHealth.tsx`: novos cards + heatmap (recharts) + filtros

**Fora de escopo:**
- Rewrite do FlowBuilder
- ML real para spam (heurística por enquanto; estrutura permite plugar depois)
- Rate limiting da API pública do Prime
- Mudança de provider

**Ordem de execução:** Fase 1 → 2 → 3 → 4. Cada fase é independente; após cada uma, a anterior fica funcional e mensurável no dashboard.

**Compatibilidade:** todos os novos checks têm modo "soft" (apenas loga `audit_logs`) ativável por `app_settings.antiban_v2_enforce_mode` (`off`/`shadow`/`enforce`) — permite rodar 48h em shadow antes de aplicar bloqueios reais.

Confirma que posso iniciar pela Fase 1 (campaign risk profiles + spam content score)?
