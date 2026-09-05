
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS TABLE (
  total_leads BIGINT,
  total_orders BIGINT,
  approved_revenue NUMERIC,
  total_products BIGINT,
  expiring_soon_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH latest_approved AS (
    SELECT DISTINCT ON (lead_id) lead_id, created_at
    FROM orders
    WHERE status = 'approved'
    ORDER BY lead_id, created_at DESC
  )
  SELECT
    (SELECT count(*) FROM leads) as total_leads,
    (SELECT count(*) FROM orders) as total_orders,
    (SELECT coalesce(sum(amount), 0) FROM orders WHERE status = 'approved') as approved_revenue,
    (SELECT count(*) FROM products) as total_products,
    (SELECT count(*) FROM latest_approved WHERE (created_at + interval '1 month') - now() <= interval '15 days') as expiring_soon_count;
$$;
