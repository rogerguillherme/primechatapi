# Refatoração arquitetural: Instagram/FB vs WhatsApp Cloud API

Objetivo: eliminar a arquitetura híbrida atual (tokens manuais, OAuth do Facebook reusado para WhatsApp, fallback `is_default`) e separar o produto em **dois módulos independentes** que compartilham apenas o app Meta `2203903780421152` (Prime).

---

## 1. Separação de módulos

### Módulo Instagram / Facebook (mantém OAuth)
- Fluxo atual de `meta-oauth-url` + `meta-oauth-callback` permanece, **mas passa a ser exclusivo de Instagram/Facebook**.
- Mantém: Pages API, IG Graph API, comentários, live comments, DMs, automações, multi-conta.
- Tabelas: `instagram_connections`, `instagram_conversations`, `instagram_messages`, `instagram_webhook_events`, `meta_connections` (apenas linhas com `phone_number_id = 'fb:*'`).
- Edge functions afetadas: `instagram-*`, `meta-oauth-url`, `meta-oauth-callback`, `instagram-webhook`.
- Renomear conceitualmente `meta_connections` → uso "Facebook login" (sem mudar nome da tabela para evitar churn).

### Módulo WhatsApp Cloud API (somente Embedded Signup)
- **Remover** qualquer caminho que crie/atualize `whatsapp_accounts` a partir de token manual ou OAuth genérico do Facebook.
- Único caminho de onboarding: **Embedded Signup oficial** (`fb.login` com `config_id`, escopo `whatsapp_business_management,whatsapp_business_messaging,business_management`, response `code`, exchange server-side → `business_integration_system_user_access_token`).
- Edge functions novas/reescritas:
  - `whatsapp-embedded-signup-callback` (exchange code → token de sistema permanente, sem fallback).
  - `whatsapp-provision-number` (chama `/{waba_id}/phone_numbers`, registra `phone_number_id`, define two-step PIN, faz `POST /{waba_id}/subscribed_apps`).
  - `whatsapp-cloud-health` já existe → torna-se a fonte única de verdade do diagnóstico.
- Edge functions descontinuadas / bloqueadas:
  - `whatsapp-register-phone` (manual) → marcar como deprecated, retornar 410 fora do fluxo Embedded Signup.
  - Qualquer entrada manual de `access_token` no UI de "Adicionar conta WhatsApp" → removida.

---

## 2. Schema / migrações

Migração nova:

- `whatsapp_accounts`
  - adicionar colunas: `app_id TEXT NOT NULL`, `business_id TEXT`, `onboarding_method TEXT CHECK (onboarding_method IN ('embedded_signup','legacy'))`, `token_type TEXT` (`system_user` | `legacy`), `provisioned_at TIMESTAMPTZ`, `last_health_at TIMESTAMPTZ`, `last_health_status TEXT`.
  - **unique constraints**: `UNIQUE(phone_number_id)` global, `UNIQUE(user_id, business_account_id, phone_number_id)`.
  - remover semântica de `is_default` para roteamento de inbound (mantido só como preferência de UI default no envio).

- Nova tabela `whatsapp_onboarding_sessions` (state, code_verifier, user_id, status, created_at) para o Embedded Signup.

- Nova tabela `whatsapp_dead_letter` (webhook inbound que não casou com nenhuma conta): `phone_number_id`, `waba_id`, `payload`, `reason`, `created_at`. RLS admin-only.

- Nova tabela `whatsapp_audit_log` (eventos de mudança de token, reprovisionamento, healthcheck fail).

- Backfill: marcar todas as `whatsapp_accounts` existentes como `onboarding_method='legacy'` e `last_health_status='pending_migration'`.

## 3. Resolução multi-conta (inbound)

Reescrever `whatsapp-cloud-webhook`:

```
para cada change em entry[].changes[]:
  metadata.phone_number_id  → chave primária de resolução
  fallback: entry.id (waba_id) + display_phone_number
  SE nenhuma whatsapp_accounts casar:
    grava em whatsapp_dead_letter com reason='unmapped_phone_number_id'
    responde 200 (não reentregar)
  SE casar mas account.onboarding_method='legacy':
    grava em whatsapp_audit_log reason='legacy_account_inbound'
    continua processando (não bloqueia produção)
```

Remover qualquer `is_default` ou "primeira conta do user" no caminho de inbound.

## 4. Auditoria automática de tokens / WABAs

Nova edge function `whatsapp-fleet-audit` (cron diário via pg_cron) que para cada `whatsapp_accounts`:

1. `GET /debug_token` → `app_id`, `is_valid`, `expires_at`, `scopes`, `type` (`SYSTEM` vs `USER`).
2. `GET /{waba_id}?fields=id,owner_business_info,on_behalf_of_business_info`.
3. `GET /{waba_id}/subscribed_apps` → confere se `META_APP_ID` está presente.
4. `GET /{phone_number_id}?fields=verified_name,code_verification_status,quality_rating,platform_type,is_on_biz_app,certificate`.
5. Grava resultado em `whatsapp_audit_log` + atualiza `last_health_status`.

Detecta:
- token de app diferente do Prime → `flag: wrong_app`
- app desativado (`OAuthException 200`) → `flag: app_deactivated`
- WABA órfã (sem `owner_business_info`) → `flag: orphan_waba`
- `subscribed_apps` sem Prime → `flag: subscription_missing`
- token expirado / próximo do vencimento → `flag: token_expiring`
- `platform_type != CLOUD_API` ou `is_on_biz_app=true` → `flag: coexistence`
- `onboarding_method='legacy'` → `flag: needs_migration`

