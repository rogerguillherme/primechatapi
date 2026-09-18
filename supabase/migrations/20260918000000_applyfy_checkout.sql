-- Link de checkout com UTM automática por vendedor + lead, via API da ApplyFy.
--
-- applyfy_credentials: chave pública/secreta da conta ApplyFy do dono (uma
-- por conta, igual ao padrão de meta_apps). applyfy_products: catálogo mínimo
-- necessário porque a ApplyFy não tem endpoint pra listar produtos — só
-- "criar/reutilizar checkout" a partir de um externalId que a gente já tem.
CREATE TABLE IF NOT EXISTS public.applyfy_credentials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  public_key   TEXT NOT NULL,
  secret_key   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.applyfy_products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  price_cents  INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_id)
);
CREATE INDEX IF NOT EXISTS applyfy_products_user_idx ON public.applyfy_products(user_id);

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['applyfy_credentials', 'applyfy_products']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);

    EXECUTE format($f$
      CREATE POLICY "applyfy equipe le" ON public.%I
        FOR SELECT TO authenticated
        USING (auth.uid() = user_id OR public.team_access_level(user_id) IS NOT NULL);
    $f$, tbl);

    EXECUTE format($f$
      CREATE POLICY "applyfy dono gerente escreve" ON public.%I
        FOR ALL TO authenticated
        USING (auth.uid() = user_id OR public.team_access_level(user_id) IN ('owner','manager'))
        WITH CHECK (auth.uid() = user_id OR public.team_access_level(user_id) IN ('owner','manager'));
    $f$, tbl);
  END LOOP;
END $$;

CREATE TRIGGER applyfy_credentials_updated_at BEFORE UPDATE ON public.applyfy_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
