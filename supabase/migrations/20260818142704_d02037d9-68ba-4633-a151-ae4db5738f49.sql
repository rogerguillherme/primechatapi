WITH q AS (
  SELECT fe.id, fe.lead_id, regexp_replace(l.phone,'\D','','g') p,
         row_number() OVER (PARTITION BY regexp_replace(l.phone,'\D','','g') ORDER BY fe.id) rn
  FROM flow_executions fe
  JOIN leads l ON l.id = fe.lead_id
  WHERE fe.flow_id='0a665c60-fec6-42ad-ae9b-66cc4510b1b9'
    AND fe.status='waiting_delay'
    AND fe.metadata->>'requeue_reason'='reenvio_erros_listas_1708'
)
DELETE FROM flow_executions fe USING q WHERE fe.id=q.id AND q.rn > 1;

-- reescalona os restantes em cadência de 150s a partir do fim da fila atual
WITH r AS (
  SELECT id, row_number() OVER (ORDER BY id) rn
  FROM flow_executions
  WHERE flow_id='0a665c60-fec6-42ad-ae9b-66cc4510b1b9'
    AND status='waiting_delay'
    AND metadata->>'requeue_reason'='reenvio_erros_listas_1708'
)
UPDATE flow_executions fe
SET next_action_at = timestamptz '2026-08-19 03:12:00+00' + (r.rn * interval '150 seconds')
FROM r WHERE fe.id = r.id;