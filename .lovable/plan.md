
# Camada Anti-Ban & Reputação Prime — Plano de Implementação

## Avaliação geral

O núcleo multi-WABA já é sólido: OAuth, webhooks, queue, warmup, logs, snapshots, delivery tracking e throttling parcial estão em produção. O que falta é a **camada de proteção ativa**: detectar sinais de risco em tempo real e reagir automaticamente antes da Meta punir a conta.

Hoje a plataforma é **reativa** (pausa só quando a Meta já bloqueou via erro 131031). O objetivo é torná-la **preditiva** — agir nos primeiros sinais (queda de quality, spike de unsubscribe, burst suspeito) para nunca chegar no bloqueio.

Risco principal hoje: um único tenant agressivo pode degradar a reputação do número e, em multi-tenant, contaminar o ecossistema. Itens 1 (unsubscribe), 2 (rate limiter) e 6 (risk engine) são os que mais mitigam isso.

Não vamos quebrar nada existente: tudo é aditivo sobre `broadcast_jobs`, `waba_health_snapshots`, `lead_blacklist` e `whatsapp-cloud-webhook`.

---

## Fase 1 — Compliance crítico (semana 1)

Mais alto impacto/risco, menor complexidade. Bloqueia o pior dano possível.

### 1.1 Auto Unsubscribe Engine
- Migration: adicionar em `leads`: `unsubscribed boolean`, `unsubscribed_at timestamptz`, `unsubscribe_reason text`.
- Nova tabela `unsubscribe_logs` (lead_id, user_id, keyword_matched, source_message, created_at).
- Editar `whatsapp-cloud-webhook`: nas mensagens inbound, normalizar (lowercase + remoção de acento) e rodar regex contra dicionário de keywords (`sair`, `parar`, `stop`, `unsubscribe`, `cancelar`, `remover`, `descadastrar`, `não quero`, `pare`, `cancelar inscrição`, `nao quero mais`).
- Ao detectar: insert em `lead_blacklist` + `unsubscribe_logs`, marcar lead `unsubscribed=true`, cancelar `flow_executions` ativas do lead, remover lead de `broadcast_jobs.lead_ids` em status `pending`/`paused`.
- Resposta automática opcional controlada por flag em `app_settings` (default ligado): "Você foi removido da lista. 👍".
- `broadcast-processor` e `flow-processor`: passar a filtrar `leads.unsubscribed=false` antes de enfileirar envio.

### 1.2 Webhook Status Intelligence (expansão)
- Já processamos `statuses[].status` para delivered/read/failed. Adicionar tratamento explícito para `warning` e códigos `131048/131049` (spam restriction) e `130429/80007` (rate limit) → criar `waba_health_events` com severity proporcional, sem pausar a conta inteira.
- Acumular contadores em `waba_health_snapshots` recente: `warning_count_1h`, `throttle_count_1h`.

### 1.3 Pausa preventiva por quality drop
- Estender `waba-protect-account`: aceitar gatilho `quality_downgrade` (não só bloqueio). Quando snapshot novo registra YELLOW→RED ou block_rate_1h > 10%, pausar apenas `broadcast_jobs` em status `running` (não fluxos), com `pause_reason='auto_quality_protection'` e `auto_paused_by_system=true`.

---

## Fase 2 — Throttling adaptativo & rate limit (semana 2)

### 2.1 Quality Adaptive Throttling no processor
- Editar `broadcast-processor`: antes de processar batch, buscar snapshot mais recente da conta (cache 60s em memória da function).
- Aplicar multiplicador no `messages_per_second` efetivo e nos delays:
  - GREEN → 1.0× (sem alteração)
  - YELLOW → 0.5× msgs/s, delays +50%
  - RED → 0.1× msgs/s, delays ×3, marcar job `warmup_recovery=true`
  - BLOCKED → não envia, marca job `paused`
- Registrar em `audit_logs` cada degradação aplicada.

