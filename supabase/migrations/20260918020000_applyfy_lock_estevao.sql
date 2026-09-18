-- O módulo de checkout ApplyFy ainda não é recurso geral do Prime Chat — só
-- a conta do Estevao pediu e usa por enquanto. Restringe a RLS a esse
-- user_id específico: nenhuma outra conta consegue ler nem escrever nas
-- tabelas applyfy_*, mesmo chamando a API direto sem passar pela UI.
DO $$
DECLARE
  tbl TEXT;
  dono UUID := '44c78035-7cdb-4e8e-8e22-beaba931b549';
BEGIN
  FOREACH tbl IN ARRAY ARRAY['applyfy_credentials', 'applyfy_products']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "applyfy equipe le" ON public.%I;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "applyfy dono gerente escreve" ON public.%I;', tbl);

    EXECUTE format($f$
      CREATE POLICY "applyfy equipe le" ON public.%I
        FOR SELECT TO authenticated
        USING (user_id = %L AND (auth.uid() = user_id OR public.team_access_level(user_id) IS NOT NULL));
    $f$, tbl, dono);

    EXECUTE format($f$
      CREATE POLICY "applyfy dono gerente escreve" ON public.%I
        FOR ALL TO authenticated
        USING (user_id = %L AND (auth.uid() = user_id OR public.team_access_level(user_id) IN ('owner','manager')))
        WITH CHECK (user_id = %L AND (auth.uid() = user_id OR public.team_access_level(user_id) IN ('owner','manager')));
    $f$, tbl, dono, dono);
  END LOOP;

  EXECUTE 'DROP POLICY IF EXISTS "applyfy sales equipe le" ON public.applyfy_sales;';
  EXECUTE format($f$
    CREATE POLICY "applyfy sales equipe le" ON public.applyfy_sales
      FOR SELECT TO authenticated
      USING (user_id = %L AND (auth.uid() = user_id OR public.team_access_level(user_id) IS NOT NULL));
  $f$, dono);
END $$;
