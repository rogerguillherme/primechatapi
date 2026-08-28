import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AccessLevel = "owner" | "manager" | "broadcast" | "chat" | "readonly";
export type LeadScope = "all" | "assigned";

export interface TeamContext {
  /** Account whose data should be displayed (the owner that invited the user). */
  ownerId: string;
  accessLevel: AccessLevel;
  leadScope: LeadScope;
  isOwner: boolean;
  canManageTeam: boolean;
  canEditLeads: boolean;
  canBroadcast: boolean;
}

/**
 * Resolves whether the signed-in user is an account owner or a collaborator
 * invited into someone else's account, plus the resulting permissions.
 */
export function useTeamContext() {
  const { user } = useAuth();

  return useQuery<TeamContext>({
    queryKey: ["team-context", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select("owner_id, access_level, lead_scope")
        .eq("member_user_id", user!.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return {
          ownerId: user!.id,
          accessLevel: "owner",
          leadScope: "all",
          isOwner: true,
          canManageTeam: true,
          canEditLeads: true,
          canBroadcast: true,
        };
      }

      const accessLevel = data.access_level as AccessLevel;
      return {
        ownerId: data.owner_id,
        accessLevel,
        leadScope: data.lead_scope as LeadScope,
        isOwner: false,
        canManageTeam: false,
        canEditLeads: accessLevel !== "readonly",
        canBroadcast: accessLevel === "manager" || accessLevel === "broadcast",
      };
    },
  });
}

export interface TeamMemberRow {
  id: string;
  owner_id: string;
  member_user_id: string;
  access_level: Exclude<AccessLevel, "owner">;
  lead_scope: LeadScope;
  created_at: string;
  email: string;
  display_name: string;
  last_sign_in_at: string | null;
}

async function teamFetch(action: string, method: string, body?: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Faça login novamente.");

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const res = await fetch(
    `https://${projectId}.supabase.co/functions/v1/team-members?action=${action}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );

  const text = await res.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || "Erro desconhecido" };
  }

  if (!res.ok) throw new Error(payload?.error || "Erro desconhecido");
  return payload;
}

export function useTeamMembers(enabled = true) {
  const { user } = useAuth();

  return useQuery<TeamMemberRow[]>({
    queryKey: ["team-members", user?.id],
    queryFn: () => teamFetch("list", "GET"),
    enabled: enabled && !!user,
    retry: false,
  });
}

export const teamApi = {
  create: (payload: Record<string, unknown>) => teamFetch("create", "POST", payload),
  update: (payload: Record<string, unknown>) => teamFetch("update", "PUT", payload),
  remove: (memberUserId: string) => teamFetch("delete", "DELETE", { member_user_id: memberUserId }),
};

export const ACCESS_LEVEL_LABELS: Record<Exclude<AccessLevel, "owner">, string> = {
  manager: "Gerente",
  broadcast: "Disparos",
  chat: "Somente Chat",
  readonly: "Somente leitura",
};

export const ACCESS_LEVEL_DESCRIPTIONS: Record<Exclude<AccessLevel, "owner">, string> = {
  manager: "Acesso completo, exceto gerenciar equipe e contas",
  broadcast: "Pode criar e enviar campanhas e fluxos",
  chat: "Atende conversas e movimenta leads no Kanban",
  readonly: "Apenas visualiza dados, sem editar",
};
