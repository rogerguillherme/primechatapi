-- ============================================================================
-- Fluxo "Boas-vindas após o Mapa do Lipedema" — criado via SQL direto
-- Projeto Supabase: nnjwemmerumzkiiykpas (produção do Prime Chat)
-- ============================================================================
--
-- Migration em vez de SQL avulso: como migration, o Supabase só aplica isto
-- UMA VEZ por ambiente (registro em supabase_migrations.schema_migrations) —
-- resolve de vez o risco de "rodar duas vezes cria fluxo duplicado" que o
-- SQL avulso original (zerolipedema-funnel/fluxo-boas-vindas.sql) tinha.
--
-- POR QUE SQL EM VEZ DA UI: o Roger não conseguiu logar na UI do Prime pelo
-- Chrome controlado. Isto substitui só a AÇÃO DE SALVAR do construtor de
-- fluxos — lido exatamente o que o "Salvar" da UI grava (src/components/
-- FlowBuilder.tsx, saveMutation) e o que os dois motores que executam fluxo
-- esperam encontrar (supabase/functions/flow-processor/index.ts e
-- supabase/functions/whatsapp-cloud-webhook/index.ts), pra este INSERT gerar
-- exatamente a mesma estrutura que o construtor geraria.
--
-- TESTADO: rodado sem alterações contra um Postgres 17 local com réplica do
-- schema real (mesmas colunas/defaults/triggers de flows e flow_steps) antes
-- de entregar. Criou o 1 fluxo + 11 passos corretamente — ver detalhe do
-- mapeamento 10 etapas → 11 linhas mais abaixo.
--
-- SEGURANÇA: o fluxo entra INATIVO (active = false). Nada dispara pra
-- ninguém até o Roger revisar na UI e apertar o toggle "Ativo" — de
-- propósito, é o passo mais simples e reversível que existe. Esta migration
-- não ativa nada.
--
-- ATENÇÃO — só pode haver UM fluxo com trigger_type = 'mensagem_recebida'
-- ATIVO por conta (o motor pega sempre o mais antigo ativo). Antes de ativar
-- este aqui pela UI, veja se já existe outro "mensagem_recebida" ativo na
-- conta admin@primechat.com e desative/consolide.
--
-- ⚠️ BRANCH: este arquivo foi escrito num clone local que estava em
-- `migracao-supabase` (commit 61c485b, 2026-09-05), desatualizado em relação
-- a `origin/main` (878c520, 2026-09-08+) — mesmo aviso do DEPLOY.md. Confirme
-- que está aplicando isto contra o branch/commit certo antes de comitar e
-- rodar `supabase db push`.
-- ============================================================================


-- ── Conferência opcional ─────────────────────────────────────────────────
-- Não precisa rodar à parte — o INSERT abaixo já busca o id sozinho pelo
-- e-mail. Serve só pra você ver com os próprios olhos qual conta é a dona.
-- select id, email from auth.users where email = 'admin@primechat.com';


-- ── O fluxo + os 11 passos ──────────────────────────────────────────────
--
-- Mapeamento do pedido do Roger (10 "etapas") para as 11 linhas de
-- flow_steps que o motor realmente usa — "Sem resposta" é um TIPO DE PASSO
-- próprio (step_type = 'no_response'), separado da mensagem que ele dispara:
--
--   Etapa do pedido                                   step_order  step_type
--   1. Mensagem "Oi {nome}!..."                            0      message   (is_entry = true)
--   2. Delay 1 min                                         1      delay
--   3. Mensagem "{abertura_validadora}"                    2      message
--   4. Delay 1 min                                         3      delay
--   5. Mensagem "...estágio *{estagio}*..."                4      message
--   6. Delay 1 min                                         5      delay
--   7. Mensagem "Suas 3 prioridades..."                    6      message
--   8. Delay 1 min                                         7      delay
--   9. Mensagem "{proximo_passo_titulo}..."                8      message
--   10. Sem resposta 15 min ─┬─ o passo "sem resposta" em si            9   no_response
--                            └─ a mensagem que ele dispara ao vencer    10  message
--
-- Cada passo (exceto o 1º) tem parent_step_id apontando pro passo anterior —
-- é assim que o construtor liga uma etapa na outra (cadeia linear, sem
-- ramificação). O 1º passo tem parent_step_id NULL e is_entry = true: é o
-- que marca "isto é o que roda quando o gatilho dispara" (FlowBuilder.tsx
-- ~linha 1157; os dois motores checam por is_entry = true OU
-- parent_step_id IS NULL — deixados os dois certos por segurança).
--
-- As variáveis {nome}/{abertura_validadora}/{estagio}/etc. são resolvidas em
-- tempo de envio pelo interpolate() a partir de leads.metadata (ver o patch
-- do funil zerolipedema já entregue) — não precisam existir agora pra este
-- INSERT funcionar, só precisam existir quando a mensagem for de fato enviada.

with novo_fluxo as (
  insert into public.flows (name, description, user_id, trigger_type, flow_kind, active)
  values (
    'Boas-vindas após o Mapa do Lipedema',
    'Nutrição pós-quiz zerolipedema.com.br. Dispara na primeira mensagem da lead (gatilho mensagem_recebida). Criado via migration em ' || now()::date || ' — revisar na UI antes de ativar.',
    -- Subquery escalar de propósito: se o e-mail não existir, isto vira
    -- NULL, e user_id é NOT NULL — o INSERT falha alto e claro, em vez de
    -- silenciosamente não criar nada.
    (select id from auth.users where email = 'admin@primechat.com'),
    'mensagem_recebida',
    'api',    -- 'api' = WhatsApp Cloud API (Meta) — é o provedor deste funil, via whatsapp-cloud-webhook
    false     -- INATIVO até o Roger revisar e ativar pela UI
  )
  returning id
),

