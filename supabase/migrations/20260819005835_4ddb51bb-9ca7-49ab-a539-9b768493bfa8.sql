INSERT INTO public.flow_steps (id, flow_id, step_order, step_type, custom_message, is_entry, delay_minutes)
VALUES (
  'a1b2c3d4-0001-4000-8000-000000000001',
  '1a4b12e8-c99a-4682-9ab8-5dc99ce7627b',
  8,
  'message',
  E'🟢 INSCRIÇÕES ABERTAS!!!\n\nAs inscrições pro Combo da Nova Era da Nutrição estão abertas AGORA.\n\n👉 https://pay.hub.la/qWWBdyoFDGgeHlEnNUwL\n\n👉 https://pay.hub.la/qWWBdyoFDGgeHlEnNUwL\n\n👉 https://pay.hub.la/qWWBdyoFDGgeHlEnNUwL\n\n✅ *Durante 18 meses você vai estar ao lado dos maiores nomes da nova era da nutrição, Felipe Almeida e Dudu Haluch, te guiando para ser um nutricionista que domina a ciência, constrói autoridade e lota a agenda.*\n\nConteúdo estruturado, comunidade com vários nutricionistas, acesso aos novos aplicativos\n\nNão é só mais um cursinho de nutrição com teoria\n\nÉ uma Nova Era que já começou. É uma nova geração de nutricionistas que querem dominar a ciência, construir autoridade e lotar a agenda.',
  false,
  0
);

INSERT INTO public.flow_executions (flow_id, lead_id, current_step_id, status, next_action_at, metadata)
SELECT
  '1a4b12e8-c99a-4682-9ab8-5dc99ce7627b',
  l.id,
  'a1b2c3d4-0001-4000-8000-000000000001',
  'waiting_delay',
  now() + ((row_number() over (order by l.last_inbound_at desc)) * interval '0.35 seconds'),
  '{"campaign":"inscricoes_abertas"}'::jsonb
FROM public.leads l
WHERE l.user_id = '63ee595e-1023-4e4a-9290-5e3e9c1c98f6'
  AND l.unsubscribed = false
  AND l.last_inbound_at > now() - interval '23 hours 30 minutes';