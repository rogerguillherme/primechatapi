-- Grupos WhatsApp sincronizados via Evolution API — primeira fatia portada do
-- Group Flow Hub (produto separado, conta MenopausaC) pro Prime Chat: só
-- sincronização + dashboard, sem comunidades/distribuição ainda.
--
-- Reaproveita a conexão que já existe em whatsapp_accounts (provider =
-- 'evolution') em vez de criar um conceito de "instância" paralelo.

ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS groups_synced_at timestamptz;

CREATE TABLE public.whatsapp_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  participants_count INT NOT NULL DEFAULT 0,
  admins_count INT NOT NULL DEFAULT 0,
  invite_link TEXT,
  group_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, group_jid)
);

CREATE INDEX whatsapp_groups_account_id_idx ON public.whatsapp_groups(account_id);
CREATE INDEX whatsapp_groups_user_id_idx ON public.whatsapp_groups(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_groups TO authenticated;
GRANT ALL ON public.whatsapp_groups TO service_role;
ALTER TABLE public.whatsapp_groups ENABLE ROW LEVEL SECURITY;

-- Ver: dono e qualquer membro da equipe — não é dado sensível de cliente
-- individual, mesmo padrão amplo de leitura usado em orders/leads.
CREATE POLICY "Equipe ve os grupos da conta" ON public.whatsapp_groups
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.team_access_level(user_id) IS NOT NULL
  );

-- Sincronizar/editar/remover: só dono e gerente — mesmo grupo que já pode
-- mexer na conexão WhatsApp em si (whatsapp_accounts).
CREATE POLICY "Dono e gerente sincronizam grupos" ON public.whatsapp_groups
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR public.team_access_level(user_id) IN ('owner', 'manager')
  );

CREATE POLICY "Dono e gerente atualizam grupos" ON public.whatsapp_groups
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.team_access_level(user_id) IN ('owner', 'manager')
  )
  WITH CHECK (
    auth.uid() = user_id
    OR public.team_access_level(user_id) IN ('owner', 'manager')
  );

CREATE POLICY "Dono e gerente removem grupos" ON public.whatsapp_groups
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.team_access_level(user_id) IN ('owner', 'manager')
  );

CREATE TRIGGER whatsapp_groups_updated_at BEFORE UPDATE ON public.whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