### 2.2 Global Phone Rate Limiter
- Nova tabela `phone_send_rate_limits` (phone_number_id PK, window_start_second timestamptz, count_last_second int, count_last_minute int, count_last_hour int, updated_at).
- Função RPC `try_acquire_send_slot(phone_number_id, max_per_second)` que faz UPDATE atômico com `RETURNING` — se ultrapassou, retorna `false` e o processor espera no próximo tick.
- Throughput máximo por número derivado da fase do warmup + quality rating:
  - Warmup novo (dia 1-3): 1 msg / 5s
  - Warmup intermediário (4-7): 1 msg / 2s
  - Estável GREEN: 3-5/s
  - RED: 0
- Não vamos usar Redis (não está na stack); usar o próprio Postgres com `FOR UPDATE SKIP LOCKED` para serializar.

> **Nota sobre rate limiting:** estamos implementando aqui rate limiter *de envio externo para a Meta* (proteção da WABA), não rate limiter de API pública do Prime — esse último seguimos sem implementar conforme prática atual.

### 2.3 Health Score real
- Editar `waba-health-monitor` (a ser criado na Fase 3 ou logo se necessário): persistir `reputation_score` calculado por:
  ```
  score = 0.30 * delivery_rate_24h
        + 0.15 * read_rate_24h
        + 0.15 * reply_rate_24h
        + 0.20 * (100 - block_rate_24h * 10)
        + 0.10 * (100 - failed_rate_24h * 5)
        + 0.10 * quality_factor   // GREEN=100, YELLOW=60, RED=20
  ```
- Faixas: 90-100 excelente, 70-89 saudável, 50-69 atenção, <50 crítico. Mostrar na página `/whatsapp/health`.

---

## Fase 3 — Inteligência e diversidade (semana 3)

### 3.1 Cron `waba-health-monitor` (snapshot a cada 2 min)
- Edge function que itera por todas `whatsapp_accounts` ativas, chama Graph API (`whatsapp-limits`), agrega contadores de `message_logs` últimos 24h e grava `waba_health_snapshots` com health_score.
- Agendar via `pg_cron` + `pg_net` (SQL via insert tool, não migration, pois contém URL e anon key).
- Comparar com snapshot anterior: se quality_rating piorou, dispara `waba-protect-account` com `trigger='quality_downgrade'`.

### 3.2 Template Rotation Engine
- Nova tabela `broadcast_template_variants` (id, job_id, template_id, weight int default 1, language, params jsonb, active bool, sent_count int, last_used_at).
- UI no `BulkBroadcastDialog`: ao escolher template, permitir adicionar variantes (2-5) com peso.
- Editar `broadcast-processor`: para cada envio, selecionar variante via amostragem ponderada evitando repetir a última variante usada (anti-repeat). Atualizar `sent_count` e `last_used_at`.
- Manter `broadcast_jobs.template_id` como fallback quando não há variantes (retrocompat).

### 3.3 Anti-Spam Detection
- Nova tabela `spam_detection_events` (account_id, user_id, signal_type, severity, details jsonb, created_at).
- Heurísticas rodadas no cron (a cada 5 min):
  - Burst: >X msgs em <Y seg pelo mesmo número
  - Mensagens 100% idênticas para >N destinatários (já temos rotation, então detectamos quem ignorou)
  - Campanhas com reply_rate <2% e block_rate >5%
  - Spike de blocks (>3× a média da última semana)
- Cada evento crítico → `waba_health_events` + notification + possível ação automática.

---

## Fase 4 — Multi-tenant safety & observabilidade (semana 4)

