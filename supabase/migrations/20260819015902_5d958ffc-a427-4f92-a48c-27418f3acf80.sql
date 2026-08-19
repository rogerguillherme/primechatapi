INSERT INTO public.flow_steps (id, flow_id, step_order, step_type, custom_message, is_entry)
VALUES (
 'a1b2c3d4-0003-4000-8000-000000000003',
 '1a4b12e8-c99a-4682-9ab8-5dc99ce7627b',
 10,
 'message',
 E'🚨 FALTA MENOS DE 1 HORA PARA O ENCERRAMENTO DA CONDIÇÃO ESPECIAL!\n\n⏰ Quem entrar até 23h59 de hoje (18/08) ainda leva:\n\n🏆 Chance de estar entre os 25 PRIMEIROS e concorrer ao sorteio de um NOTEBOOK 💻\n\n🏆 Chance de estar entre os 100 PRIMEIROS e concorrer ao sorteio de 3 BOLSAS DE PÓS-GRADUAÇÃO 100% GRATUITAS 🎒\n\n💰 E o desconto válido apenas hoje (18/08) até 23h59:\nR$ 1497 à vista (R$500 OFF) ou 12x de R$ 152,11\n\n👉 https://novaeranutricao.com.br/combo/\n👉 https://novaeranutricao.com.br/combo/\n👉 https://novaeranutricao.com.br/combo/',
 false
) ON CONFLICT (id) DO NOTHING;

WITH prev AS (
  SELECT custom_message FROM public.flow_steps WHERE id='a1b2c3d4-0002-4000-8000-000000000002'
), target AS (
  SELECT DISTINCT cm.lead_id
  FROM public.chat_messages cm, prev
  WHERE cm.direction='outbound'
    AND cm.status IN ('sent','delivered','read')
    AND cm.content = prev.custom_message
    AND cm.created_at > now() - interval '6 hours'
), ordered AS (
  SELECT lead_id, row_number() OVER () rn FROM target
)
INSERT INTO public.flow_executions (flow_id, lead_id, current_step_id, status, next_action_at, metadata)
SELECT '1a4b12e8-c99a-4682-9ab8-5dc99ce7627b', lead_id, 'a1b2c3d4-0003-4000-8000-000000000003',
       'waiting_delay', now() + (rn * interval '0.35 seconds'),
       jsonb_build_object('campaign','encerramento_1h')
FROM ordered;