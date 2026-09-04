-- Rótulo de cada número (id → nome/telefone) + quantos leads entraram por
-- número hoje. Serve dois lugares: o cabeçalho da conversa (qual número está
-- falando com o lead) e o card "Novos contatos hoje" (separado por número).
--
-- Não dá pra resolver isso lendo whatsapp_accounts direto pelo client: a
-- tabela só tem RLS "dono vê o próprio" (nunca ganhou o tratamento de equipe
-- que leads/pipeline_stages já têm) e MESMO SE ganhasse, a linha carrega
-- access_token/api_key — não é coisa pra abrir pra colaborador "somente
-- chat". Uma função retornando só rótulo + contagem evita expor a
-- credencial.
CREATE OR REPLACE FUNCTION public.get_account_stats_today(p_owner_id uuid)
RETURNS TABLE(
  account_id uuid,
  name text,
  display_phone_number text,
  provider text,
  leads_today bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.team_access_level(p_owner_id) IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.display_phone_number,
    a.provider,
    count(l.id) FILTER (WHERE l.created_at >= date_trunc('day', now()))
  FROM public.whatsapp_accounts a
  LEFT JOIN public.leads l
    ON l.user_id = p_owner_id AND l.last_message_account_id = a.id
  WHERE a.user_id = p_owner_id
  GROUP BY a.id, a.name, a.display_phone_number, a.provider, a.is_default
  ORDER BY a.is_default DESC, a.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_stats_today(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_account_stats_today(uuid) TO authenticated;
