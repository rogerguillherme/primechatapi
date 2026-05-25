
# Plataforma Enterprise WhatsApp Cloud — Reestruturação Anti-Bloqueio

Transformar o SaaS de "painel de disparo" em uma **central de inteligência operacional** que protege a reputação da WABA do cliente, mostra a verdade sobre entregas e reage automaticamente a bloqueios da Meta.

---

## 1. Nova arquitetura de status de mensagens

Hoje confiamos no `200 accepted` da Cloud API. Vamos passar a confiar **apenas no webhook da Meta**.

### Estados oficiais (campo `status` em `message_logs`)

```text
queued              → criado no banco, ainda não chamou a API
processing          → edge function chamando Cloud API
accepted_by_meta    → API retornou 200 + wamid (NÃO conta como sucesso)
delivered           → webhook 'delivered'
read                → webhook 'read'
failed              → webhook 'failed' com erro recuperável
blocked_by_meta     → webhook 'failed' com erro de bloqueio (131031, 368, 131056…)
retrying            → será reenviado
paused              → broadcast pausado, não envia
```

### Métricas reais no dashboard

- **KPI principal:** `Taxa de entrega real = delivered / (delivered + failed + blocked)`
- **KPI secundário:** `Taxa de leitura`, `Taxa de bloqueio`, `Tempo médio de entrega`
- **Removido:** "enviadas" deixa de aparecer sozinho. Sempre mostrado junto com "entregues de fato".

### Mudanças de banco (resumo)

- `message_logs.status` aceitando os novos enums.
- `message_logs.meta_error_code`, `meta_error_title`, `meta_error_details`, `delivered_at`, `read_at`, `failed_at`.
- Nova tabela `waba_health_events` (code, severidade, account_id, created_at, resolved_at).
- Nova tabela `waba_health_snapshots` (account_id, quality_rating, tier, messaging_limit, delivery_rate_24h, block_rate_24h, score, captured_at).
- View `v_account_delivery_stats` agregando por `account_id` nas últimas 1h / 24h / 7d.

---

## 2. Detecção automática de bloqueios

Edge function `whatsapp-cloud-webhook` ganha um **classificador de erros**:

```text
131031, 131056, 368, 130472  → blocked_by_meta (bloqueio sério)
131026, 131047              → quality / 24h window
131048, 131049              → spam restriction
130429, 80007               → rate limit
131045, 132000–132100        → template/integrity
```

Quando um erro de bloqueio é recebido:

1. Marca mensagem como `blocked_by_meta` + grava `waba_health_events`.
2. Conta ocorrências por `account_id` nos últimos 5 min.
3. Se ≥ 3 eventos críticos OU 1 evento `131031`/`account locked`:
   - `UPDATE broadcast_jobs SET status='paused', pause_reason='waba_blocked'` para a conta.
   - `UPDATE flows SET active=false` (com flag `auto_paused_by_system=true` em metadata para restaurar depois).
   - Cancela `flow_executions` em `waiting_delay/waiting_no_response` da conta.
   - Insere `notifications` urgente para o `user_id`.
   - Emite evento realtime no canal `waba-health:{user_id}`.

Cron job (`waba-health-monitor`, a cada 2 min):

- Chama `whatsapp-limits` para todas as WABAs ativas.
- Salva snapshot e dispara alerta se `quality_rating` cair de GREEN→YELLOW ou YELLOW→RED.
- Calcula `delivery_rate_24h` e `block_rate_24h`; se entrega < 70% **ou** bloqueio > 5%, ativa modo "throttle preventivo".

---

## 3. UX anti-frustração

### Banner global (`<WabaHealthBanner />` em `AppHeader`)

Aparece quando há `waba_health_events` ativos. Três variantes:

- **Vermelho** — "Sua conta WhatsApp foi temporariamente bloqueada pela Meta. Pausamos seus disparos automaticamente para proteger sua reputação."
- **Amarelo** — "Detectamos sinais de risco na sua WABA. Reduzimos o ritmo de envio automaticamente."
- **Azul (informativo)** — "Qualidade ALTA. Tudo operando normalmente."

Cada banner tem CTA: **Ver diagnóstico** → abre o painel de saúde.

### Copy padrão dos alertas (PT-BR)

```text
Título:    Conta WhatsApp temporariamente bloqueada pela Meta
Subtítulo: Não é um problema da Prime Chat — a Meta restringiu sua WABA.
Ação 1:    O que pausamos para te proteger →  (lista campanhas/fluxos pausados)
Ação 2:    Como resolver  →  passo a passo (Business Suite → Account Quality → Solicitar revisão)
Ação 3:    Notificar quando normalizar  (toggle)
Status:    Estamos monitorando sua conta a cada 2 minutos.
```

### Mudanças nas telas

- **Dashboard:** novo card hero "Saúde da WABA" no topo (semaforo + score).
- **CloudChatTab:** aba "Erros" mostra agrupamento por `meta_error_code` com explicação humana.
- **Campanhas:** badge "Pausada automaticamente — proteção" com link para o diagnóstico.
- **Logs de envio:** filtro "Apenas entregues de verdade" ligado por padrão.

