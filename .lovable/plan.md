# 🚀 Prime Chat 2.0 — Plano de Redesign Completo

> Transformar o Prime Chat de "painel técnico" em **plataforma premium de vendas via WhatsApp + IA**.
> Identidade visual: **Stripe-like** (clean + dados precisos). Sistema de planos pagos com locks visuais 🔒.

---

## 📦 FASE 1 — Fundação Visual & Navegação

### 1.1 Design tokens premium
**Arquivos:** `src/index.css`, `tailwind.config.ts`
- Tokens novos: `--revenue` (verde), `--ai-accent` (roxo), `--surface-elevated`
- Sombras Stripe-like (sutis, multi-camadas)
- Gradientes leves: `--gradient-revenue`, `--gradient-ai`

### 1.2 Nova Sidebar estratégica (11 → 9 itens)
```
🏠 Início
💬 Conversas         (era Chat)
🎯 Leads & Funil
🚀 Campanhas         (Disparos + Histórico)
⚡ Automações        (Fluxos + Agente IA + Voice)
📊 Performance       (era Analytics)
💰 Financeiro
─── divider ───
🔌 Integrações       (Webhooks + Meta + Instagram)
⚙️ Configurações
```
Badges 🔒 Pro + indicador de plano no rodapé.

### 1.3 Componentes premium
- `PremiumCard`, `MetricHero`, `InsightCard`, `PlanLock`, `EmptyStatePremium`

---

## 📦 FASE 2 — Dashboard "Início" Premium

### 2.1 Quebrar `Dashboard.tsx`
- `RevenueHero` — banner R$ faturado + delta vs ontem
- `KpiGrid` — 4 KPIs (leads hoje, taxa resposta, IA poupou, campanhas ativas)
- `AiInsights` — 3 insights via Lovable AI
- `QuickActions` — Nova Campanha / Responder Leads / Carrinhos
- Extrair `SalesRanking` e `RecentOrders`

### 2.2 Edge function `dashboard-insights`
Lovable AI (`google/gemini-3-flash-preview`) → 3 insights acionáveis. Cache 15min.

### 2.3 Copywriting comercial
"Total de Leads" → "Novos contatos hoje" | "Receita Aprovada" → "💰 Faturado hoje"

---

## 📦 FASE 3 — Conversas (Chat → CRM)

### 3.1 Migration em `leads`
`lead_score`, `lead_temperature`, `potential_value`, `next_action_suggestion`, `ai_summary`

### 3.2 Painel lateral no `LeadChatDrawer.tsx`
Score IA, temperatura (quente/morno/frio), valor potencial, próxima ação, resumo IA.
Botão "✨ Sugerir resposta" no input.

### 3.3 Edge function `lead-ai-analysis`
Gera score + resumo + próxima ação via Lovable AI.

---

## 📦 FASE 4 — Campanhas com Templates Prontos

### 4.1 `src/pages/Campaigns.tsx` + `CampaignTemplateGallery`
Templates: Recuperar Carrinho, Pós-venda, Reativação 30d, VIP, Black Friday.
Config local em `src/lib/campaign-templates.ts`.

---

## 📦 FASE 5 — Performance (Analytics ROI)

Hero "🏆 Campanha Campeã do Mês" + funil visual + ROI estimado por campanha.

---

## 📦 FASE 6 — Financeiro com Lucro

Cards: Faturamento gerado | Custo Meta | 💰 Lucro estimado | Custo/lead | ROI %

---

## 📦 FASE 7 — Sistema de Planos & Locks 🔒

### 7.1 Migration `user_plans`
`(user_id, plan, trial_ends_at, current_period_end)` — plan: starter/pro/scale/white_label

### 7.2 Hook `useUserPlan()` + `src/lib/plan-features.ts`

### 7.3 `<PlanLock feature="multi_number">` — overlay 🔒 com CTA "Ver planos"

### 7.4 Página `src/pages/Pricing.tsx` — tabela comparativa

### 7.5 Aplicar locks
- Múltiplos números → Pro+
- Agente IA → Pro+
- Voice Studio → Scale+
- Disparos > 10k/dia → Scale+
- White Label → plano White Label

---

## 🎯 Ordem de Execução
1. Fase 1 (Fundação + Sidebar)
2. Fase 2 (Dashboard Premium)
3. Fase 7 (Planos & Locks)
4. Fase 3 (Chat-CRM IA)
5. Fase 4 (Templates Campanhas)
6. Fases 5 e 6 (Performance + Financeiro ROI)

---

## ⚠️ Decisões pendentes antes de codar
- Confirmar nomes finais dos planos (Starter / Pro / Scale / White Label)?
- Trial gratuito de 7 dias ou direto pago?
- Lovable AI consumo: cache agressivo (15min) ou tempo real?
