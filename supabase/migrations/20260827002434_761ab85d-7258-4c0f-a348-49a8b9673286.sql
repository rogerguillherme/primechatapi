-- Etiqueta com coluna do Kanban associada.
-- "Ao aplicar esta etiqueta, mover o lead para esta coluna". NULL = sem efeito.

ALTER TABLE public.chat_labels
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;

-- Regra única para front e backend: quem insere em lead_labels não precisa
-- saber nada sobre Kanban. Vale para o chat, o ContactInfoSheet e a atribuição
-- de link de compartilhamento feita no whatsapp-cloud-webhook.
-- Remover a etiqueta NÃO desfaz o movimento (proposital).
CREATE OR REPLACE FUNCTION public.apply_label_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage uuid;
BEGIN
  SELECT stage_id INTO v_stage FROM public.chat_labels WHERE id = NEW.label_id;
  IF v_stage IS NULL THEN
    RETURN NEW;
  END IF;

  -- A função é SECURITY DEFINER: confere explicitamente que a coluna pertence
  -- ao mesmo dono do lead antes de escrever.
  UPDATE public.leads l
     SET stage_id = v_stage
   WHERE l.id = NEW.lead_id
     AND l.stage_id IS DISTINCT FROM v_stage
     AND EXISTS (
       SELECT 1 FROM public.pipeline_stages s
        WHERE s.id = v_stage AND s.owner_id = l.user_id
     );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_label_stage ON public.lead_labels;
CREATE TRIGGER trg_apply_label_stage
  AFTER INSERT ON public.lead_labels
  FOR EACH ROW EXECUTE FUNCTION public.apply_label_stage();

REVOKE ALL ON FUNCTION public.apply_label_stage() FROM anon, authenticated, public;