import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send, CheckCheck, Inbox, Eye, XCircle, ChevronDown, ChevronUp,
  Loader2, AlertTriangle, CheckCircle2, PauseCircle, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BroadcastJob {
  id: string;
  status: string;
  total_leads: number;
  sent_count: number;
  error_count: number;
  delivered_count: number;
  read_count: number;
  last_cursor: number;
  last_error: string | null;
  pause_reason: string | null;
  error_rate: number;
  consecutive_errors: number;
  template_name: string | null;
  created_at: string;
  updated_at: string;
}

interface ErrorLog {
  id: string;
  phone: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export function BroadcastProgressFloat() {
  const { session } = useAuth();
  const [minimized, setMinimized] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showErrors, setShowErrors] = useState<string | null>(null);

  // Poll for active or recently finished jobs
  const { data: activeJobs } = useQuery({
    queryKey: ["broadcast-float-jobs"],
    queryFn: async () => {
      if (!session?.user.id) return [];
      // Get jobs from last 2 hours that are active or recently completed
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("broadcast_jobs")
        .select("id, status, total_leads, sent_count, error_count, delivered_count, read_count, last_cursor, last_error, pause_reason, error_rate, consecutive_errors, template_name, created_at, updated_at")
        .eq("user_id", session.user.id)
        .gte("created_at", twoHoursAgo)
        .in("status", ["pending", "processing", "completed", "error", "paused_by_system"])
        .order("created_at", { ascending: false })
        .limit(5);
      return (data || []) as BroadcastJob[];
    },
    // 3s só enquanto existe disparo andando. Este componente fica montado no
    // app inteiro: no ritmo fixo eram 1.200 requisições por hora, por aba,
    // mesmo sem nada acontecendo — e a barra só aparece quando há job ativo.
    refetchInterval: (query) => {
      const jobs = (query.state.data || []) as BroadcastJob[];
      const rodando = jobs.some((j) => j.status === "pending" || j.status === "processing");
      return rodando ? 3000 : 60_000;
    },
    enabled: !!session?.user.id,
  });

  // Fetch error logs for a specific job
  const { data: errorLogs } = useQuery({
    queryKey: ["broadcast-error-logs", showErrors],
    queryFn: async () => {
      if (!showErrors || !session?.user.id) return [];
      const { data } = await supabase
        .from("message_logs")
        .select("id, phone, status, error_code, error_message, created_at")
        .eq("job_id", showErrors)
        .eq("user_id", session.user.id)
        .neq("status", "sent")
        .order("created_at", { ascending: false })
        .limit(100);
      return (data || []) as ErrorLog[];
    },
    enabled: !!showErrors && !!session?.user.id,
  });

