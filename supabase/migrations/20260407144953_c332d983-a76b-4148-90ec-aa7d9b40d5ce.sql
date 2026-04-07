
DELETE FROM chat_messages
WHERE id NOT IN (
  SELECT DISTINCT ON (lead_id, content, direction, date_trunc('minute', created_at)) id
  FROM chat_messages
  ORDER BY lead_id, content, direction, date_trunc('minute', created_at), created_at ASC
)
AND direction = 'outbound';
