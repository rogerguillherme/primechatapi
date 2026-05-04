
DO $$
DECLARE
  v_user_id uuid := '3d0d65a4-0aed-4e86-98e0-5d91e555c354';
  v_flow_id uuid := 'eb4d5d73-0ecf-4f1f-8305-cdcfe15eb745';
  v_first_step uuid;
  rec RECORD;
  v_phone text;
  v_name text;
  v_email text;
  v_cpf text;
  v_lead_id uuid;
  v_order_id text;
  v_amount numeric;
  v_product text;
BEGIN
  SELECT id INTO v_first_step FROM flow_steps WHERE flow_id = v_flow_id ORDER BY step_order ASC LIMIT 1;

  FOR rec IN
    SELECT id, payload FROM webhook_events
    WHERE user_id = v_user_id AND processed = false AND event_type = 'compra_aprovada'
    ORDER BY created_at ASC
  LOOP
    v_phone := regexp_replace(COALESCE(rec.payload->'data'->'client'->>'phone',''), '\D', '', 'g');
    IF v_phone = '' THEN
      RAISE NOTICE 'skip event % (no phone)', rec.id;
      CONTINUE;
    END IF;

    v_name := COALESCE(rec.payload->'data'->'client'->>'full_name',
                       NULLIF(trim(coalesce(rec.payload->'data'->'client'->>'first_name','') || ' ' || coalesce(rec.payload->'data'->'client'->>'last_name','')), ''),
                       v_phone);
    v_email := rec.payload->'data'->'client'->>'email';
    v_cpf := rec.payload->'data'->'client'->>'document';
    v_order_id := rec.payload->'data'->'transaction'->>'id';
    v_amount := COALESCE((rec.payload->'data'->'transaction'->>'amount')::numeric, 0) / 100.0;
    v_product := rec.payload->'data'->'offer'->'product'->>'name';

    SELECT id INTO v_lead_id FROM leads WHERE user_id = v_user_id AND phone = v_phone LIMIT 1;
    IF v_lead_id IS NULL THEN
      INSERT INTO leads (user_id, phone, name, email, cpf, origin, chat_status)
      VALUES (v_user_id, v_phone, v_name, v_email, v_cpf, 'custom_webhook', 'novos_pedidos')
      RETURNING id INTO v_lead_id;
    END IF;

    -- Skip if there's already a running execution for this lead+flow
    IF NOT EXISTS (
      SELECT 1 FROM flow_executions
      WHERE flow_id = v_flow_id AND lead_id = v_lead_id
        AND status IN ('running','waiting_reply','scheduled')
    ) THEN
      INSERT INTO flow_executions (flow_id, lead_id, status, current_step_id, next_action_at, metadata)
      VALUES (
        v_flow_id, v_lead_id, 'running', v_first_step, now(),
        jsonb_build_object('trigger','compra_aprovada','order_id',v_order_id,'amount',v_amount,'product_name',v_product,'source','custom_webhook_backfill')
      );
    END IF;

    UPDATE webhook_events SET processed = true WHERE id = rec.id;
  END LOOP;
END $$;
