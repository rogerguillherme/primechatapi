
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
 RETURNS TABLE(total_leads bigint, total_orders bigint, approved_revenue numeric, total_products bigint, expiring_soon_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  WITH main_orders AS (
    SELECT * FROM orders 
    WHERE external_order_id NOT LIKE '%-offer%' 
      AND external_order_id NOT LIKE '%-tester%'
  ),
  latest_approved AS (
    SELECT DISTINCT ON (lead_id) lead_id, created_at
    FROM main_orders
    WHERE status = 'approved'
    ORDER BY lead_id, created_at DESC
  )
  SELECT
    (SELECT count(*) FROM leads) as total_leads,
    (SELECT count(*) FROM main_orders WHERE status = 'approved') as total_orders,
    (SELECT coalesce(
      sum(
        coalesce(
          (SELECT (r->>'totalCents')::numeric / 100 
           FROM jsonb_array_elements(webhook_payload->'event'->'invoice'->'receivers') r 
           WHERE r->>'role' = 'seller'),
          amount
        )
      ), 0) 
    FROM main_orders WHERE status = 'approved') as approved_revenue,
    (SELECT count(*) FROM products) as total_products,
    (SELECT count(*) FROM latest_approved WHERE (created_at + interval '1 month') - now() <= interval '15 days') as expiring_soon_count;
$$;
