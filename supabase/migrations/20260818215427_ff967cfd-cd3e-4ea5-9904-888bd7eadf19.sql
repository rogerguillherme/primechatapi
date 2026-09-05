DO $$
DECLARE
  v_user uuid := '63ee595e-1023-4e4a-9290-5e3e9c1c98f6';
  v_flow uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  d2 uuid := gen_random_uuid();
  s3 uuid := gen_random_uuid();
  d3 uuid := gen_random_uuid();
  s4 uuid := gen_random_uuid();
  v_url text := 'https://youtube.com/live/h_QD1f-Hr8g?feature=share';
BEGIN
  INSERT INTO public.flows (id, user_id, name, description, active, trigger_type, flow_kind)
  VALUES (v_flow, v_user, 'LIVE Nova Era — Sequência Completa', 'Sequência única: 19:00, 19:45, 20:00 e 20:15 com esperas automáticas', true, 'manual', 'api');

  INSERT INTO public.flow_steps (id, flow_id, step_order, step_type, custom_message, buttons, delay_minutes, is_entry, parent_step_id)
  VALUES
  (s1, v_flow, 1, 'cta_url', E'Falta 1h.\n\nA live da Nova Era da Nutrição que você se inscreveu está prestes a começar.\n\nClique no link abaixo para acessar ⤵️',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'title', 'Assistir a live', 'url', v_url)), 0, true, NULL),
  (d1, v_flow, 2, 'delay', NULL, NULL, 45, false, s1),
  (s2, v_flow, 3, 'cta_url', E'Faltam apenas 15 minutos!\n\nA live da Nova Era da Nutrição que você se inscreveu está prestes a começar.\n\nEntra agora pelo link abaixo ⤵️',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'title', 'Assistir a live', 'url', v_url)), 0, false, d1),
  (d2, v_flow, 4, 'delay', NULL, NULL, 15, false, s2),
  (s3, v_flow, 5, 'cta_url', E'Estamos Ao Vivo 🔴\n\nA live da Nova Era da Nutrição que você se inscreveu já começou.\n\nClique no link abaixo para acessar ⤵️',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'title', 'Assistir a live', 'url', v_url)), 0, false, d2),
  (d3, v_flow, 6, 'delay', NULL, NULL, 15, false, s3),
  (s4, v_flow, 7, 'message', E'Ainda dá tempo!\n\nEntra agora pelo link abaixo ⤵️\n\n' || v_url, NULL, 0, false, d3);
END $$;