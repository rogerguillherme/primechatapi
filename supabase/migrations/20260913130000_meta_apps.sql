-- App Meta próprio por conta — bypassa a revisão da Meta (Advanced Access de
-- whatsapp_business_management) que hoje só libera as WABAs dos dois apps
-- fixos do Prime ("Prime" e "CRM"). Cada dono cadastra o App ID/Secret do
-- PRÓPRIO app Meta e o OAuth passa a usar essas credenciais: como é o app do
-- próprio dono acessando a própria WABA, não depende de revisão nenhuma.
--
-- app_secret nunca é lido pelo navegador — só as funções (service role)
-- trocam código por token e assinam o state. GRANT por coluna em vez de
-- policy, mesmo problema que metrik-credentials resolve: dar SELECT à tabela
-- inteira devolveria o segredo pra tela que só precisa saber "configurado ou
-- não" (mesmo padrão do metrics_settings.applyfy_configured_at).
CREATE TABLE public.meta_apps (
  owner_id uuid PRIMARY KEY,
  app_id text NOT NULL,
  app_secret text NOT NULL,
  configured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_apps ENABLE ROW LEVEL SECURITY;

-- Sem policy de INSERT/UPDATE/DELETE para 'authenticated': com RLS ligado e
-- nenhuma policy pra essas ações, ficam bloqueadas por padrão — só a função
-- (service role) grava.
CREATE POLICY "Equipe ve se o app esta configurado" ON public.meta_apps
  FOR SELECT TO authenticated
  USING (public.team_access_level(owner_id) IS NOT NULL);

REVOKE SELECT ON public.meta_apps FROM authenticated;
GRANT SELECT (owner_id, app_id, configured_at, updated_at) ON public.meta_apps TO authenticated;
GRANT ALL ON public.meta_apps TO service_role;
