// Ponte para a MESMA substituição de variáveis usada pelas edge functions.
//
// O motor de fluxos (servidor) e os atalhos do chat (navegador) precisam
// entender exatamente as mesmas variáveis. Quando eram duas implementações,
// `{Telefone do lead}` funcionava no fluxo e ia literal pelo atalho — o cliente
// recebia o placeholder dentro do link de checkout.
//
// A implementação vive em supabase/functions/_shared porque edge function não
// consegue importar de src/; o caminho contrário funciona.
import { interpolate as run } from "../../supabase/functions/_shared/interpolate.mjs";

export interface LeadLike {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Mapa de variáveis de um lead, espelhando o buildVars do servidor. */
export function leadVars(lead: LeadLike | null | undefined): Record<string, string> {
  const fullName = (lead?.name || "").trim();
  const firstName = fullName.split(" ")[0] || "";
  const phone = lead?.phone || "";
  const vars: Record<string, string> = {
    nome: firstName,
    name: firstName,
    primeiro_nome: firstName,
    nome_completo: fullName,
    full_name: fullName,
    telefone: phone,
    phone,
    email: lead?.email || "",
  };
  for (const [k, v] of Object.entries(lead?.metadata || {})) {
    if (vars[k] === undefined && v != null && typeof v !== "object") vars[k] = String(v);
  }
  return vars;
}

export function interpolate(text: string, vars: Record<string, string>): string {
  return run(text, vars) as string;
}

/** Atalho para o caso comum: resolver o texto contra um lead. */
export function interpolateForLead(text: string, lead: LeadLike | null | undefined): string {
  return interpolate(text, leadVars(lead));
}
