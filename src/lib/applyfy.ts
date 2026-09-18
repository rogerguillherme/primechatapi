// O módulo de checkout ApplyFy (link com UTM + dashboard de vendas) ainda não
// é recurso geral do Prime Chat — só a conta do Estevao pediu e usa. A trava
// de dados de verdade é RLS (só esse user_id consegue ler/escrever nas
// tabelas applyfy_*); esta constante só evita mostrar telas que dariam vazio
// pra qualquer outra conta. Remover esta trava (e a de RLS) quando o recurso
// virar geral.
export const APPLYFY_ACCOUNT_ID = "44c78035-7cdb-4e8e-8e22-beaba931b549";
