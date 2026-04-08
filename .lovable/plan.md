## Plano de Melhorias — Fase por Fase

### Fase 1: Segurança RLS (Crítico)
- Corrigir políticas RLS das tabelas `items`, `products`, `orders`, `order_items`, `product_items`, `webhook_logs`, `chat_templates`, `account_templates`, `app_settings`
- Adicionar coluna `user_id` nas tabelas que não possuem (`products`, `items`, `orders`, `chat_templates`)
- Migrar dados existentes atribuindo o `user_id` do admin atual
- Atualizar código frontend para enviar `user_id` nas inserções

### Fase 2: Funcionalidades
- Dashboard com métricas avançadas (taxa de resposta, tempo médio, funil)
- Agendamento de disparos (campo `scheduled_at` em `broadcast_jobs`)
- Exportação de relatórios CSV
- Busca global de leads/mensagens/templates

### Fase 3: UX
- Sistema de notificações em tempo real (nova tabela `notifications`)
- Proteção contra cliques duplos no frontend
- Melhorias de responsividade mobile

### Fase 4: Auditoria
- Tabela de audit logs para rastrear ações dos usuários

**Nota:** Todas as migrações preservam dados existentes usando `UPDATE` para preencher `user_id` com o usuário admin atual antes de aplicar RLS restritiva.