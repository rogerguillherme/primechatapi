// Saúde das contas de WhatsApp, de todos os clientes, para o admin.
//
// Os sinais que antecedem um banimento já existiam espalhados: a nota de
// qualidade vive na Meta e só aparecia se o cliente abrisse a própria tela de
// limites; a taxa de falha vive em chat_messages e ninguém somava; o bloqueio
// da conta agora fica em whatsapp_accounts. Nenhum deles chegava a quem podia
// agir. Aqui eles viram uma lista só, ordenada por gravidade.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ADMIN_EMAIL = "admin@primechat.com";

// ponytail: uma consulta de contagem por conta, sem agregação no banco. Com
// dezenas de contas é barato; passando de algumas centenas, vale trocar por uma
// função SQL que agrupe de uma vez.
const MAX_CONTAS = 60;

type Nivel = "critico" | "alto" | "medio";

interface Aviso {
  account_id: string;
  conta: string;
  dono: string | null;
  nivel: Nivel;
  titulo: string;
  detalhe: string;
  quality_rating?: string | null;
  tier?: string | null;
  enviadas_24h?: number;
  falhas_24h?: number;
}

const PESO: Record<Nivel, number> = { critico: 0, alto: 1, medio: 2 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Mesma porta do admin-users: o e-mail sai do JWT verificado, nunca do corpo.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("authorization") || "" } },
    });
    const { data: { user: caller } } = await userClient.auth.getUser();
    if (!caller) return json({ error: "Não autenticado" }, 401);
    if (caller.email !== ADMIN_EMAIL) return json({ error: "Acesso restrito" }, 403);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: contas } = await admin
      .from("whatsapp_accounts")
      .select("id, name, user_id, provider, phone_number_id, access_token, blocked_at, blocked_reason")
      .limit(MAX_CONTAS);

    const lista = contas || [];
    const emailPorDono = new Map<string, string>();
    const { data: listados } = await admin.auth.admin
      .listUsers({ page: 1, perPage: 1000 })
      .catch(() => ({ data: null }) as any);
    for (const u of listados?.users || []) emailPorDono.set(u.id, u.email || u.id);

    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const avisos: Aviso[] = [];

    for (const acc of lista) {
      const nome = acc.name || acc.phone_number_id || acc.id;
      const dono = emailPorDono.get(acc.user_id) || acc.user_id || null;
      const base = { account_id: acc.id, conta: nome, dono };

      // ── 1. Bloqueio já confirmado pela Meta ──
      if (acc.blocked_at) {
        avisos.push({
          ...base,
          nivel: "critico",
          titulo: "Conta bloqueada pela Meta",
          detalhe: acc.blocked_reason || "A Meta recusou o envio por bloqueio da conta.",
        });
      }

      // ── 2. Nota de qualidade e faixa de envio, direto da Meta ──
      let quality: string | null = null;
      let tier: string | null = null;
      if (acc.provider !== "evolution" && acc.phone_number_id && acc.access_token) {
        try {
          const res = await fetch(
            `https://graph.facebook.com/v21.0/${acc.phone_number_id}` +
            `?fields=messaging_limit_tier,quality_rating`,
            { headers: { Authorization: `Bearer ${acc.access_token}` } },
          );
          const d = await res.json().catch(() => null);
          quality = d?.quality_rating ?? null;
          tier = d?.messaging_limit_tier ?? null;
        } catch {
          /* Meta fora do ar não é motivo para esconder os outros sinais */
        }
      }

      const q = String(quality || "").toUpperCase();
      if (q === "RED") {
        avisos.push({
          ...base,
          nivel: "critico",
          titulo: "Qualidade vermelha na Meta",
          detalhe:
            "Vermelho é o último degrau antes da restrição. Pare os disparos desta conta agora e " +
            "reveja conteúdo e origem das listas.",
          quality_rating: quality,
          tier,
        });
      } else if (q === "YELLOW") {
        avisos.push({
          ...base,
          nivel: "alto",
          titulo: "Qualidade amarela na Meta",
          detalhe:
            "Amarelo significa que destinatários estão bloqueando ou denunciando. Reduza o volume " +
            "antes que caia para vermelho.",
          quality_rating: quality,
          tier,
        });
      }

      // ── 3. Taxa de falha das últimas 24h, calculada aqui ──
      const contar = async (extra: (q: any) => any) => {
        const { count } = await extra(
          admin
            .from("chat_messages")
            .select("id", { count: "exact", head: true })
            .eq("account_id", acc.id)
            .eq("direction", "outbound")
            .gte("created_at", desde),
        );
        return count ?? 0;
      };

      const enviadas = await contar((q: any) => q);
      const falhas = await contar((q: any) => q.eq("status", "failed"));

      // Abaixo de 20 envios qualquer porcentagem é ruído.
      if (enviadas >= 20) {
        const taxa = (falhas / enviadas) * 100;
        if (taxa >= 20) {
          avisos.push({
            ...base,
            nivel: "critico",
            titulo: `${taxa.toFixed(0)}% das mensagens falharam nas últimas 24h`,
            detalhe:
              `${falhas} de ${enviadas} não foram entregues. Entrega falhada é o que a Meta usa ` +
              `para medir qualidade — cada uma conta contra a conta.`,
            enviadas_24h: enviadas,
            falhas_24h: falhas,
          });
        } else if (taxa >= 10) {
          avisos.push({
            ...base,
            nivel: "alto",
            titulo: `${taxa.toFixed(0)}% de falha nas últimas 24h`,
            detalhe: `${falhas} de ${enviadas} não foram entregues. Vale olhar antes que piore.`,
            enviadas_24h: enviadas,
            falhas_24h: falhas,
          });
        }
      }
    }

    avisos.sort((a, b) => PESO[a.nivel] - PESO[b.nivel]);

    return json({
      avisos,
      contas_verificadas: lista.length,
      verificado_em: new Date().toISOString(),
    });
  } catch (e) {
    console.error("admin-account-health:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