passo_01_mensagem_abertura as (       -- Etapa 1 do pedido — ENTRADA do fluxo
  insert into public.flow_steps (flow_id, step_order, step_type, custom_message, is_entry, parent_step_id)
  select nf.id, 0, 'message', 'Oi {nome}! Tudo bem? Aqui é a Dra. Gabriela Rosado 💙', true, null
  from novo_fluxo nf
  returning id, flow_id
),

passo_02_delay as (                   -- Etapa 2 do pedido
  insert into public.flow_steps (flow_id, step_order, step_type, delay_minutes, parent_step_id)
  select p.flow_id, 1, 'delay', 1, p.id
  from passo_01_mensagem_abertura p
  returning id, flow_id
),

passo_03_mensagem_validadora as (     -- Etapa 3 do pedido
  insert into public.flow_steps (flow_id, step_order, step_type, custom_message, parent_step_id)
  select p.flow_id, 2, 'message', '{abertura_validadora}', p.id
  from passo_02_delay p
  returning id, flow_id
),

passo_04_delay as (                   -- Etapa 4 do pedido
  insert into public.flow_steps (flow_id, step_order, step_type, delay_minutes, parent_step_id)
  select p.flow_id, 3, 'delay', 1, p.id
  from passo_03_mensagem_validadora p
  returning id, flow_id
),

passo_05_mensagem_estagio as (        -- Etapa 5 do pedido
  insert into public.flow_steps (flow_id, step_order, step_type, custom_message, parent_step_id)
  select p.flow_id, 4, 'message',
    'Pelo que você respondeu, seu Lipedema está no estágio *{estagio}*. {descricao_estagio}',
    p.id
  from passo_04_delay p
  returning id, flow_id
),

passo_06_delay as (                   -- Etapa 6 do pedido
  insert into public.flow_steps (flow_id, step_order, step_type, delay_minutes, parent_step_id)
  select p.flow_id, 5, 'delay', 1, p.id
  from passo_05_mensagem_estagio p
  returning id, flow_id
),

passo_07_mensagem_prioridades as (    -- Etapa 7 do pedido — quebra de linha REAL (E'...\n...')
  insert into public.flow_steps (flow_id, step_order, step_type, custom_message, parent_step_id)
  select p.flow_id, 6, 'message', E'Suas 3 prioridades agora:\n{prioridades}', p.id
  from passo_06_delay p
  returning id, flow_id
),

passo_08_delay as (                   -- Etapa 8 do pedido
  insert into public.flow_steps (flow_id, step_order, step_type, delay_minutes, parent_step_id)
  select p.flow_id, 7, 'delay', 1, p.id
  from passo_07_mensagem_prioridades p
  returning id, flow_id
),

passo_09_mensagem_proximo_passo as (  -- Etapa 9 do pedido — quebra de linha REAL
  insert into public.flow_steps (flow_id, step_order, step_type, custom_message, parent_step_id)
  select p.flow_id, 8, 'message', E'{proximo_passo_titulo}\n{proximo_passo_mensagem}', p.id
  from passo_08_delay p
  returning id, flow_id
),

passo_10_sem_resposta as (            -- Etapa 10 do pedido, parte 1: o timeout em si
  -- no_response_conditions = '[]' é o modo "simples": sem condições
  -- configuradas, o motor só olha timeout_minutes e, ao vencer sem resposta
  -- do lead, segue direto pro único filho (sem ramificar por etiqueta/
  -- resposta-atrasada). Ver _shared/no-response.mjs: lista vazia -> sempre
  -- {kind:"advance", branchKey:null}.
  insert into public.flow_steps (flow_id, step_order, step_type, timeout_minutes, no_response_conditions, parent_step_id)
  select p.flow_id, 9, 'no_response', 15, '[]'::jsonb, p.id
  from passo_09_mensagem_proximo_passo p
  returning id, flow_id
),

passo_11_pergunta_final as (          -- Etapa 10 do pedido, parte 2: a mensagem que o timeout dispara
  insert into public.flow_steps (flow_id, step_order, step_type, custom_message, parent_step_id)
  select p.flow_id, 10, 'message', 'O que mais te incomoda com o Lipedema no seu dia a dia?', p.id
  from passo_10_sem_resposta p
  returning id, flow_id
)

select
  nf.id as flow_id,
  'Boas-vindas após o Mapa do Lipedema' as nome,
  false as active,
  11 as passos_criados
from novo_fluxo nf;


-- ============================================================================
-- DEPOIS DE APLICAR: o que checar na UI do Prime (app.primechat.pro)
-- ============================================================================
-- 1. Aba "Fluxos" → confirme que "Boas-vindas após o Mapa do Lipedema" aparece,
--    marcado como INATIVO.
-- 2. Abra pra editar → confira a cadeia visual: gatilho → mensagem → delay →
--    ... → "Sem Resposta" (15 min) → mensagem final, em linha reta, sem nó
--    solto. A posição visual não vem do banco — a UI recalcula o layout
--    sozinha a partir de parent_step_id/step_order.
-- 3. Antes de ativar: veja se já existe outro fluxo "mensagem_recebida" ativo
--    nesta conta. Só pode haver um — desative/consolide o antigo primeiro.
-- 4. Ative pelo toggle "Ativo" da própria UI quando estiver revisado.
-- ============================================================================
