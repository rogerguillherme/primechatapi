-- Remove a conta de WhatsApp de OUTRO usuário (Evolution "Cristiane Labra")
-- das conversas do Estevão. Ela estava sendo escolhida como canal de envio
-- e devolvia "Internal Server Error" / "Bad Request" em toda mensagem.
UPDATE public.leads
SET account_ids = array_remove(account_ids, '654f7530-e5b5-45d7-a87a-534b2d494f4e'::uuid),
    last_message_account_id = CASE
      WHEN last_message_account_id = '654f7530-e5b5-45d7-a87a-534b2d494f4e'
        THEN 'e388e9c4-a058-4a5b-9490-8835d54a3871'::uuid
      ELSE last_message_account_id END,
    updated_at = now()
WHERE user_id = '44c78035-7cdb-4e8e-8e22-beaba931b549'
  AND ('654f7530-e5b5-45d7-a87a-534b2d494f4e'::uuid = ANY(account_ids)
       OR last_message_account_id = '654f7530-e5b5-45d7-a87a-534b2d494f4e');

-- As execuções de fluxo travadas nessa conta também precisam voltar para o número correto.
UPDATE public.flow_executions fe
SET metadata = jsonb_set(coalesce(fe.metadata,'{}'::jsonb), '{account_id}', '"e388e9c4-a058-4a5b-9490-8835d54a3871"'::jsonb),
    updated_at = now()
WHERE fe.metadata->>'account_id' = '654f7530-e5b5-45d7-a87a-534b2d494f4e'
  AND fe.lead_id IN (SELECT id FROM public.leads WHERE user_id = '44c78035-7cdb-4e8e-8e22-beaba931b549');