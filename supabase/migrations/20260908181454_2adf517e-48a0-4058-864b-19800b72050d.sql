CREATE OR REPLACE FUNCTION public.get_owner_chat_ai_button()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT p.chat_ai_button
      FROM public.profiles p
      WHERE p.user_id = COALESCE(
        (
          SELECT tm.owner_id
          FROM public.team_members tm
          WHERE tm.member_user_id = auth.uid()
          ORDER BY tm.created_at ASC
          LIMIT 1
        ),
        auth.uid()
      )
      LIMIT 1
    ),
    true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_owner_chat_ai_button() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_chat_ai_button() TO authenticated;