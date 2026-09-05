-- Credenciais do Metrito por conta. Sem linha aqui, as edge functions caem nos
-- secrets globais (METRITO_API_KEY / METRITO_PROJECT_ID / METRITO_GENERIC_KEY).
--
-- Sem política de leitura para a equipe, ao contrário de lead_distribution_settings:
-- isto guarda credencial, e colaborador não precisa enxergar a chave do dono.
CREATE TABLE public.metrito_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE,
  api_key text,
  project_id text,
  generic_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.metrito_settings TO authenticated;
GRANT ALL ON public.metrito_settings TO service_role;

ALTER TABLE public.metrito_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages metrito settings"
  ON public.metrito_settings FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER update_metrito_settings_updated_at
  BEFORE UPDATE ON public.metrito_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();