  // Realtime subscription
  useEffect(() => {
    if (!session?.user.id) return;

    const channel = supabase
      .channel("broadcast-float-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "broadcast_jobs" },
        () => {
          // Trigger refetch
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session?.user.id]);

  const visibleJobs = (activeJobs || []).filter((j) => !dismissed.has(j.id));

  if (visibleJobs.length === 0) return null;

  const hasActive = visibleJobs.some((j) => j.status === "processing" || j.status === "pending");

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "processing":
      case "pending":
        return <Loader2 size={14} className="animate-spin text-primary" />;
      case "completed":
        return <CheckCircle2 size={14} className="text-emerald-500" />;
      case "paused_by_system":
        return <PauseCircle size={14} className="text-amber-500" />;
      case "error":
        return <XCircle size={14} className="text-destructive" />;
      default:
        return <Send size={14} className="text-muted-foreground" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "processing": return "Enviando...";
      case "pending": return "Na fila";
      case "completed": return "Concluído";
      case "paused_by_system": return "Pausado";
      case "error": return "Erro";
      default: return status;
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)]">
      <div className="bg-background border rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setMinimized(!minimized)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/50 hover:bg-muted/80 transition-colors"
        >
          <div className="flex items-center gap-2">
            {hasActive ? (
              <Loader2 size={14} className="animate-spin text-primary" />
            ) : (
              <CheckCircle2 size={14} className="text-emerald-500" />
            )}
            <span className="text-xs font-semibold">
              Disparos ({visibleJobs.length})
            </span>
            {hasActive && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 animate-pulse">
                Ativo
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!hasActive && (
              <Button
                variant="ghost" size="icon" className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  setDismissed(new Set(visibleJobs.map((j) => j.id)));
                }}
              >
                <X size={12} />
              </Button>
            )}
            {minimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </button>

        {/* Content */}
        {!minimized && (
          <div className="max-h-[400px] overflow-y-auto">
            {visibleJobs.map((job) => {
              const progress = Math.min(job.last_cursor, job.total_leads);
              const percent = job.total_leads > 0 ? (progress / job.total_leads) * 100 : 0;
              const isActive = job.status === "processing" || job.status === "pending";

              return (
                <div key={job.id} className="px-4 py-3 border-t space-y-2">
                  {/* Job header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {getStatusIcon(job.status)}
                      <span className="text-xs font-medium truncate">
                        {job.template_name || "Disparo"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-muted-foreground">
                        {getStatusLabel(job.status)}
                      </span>
                      {!isActive && (
                        <Button
                          variant="ghost" size="icon" className="h-5 w-5"
                          onClick={() => setDismissed((prev) => new Set([...prev, job.id]))}
                        >
                          <X size={10} />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <Progress value={percent} className="h-2 bg-muted" />
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{progress}/{job.total_leads} ({Math.round(percent)}%)</span>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-0.5">
                          <CheckCheck size={10} className="text-amber-500" /> {job.sent_count}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Inbox size={10} className="text-emerald-500" /> {job.delivered_count}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Eye size={10} className="text-blue-500" /> {job.read_count}
                        </span>
                        {job.error_count > 0 && (
                          <span className="flex items-center gap-0.5 text-destructive">
                            <XCircle size={10} /> {job.error_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Pause reason */}
                  {job.status === "paused_by_system" && job.pause_reason && (
                    <div className="flex items-start gap-1.5 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                      <AlertTriangle size={12} className="text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-amber-700 dark:text-amber-400">{job.pause_reason}</p>
                    </div>
                  )}

                  {/* Last error */}
                  {job.last_error && (
                    <div className="flex items-start gap-1.5 p-2 rounded bg-destructive/5 border border-destructive/20">
                      <XCircle size={12} className="text-destructive shrink-0 mt-0.5" />
                      <p className="text-[10px] text-destructive truncate">{job.last_error}</p>
                    </div>
                  )}

                  {/* Error details toggle */}
                  {job.error_count > 0 && (
                    <div>
                      <button
                        onClick={() => setShowErrors(showErrors === job.id ? null : job.id)}
                        className="text-[10px] text-primary hover:underline flex items-center gap-1"
                      >
                        <AlertTriangle size={10} />
                        {showErrors === job.id ? "Ocultar erros" : `Ver ${job.error_count} erro(s)`}
                      </button>

                      {showErrors === job.id && errorLogs && errorLogs.length > 0 && (
                        <ScrollArea className="h-[120px] mt-1.5 rounded border bg-muted/30">
                          <div className="p-2 space-y-1">
                            {errorLogs.map((log) => (
                              <div key={log.id} className="flex items-start gap-1.5 text-[10px]">
                                <XCircle size={10} className="text-destructive shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                  <span className="font-mono text-muted-foreground">{log.phone}</span>
                                  {" — "}
                                  <span className={cn(
                                    log.status === "invalid_number" && "text-amber-600",
                                    log.status === "blocked" && "text-destructive",
                                    log.status === "rate_limited" && "text-orange-500",
                                    log.status === "error" && "text-destructive",
                                  )}>
                                    {log.status === "invalid_number" ? "Número inválido"
                                      : log.status === "blocked" ? "Bloqueado"
                                      : log.status === "rate_limited" ? "Rate limit"
                                      : "Erro"}
                                  </span>
                                  {log.error_message && (
                                    <p className="text-muted-foreground truncate">{log.error_message}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
