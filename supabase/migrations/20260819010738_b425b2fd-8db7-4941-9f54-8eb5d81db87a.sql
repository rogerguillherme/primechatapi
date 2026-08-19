INSERT INTO public.flow_steps (id, flow_id, step_order, step_type, custom_message, is_entry, delay_minutes)
VALUES (
  'a1b2c3d4-0002-4000-8000-000000000002',
  '1a4b12e8-c99a-4682-9ab8-5dc99ce7627b',
  9,
  'message',
  E'🎁 E TEM MAIS (BÔNUS ESPECIAIS):\n\n✅ Os 25 PRIMEIROS concorrem:\n\nSorteio de um NOTEBOOK 💻\n\n✅ Os 100 PRIMEIROS concorrem:\n\nSorteio de 3 BOLSAS DE PÓS-GRADUAÇÃO 100% GRATUITAS 🎒\n\n⏰ Quem entrar até 23h59 de hoje (18/08) leva ainda:\n\n➡️ R$500 de desconto no Combo da Nova Era da Nutrição\n\n➡️ Mentoria em grupo com o Felipe Almeida e o Dudu Haluch por 3 meses\n\n➡️ Acesso à comunidade com vários outros nutricionistas da nova Nutriflix\n\n➡️ Curso de Educação Financeira e Contabilidade\n\n➡️ Curso de Marketing e Vendas\n\n➡️ App Consultório de Bolso\n\n➡️ App Radar Científico\n\n➡️ Mais de 15 cursos e ebooks\n\n➡️ Acesso à nova Nutriflix por 18 meses\n\n💰 Valor válido apenas hoje (18/08) até 23h59:\n\n12x de R$ 152,11 ou R$ 1497 à vista (R$500 OFF)\n\n👉 https://pay.hub.la/qWWBdyoFDGgeHlEnNUwL\n\nOs 25 primeiros fecham rápido.\n\nQuem entrar primeiro, leva mais. 🔥',
  false,
  0
);

INSERT INTO public.flow_executions (flow_id, lead_id, current_step_id, status, next_action_at, metadata)
SELECT
  '1a4b12e8-c99a-4682-9ab8-5dc99ce7627b',
  d.lead_id,
  'a1b2c3d4-0002-4000-8000-000000000002',
  'waiting_delay',
  now() + ((row_number() over ()) * interval '0.35 seconds'),
  jsonb_build_object('campaign', 'bonus_especiais', 'account_id', d.account_id)
FROM (
  SELECT DISTINCT cm.lead_id, cm.account_id
  FROM public.chat_messages cm
  WHERE cm.direction = 'outbound'
    AND cm.content LIKE '🟢 INSCRIÇÕES ABERTAS%'
    AND cm.status IN ('sent','delivered','read')
) d;