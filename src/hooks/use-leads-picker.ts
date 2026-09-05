import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PickerLead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
}

/**
 * Lista de leads para escolher destinatário (disparo, rastreio, seleção).
 *
 * Existia declarada três vezes, em dois arquivos e sob duas chaves diferentes:
 * a mesma consulta ia à rede duas vezes por carregamento da tela principal, e
 * qualquer ajuste em uma cópia deixava as outras para trás. Uma definição só,
 * uma chave só — as invalidações que já existiam continuam valendo.
 */
export const LEADS_PICKER_KEY = ["broadcast-leads"] as const;

export function useLeadsPicker() {
  return useQuery<PickerLead[]>({
    queryKey: LEADS_PICKER_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, name, phone, email, photo_url")
        .order("name")
        .limit(10000);
      if (error) throw error;
      return (data || []) as PickerLead[];
    },
    // A lista muda pouco e é grande: revalidar a cada foco custava caro sem
    // trazer informação nova.
    staleTime: 5 * 60_000,
  });
}
