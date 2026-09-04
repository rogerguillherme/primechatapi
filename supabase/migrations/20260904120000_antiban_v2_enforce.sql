-- Liga o anti-ban v2 de vez: até aqui o pre-flight de disparo (score de spam do
-- template + histórico de bloqueio/denúncia da campanha) só auditava em
-- audit_logs e deixava passar na velocidade normal, mesmo quando classificava
-- como risco crítico. Nasceu em 'shadow' em 27/05 e nunca foi ligado.
UPDATE public.app_settings
SET value = 'enforce', updated_at = now()
WHERE key = 'antiban_v2_enforce_mode';