## 5. Healthcheck on-demand
- `whatsapp-cloud-health` atual fica como entrypoint por conta (já implementado).
- UI: aba "Saúde" em cada `whatsapp_accounts` mostra último resultado do fleet audit + botão "Re-executar agora".
- Banner global: se qualquer conta do user tem flag crítica (`app_deactivated`, `subscription_missing`, `coexistence`), CTA "Reconectar via Embedded Signup".

## 6. Migração de contas legadas
- Wizard novo `WhatsAppMigrationDialog`:
  1. Lista contas com `onboarding_method='legacy'`.
  2. Mostra diagnóstico (fleet audit).
  3. Botão "Migrar via Embedded Signup" → abre fluxo oficial; após sucesso, faz match por `phone_number_id` e **atualiza in-place** (preserva `id`, `user_id`, automações, templates, mensagens, broadcasts).
  4. Se o usuário escolher número diferente, oferece "vincular automações da conta antiga ao novo `phone_number_id`".
- Não deletar a conta antiga até o usuário confirmar; apenas marcar `status='superseded'`.
- Tokens legados ficam armazenados criptografados em `whatsapp_audit_log` para forense e nunca mais são usados em runtime.

## 7. UI

- Página `WhatsAppApi.tsx`:
  - Remover formulário "Adicionar conta manualmente (token + phone_number_id)".
  - Substituir por um único CTA: **"Conectar WhatsApp via Meta (Embedded Signup)"**.
  - Mostrar badge por conta: `Embedded Signup` (verde) ou `Legado — migração necessária` (âmbar).
- Instagram permanece como está (`MetaConnect.tsx`, `InstagramSetupWizard.tsx`).
- Adicionar página/aba `Frota & Saúde` (admin) listando todas as contas + flags do fleet audit.

## 8. Configuração Meta (fora do código, instruções para o usuário)
- Criar **Embedded Signup configuration** no app Prime → gerar `config_id`.
- Adicionar produtos no app: WhatsApp + Facebook Login for Business + Instagram (já tem).
- Confirmar Advanced Access para `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`.
- Adicionar `https://primechatapi.lovable.app/auth/meta/whatsapp/callback` aos Valid OAuth Redirect URIs.

## 9. Segredos adicionais
- `META_EMBEDDED_SIGNUP_CONFIG_ID` (novo, via `add_secret`).
- Reaproveita `META_APP_ID`, `META_APP_SECRET`.
- `WHATSAPP_ACCESS_TOKEN` global passa a ser **apenas fallback de audit**, nunca usado para envio em produção.

---

## Detalhes técnicos

### Embedded Signup — exchange
```
POST https://graph.facebook.com/v21.0/oauth/access_token
  client_id=META_APP_ID
  client_secret=META_APP_SECRET
  code=<code do FB.login>
→ { access_token } (business integration system user token, permanente)
```
Depois:
```
GET /debug_token?input_token=<token>&access_token=<app_token>
→ data.granular_scopes (lista de waba_ids/business_ids autorizados)
```
Para cada `waba_id` autorizado: `GET /{waba_id}/phone_numbers` → cria 1 `whatsapp_accounts` por número.

### Subscribed apps
```
POST /{waba_id}/subscribed_apps  (Authorization: Bearer <system_user_token>)
GET  /{waba_id}/subscribed_apps  → assert META_APP_ID presente
```

### Webhook resolution SQL
```sql
SELECT id, user_id, access_token, onboarding_method
FROM whatsapp_accounts
WHERE phone_number_id = $1
LIMIT 1;
```
Sem fallback. Dead-letter se vazio.

---

## Ordem de execução proposta

1. Migração schema (colunas novas + tabelas `whatsapp_onboarding_sessions`, `whatsapp_dead_letter`, `whatsapp_audit_log` + unique constraints + backfill `onboarding_method='legacy'`).
2. Edge functions: `whatsapp-embedded-signup-start`, `whatsapp-embedded-signup-callback`, `whatsapp-provision-number`, `whatsapp-fleet-audit`. Atualizar `whatsapp-cloud-webhook` (resolução estrita + dead letter).
3. Cron pg_cron diário para `whatsapp-fleet-audit`.
4. Pedir `META_EMBEDDED_SIGNUP_CONFIG_ID` via `add_secret`.
5. UI: remover entrada manual, novo CTA Embedded Signup, badges, página de saúde, wizard de migração.
6. Deprecar `whatsapp-register-phone` (410) e remover botões correspondentes.
7. Documentação curta in-app explicando a separação Instagram (OAuth) vs WhatsApp (Embedded Signup).

## Riscos / pontos de confirmação

- **Quebra de contas existentes durante migração**: mitigado por `status='superseded'` em vez de delete; automações continuam ligadas pelo `phone_number_id`.
- **Embedded Signup exige Business Verification do cliente final**: avisar no wizard antes de iniciar.
- **Cron pg_cron**: precisa `pg_cron` + `pg_net` habilitados (já são em Lovable Cloud).
- **Confirmar que você tem o `config_id` do Embedded Signup criado no app Prime** — sem isso o fluxo não roda.

Posso começar pela etapa 1 (migração de schema) assim que aprovar; ou se preferir, começo pelas edge functions do Embedded Signup primeiro para validar o fluxo end-to-end com 1 número antes de tocar no resto.
