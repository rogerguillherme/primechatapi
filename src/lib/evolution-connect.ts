// Conexão Evolution API compartilhada entre o Prime Chat (aba Configuração)
// e o Prime Group (tela de conectar) — duplicar isso nos dois lugares faria
// uma correção (ex: heurística de QR, backoff) valer só de um lado.
import QRCodeLib from "qrcode";
import { supabase } from "@/integrations/supabase/client";

export async function resolveQrToDataUrl(raw: string): Promise<string> {
  const value = raw.trim();
  if (value.startsWith("data:image")) return value;
  // Heurística: base64 PNG puro costuma começar com "iVBOR"
  if (/^[A-Za-z0-9+/=]+$/.test(value) && value.length > 200 && value.startsWith("iVBOR")) {
    return `data:image/png;base64,${value}`;
  }
  // Caso contrário, tratamos como payload do QR e geramos a imagem localmente
  return await QRCodeLib.toDataURL(value, { width: 320, margin: 1 });
}

export function normalizePairingCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim();
  // Evolution às vezes devolve o payload bruto do QR em "code"; isso não é código de pareamento.
  if (!code || code.length > 32 || code.includes("@") || code.includes(",")) return null;
  return code;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const isTransientEvolutionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /503|temporarily unavailable|failed to fetch|edge runtime/i.test(message);
};

export const invokeEvolutionInstance = async (body: Record<string, unknown>, retries = 4) => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { data, error } = await supabase.functions.invoke("evolution-instance", { body });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      return data;
    } catch (error) {
      lastError = error;
      if (!isTransientEvolutionError(error) || attempt === retries) break;
      // Exponential backoff: 1s, 2s, 4s, 8s — handles edge runtime cold starts
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha temporária ao acessar a conexão WhatsApp.");
};
