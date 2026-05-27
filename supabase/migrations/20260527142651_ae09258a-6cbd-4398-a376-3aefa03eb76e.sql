DO $$
DECLARE
  v_user uuid := '63ee595e-1023-4e4a-9290-5e3e9c1c98f6';
  v_template_content text := 'Olá, {{1}}.

Aqui é o Nutri, estou passando para avisar que seu cadastro foi confirmado
Posso te enviar mais informações?';
  v_old_flow uuid;
  v_new_flow uuid;
  v_old_step record;
  v_id_map jsonb := '{}'::jsonb;
  v_new_id uuid;
  v_new_parent uuid;
  v_new_message text;
  v_new_template uuid;
BEGIN
  FOR v_old_flow, v_new_flow IN
    SELECT * FROM (VALUES
      ('c2329e86-45da-4881-9838-65e776c20b0b'::uuid, gen_random_uuid()),
      ('946f3532-5aec-443b-acbf-62e8a43bd4de'::uuid, gen_random_uuid())
    ) AS t(old_id, new_id)
  LOOP
    INSERT INTO flows (id, name, description, active, user_id, trigger_type, flow_kind, variation_enabled, delay_min_seconds, delay_max_seconds, sending_window_enabled, sending_window_start, sending_window_end, sending_window_timezone)
    SELECT v_new_flow, name || ' (WhatsApp)', description, false, user_id, trigger_type, 'whatsapp', variation_enabled, delay_min_seconds, delay_max_seconds, sending_window_enabled, sending_window_start, sending_window_end, sending_window_timezone
    FROM flows WHERE id = v_old_flow;

    v_id_map := '{}'::jsonb;

    -- pass 1: insert steps, build mapping
    FOR v_old_step IN
      SELECT * FROM flow_steps WHERE flow_id = v_old_flow ORDER BY step_order
    LOOP
      v_new_id := gen_random_uuid();
      v_id_map := v_id_map || jsonb_build_object(v_old_step.id::text, v_new_id);

      -- convert entry HSM template to custom_message for WhatsApp flow
      v_new_message := v_old_step.custom_message;
      v_new_template := v_old_step.template_id;
      IF v_old_step.is_entry AND v_old_step.template_id IS NOT NULL THEN
        v_new_message := v_template_content;
        v_new_template := NULL;
      END IF;

      INSERT INTO flow_steps (
        id, flow_id, step_order, step_type, is_entry, template_id, custom_message,
        delay_minutes, delay_min_seconds, delay_max_seconds, trigger_value, parent_step_id,
        buttons, timeout_minutes, ai_agent_id, ai_prompt, max_interactions,
        media_url, media_type, file_name, message_variations
      ) VALUES (
        v_new_id, v_new_flow, v_old_step.step_order, v_old_step.step_type, v_old_step.is_entry,
        v_new_template, v_new_message,
        v_old_step.delay_minutes, v_old_step.delay_min_seconds, v_old_step.delay_max_seconds,
        v_old_step.trigger_value, NULL,
        v_old_step.buttons, v_old_step.timeout_minutes, v_old_step.ai_agent_id, v_old_step.ai_prompt, v_old_step.max_interactions,
        v_old_step.media_url, v_old_step.media_type, v_old_step.file_name, v_old_step.message_variations
      );
    END LOOP;

    -- pass 2: remap parent_step_id
    FOR v_old_step IN
      SELECT id, parent_step_id FROM flow_steps WHERE flow_id = v_old_flow AND parent_step_id IS NOT NULL
    LOOP
      UPDATE flow_steps
      SET parent_step_id = (v_id_map ->> v_old_step.parent_step_id::text)::uuid
      WHERE id = (v_id_map ->> v_old_step.id::text)::uuid;
    END LOOP;
  END LOOP;
END $$;