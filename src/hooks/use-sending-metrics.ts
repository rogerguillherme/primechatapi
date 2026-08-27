import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  aggregateByAccount,
  aggregateBySource,
  type OriginTotals,
  type SourceMetricRow,
} from "@/lib/sendingMetrics";

/**
 * Métricas de disparo vindas prontas do Postgres.
 *
 * Antes o front buscava linhas de campaign_events / flow_executions /
 * chat_messages e somava em JavaScript. O PostgREST devolve no máximo 1.000
 * linhas por requisição, então a soma parava no milésimo evento sem erro
 * nenhum. Agora quem soma é o banco — o que chega aqui são dezenas de linhas.
 */

// As RPCs são novas e ainda não estão em src/integrations/supabase/types.ts
// (gerado pelo Lovable). O cast evita depender da regeneração dos tipos.
const rpc = supabase.rpc as unknown as (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: unknown }>;

export interface BroadcastProgressRow {
  job_id: string;
  campaign_name: string | null;
  template_name: string | null;
  status: string | null;
  created_at: string;
  updated_at: string | null;
  audience: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  pending: number;
  /** contador gravado em broadcast_jobs — só para mostrar divergência */
  job_delivered: number;
  job_read: number;
}

export interface FlowProgressRow {
  flow_id: string;
  flow_name: string;
  batch_started_at: string;
  last_activity: string | null;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
}

export interface SendingMetricsBySource {
  bySource: OriginTotals[];
  byAccount: Map<string, OriginTotals[]>;
}

export function useSendingMetricsBySource(since?: Date, until?: Date) {
  const { user } = useAuth();

  return useQuery<SendingMetricsBySource>({
    queryKey: [
      "sending-metrics-by-source",
      user?.id,
      since?.toISOString() ?? "all",
      until?.toISOString() ?? "all",
    ],
    enabled: !!user,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await rpc("get_sending_metrics_by_source", {
        p_since: since?.toISOString() ?? null,
        p_until: until?.toISOString() ?? null,
      });
      if (error) throw error;
      const rows = (data as SourceMetricRow[]) || [];
      return { bySource: aggregateBySource(rows), byAccount: aggregateByAccount(rows) };
    },
  });
}

export function useBroadcastProgress(since?: Date, limit = 200) {
  const { user } = useAuth();

  return useQuery<BroadcastProgressRow[]>({
    queryKey: ["broadcast-progress", user?.id, since?.toISOString() ?? "all", limit],
    enabled: !!user,
    staleTime: 4_000,
    placeholderData: (prev) => prev,
    refetchInterval: (q) => {
      const rows = (q.state.data as BroadcastProgressRow[] | undefined) || [];
      return rows.some((r) => r.pending > 0) ? 5_000 : 30_000;
    },
    queryFn: async () => {
      const { data, error } = await rpc("get_broadcast_progress", {
        p_since: since?.toISOString() ?? null,
        p_limit: limit,
      });
      if (error) throw error;
      return (data as BroadcastProgressRow[]) || [];
    },
  });
}

export function useFlowProgress(since?: Date, limit = 200) {
  const { user } = useAuth();

  return useQuery<FlowProgressRow[]>({
    queryKey: ["flow-progress", user?.id, since?.toISOString() ?? "all", limit],
    enabled: !!user,
    staleTime: 4_000,
    placeholderData: (prev) => prev,
    refetchInterval: (q) => {
      const rows = (q.state.data as FlowProgressRow[] | undefined) || [];
      return rows.some((r) => r.pending > 0) ? 5_000 : 30_000;
    },
    queryFn: async () => {
      const { data, error } = await rpc("get_flow_progress", {
        p_since: since?.toISOString() ?? null,
        p_gap_minutes: 30,
        p_limit: limit,
      });
      if (error) throw error;
      return (data as FlowProgressRow[]) || [];
    },
  });
}
