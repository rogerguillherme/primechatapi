-- Notificações de lead: para o dono da conta e para o vendedor responsável.
--
-- A tabela `notifications` e o sino já existiam, mas nada gerava aviso de
-- lead novo ou mensagem recebida. Aqui entram os gatilhos, a preferência de
-- cada usuário e a proteção contra enxurrada.

-- ── Preferência por usuário ──
CREATE TABLE public.notification_prefs (
  user_id uuid PRIMARY KEY,
  new_lead boolean NOT NULL DEFAULT true,
  new_message boolean NOT NULL DEFAULT true,
  assigned_to_me boolean NOT NULL DEFAULT true,
  sound boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_prefs TO authenticated;
GRANT ALL ON public.notification_prefs TO service_role;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own notification prefs"
  ON public.notification_prefs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_notification_prefs_updated_at
  BEFORE UPDATE ON public.notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Referência ao lead na notificação ──
-- Sem ela não dá para deduplicar por conversa nem levar o clique ao lugar certo.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS lead_id uuid;

-- Dedupe e a consulta do sino passam por aqui.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON public.notifications (user_id, lead_id, type) WHERE read = false;

-- ── Emissor único ──
--
-- Respeita a preferência do destinatário e não empilha aviso repetido: se já
-- existe um não lido do mesmo tipo para a mesma conversa, atualiza o horário
-- em vez de criar outro. Com 4 mil mensagens por dia, uma linha por mensagem
-- entupiria o sino e a tabela.
CREATE OR REPLACE FUNCTION public.notify_lead_event(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_lead_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed boolean;
  v_existing uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  -- Sem linha de preferência = tudo ligado (padrão da tabela).
  SELECT CASE p_type
    WHEN 'new_lead'       THEN coalesce(np.new_lead, true)
    WHEN 'new_message'    THEN coalesce(np.new_message, true)
    WHEN 'assigned_to_me' THEN coalesce(np.assigned_to_me, true)
    ELSE true
  END INTO v_allowed
  FROM (SELECT 1) AS _
  LEFT JOIN public.notification_prefs np ON np.user_id = p_user_id;

  IF v_allowed IS FALSE THEN RETURN; END IF;

  SELECT id INTO v_existing
  FROM public.notifications
  WHERE user_id = p_user_id AND lead_id = p_lead_id AND type = p_type AND read = false
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.notifications
      SET created_at = now(), title = p_title, message = p_message
      WHERE id = v_existing;
    RETURN;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, lead_id, link)
    VALUES (p_user_id, p_type, p_title, p_message, p_lead_id, '/');
END;
$$;

-- ── Lead novo: avisa o dono da conta ──
CREATE OR REPLACE FUNCTION public.notify_on_new_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.notify_lead_event(
    NEW.user_id, 'new_lead', 'Novo lead',
    coalesce(NEW.name, NEW.phone, 'Contato sem nome'), NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_new_lead
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_lead();

-- ── Lead atribuído: avisa o vendedor que recebeu ──
CREATE OR REPLACE FUNCTION public.notify_on_lead_assigned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     -- Quem se atribui sozinho não precisa ser avisado disso.
     AND NEW.assigned_to <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  THEN
    PERFORM public.notify_lead_event(
      NEW.assigned_to, 'assigned_to_me', 'Lead atribuído a você',
      coalesce(NEW.name, NEW.phone, 'Contato sem nome'), NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_lead_assigned
  AFTER UPDATE OF assigned_to ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_lead_assigned();

-- ── Mensagem recebida: avisa quem atende ──
-- Vai para o responsável; sem responsável, para o dono da conta. Notificar os
-- dois faria o dono receber tudo o que a equipe já está atendendo.
CREATE OR REPLACE FUNCTION public.notify_on_inbound_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid; v_assigned uuid; v_name text;
BEGIN
  IF NEW.direction <> 'inbound' THEN RETURN NEW; END IF;

  SELECT l.user_id, l.assigned_to, coalesce(l.name, l.phone)
    INTO v_owner, v_assigned, v_name
    FROM public.leads l WHERE l.id = NEW.lead_id;

  PERFORM public.notify_lead_event(
    coalesce(v_assigned, v_owner), 'new_message',
    'Nova mensagem', coalesce(v_name, 'Contato'), NEW.lead_id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_inbound_message
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_inbound_message();