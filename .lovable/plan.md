## O que vou entregar

### 1. Dashboard inicial com métricas para todos os usuários
- Hoje a tela inicial em `WhatsAppApi.tsx` já usa `DashboardHome` (aba "home") com KPIs, receita, insights e ranking.
- Vou revisar o `RevenueHero` e o `DashboardHome` para: (a) esconder cards de "Receita/Pedidos" quando o usuário não é admin (essas métricas vêm de vendas globais via `get_dashboard_stats`) e (b) destacar métricas de conversação (leads, taxa de resposta, mensagens enviadas, campanhas ativas) que já vêm do `get_advanced_dashboard_stats` filtrado por `user_id`.
- Garantir que ao logar, contas não-admin caiam na aba `home` (dashboard) e não em uma aba "admin".

### 2. Correção do redirecionamento após login em contas de cliente
- Sintoma: logando com uma conta cliente, cai numa "aba admin".
- Causa provável: `activeMainTab` é persistido em `localStorage` global do navegador, então se o navegador já esteve com o admin e trocou de conta, mantém a última aba (que pode ser `admin-users` ou similar).
- Correção: no `AuthContext`, ao detectar troca de `user.id`, limpar a chave `activeMainTab` do localStorage. Além disso, quando a aba salva for restrita a admin e o usuário atual não for admin, cair em `home`.

### 3. Filtro de data no Chat
- Adicionar um `DateRangeFilter` (componente já existe em `src/components/DateRangeFilter.tsx`) no header da lista de conversas em `src/pages/Chat.tsx`.
- Filtro aplica ao campo `last_inbound_at` (ou `updated_at` como fallback) dos leads, filtrando in-memory a lista de conversas exibidas.
- Persistir seleção em state local do componente (sem localStorage) e botão "Limpar".

### 4. Controle de acesso ao Instagram por usuário (admin)
- Adicionar coluna `instagram_enabled boolean not null default false` em `public.profiles` (via migration).
- Em `AdminUsers.tsx`: novo Switch por usuário "Acesso Instagram" que faz update no perfil.
- Em `AppHeader.tsx`: só mostrar o botão de plataforma "Instagram" quando `profile.instagram_enabled === true` **ou** o usuário for admin.
- Em `InstagramDashboard.tsx`: no bootstrap, se `!instagram_enabled && !isAdmin`, redirecionar para `/` com toast "Recurso indisponível no seu plano".

### 5. Criação de webhooks personalizados
- Em `WebhookEndpoints.tsx`, adicionar um botão "Novo webhook personalizado" que abre um dialog para:
  - Nome do webhook (event_type customizado, ex.: `custom:meu-evento`)
  - Conta WhatsApp opcional (`account_id`)
  - Mapping de campos (JSON) — reaproveitar o editor de field_mapping já existente
  - Gera automaticamente um `webhook_token` único e salva na tabela `webhook_endpoints`.
- Mostrar URL final `https://<host>/functions/v1/custom-webhook?token=<token>` com botão copiar.

### 6. Correção da tela branca ao voltar do editor de fluxo
- Sintoma: entra num fluxo, clica em voltar → tela branca.
- Causa: em `WhatsAppApi.tsx`, `flowEditId` fica retido no parent quando o usuário navega via webhook. Ao voltar dentro do FlowBuilder (`setEditingFlow(undefined)`), o parent ainda tem `flowEditId`, mas o `useEffect` interno do FlowBuilder só roda uma vez, então mostra a lista. Porém, o `<TabsContent>` renderiza o FlowBuilder em `fixed inset-0 z-50` (o editor) — quando volta, a lista renderiza dentro do container mas o header vertical some porque um outro modal antigo (`fixed inset-0`) permaneceu montado se o usuário abriu via link direto.
- Correção defensiva:
  - Limpar `flowEditId` e `flowTriggerType` no parent ao receber callback `onBack` do FlowBuilder (adicionar prop `onEditorClose` no FlowBuilder).
  - Remover `fixed inset-0 z-50` do FlowEditorView e usar layout normal (`h-full flex flex-col`) — isso resolve o overlay preso e evita conflitos com o layout vertical de tabs.

## Detalhes técnicos

- Migration: `ALTER TABLE public.profiles ADD COLUMN instagram_enabled boolean not null default false;` + policy update para usuário ler o próprio perfil (já existe).
- Novo hook: `useProfile()` que retorna `{ profile, isAdmin }` para reutilização em `AppHeader` e `InstagramDashboard`.
- `Chat.tsx` filtro: adicionar `dateRange` state, filtrar `conversations` por `last_message_at >= from && <= to`.
- FlowBuilder onBack chamando prop `onEditorClose?.()` para o parent limpar `flowEditId`.
