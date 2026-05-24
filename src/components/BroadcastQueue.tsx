import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Send, Search, ArrowLeft, Trash2, Plus, CheckCircle2,
  AlertCircle, Loader2, ChevronDown, ChevronUp, Upload,
  Inbox, Eye, CheckCheck, XCircle, Shield, Shuffle, Flame,
  PauseCircle, AlertTriangle, BarChart3, CalendarClock,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import * as XLSX from "xlsx";

/* ── helpers ── */
function getAvatarColor(name: string) {
  const colors = ["bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-rose-600", "bg-cyan-600", "bg-indigo-600"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/* ── types ── */
interface QueueItem {
  id: string;
  accountId: string;
  templateId: string;
  leadSource: "manual" | "last_broadcast";
  selectedLeadIds: Set<string>;
  customParams: Record<number, string>;
  status: "pending" | "sending" | "done" | "error";
  jobId?: string;
  // Smart sending options
  warmupMode: boolean;
  warmupDailyLimit: number;
  shuffleLeads: boolean;
  multiNumber: boolean;
  extraAccountIds: string[];
  // Timing controls
  delayMinSeconds: number;
  delayMaxSeconds: number;
  messagesPerSecond: number;
  // Scheduling
  scheduledAt: string;
}

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
  created_at: string;
  updated_at: string;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export function BroadcastQueue() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { accounts, defaultAccount } = useWhatsAppAccounts();

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [activeJobs, setActiveJobs] = useState<Record<string, BroadcastJob>>({});

  const { data: leads } = useQuery({
    queryKey: ["broadcast-leads"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, name, phone, email, photo_url")
        .order("name")
        .limit(10000);
      return data || [];
    },
  });

  const { templates } = useUserTemplates();

  const { data: accountTemplates } = useQuery({
    queryKey: ["account-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("account_templates").select("*");
      return (data || []) as { id: string; account_id: string; template_id: string }[];
    },
  });

  // Subscribe to realtime updates on broadcast_jobs
  useEffect(() => {
    const jobIds = Object.keys(activeJobs);
    if (jobIds.length === 0) return;

    const channel = supabase
      .channel("broadcast-jobs-progress")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "broadcast_jobs" },
        (payload) => {
          const updated = payload.new as any;
          setActiveJobs((prev) => {
            if (!prev[updated.id]) return prev;
            return { ...prev, [updated.id]: updated };
          });

          // Update queue item status based on job status
          if (updated.status === "completed" || updated.status === "error" || updated.status === "paused_by_system") {
            setQueue((prev) =>
              prev.map((item) => {
                if (item.jobId !== updated.id) return item;
                return {
                  ...item,
                  status: updated.status === "completed" ? "done" : "error",
                };
              })
            );

            // Alert user on pause
            if (updated.status === "paused_by_system") {
              toast.warning(`Campanha pausada: ${updated.pause_reason || "Proteção anti-ban ativada"}`, { duration: 10000 });
            }
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [Object.keys(activeJobs).join(",")]);

  // Also poll for delivery/read counts on active jobs
  useEffect(() => {
    const processingJobs = Object.values(activeJobs).filter(
      (j) => j.status === "processing" || j.status === "pending"
    );
    if (processingJobs.length === 0) return;

    const interval = setInterval(async () => {
      for (const job of processingJobs) {
        const { data } = await supabase
          .from("broadcast_jobs")
          .select("*")
          .eq("id", job.id)
          .maybeSingle();
        if (data) {
          setActiveJobs((prev) => ({ ...prev, [data.id]: data as BroadcastJob }));
          if (data.status === "completed" || data.status === "error" || data.status === "paused_by_system") {
            setQueue((prev) =>
              prev.map((item) => {
                if (item.jobId !== data.id) return item;
                return { ...item, status: data.status === "completed" ? "done" : "error" };
              })
            );
          }
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [Object.keys(activeJobs).join(",")]);

  const addQueueItem = () => {
    const newItem: QueueItem = {
      id: generateId(),
      accountId: defaultAccount?.id || accounts[0]?.id || "",
      templateId: "",
      leadSource: "manual",
      selectedLeadIds: new Set(),
      customParams: {},
      status: "pending",
      warmupMode: false,
      warmupDailyLimit: 20,
      shuffleLeads: true,
      multiNumber: false,
      extraAccountIds: [],
      delayMinSeconds: 1,
      delayMaxSeconds: 5,
      messagesPerSecond: 75,
      scheduledAt: "",
    };
    setQueue((prev) => [...prev, newItem]);
    setExpandedItemId(newItem.id);
  };

  const removeQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
    if (expandedItemId === id) setExpandedItemId(null);
  };

  const updateQueueItem = (id: string, updates: Partial<QueueItem>) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const loadLastBroadcastLeads = async (itemId: string) => {
    const { data: recentMessages } = await supabase
      .from("chat_messages")
      .select("lead_id, created_at")
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(500);

    if (!recentMessages || recentMessages.length === 0) {
      toast.error("Nenhum disparo anterior encontrado.");
      return;
    }

    const latestTs = recentMessages[0].created_at;
    const latestDate = new Date(latestTs);
    const cutoff = new Date(latestDate.getTime() - 5 * 60 * 1000).toISOString();

    const batchLeadIds = new Set<string>();
    for (const msg of recentMessages) {
      if (msg.created_at >= cutoff) batchLeadIds.add(msg.lead_id);
    }

    if (batchLeadIds.size === 0) {
      toast.error("Nenhum lead encontrado no último disparo.");
      return;
    }

    updateQueueItem(itemId, { selectedLeadIds: batchLeadIds, leadSource: "last_broadcast" });
    toast.success(`${batchLeadIds.size} lead(s) do último disparo carregados!`);
  };

  const resolveParams = (rawParams: any[], nome: string, customParams: Record<number, string>) => {
    return (rawParams as any[]).map((p: any, i: number) => {
      const customValue = customParams[i];
      if (customValue !== undefined && customValue !== "") {
        return { type: "text", text: customValue.replace(/\{nome\}/g, nome.split(" ")[0]).replace(/\{codigo\}/g, "-") };
      }
      const text = typeof p === "string" ? p : p?.text || "";
      return { type: "text", text: text.replace(/\{nome\}/g, nome.split(" ")[0]).replace(/\{codigo\}/g, "-") };
    });
  };

  const handleSendAll = async () => {
    const pendingItems = queue.filter((item) => item.status === "pending");
    if (pendingItems.length === 0) { toast.error("Nenhum item pendente na fila."); return; }

    for (const item of pendingItems) {
      if (!item.accountId) { toast.error("Selecione uma conta para todos os itens."); return; }
      if (!item.templateId) { toast.error("Selecione um template para todos os itens."); return; }
      if (item.selectedLeadIds.size === 0) { toast.error("Selecione pelo menos um lead em cada item."); return; }
    }

    setIsSendingAll(true);

    for (const item of pendingItems) {
      const template = templates?.find((t: any) => t.id === item.templateId);
      if (!template?.template_name) {
        toast.error(`Template sem nome API configurado: ${template?.name || "desconhecido"}`);
        continue;
      }

      const leadIdsArray = Array.from(item.selectedLeadIds);

      // Resolve custom params for storage (will use {nome} placeholder for per-lead resolution in processor)
      const storedParams = Array.isArray(template.template_params)
        ? (template.template_params as any[]).map((p: any, i: number) => {
            const customValue = item.customParams[i];
            if (customValue !== undefined && customValue !== "") {
              return { type: "text", text: customValue };
            }
            const text = typeof p === "string" ? p : p?.text || "";
            return { type: "text", text };
          })
        : [];

      // Create broadcast job in DB with smart sending options
      const insertData: any = {
        user_id: session?.user.id,
        account_id: item.accountId,
        template_id: item.templateId,
        template_name: template.template_name,
        template_language: template.template_language || "pt_BR",
        template_params: storedParams,
        lead_ids: leadIdsArray,
        total_leads: leadIdsArray.length,
        status: item.scheduledAt ? "scheduled" : "pending",
        warmup_mode: item.warmupMode,
        warmup_daily_limit: item.warmupDailyLimit,
        shuffle_leads: item.shuffleLeads,
        multi_number: item.multiNumber,
        account_ids: item.multiNumber ? [item.accountId, ...item.extraAccountIds] : [],
        delay_min_seconds: item.delayMinSeconds,
        delay_max_seconds: item.delayMaxSeconds,
        messages_per_second: item.messagesPerSecond,
      };
      if (item.scheduledAt) insertData.scheduled_at = new Date(item.scheduledAt).toISOString();

      const { data: job, error: jobError } = await supabase
        .from("broadcast_jobs")
        .insert(insertData)
        .select()
        .single();

      if (jobError || !job) {
        toast.error(`Erro ao criar job: ${jobError?.message || "Desconhecido"}`);
        continue;
      }

      // Track active job
      setActiveJobs((prev) => ({ ...prev, [(job as any).id]: job as any }));
      updateQueueItem(item.id, { status: "sending", jobId: (job as any).id });

      // Trigger the processor (fire and forget) — skip for scheduled
      if (!item.scheduledAt) {
        supabase.functions.invoke("broadcast-processor", {
          body: { job_id: (job as any).id },
        }).catch((e) => console.error("Failed to invoke processor:", e));
      }
    }

    setIsSendingAll(false);
    toast.success("Disparos iniciados em background! Acompanhe o progresso abaixo.");
  };

  const cancelJob = async (jobId: string) => {
    await supabase
      .from("broadcast_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() } as any)
      .eq("id", jobId);
    
    setActiveJobs((prev) => {
      const updated = { ...prev };
      if (updated[jobId]) updated[jobId] = { ...updated[jobId], status: "cancelled" };
      return updated;
    });
    
    setQueue((prev) =>
      prev.map((item) =>
        item.jobId === jobId ? { ...item, status: "error" } : item
      )
    );
    toast.info("Disparo cancelado.");
  };

  const totalPending = queue.filter((i) => i.status === "pending").length;
  const totalLeads = queue.filter((i) => i.status === "pending").reduce((acc, i) => acc + i.selectedLeadIds.size, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Send size={16} /> Fila de Disparos
          </h3>
          <p className="text-xs text-muted-foreground">
            Disparos processados em background em lotes de 100. Suporta volumes grandes (100k+ leads).
          </p>
        </div>
        <Button size="sm" onClick={addQueueItem}>
          <Plus size={14} /> Adicionar Disparo
        </Button>
      </div>

      {queue.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum disparo na fila. Clique em "Adicionar Disparo" para começar.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {queue.map((item, index) => (
            <QueueItemCard
              key={item.id}
              item={item}
              index={index}
              userId={session?.user.id}
              accounts={accounts}
              templates={templates || []}
              accountTemplates={accountTemplates || []}
              leads={leads || []}
              isExpanded={expandedItemId === item.id}
              onToggleExpand={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
              onUpdate={(updates) => updateQueueItem(item.id, updates)}
              onRemove={() => removeQueueItem(item.id)}
              onLoadLastBroadcast={() => loadLastBroadcastLeads(item.id)}
              onCancelJob={cancelJob}
              activeJob={item.jobId ? activeJobs[item.jobId] : undefined}
              disabled={isSendingAll}
            />
          ))}
        </div>
      )}

      {queue.length > 0 && (
        <Button onClick={handleSendAll} disabled={isSendingAll || totalPending === 0} className="w-full" size="lg">
          {isSendingAll ? (
            <><Loader2 size={16} className="animate-spin" /> Criando jobs...</>
          ) : (
            <><Send size={16} /> Disparar {totalPending} item(ns) — {totalLeads} lead(s) total</>
          )}
        </Button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   QUEUE ITEM CARD
   ═══════════════════════════════════════════════ */
interface QueueItemCardProps {
  item: QueueItem;
  index: number;
  userId?: string;
  accounts: any[];
  templates: any[];
  accountTemplates: { id: string; account_id: string; template_id: string }[];
  leads: any[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (updates: Partial<QueueItem>) => void;
  onRemove: () => void;
  onLoadLastBroadcast: () => void;
  onCancelJob: (jobId: string) => void;
  activeJob?: BroadcastJob;
  disabled: boolean;
}

function QueueItemCard({
  item, index, userId, accounts, templates, accountTemplates, leads,
  isExpanded, onToggleExpand, onUpdate, onRemove, onLoadLastBroadcast, onCancelJob,
  activeJob, disabled,
}: QueueItemCardProps) {
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [columnMapOpen, setColumnMapOpen] = useState(false);
  const [sheetColumns, setSheetColumns] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<Record<string, any>[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  const account = accounts.find((a) => a.id === item.accountId);
  const template = templates.find((t: any) => t.id === item.templateId);
  const templateParamCount = Array.isArray(template?.template_params)
    ? (template.template_params as any[]).length : 0;

  // Normaliza: remove tudo que não é dígito
  const normalizePhone = (raw: any): string => String(raw ?? "").replace(/\D/g, "");

  // Converte valor do Excel para string numérica
  const rawToPhone = (value: any): string => {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "number") return value.toFixed(0);
    const str = String(value).trim();
    if (/\d+\.?\d*[eE][+\-]\d+/.test(str)) return parseFloat(str).toFixed(0);
    return str;
  };

  const matchOrCreateLeads = async (rawPhones: string[], names: Record<string, string>) => {
    const phones = rawPhones.map(normalizePhone).filter((p) => p.length >= 10);
    if (phones.length === 0) {
      toast.error("Nenhum número válido encontrado.");
      return;
    }

    const matchedIds = new Set<string>();
    const unmatchedPhones: string[] = [];

    for (const phone of phones) {
      const suffix = phone.slice(-8);
      const found = leads.find((lead) => normalizePhone(lead.phone).endsWith(suffix));
      if (found) matchedIds.add(found.id);
      else unmatchedPhones.push(phone);
    }

    if (unmatchedPhones.length > 0) {
      const phoneMap = new Map<string, string>();
      for (const p of unmatchedPhones) {
        const phone55 = p.length <= 11 ? `55${p}` : p;
        if (!phoneMap.has(phone55)) {
          phoneMap.set(phone55, names[p] || names[phone55] || `Contato ${p.slice(-4)}`);
        }
      }

      const uniqueEntries = Array.from(phoneMap.entries()).map(([phone, name]) => ({
        phone, name, origin: "xls_import", user_id: userId,
      }));

      const BATCH = 50;
      for (let i = 0; i < uniqueEntries.length; i += BATCH) {
        const batch = uniqueEntries.slice(i, i + BATCH);
        const { data: upserted, error } = await supabase
          .from("leads")
          .upsert(batch, { onConflict: "phone,user_id", ignoreDuplicates: false })
          .select("id");
        if (error) {
          const phones55 = batch.map((b) => b.phone);
          const { data: existing } = await supabase.from("leads").select("id").in("phone", phones55);
          for (const ex of existing || []) matchedIds.add(ex.id);
        } else {
          for (const nl of upserted || []) matchedIds.add(nl.id);
        }
      }
    }

    if (matchedIds.size === 0) { toast.error("Nenhum lead pôde ser adicionado."); return; }

    onUpdate({ selectedLeadIds: matchedIds, leadSource: "manual" });
    const existingCount = leads.filter((l) => matchedIds.has(l.id)).length;
    const newCount = matchedIds.size - existingCount;
    toast.success(
      `${existingCount} existente(s)${newCount > 0 ? ` + ${newCount} novo(s)` : ""} — total: ${matchedIds.size}`,
      { duration: 6000 }
    );
  };

  const getAvailableFields = () => {
    const fields = [
      { value: "ignore", label: "— Ignorar" },
      { value: "phone", label: "📞 Telefone" },
      { value: "name", label: "👤 Nome" },
    ];
    for (let i = 0; i < templateParamCount; i++) {
      fields.push({ value: `param_${i}`, label: `🔧 Parâmetro {{${i + 1}}}` });
    }
    return fields;
  };

  const autoDetectMapping = (cols: string[]): Record<string, string> => {
    const mapping: Record<string, string> = {};
    let paramIdx = 0;
    for (const col of cols) {
      const lower = col.toLowerCase();
      if (/tel|phone|fone|celular|whatsapp|numero|n[uú]mero/.test(lower)) mapping[col] = "phone";
      else if (/nome|name|cliente/.test(lower)) mapping[col] = "name";
      else if (/param|codigo|c[oó]digo/.test(lower) && paramIdx < templateParamCount) mapping[col] = `param_${paramIdx++}`;
      else mapping[col] = "ignore";
    }
    return mapping;
  };

  const openColumnMapModal = (rows: Record<string, any>[]) => {
    if (rows.length === 0) { toast.error("Arquivo sem dados."); return; }
    const cols = Object.keys(rows[0]);
    setSheetColumns(cols);
    setSheetRows(rows);
    setColumnMapping(autoDetectMapping(cols));
    setColumnMapOpen(true);
  };

  const handleConfirmColumnMap = async () => {
    const phoneCol = Object.entries(columnMapping).find(([, v]) => v === "phone")?.[0];
    const nameCol = Object.entries(columnMapping).find(([, v]) => v === "name")?.[0];
    if (!phoneCol) { toast.error("Selecione qual coluna é o Telefone."); return; }

    const phones: string[] = [];
    const names: Record<string, string> = {};

    for (const row of sheetRows) {
      const phone = normalizePhone(rawToPhone(row[phoneCol]));
      if (phone.length >= 10) {
        phones.push(phone);
        if (nameCol) names[phone] = String(row[nameCol] ?? "").trim() || `Contato ${phone.slice(-4)}`;
      }
    }

    setColumnMapOpen(false);
    await matchOrCreateLeads(phones, names);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isExcel = /\.(xlsx?|xls)$/i.test(file.name);
    const isCsv = /\.csv$/i.test(file.name);
    const reader = new FileReader();

    reader.onload = (ev) => {
      if (isExcel) {
        const buffer = ev.target?.result as ArrayBuffer;
        if (!buffer) return;
        try {
          const workbook = XLSX.read(buffer, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: true, defval: "" });
          openColumnMapModal(rows);
        } catch (err: any) {
          toast.error(`Erro ao ler Excel: ${err?.message || err}`);
        }
      } else if (isCsv) {
        const text = ev.target?.result as string;
        if (!text) { toast.error("CSV vazio."); return; }
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) { toast.error("CSV sem dados suficientes."); return; }
        const sep = lines[0].includes(";") ? ";" : ",";
        const headers = lines[0].split(sep).map((h) => h.trim().replace(/^["']|["']$/g, ""));
        const rows: Record<string, any>[] = [];
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(sep).map((v) => v.trim().replace(/^["']|["']$/g, ""));
          if (vals.every((v) => !v)) continue;
          const row: Record<string, any> = {};
          headers.forEach((h, idx) => { row[h] = vals[idx] ?? ""; });
          rows.push(row);
        }
        openColumnMapModal(rows);
      } else {
        const text = ev.target?.result as string;
        if (!text) return;
        const phones = text
          .split(/[\r\n,;]+/)
          .map((l) => normalizePhone(l.trim()))
          .filter((p) => p.length >= 10);
        matchOrCreateLeads(phones, {});
      }
    };

    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const filteredLeads = useMemo(() => {
    const s = search.toLowerCase();
    return leads.filter(
      (l: any) =>
        l.name.toLowerCase().includes(s) ||
        l.phone.includes(s) ||
        l.email?.toLowerCase().includes(s)
    );
  }, [leads, search]);

  const toggleLead = (id: string) => {
    const next = new Set(item.selectedLeadIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onUpdate({ selectedLeadIds: next, leadSource: "manual" });
  };

  const toggleAll = () => {
    if (item.selectedLeadIds.size === filteredLeads.length) {
      onUpdate({ selectedLeadIds: new Set(), leadSource: "manual" });
    } else {
      onUpdate({ selectedLeadIds: new Set(filteredLeads.map((l: any) => l.id)), leadSource: "manual" });
    }
  };

  const isPaused = activeJob?.status === "paused_by_system";

  const statusIcon =
    isPaused ? <PauseCircle size={16} className="text-amber-500" />
    : item.status === "done" ? <CheckCircle2 size={16} className="text-green-500" />
    : item.status === "error" ? <AlertCircle size={16} className="text-destructive" />
    : item.status === "sending" ? <Loader2 size={16} className="animate-spin text-primary" />
    : null;

  // Job progress data
  const job = activeJob;
  const jobTotalLeads = job?.total_leads || item.selectedLeadIds.size;
  const jobSent = job?.sent_count || 0;
  const jobErrors = job?.error_count || 0;
  const jobDelivered = job?.delivered_count || 0;
  const jobRead = job?.read_count || 0;
  const jobProgress = job ? Math.min(job.last_cursor, jobTotalLeads) : 0;
  const jobPercent = jobTotalLeads > 0 ? (jobProgress / jobTotalLeads) * 100 : 0;
  const isJobActive = job && (job.status === "processing" || job.status === "pending");

  return (
    <>
      {/* Column mapping modal */}
      <Dialog open={columnMapOpen} onOpenChange={setColumnMapOpen}>
        <DialogContent className="sm:max-w-lg" aria-describedby="col-map-desc">
          <DialogHeader>
            <DialogTitle>Selecionar colunas do arquivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1" id="col-map-desc">
            <p className="text-xs text-muted-foreground">
              Defina o significado de cada coluna. A coluna <strong>Telefone</strong> é obrigatória.
            </p>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-1/2">Coluna</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-1/2">Representa</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetColumns.map((col, idx) => (
                    <tr key={col} className={cn("border-t", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-sm truncate max-w-[180px]">{col}</p>
                        {sheetRows[0] && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                            ex: {rawToPhone(sheetRows[0][col]) || String(sheetRows[0][col] ?? "—")}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={columnMapping[col] ?? "ignore"}
                          onValueChange={(val) => setColumnMapping((prev) => ({ ...prev, [col]: val }))}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {getAvailableFields().map((f) => (
                              <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!Object.values(columnMapping).includes("phone") && (
              <p className="text-xs text-destructive">⚠️ Selecione ao menos uma coluna como <strong>Telefone</strong>.</p>
            )}
            <p className="text-[10px] text-muted-foreground">{sheetRows.length} linha(s) encontrada(s).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setColumnMapOpen(false)}>Cancelar</Button>
            <Button onClick={handleConfirmColumnMap} disabled={!Object.values(columnMapping).includes("phone")}>
              Importar Leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card
        className={cn(
          "transition-colors",
          item.status === "done" && "border-green-300 dark:border-green-800",
          item.status === "error" && "border-destructive/50"
        )}
      >
        {/* Collapsed header */}
        <button
          onClick={onToggleExpand}
          className="w-full flex items-center gap-3 p-4 text-left"
          disabled={disabled}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {statusIcon}
            <span className="text-sm font-semibold">#{index + 1}</span>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm truncate">{account?.name || "Sem conta"}</span>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm truncate text-muted-foreground">{template?.name || "Sem template"}</span>
            <Badge variant="secondary" className="text-xs ml-auto shrink-0">
              {item.selectedLeadIds.size} lead(s)
            </Badge>
          </div>
          {item.status === "done" && job && (
            <span className="text-xs text-emerald-600">
              ✓ {jobSent} ok{jobErrors > 0 ? `, ${jobErrors} erro(s)` : ""}
            </span>
          )}
          {item.status === "error" && job?.last_error && (
            <span className="text-xs text-destructive truncate max-w-[200px]">{job.last_error}</span>
          )}
          <div className="flex items-center gap-1 shrink-0">
            {item.status === "pending" && (
              <Button
                variant="ghost" size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
              >
                <Trash2 size={14} />
              </Button>
            )}
            {isJobActive && item.jobId && (
              <Button
                variant="ghost" size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); onCancelJob(item.jobId!); }}
                title="Cancelar disparo"
              >
                <XCircle size={14} />
              </Button>
            )}
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>

        {/* Progress bars for sending/done */}
        {(item.status === "sending" || item.status === "done" || isPaused) && job && (
          <div className="px-4 pb-4 space-y-3">
            {/* Overall progress */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">
                  Progresso geral
                </span>
                <span className="font-mono text-muted-foreground">
                  {jobProgress}/{jobTotalLeads} ({Math.round(jobPercent)}%)
                </span>
              </div>
              <Progress value={jobPercent} className="h-2.5 bg-muted" />
            </div>

            {/* Sent */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                  <CheckCheck size={13} /> Enviadas
                </span>
                <span className="font-mono text-muted-foreground">
                  {jobSent}/{jobTotalLeads}
                  {jobErrors > 0 && <span className="text-destructive ml-1">({jobErrors} erro)</span>}
                </span>
              </div>
              <Progress
                value={(jobSent / Math.max(jobTotalLeads, 1)) * 100}
                className="h-2 bg-muted"
              />
            </div>

            {/* Delivered */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <Inbox size={13} /> Entregues
                </span>
                <span className="font-mono text-muted-foreground">{jobDelivered}/{jobSent}</span>
              </div>
              <Progress
                value={(jobDelivered / Math.max(jobSent, 1)) * 100}
                className="h-2 bg-muted [&>div]:bg-emerald-500"
              />
            </div>

            {/* Read */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium">
                  <Eye size={13} /> Lidas
                </span>
                <span className="font-mono text-muted-foreground">{jobRead}/{jobSent}</span>
              </div>
              <Progress
                value={(jobRead / Math.max(jobSent, 1)) * 100}
                className="h-2 bg-muted [&>div]:bg-blue-500"
              />
            </div>

            {isJobActive && (
              <p className="text-[10px] text-muted-foreground text-center animate-pulse">
                Processando em background... lotes de 100 mensagens | Delay aleatório anti-spam ativo
              </p>
            )}

            {/* Pause alert */}
            {job.status === "paused_by_system" && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <PauseCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Campanha pausada automaticamente</p>
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">{job.pause_reason || "Motivo não especificado"}</p>
                  {job.error_rate > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Taxa de erro: {job.error_rate}% | Erros consecutivos: {job.consecutive_errors}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expanded content */}
        {isExpanded && item.status === "pending" && (
          <CardContent className="pt-0 space-y-4">
            <Separator />

            {/* Account selector */}
            <div className="space-y-2">
              <Label className="text-xs">Conta WhatsApp</Label>
              <select
                value={item.accountId}
                onChange={(e) => onUpdate({ accountId: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Selecione...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} {a.is_default ? "(padrão)" : ""}</option>
                ))}
              </select>
            </div>

            {/* Template selector */}
            <div className="space-y-2">
              <Label className="text-xs">Template</Label>
              <select
                value={item.templateId}
                onChange={(e) => onUpdate({ templateId: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Selecione um template...</option>
                {templates
                  .filter((t: any) => {
                    if (t.meta_status && t.meta_status !== "unknown" && t.meta_status !== "APPROVED") return false;
                    if (!item.accountId) return true;
                    const linked = accountTemplates.filter((at) => at.template_id === t.id);
                    return linked.length === 0 || linked.some((at) => at.account_id === item.accountId);
                  })
                  .map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.template_name ? `(API: ${t.template_name})` : ""}
                    </option>
                  ))}
              </select>
              {template && (
                <div className="rounded-lg border bg-muted/30 p-2">
                  <p className="text-xs whitespace-pre-wrap">{template.content}</p>
                </div>
              )}

              {/* Template parameters */}
              {template && Array.isArray(template.template_params) && (template.template_params as any[]).length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Parâmetros do Template</Label>
                  <div className="space-y-1.5">
                    {(template.template_params as any[]).map((_: any, i: number) => {
                      const defaultText = typeof _ === "string" ? _ : _?.text || "";
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground whitespace-nowrap w-12 shrink-0">{`{{${i + 1}}}`}</span>
                          <Input
                            placeholder={defaultText || `Valor para {{${i + 1}}}. Use {nome}`}
                            value={item.customParams?.[i] ?? defaultText}
                            onChange={(e) => onUpdate({ customParams: { ...item.customParams, [i]: e.target.value } } as any)}
                            className="h-7 text-xs"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Use <code className="bg-muted px-1 rounded">{"{nome}"}</code> para o primeiro nome do lead.
                  </p>
                </div>
              )}
            </div>

            {/* ── SMART SENDING OPTIONS ── */}
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-primary" />
                <span className="text-xs font-semibold">Envio Inteligente (Anti-ban)</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Shuffle */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Shuffle size={12} className="text-muted-foreground" />
                    <span className="text-[11px]">Embaralhar leads</span>
                  </div>
                  <Switch
                    checked={item.shuffleLeads}
                    onCheckedChange={(v) => onUpdate({ shuffleLeads: v })}
                  />
                </div>

                {/* Warmup */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Flame size={12} className="text-muted-foreground" />
                    <span className="text-[11px]">Aquecimento</span>
                  </div>
                  <Switch
                    checked={item.warmupMode}
                    onCheckedChange={(v) => onUpdate({ warmupMode: v })}
                  />
                </div>
              </div>

              {item.warmupMode && (
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Início:</Label>
                  <Input
                    type="number"
                    min={5}
                    max={100}
                    value={item.warmupDailyLimit}
                    onChange={(e) => onUpdate({ warmupDailyLimit: parseInt(e.target.value) || 20 })}
                    className="h-7 text-xs w-20"
                  />
                  <span className="text-[10px] text-muted-foreground">msgs/dia (dobra a cada dia)</span>
                </div>
              )}

              {/* Timing controls */}
              <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-2">
                <div className="flex items-center gap-1.5">
                  <CalendarClock size={12} className="text-muted-foreground" />
                  <span className="text-[11px] font-medium">Velocidade de envio</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Mín (s)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={item.delayMinSeconds}
                      onChange={(e) => {
                        const v = Math.max(0, parseFloat(e.target.value) || 0);
                        onUpdate({
                          delayMinSeconds: v,
                          delayMaxSeconds: Math.max(v, item.delayMaxSeconds),
                        });
                      }}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Máx (s)</Label>
                    <Input
                      type="number"
                      min={item.delayMinSeconds}
                      step={0.5}
                      value={item.delayMaxSeconds}
                      onChange={(e) =>
                        onUpdate({
                          delayMaxSeconds: Math.max(item.delayMinSeconds, parseFloat(e.target.value) || 0),
                        })
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Msgs/s</Label>
                    <Input
                      type="number"
                      min={1}
                      max={300}
                      value={item.messagesPerSecond}
                      onChange={(e) =>
                        onUpdate({ messagesPerSecond: Math.max(1, parseInt(e.target.value) || 1) })
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Cada envio espera entre {item.delayMinSeconds}s e {item.delayMaxSeconds}s (jitter
                  aleatório). Limite global: {item.messagesPerSecond} msg/s.
                </p>
              </div>

              {/* Multi-number */}
              {accounts.length > 1 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <BarChart3 size={12} className="text-muted-foreground" />
                      <span className="text-[11px]">Multi-número (round-robin)</span>
                    </div>
                    <Switch
                      checked={item.multiNumber}
                      onCheckedChange={(v) => onUpdate({ multiNumber: v, extraAccountIds: v ? accounts.filter(a => a.id !== item.accountId).map(a => a.id) : [] })}
                    />
                  </div>
                  {item.multiNumber && (
                    <p className="text-[10px] text-muted-foreground">
                      Distribuindo entre {accounts.length} número(s): {accounts.map(a => a.name).join(", ")}
                    </p>
                  )}
                </div>
              )}

              {/* Scheduling */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <CalendarClock size={12} className="text-muted-foreground" />
                  <span className="text-[11px]">Agendar disparo</span>
                </div>
                <input
                  type="datetime-local"
                  value={item.scheduledAt}
                  onChange={(e) => onUpdate({ scheduledAt: e.target.value })}
                  min={new Date().toISOString().slice(0, 16)}
                  className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {item.scheduledAt && (
                  <p className="text-[10px] text-amber-500">
                    ⏰ Disparo agendado para {new Date(item.scheduledAt).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>

              <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
                ✅ Delay aleatório (300-1500ms) • Detecção de bloqueios • Pausa automática (erro {">"}10%) • Log de auditoria
              </p>
            </div>

            {/* Lead selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Leads ({item.selectedLeadIds.size} selecionados)</Label>
                <div className="flex gap-2">
                  <input ref={fileInputRef} type="file" accept=".csv,.txt,.xls,.xlsx" className="hidden" onChange={handleFileImport} />
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => fileInputRef.current?.click()}>
                    <Upload size={12} className="mr-1" /> Importar CSV / XLS
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onLoadLastBroadcast}>
                    <ArrowLeft size={12} className="mr-1" /> Último disparo
                  </Button>
                </div>
              </div>

              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar lead..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-8 text-sm"
                />
              </div>

              <div className="border rounded-md">
                <div className="px-3 py-1.5 border-b">
                  <button onClick={toggleAll} className="text-xs text-primary hover:underline">
                    {item.selectedLeadIds.size === filteredLeads.length ? "Desmarcar todos" : "Selecionar todos"}
                  </button>
                </div>
                <ScrollArea className="h-[200px]">
                  {filteredLeads.map((lead: any) => (
                    <button
                      key={lead.id}
                      onClick={() => toggleLead(lead.id)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/40",
                        item.selectedLeadIds.has(lead.id) && "bg-primary/5"
                      )}
                    >
                      <Checkbox checked={item.selectedLeadIds.has(lead.id)} className="pointer-events-none" />
                      <Avatar className="w-6 h-6">
                        {lead.photo_url && <AvatarImage src={lead.photo_url} />}
                        <AvatarFallback className={cn(getAvatarColor(lead.name), "text-[10px]")}>
                          {getInitials(lead.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{lead.name}</p>
                        <p className="text-[10px] text-muted-foreground">{lead.phone}</p>
                      </div>
                    </button>
                  ))}
                  {filteredLeads.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">Nenhum lead encontrado</p>
                  )}
                </ScrollArea>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </>
  );
}