### 4.1 Risk Engine por Usuário
- Nova tabela `user_risk_profiles` (user_id PK, risk_tier text [`low`,`medium`,`high`,`restricted`], campaigns_per_day int, send_velocity_max int, spam_ratio numeric, unsubscribe_ratio numeric, block_ratio numeric, failed_ratio numeric, updated_at, reason text).
- Cron diário recalcula métricas dos últimos 7d por user e ajusta tier.
- `broadcast-processor` e `BulkBroadcastDialog` consultam tier para aplicar caps:
  - `low`: limites normais do plano
  - `medium`: -30% throughput, max 2 campanhas paralelas
  - `high`: -70% throughput, warmup obrigatório em novos números
  - `restricted`: bloqueio de novos disparos até revisão admin
- Notificação ao usuário quando tier muda + página admin para revisão manual.

### 4.2 Warmup Automation reforçado
- Cron diário: para cada `broadcast_jobs` com `warmup_mode=true`, avançar `warmup_day` automaticamente e calcular `warmup_daily_limit` pela curva: 20 → 50 → 100 → 200 → 400 → 800 → 1500 → 3000.
- Se quality cai durante warmup → segura no dia atual (não avança). Se cai 2 dias seguidos → recua um nível.
- Forçar `warmup_mode=true` quando criar `whatsapp_accounts` nova (primeiros 7 dias).

### 4.3 Dashboards & alertas (`/whatsapp/health` v2)
- Cards: block rate 24h/7d, unsubscribe rate, reply rate, delivery quality, health score histórico (sparkline), template performance (variantes ordenadas por reply rate).
- Timeline unificada de `waba_health_events` + `spam_detection_events` + `unsubscribe_logs` agregados.
- Toast/email (via notifications) para quality downgrade, spike de block (>2σ), spike de unsubscribe (>5% em 1h), failed delivery surge.

---

## Resumo técnico das mudanças

### Novas tabelas
`unsubscribe_logs`, `phone_send_rate_limits`, `broadcast_template_variants`, `spam_detection_events`, `user_risk_profiles`.

### Colunas adicionadas
- `leads`: `unsubscribed`, `unsubscribed_at`, `unsubscribe_reason`
- `waba_health_snapshots`: já tem `reputation_score`, popular via cron
- `broadcast_jobs`: `warmup_recovery boolean`

### Edge functions
- **Editadas:** `whatsapp-cloud-webhook` (unsubscribe + status intelligence), `broadcast-processor` (throttling adaptativo + rate limiter + rotation), `waba-protect-account` (gatilho `quality_downgrade`), `flow-processor` (filtrar unsubscribed).
- **Novas:** `waba-health-monitor` (cron 2 min), `spam-detector` (cron 5 min), `risk-profile-recalc` (cron diário), `warmup-advance` (cron diário).

### Frontend
- `BulkBroadcastDialog`: aba "Variantes de template" (Fase 3).
- `WabaHealth.tsx`: novos cards (score histórico, template performance, unsubscribe rate, timeline unificada).
- Banner em `AppHeader` ganha variante "risco de reputação" antes do bloqueio.
- Página admin `/admin/risk` para revisar usuários `restricted`.

### Cron jobs (via pg_cron + pg_net, agendados com `supabase insert`)
- `waba-health-monitor` a cada 2 min
- `spam-detector` a cada 5 min
- `risk-profile-recalc` diário 03:00 UTC
- `warmup-advance` diário 00:00 UTC do timezone do user

---

## Ordem de execução sugerida

1. **Fase 1** primeiro — compliance é o que protege a Meta de nos punir hoje.
2. **Fase 2** logo em seguida — throttling adaptativo trava o pior cenário (campanha em RED continua agressiva).
3. **Fase 3** — diversidade e detecção, depende do monitor rodando.
4. **Fase 4** — política multi-tenant e observabilidade premium.

Cada fase é entregável independente e não quebra o que já existe.

## Fora deste plano
- Rate limiting da API pública do Prime (mantido fora conforme prática atual).
- Reescrita do FlowBuilder.
- Mudança de provedor (Evolution/Z-API).
- Sistema de revisão humana via Meta Business Suite (apenas linkamos).

Se aprovar, começo pela **Fase 1.1 (Unsubscribe Engine)** já na próxima iteração.