---

## 4. Dashboard de Saúde da WABA

Nova página `/whatsapp/health` (rota nova, acessível também via card no Dashboard).

Conteúdo:

- **Semáforo geral** por número conectado (verde/amarelo/vermelho).
- **Quality rating** (GREEN/YELLOW/RED) — atualizado a cada 2 min.
- **Messaging tier** atual + limite diário restante.
- **Taxa de entrega 24h** (gráfico de linhas).
- **Taxa de bloqueio 24h**.
- **Taxa de resposta** (já existe, reaproveita).
- **Score de reputação** calculado (0–100): combinação ponderada de quality, entrega, bloqueio, taxa de resposta.
- **Histórico de eventos** (locks, quality drops, spam flags) com timeline.
- **Recomendações automáticas** ("Reduza o volume diário para 200", "Solicite revisão no Business Suite", "Use mais templates UTILITY").

---

## 5. Proteção automática (anti-ban)

Tudo no backend, sem ação do usuário:

- **Warmup automático** já existe (`warmup_mode`, `warmup_daily_limit`) — vamos reforçar: novas WABAs entram em warmup **obrigatório por 7 dias** com escala 20→50→100→250→500→1000→2000.
- **Throttling adaptativo:** `broadcast-processor` lê o snapshot mais recente; se quality=YELLOW reduz `messages_per_second` em 50%; RED reduz para 10%.
- **Pausa preventiva:** se `block_rate_1h > 10%`, pausa o job e marca `pause_reason='auto_quality_protection'`.
- **Retry inteligente:** falhas `failed` (não-bloqueio) entram em fila com backoff exponencial (1m, 5m, 30m). Erros `blocked_by_meta` **nunca** são reenviados automaticamente.
- **Fallback multi-número:** se a conta tem mais de um número e um cai em YELLOW/RED, o `broadcast-processor` roteia novos envios para o número saudável.
- **Janela de 24h:** já há lógica; reforçar bloqueio de mensagens livres fora da janela (apenas templates).

---

## 6. Fluxo ideal de webhook

```text
Meta → whatsapp-cloud-webhook
   1. Persistir raw em webhook_debug
   2. Para cada status:
        - upsert message_logs por wamid
        - se status='failed': classificar erro
            ├─ recuperável → status='failed', enfileirar retry se aplicável
            └─ bloqueio    → status='blocked_by_meta'
                            + insert waba_health_events
                            + acionar protect_account(account_id)
        - se status='delivered'/'read': atualizar timestamps
   3. Atualizar contadores no broadcast_jobs (delivered_count real, block_count)
   4. Emitir realtime: 'message-status:{user_id}' e 'waba-health:{user_id}'
```

---

## 7. Entregáveis técnicos (ordem sugerida)

1. **Migration:** novos enums de status, colunas em `message_logs`, tabelas `waba_health_events` e `waba_health_snapshots`, view `v_account_delivery_stats`.
2. **Edge `whatsapp-cloud-webhook`:** classificador de erros + acionador de proteção.
3. **Edge nova `waba-protect-account`:** centraliza pausa de jobs/fluxos/executions + notificação.
4. **Cron + edge `waba-health-monitor`:** snapshot a cada 2 min.
5. **Edge `broadcast-processor`:** ler snapshot e aplicar throttle / fallback de número.
6. **Frontend:**
   - `WabaHealthBanner` global no `AppHeader`.
   - Página `/whatsapp/health` com cards + timeline + recomendações.
   - Card "Saúde da WABA" no `DashboardHome`.
   - KPIs do dashboard recalculados sobre `delivered` (não `sent`).
   - Aba "Erros" do chat reagrupando por `meta_error_code` com copy humana.
7. **Copy & i18n:** todas as mensagens em PT-BR profissional, sem culpar o cliente.

---

## 8. Detalhes técnicos resumidos

- Stack: Supabase (Postgres + RLS + Realtime), Edge Functions Deno, Cloud API v20+, React 18 + Tailwind.
- Multi-tenant: tudo filtrado por `user_id`; webhooks resolvem tenant via `phone_number_id → whatsapp_accounts.user_id`.
- Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE waba_health_events;`
- Observabilidade: tabela `audit_logs` registra cada pausa automática para reverter manualmente se preciso.
- Reversão: quando snapshot volta a GREEN por 30 min seguidos e não há `waba_health_events` ativos, sistema reativa jobs marcados com `auto_paused_by_system=true`.

---

## 9. O que NÃO entra nesta entrega

- Rate-limiting de API próprio (não temos primitiva ainda).
- Mudança de provedor (Evolution/Z-API permanecem como estão).
- Reescrita do FlowBuilder (apenas integração com pausa automática).

---

## Próximo passo

Se aprovar este plano, eu executo na ordem da seção 7. Posso começar pelas **fundações (migration + webhook + banner global)** já nesta iteração e seguir incrementalmente — sem quebrar o que já funciona.
