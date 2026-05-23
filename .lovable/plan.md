# Refatoração multi-WABA com OAuth legado

Objetivo: manter o fluxo OAuth tradicional (sem Embedded Signup) e blindar o backend para operar com várias contas WhatsApp Cloud isoladas entre si, sem nenhum fallback global de token.

## 1. Esquema do banco

Migration única adicionando ao `whatsapp_accounts`:

- `meta_user_id text` — identificador FB do dono do token (de `/me`)
- `webhook_subscribed boolean default false`
- `webhook_subscribed_at timestamptz`
- `webhook_last_check_at timestamptz`
- `webhook_last_status text` — `ok`, `not_subscribed`, `error:*`
- `token_validity text default 'unknown'` — `valid`, `expired`, `invalid_app`, `revoked`, `unknown`
- `token_app_id text` — `app_id` retornado por `debug_token` (proof of ownership)
- `token_checked_at timestamptz`

Nova tabela `whatsapp_account_audit` (id, account_id FK→whatsapp_accounts, user_id, event, status, details jsonb, created_at). Eventos: `oauth_provisioned`, `subscribed_apps`, `webhook_check`, `token_check`, `app_ownership_check`. RLS: dono lê o próprio, service_role gerencia.

## 2. OAuth callback (`meta-oauth-callback`)

Reescrito para fazer todo o provisionamento multi-WABA:

1. Troca `code` por `access_token` (System User permanente via OAuth).
2. `GET /me` → `meta_user_id`, nome.
3. `GET /debug_token` → `app_id`, `granular_scopes`. Valida que `app_id === META_APP_ID` (proof of ownership) — senão grava `app_ownership_check` falho e retorna erro.
4. Descobre WABAs: `target_ids` de `whatsapp_business_management` + fallback `/{business_id}/owned_whatsapp_business_accounts`.
5. Para cada WABA:
   - `GET /{waba}?fields=id,name,owner_business_info,on_behalf_of_business_info` → `business_id`.
   - `POST /{waba}/subscribed_apps` com `Authorization: Bearer <token>` da própria conta. Grava `webhook_subscribed`, `webhook_subscribed_at`, `webhook_last_status`. Audita `subscribed_apps`.
   - `GET /{waba}/phone_numbers` → para cada telefone faz upsert em `whatsapp_accounts` por `phone_number_id` único, gravando `access_token`, `token_type='system_user'`, `waba_id`, `business_id`, `phone_number_id`, `app_id`, `meta_user_id`, `token_app_id`, `token_validity='valid'`, `token_checked_at`, `webhook_subscribed`.
   - Audita `oauth_provisioned` por conta.
6. Mantém `meta_connections` apenas como registro do login (não usado em runtime).
7. Retorna `provisioned: [{ account_id, waba_id, phone_number_id, phone_number, subscribed }]`.

`meta-list-numbers` permanece para a tela de seleção, mas o provisionamento real passa a acontecer no callback.

## 3. Webhook (`whatsapp-cloud-webhook`)

Resolução **estrita** por `value.metadata.phone_number_id`:

- Sem `phone_number_id` → 200 com `{ ignored: 'missing_phone_number_id' }` (não derruba a Meta).
- Sem conta correspondente → grava `webhook_debug` + 200 com `{ ignored: 'unknown_phone_number_id' }`.
- Removido fallback `is_default` e `Deno.env.WHATSAPP_ACCESS_TOKEN`.
- Todas as chamadas Graph (baixar mídia, marcar como lida, etc.) usam o token da conta resolvida.
- `resolvedAccountId` e `resolvedUserId` deixam de ser opcionais — todas as inserções (`chat_messages`, `leads`, `message_logs`) usam esse `user_id` para respeitar o isolamento multi-tenant.

## 4. Envio (`whatsapp-cloud-send`)

- `account_id` torna-se **obrigatório** para `provider='meta_cloud'`. Sem ele → 400 `account_id_required`.
- Removidos os fallbacks `is_default`, "primeira conta", e `Deno.env.WHATSAPP_ACCESS_TOKEN`.
- Valida que `account.user_id === user.id` antes de enviar (defesa em profundidade além da RLS).
- Erros 190/200/10 da Meta marcam `token_validity='expired'`/`revoked` na conta e auditam `token_check`.

## 5. Saúde periódica e on-demand

- `whatsapp-cloud-health` passa a popular `webhook_last_check_at`, `webhook_last_status`, `token_validity`, `token_checked_at` e `token_app_id` em cada execução. Audita `webhook_check`, `token_check`, `app_ownership_check`.
- Nova função `whatsapp-resubscribe` (botão no UI) que chama `POST /{waba}/subscribed_apps` com o token da conta selecionada e atualiza os mesmos campos.

## 6. Remoção do token global

Auditadas e atualizadas todas as referências a `WHATSAPP_ACCESS_TOKEN`:

- `whatsapp-cloud-webhook` (linha 448) — removido.
- `whatsapp-cloud-send` (linha 98) — removido.
- `whatsapp-cloud-health` — apenas usado para comparar metadados do app (`META_APP_ID|META_APP_SECRET`), não para enviar.

O secret continua existindo mas nenhum caminho de runtime depende dele.

## 7. UI mínima

Em `WhatsAppApi.tsx`:

- Após OAuth, exibir toast com `provisioned.length` números e invalidar `whatsapp-accounts`.
- Badge por conta: `webhook_subscribed`, `token_validity`, último check. Botão "Reinscrever webhook".
- Selecionar conta passa a ser obrigatório antes de enviar (já é hoje no broadcast, reforçado em ações soltas).

## Arquivos tocados

```
supabase/migrations/<novo>.sql               (+ campos + tabela auditoria + RLS)
supabase/functions/meta-oauth-callback/index.ts        (reescrita)
supabase/functions/whatsapp-cloud-webhook/index.ts     (resolução estrita)
supabase/functions/whatsapp-cloud-send/index.ts        (account_id obrigatório)
supabase/functions/whatsapp-cloud-health/index.ts      (popula auditoria)
supabase/functions/whatsapp-resubscribe/index.ts       (nova)
src/pages/WhatsAppApi.tsx                              (toast + badges + botão)
```

## Fora de escopo

- Embedded Signup (mantido desativado, código preservado mas botão pode ficar oculto).
- Refresh automático de token (System User OAuth já é permanente; só marcamos `invalid` quando a Meta devolve 190).
- Multi-app (META_APP_ID continua único por instalação).