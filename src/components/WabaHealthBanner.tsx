import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ShieldAlert, X, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

type Severity = "critical" | "warning" | "info";

interface HealthEvent {
  id: string;
  event_code: string;
  event_title: string;
  event_message: string | null;
  severity: Severity;
  meta_error_code: string | null;
  created_at: string;
  account_id: string;
}

const severityStyle: Record<Severity, string> = {
  critical: "bg-destructive/10 border-destructive/40 text-destructive-foreground",
  warning: "bg-warning/10 border-warning/40 text-foreground",
  info: "bg-primary/10 border-primary/30 text-foreground",
};

export function WabaHealthBanner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: events = [] } = useQuery({
    queryKey: ["waba-health-events", user?.id],
    queryFn: async () => {
      if (!user) return [] as HealthEvent[];
      const { data } = await supabase
        .from("waba_health_events")
        .select("id, event_code, event_title, event_message, severity, meta_error_code, created_at, account_id")
        .eq("user_id", user.id)
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(5);
      return (data || []) as HealthEvent[];
    },
    enabled: !!user,
    refetchInterval: 30_000,
  });

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`waba-health-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "waba_health_events", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["waba-health-events", user.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, qc]);

  if (!events.length) return null;

  // Most severe first
  const event = events.find((e) => e.severity === "critical") || events[0];

  const dismiss = async () => {
    await supabase
      .from("waba_health_events")
      .update({ resolved_at: new Date().toISOString() })
      .eq("id", event.id);
    qc.invalidateQueries({ queryKey: ["waba-health-events", user?.id] });
  };

  return (
    <div
      className={cn(
        "w-full border-b px-4 sm:px-6 lg:px-8 py-3 flex items-start gap-3 text-sm",
        severityStyle[event.severity],
      )}
      role="alert"
    >
      {event.severity === "critical" ? (
        <ShieldAlert className="shrink-0 mt-0.5" size={18} />
      ) : (
        <AlertTriangle className="shrink-0 mt-0.5" size={18} />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-semibold leading-tight">{event.event_title}</p>
        {event.event_message && (
          <p className="text-xs opacity-90 mt-0.5 leading-snug">{event.event_message}</p>
        )}
        {events.length > 1 && (
          <p className="text-[11px] opacity-70 mt-1">
            +{events.length - 1} outro(s) evento(s) ativo(s)
          </p>
        )}
      </div>
      <button
        onClick={() => navigate("/whatsapp/health")}
        className="shrink-0 inline-flex items-center gap-1 text-xs font-medium hover:underline whitespace-nowrap"
      >
        Ver diagnóstico <ArrowRight size={12} />
      </button>
      <button
        onClick={dismiss}
        className="shrink-0 opacity-60 hover:opacity-100"
        title="Dispensar"
      >
        <X size={16} />
      </button>
    </div>
  );
}
