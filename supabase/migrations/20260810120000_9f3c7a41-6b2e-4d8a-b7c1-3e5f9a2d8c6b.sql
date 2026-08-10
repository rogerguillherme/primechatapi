-- Incremento atômico dos contadores de broadcast_jobs. O código anterior fazia
-- select delivered_count/read_count/error_count e depois um update com o valor
-- +1 calculado na aplicação — sob concorrência (vários status da Meta chegando
-- juntos num disparo em massa) isso perde incrementos (lost update). Um único
-- UPDATE ... SET col = col + N é atômico no Postgres e resolve a race.
CREATE OR REPLACE FUNCTION public.increment_broadcast_job_counters(
  p_job_id uuid,
  p_delivered integer DEFAULT 0,
  p_read integer DEFAULT 0,
  p_errors integer DEFAULT 0
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.broadcast_jobs
  SET delivered_count = COALESCE(delivered_count, 0) + p_delivered,
      read_count = COALESCE(read_count, 0) + p_read,
      error_count = COALESCE(error_count, 0) + p_errors,
      updated_at = now()
  WHERE id = p_job_id;
$$;

REVOKE ALL ON FUNCTION public.increment_broadcast_job_counters(uuid, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_broadcast_job_counters(uuid, integer, integer, integer) TO authenticated, service_role;
