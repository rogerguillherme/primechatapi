import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { ChatMediaBubble } from "@/components/ChatMediaBubble";
import { Progress } from "@/components/ui/progress";
import { AudioRecorder } from "@/components/AudioRecorder";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Phone, Key, Link2, Send, CheckCircle2, AlertCircle, Copy, ExternalLink,
  Package, MessageCircle, Search, FileText, Check, CheckCheck, Paperclip,
  Truck, Users, ArrowLeft, BarChart3, MoreVertical, Pencil, Trash2, Star,
  KeyRound, ChevronDown, Webhook, LogOut, Plug, Tag, ChevronLeft, ChevronRight,
  Instagram, GitBranch, TrendingUp,
} from "lucide-react";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { FlowBuilder } from "@/components/FlowBuilder";
import { TemplateManager } from "@/components/TemplateManager";
import { BroadcastQueue } from "@/components/BroadcastQueue";
import { ContactImporter } from "@/components/ContactImporter";
import { SendingMetrics } from "@/components/SendingMetrics";
import { CampaignAnalytics } from "@/components/CampaignAnalytics";
import { TemplateAccountBar } from "@/components/TemplateAccountBar";
import { WebhookEndpoints } from "@/components/WebhookEndpoints";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { AccountSelector } from "@/components/AccountSelector";
import { ChatLabelsManager, useLabels, LeadLabelSelector } from "@/components/ChatLabelsManager";

const isUnauthorizedFunctionError = (error: unknown) =>
  error instanceof Error && error.message.includes("401");

const META_REDIRECT_URI = "https://primechatapi.lovable.app/auth/meta/callback";

/* ── Helpers ── */
function getAvatarColor(name: string) {
  const colors = ["bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-rose-600", "bg-cyan-600", "bg-indigo-600"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function formatDateSeparator(date: Date) {
  if (isToday(date)) return "HOJE";
  if (isYesterday(date)) return "ONTEM";
  return format(date, "dd/MM/yyyy", { locale: ptBR });
}

/* ══════════════════════════════════════════════════
   TRACKING TAB COMPONENT
   ══════════════════════════════════════════════════ */
function TrackingTab() {
  const [search, setSearch] = useState("");
  const [trackingCode, setTrackingCode] = useState("");
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [isSending, setIsSending] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const { accounts, defaultAccount } = useWhatsAppAccounts();
  const [messageTemplate, setMessageTemplate] = useState(
    "Olá {nome}! 📦 Seu pedido foi enviado!\n\nCódigo de rastreio: *{codigo}*\n\nAcompanhe em: https://www.linkcorreto.com.br/{codigo}"
  );

  // Auto-select default account
  useEffect(() => {
    if (selectedAccountIds.size === 0 && defaultAccount) {
      setSelectedAccountIds(new Set([defaultAccount.id]));
    }
  }, [defaultAccount, selectedAccountIds.size]);

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { data: leads } = useQuery({
    queryKey: ["tracking-leads"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, name, phone, email, photo_url")
        .order("name");
      return data || [];
    },
  });

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    const s = search.toLowerCase();
    return leads.filter(
      (l) => l.name.toLowerCase().includes(s) || l.phone.includes(s) || l.email?.toLowerCase().includes(s)
    );
  }, [leads, search]);

  const toggleLead = (id: string) => {
    setSelectedLeads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedLeads.size === filteredLeads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(filteredLeads.map((l) => l.id)));
    }
  };

  const handleSendTracking = async () => {
    if (!trackingCode.trim()) {
      toast.error("Informe o código de rastreio.");
      return;
    }
    if (selectedLeads.size === 0) {
      toast.error("Selecione pelo menos um lead.");
      return;
    }
    setIsSending(true);
    let successCount = 0;
    let errorCount = 0;

    const accountIds = selectedAccountIds.size > 0 ? Array.from(selectedAccountIds) : (defaultAccount ? [defaultAccount.id] : []);

    for (const leadId of selectedLeads) {
      const lead = leads?.find((l) => l.id === leadId);
      if (!lead) continue;

      const finalMessage = messageTemplate
        .replace(/\{nome\}/g, lead.name.split(" ")[0])
        .replace(/\{codigo\}/g, trackingCode.trim());

      for (const accountId of accountIds) {
        try {
          const { error } = await supabase.functions.invoke("whatsapp-cloud-send", {
            body: { phone: lead.phone, message: finalMessage, account_id: accountId },
          });
          if (error) throw error;
          successCount++;
        } catch {
          errorCount++;
        }
      }
    }

    setIsSending(false);
    if (successCount > 0) toast.success(`${successCount} mensagem(ns) enviada(s) com sucesso!`);
    if (errorCount > 0) toast.error(`${errorCount} mensagem(ns) falharam.`);
    if (successCount > 0) {
      setSelectedLeads(new Set());
      setTrackingCode("");
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Left: Lead selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users size={18} />
            Selecionar Leads ({selectedLeads.size})
          </CardTitle>
          <div className="relative mt-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar lead..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="px-4 py-2 border-b border-border">
            <button onClick={toggleAll} className="text-xs text-primary hover:underline">
              {selectedLeads.size === filteredLeads.length ? "Desmarcar todos" : "Selecionar todos"}
            </button>
          </div>
          <ScrollArea className="h-[320px]">
            {filteredLeads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => toggleLead(lead.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/40",
                  selectedLeads.has(lead.id) && "bg-primary/5"
                )}
              >
                <Checkbox checked={selectedLeads.has(lead.id)} className="pointer-events-none" />
                <Avatar className="w-8 h-8">
                  {lead.photo_url && <AvatarImage src={lead.photo_url} />}
                  <AvatarFallback className={cn(getAvatarColor(lead.name), "text-white text-xs")}>
                    {getInitials(lead.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{lead.name}</p>
                  <p className="text-xs text-muted-foreground">{lead.phone}</p>
                </div>
              </button>
            ))}
            {filteredLeads.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead encontrado</p>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Right: Tracking code & message */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck size={18} />
            Código de Rastreio
          </CardTitle>
          <CardDescription>
            Envie o código de rastreio para os leads selecionados via WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="trackingCode">Código de Rastreio</Label>
            <Input
              id="trackingCode"
              placeholder="Ex: BR123456789XX"
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label>Mensagem (use {"{nome}"} e {"{codigo}"})</Label>
            <textarea
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[120px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              rows={5}
            />
          </div>

          {trackingCode && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Pré-visualização:</p>
              <p className="text-sm whitespace-pre-wrap">
                {messageTemplate
                  .replace(/\{nome\}/g, "João")
                  .replace(/\{codigo\}/g, trackingCode || "BR123456789XX")}
              </p>
            </div>
          )}

          <AccountSelector
            accounts={accounts}
            selectedIds={selectedAccountIds}
            onToggle={toggleAccount}
            mode="multi"
            label="Contas para envio"
          />

          <Button
            onClick={handleSendTracking}
            disabled={isSending || selectedLeads.size === 0 || !trackingCode.trim()}
            className="w-full"
          >
            {isSending ? (
              "Enviando..."
            ) : (
              <>
                <Send size={16} />
                Enviar para {selectedLeads.size} lead(s)
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   CSV PARSE HELPER
   ══════════════════════════════════════════════════ */
interface CsvRow { nome: string; telefone: string; codigo: string }

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
  const nameIdx = headers.findIndex((h) => h === "nome" || h === "name");
  const phoneIdx = headers.findIndex((h) => h === "telefone" || h === "phone" || h === "fone" || h === "celular");
  const codeIdx = headers.findIndex((h) => h === "codigo" || h === "code" || h === "rastreio" || h === "tracking");
  if (nameIdx === -1 || phoneIdx === -1) return [];
  return lines.slice(1).map((line) => {
    const cols = line.split(sep).map((c) => c.trim().replace(/^["']|["']$/g, ""));
    return { nome: cols[nameIdx] || "", telefone: cols[phoneIdx]?.replace(/\D/g, "") || "", codigo: codeIdx >= 0 ? cols[codeIdx] || "" : "" };
  }).filter((r) => r.nome && r.telefone);
}

/* ══════════════════════════════════════════════════
   BROADCAST TAB COMPONENT
   ══════════════════════════════════════════════════ */
function BroadcastTab() {
  const [mode, setMode] = useState<"leads" | "csv">("leads");
  const [search, setSearch] = useState("");
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [isSending, setIsSending] = useState(false);
  const cancelRef = useRef(false);
  const [sendType, setSendType] = useState<"template" | "flow" | "custom">("template");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [customMessage, setCustomMessage] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const { accounts, defaultAccount } = useWhatsAppAccounts();
  // CSV state
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvSelectedIdxs, setCsvSelectedIdxs] = useState<Set<number>>(new Set());
  const csvInputRef = useRef<HTMLInputElement>(null);
  // Progress state for dispatches
  const [dispatchProgress, setDispatchProgress] = useState<{ current: number; total: number; errors: number; errorDetails: Array<{ phone: string; reason: string }> } | null>(null);
  // Add lead manually
  const [showAddLead, setShowAddLead] = useState(false);
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadPhone, setNewLeadPhone] = useState("");
  const [isAddingLead, setIsAddingLead] = useState(false);
  const queryClient = useQueryClient();

  // Auto-select default account
  useEffect(() => {
    if (selectedAccountIds.size === 0 && defaultAccount) {
      setSelectedAccountIds(new Set([defaultAccount.id]));
    }
  }, [defaultAccount, selectedAccountIds.size]);

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { data: leads } = useQuery({
    queryKey: ["broadcast-leads"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, name, phone, email, photo_url")
        .order("name");
      return data || [];
    },
  });

  const { templates } = useUserTemplates();

  const { data: flows } = useQuery({
    queryKey: ["broadcast-flows"],
    queryFn: async () => {
      const { data } = await supabase.from("flows").select("*").eq("active", true).order("name");
      return data || [];
    },
  });

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    const s = search.toLowerCase();
    return leads.filter(
      (l) => l.name.toLowerCase().includes(s) || l.phone.includes(s) || l.email?.toLowerCase().includes(s)
    );
  }, [leads, search]);

  const toggleLead = (id: string) => {
    setSelectedLeads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedLeads.size === filteredLeads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(filteredLeads.map((l) => l.id)));
    }
  };

  const toggleCsvAll = () => {
    if (csvSelectedIdxs.size === csvRows.length) {
      setCsvSelectedIdxs(new Set());
    } else {
      setCsvSelectedIdxs(new Set(csvRows.map((_, i) => i)));
    }
  };

  const toggleCsvRow = (idx: number) => {
    setCsvSelectedIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleAddLead = async () => {
    if (!newLeadName.trim() || !newLeadPhone.trim()) {
      toast.error("Preencha nome e telefone.");
      return;
    }
    setIsAddingLead(true);
    try {
      const phone = newLeadPhone.replace(/\D/g, "");
      const cleanPhone = phone.startsWith("55") ? phone : "55" + phone;
      const { data, error } = await supabase.from("leads").insert({ name: newLeadName.trim(), phone: cleanPhone, origin: "manual" }).select("id").single();
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["broadcast-leads"] });
      setSelectedLeads((prev) => new Set([...prev, data.id]));
      setNewLeadName("");
      setNewLeadPhone("");
      setShowAddLead(false);
      toast.success("Lead adicionado!");
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setIsAddingLead(false);
    }
  };

  const handleLoadLastBroadcast = async () => {
    // Get the most recent outbound messages grouped by lead_id (last broadcast batch)
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

    // Find the timestamp of the most recent message
    const latestTs = recentMessages[0].created_at;
    const latestDate = new Date(latestTs);
    // Consider messages within a 5-minute window as part of the same broadcast
    const windowMs = 5 * 60 * 1000;
    const cutoff = new Date(latestDate.getTime() - windowMs).toISOString();

    const batchLeadIds = new Set<string>();
    for (const msg of recentMessages) {
      if (msg.created_at >= cutoff) {
        batchLeadIds.add(msg.lead_id);
      }
    }

    if (batchLeadIds.size === 0) {
      toast.error("Nenhum lead encontrado no último disparo.");
      return;
    }

    setSelectedLeads(batchLeadIds);
    setMode("leads");
    toast.success(`${batchLeadIds.size} lead(s) do último disparo selecionados!`);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast.error("CSV inválido. Verifique se há colunas 'nome' e 'telefone'.");
        return;
      }
      setCsvRows(rows);
      setCsvSelectedIdxs(new Set(rows.map((_, i) => i)));
      toast.success(`${rows.length} contato(s) importado(s)!`);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const selectedTemplate = templates?.find((t: any) => t.id === selectedTemplateId);
  const selectedFlow = flows?.find((f: any) => f.id === selectedFlowId);

  const resolveParams = (rawParams: any[], nome: string, codigo: string) => {
    return (rawParams as any[]).map((p: any) => {
      const text = typeof p === "string" ? p : p?.text || "";
      return {
        type: "text",
        text: text.replace(/\{nome\}/g, nome.split(" ")[0]).replace(/\{codigo\}/g, codigo),
      };
    });
  };

  const handleSendBroadcast = async () => {
    const isCsv = mode === "csv";
    const count = isCsv ? csvSelectedIdxs.size : selectedLeads.size;

    if (count === 0) {
      toast.error("Selecione pelo menos um contato.");
      return;
    }
    if (sendType === "template" && !selectedTemplate) {
      toast.error("Selecione um template.");
      return;
    }
    if (sendType === "flow" && !selectedFlow) {
      toast.error("Selecione um fluxo.");
      return;
    }
    if (sendType === "custom" && !customMessage.trim()) {
      toast.error("Digite uma mensagem.");
      return;
    }

    setIsSending(true);
    cancelRef.current = false;
    setDispatchProgress(null);
    let successCount = 0;
    let errorCount = 0;

    const flowIdForDispatch = sendType === "flow" ? selectedFlowId : null;

    // Helper to start a flow for a single lead (used for small batches)
    const startFlowForLead = async (leadId: string, flowId: string, codigo?: string) => {
      const { data: rootSteps, error: rootStepError } = await supabase
        .from("flow_steps")
        .select("*")
        .eq("flow_id", flowId)
        .is("parent_step_id", null)
        .order("step_order")
        .limit(1);

      if (rootStepError) throw new Error(`Erro ao carregar etapas do fluxo: ${rootStepError.message}`);

      let firstStep = rootSteps?.[0];

      if (!firstStep) {
        const { data: anySteps, error: anyStepError } = await supabase
          .from("flow_steps")
          .select("*")
          .eq("flow_id", flowId)
          .order("step_order")
          .limit(1);
        if (anyStepError) throw new Error(`Erro ao carregar etapas do fluxo: ${anyStepError.message}`);
        firstStep = anySteps?.[0];
      }

      if (!firstStep) throw new Error("Fluxo sem etapas. Abra o Flow Builder e salve o fluxo novamente.");

      const firstStepStatus =
        firstStep.step_type === "delay"
          ? "waiting_delay"
          : firstStep.step_type === "no_response"
            ? "waiting_no_response"
            : firstStep.step_type === "condition"
              ? "waiting_reply"
              : "waiting_delay";

      const firstStepNextActionAt =
        firstStep.step_type === "delay"
          ? new Date(Date.now() + (firstStep.delay_minutes || 0) * 60 * 1000).toISOString()
          : firstStep.step_type === "no_response"
            ? new Date(Date.now() + (firstStep.timeout_minutes || 10) * 60 * 1000).toISOString()
            : new Date().toISOString();

      await supabase
        .from("flow_executions")
        .update({ status: "cancelled" })
        .eq("lead_id", leadId)
        .in("status", ["running", "waiting_delay", "waiting_reply", "waiting_no_response"]);

      const { error: insertExecutionError } = await supabase.from("flow_executions").insert({
        flow_id: flowId,
        lead_id: leadId,
        current_step_id: firstStep.id,
        status: firstStepStatus,
        next_action_at: firstStepNextActionAt,
        metadata: { codigo: codigo || "" },
      });
      if (insertExecutionError) throw new Error(`Erro ao iniciar execução do fluxo: ${insertExecutionError.message}`);
    };

    // Bulk flow dispatch: insert all executions, then trigger processor once
    const startFlowBulk = async (leadIds: string[], flowId: string, codigoMap?: Record<string, string>) => {
      const { data: rootSteps, error: rootStepError } = await supabase
        .from("flow_steps")
        .select("*")
        .eq("flow_id", flowId)
        .is("parent_step_id", null)
        .order("step_order")
        .limit(1);

      if (rootStepError) throw new Error(`Erro ao carregar etapas do fluxo: ${rootStepError.message}`);

      let firstStep = rootSteps?.[0];
      if (!firstStep) {
        const { data: anySteps, error: anyStepError } = await supabase
          .from("flow_steps")
          .select("*")
          .eq("flow_id", flowId)
          .order("step_order")
          .limit(1);
        if (anyStepError) throw new Error(`Erro ao carregar etapas do fluxo: ${anyStepError.message}`);
        firstStep = anySteps?.[0];
      }

      if (!firstStep) throw new Error("Fluxo sem etapas. Abra o Flow Builder e salve o fluxo novamente.");

      const firstStepStatus =
        firstStep.step_type === "delay"
          ? "waiting_delay"
          : firstStep.step_type === "no_response"
            ? "waiting_no_response"
            : firstStep.step_type === "condition"
              ? "waiting_reply"
              : "waiting_delay";

      const firstStepNextActionAt =
        firstStep.step_type === "delay"
          ? new Date(Date.now() + (firstStep.delay_minutes || 0) * 60 * 1000).toISOString()
          : firstStep.step_type === "no_response"
            ? new Date(Date.now() + (firstStep.timeout_minutes || 10) * 60 * 1000).toISOString()
            : new Date().toISOString();

      // Cancel existing active executions for all leads in bulk
      const CANCEL_BATCH = 200;
      for (let i = 0; i < leadIds.length; i += CANCEL_BATCH) {
        const batch = leadIds.slice(i, i + CANCEL_BATCH);
        await supabase
          .from("flow_executions")
          .update({ status: "cancelled" })
          .in("lead_id", batch)
          .in("status", ["running", "waiting_delay", "waiting_reply", "waiting_no_response"]);
      }

      // Insert all flow_executions in batches
      const INSERT_BATCH = 50;
      let insertedCount = 0;
      let insertErrors = 0;

      for (let i = 0; i < leadIds.length; i += INSERT_BATCH) {
        const batch = leadIds.slice(i, i + INSERT_BATCH);
        const rows = batch.map((leadId) => ({
          flow_id: flowId,
          lead_id: leadId,
          current_step_id: firstStep!.id,
          status: firstStepStatus,
          next_action_at: firstStepNextActionAt,
          metadata: { codigo: codigoMap?.[leadId] || "" },
        }));

        const { error: batchError } = await supabase.from("flow_executions").insert(rows);
        if (batchError) {
          console.error("Batch insert error:", batchError);
          insertErrors += batch.length;
        } else {
          insertedCount += batch.length;
        }
      }

      // Trigger flow-processor once (it will process pending executions)
      supabase.functions.invoke("flow-processor", { body: { auto: true } }).catch((e: any) =>
        console.error("Failed to invoke flow-processor:", e)
      );

      return { insertedCount, insertErrors };
    };

    // Helper: generate Brazilian phone variants (with/without 9th digit)
    const brazilianPhoneVariants = (phone: string): string[] => {
      const digits = phone.replace(/\D/g, "");
      const clean = digits.startsWith("55") ? digits : "55" + digits;
      const variants = [clean];
      const afterCountry = clean.slice(2);
      if (afterCountry.length === 11 && afterCountry[2] === "9") {
        variants.push("55" + afterCountry.slice(0, 2) + afterCountry.slice(3));
      } else if (afterCountry.length === 10) {
        variants.push("55" + afterCountry.slice(0, 2) + "9" + afterCountry.slice(2));
      }
      return variants;
    };

    // Helper to find existing lead by phone (does NOT create new leads)
    const findLeadByPhone = async (phone: string): Promise<string | null> => {
      const cleanPhone = phone.replace(/\D/g, "");
      const variants = brazilianPhoneVariants(cleanPhone);
      const phoneFilter = variants.map(p => `phone.eq.${p}`).join(",");
      const { data: existing } = await supabase
        .from("leads")
        .select("id")
        .or(phoneFilter)
        .limit(1);
      return existing && existing.length > 0 ? existing[0].id : null;
    };

    let lastError = "";
    const accountIds = selectedAccountIds.size > 0 ? Array.from(selectedAccountIds) : (defaultAccount ? [defaultAccount.id] : []);

    if (isCsv) {
      if (sendType === "flow" && flowIdForDispatch) {
        // Bulk flow for CSV: auto-create leads if needed, then batch insert flow executions
        const totalContacts = Array.from(csvSelectedIdxs).length;
        setDispatchProgress({ current: 0, total: totalContacts, errors: 0, errorDetails: [] });
        
        const leadIds: string[] = [];
        const codigoMap: Record<string, string> = {};
        const errorDetails: Array<{ phone: string; reason: string }> = [];
        
        // Step 1: Ensure all CSV contacts exist as leads (batch upsert)
        const UPSERT_BATCH = 50;
        const rawCsvEntries = Array.from(csvSelectedIdxs).map(idx => csvRows[idx]).filter(Boolean);
        // Deduplicate CSV entries by phone
        const csvSeenPhones = new Set<string>();
        const csvEntries = rawCsvEntries.filter(row => {
          const norm = row.telefone.replace(/\D/g, "");
          if (csvSeenPhones.has(norm)) return false;
          csvSeenPhones.add(norm);
          return true;
        });
        const csvDupesSkipped = rawCsvEntries.length - csvEntries.length;
        if (csvDupesSkipped > 0) toast.info(`${csvDupesSkipped} contato(s) duplicado(s) removidos.`);
        
        for (let i = 0; i < csvEntries.length; i += UPSERT_BATCH) {
          const batch = csvEntries.slice(i, i + UPSERT_BATCH);
          const upsertRows = batch.map(row => ({
            phone: row.telefone.length <= 11 ? `55${row.telefone}` : row.telefone,
            name: row.nome || `Contato ${row.telefone.slice(-4)}`,
            origin: "csv_import" as const,
          }));
          
          const { data: upserted, error: upsertErr } = await supabase
            .from("leads")
            .upsert(upsertRows, { onConflict: "phone", ignoreDuplicates: false })
            .select("id, phone");
          
          if (upsertErr) {
            // Fallback: try to find existing ones
            const phones = upsertRows.map(r => r.phone);
            const { data: existing } = await supabase.from("leads").select("id, phone").in("phone", phones);
            for (const ex of existing || []) {
              leadIds.push(ex.id);
              const csvRow = batch.find(r => {
                const p = r.telefone.length <= 11 ? `55${r.telefone}` : r.telefone;
                return p === ex.phone;
              });
              if (csvRow?.codigo) codigoMap[ex.id] = csvRow.codigo;
            }
            const existingPhones = new Set((existing || []).map(e => e.phone));
            for (const row of batch) {
              const phone = row.telefone.length <= 11 ? `55${row.telefone}` : row.telefone;
              if (!existingPhones.has(phone)) {
                errorDetails.push({ phone: row.telefone, reason: `Erro ao criar lead: ${upsertErr.message}` });
              }
            }
          } else {
            for (const lead of upserted || []) {
              leadIds.push(lead.id);
              const csvRow = batch.find(r => {
                const p = r.telefone.length <= 11 ? `55${r.telefone}` : r.telefone;
                return p === lead.phone;
              });
              if (csvRow?.codigo) codigoMap[lead.id] = csvRow.codigo;
            }
          }
          
          setDispatchProgress(prev => prev ? { ...prev, current: Math.min(i + UPSERT_BATCH, csvEntries.length), errors: errorDetails.length, errorDetails: [...errorDetails] } : null);
        }
        
        // Step 2: Bulk insert flow executions
        if (leadIds.length > 0) {
          try {
            const result = await startFlowBulk(leadIds, flowIdForDispatch, codigoMap);
            successCount = result.insertedCount;
            errorCount = errorDetails.length + result.insertErrors;
          } catch (e: any) {
            errorCount = leadIds.length + errorDetails.length;
            lastError = e?.message || "Erro desconhecido";
            errorDetails.push({ phone: "—", reason: e?.message || "Erro ao criar execuções" });
          }
        } else {
          errorCount = errorDetails.length;
        }
        
        setDispatchProgress(prev => prev ? { ...prev, current: totalContacts, errors: errorCount, errorDetails } : null);
      } else {
        // Deduplicate by phone
        const seenPhones = new Set<string>();
        const dedupedIdxs: number[] = [];
        for (const idx of csvSelectedIdxs) {
          const row = csvRows[idx];
          if (!row) continue;
          const normalizedPhone = row.telefone.replace(/\D/g, "");
          if (seenPhones.has(normalizedPhone)) continue;
          seenPhones.add(normalizedPhone);
          dedupedIdxs.push(idx);
        }
        const skippedDupes = Array.from(csvSelectedIdxs).length - dedupedIdxs.length;
        if (skippedDupes > 0) toast.info(`${skippedDupes} contato(s) duplicado(s) removidos.`);

        const totalContacts = dedupedIdxs.length;
        setDispatchProgress({ current: 0, total: totalContacts, errors: 0, errorDetails: [] });
        const errorDetails: Array<{ phone: string; reason: string }> = [];
        let processed = 0;
        
        let accountRR = 0;
        for (const idx of dedupedIdxs) {
          if (cancelRef.current) break;
          const row = csvRows[idx];
          if (!row) continue;
          try {
            const accountId = accountIds[accountRR % accountIds.length];
            accountRR++;
            const body: any = { phone: row.telefone, account_id: accountId };
            if (sendType === "template" && selectedTemplate?.template_name) {
              body.template_name = selectedTemplate.template_name;
              body.template_language = selectedTemplate.template_language || "pt_BR";
              body.template_params = resolveParams((selectedTemplate.template_params || []) as any[], row.nome, row.codigo);
            } else {
              body.message = customMessage
                .replace(/\{nome\}/g, row.nome.split(" ")[0])
                .replace(/\{codigo\}/g, row.codigo);
            }
            const { data: sendData, error } = await supabase.functions.invoke("whatsapp-cloud-send", { body });
            if (error) throw error;
            if (sendData?.error) throw new Error(sendData.error);
            successCount++;
          } catch (e: any) {
            errorCount++;
            lastError = e?.message || "Erro desconhecido";
            errorDetails.push({ phone: row.telefone, reason: e?.message || "Erro desconhecido" });
          }
          processed++;
          setDispatchProgress({ current: processed, total: totalContacts, errors: errorCount, errorDetails: [...errorDetails] });
        }
      }
    } else {
      if (sendType === "flow" && flowIdForDispatch) {
        const leadIds = Array.from(selectedLeads);
        const totalContacts = leadIds.length;
        setDispatchProgress({ current: 0, total: totalContacts, errors: 0, errorDetails: [] });
        try {
          const result = await startFlowBulk(leadIds, flowIdForDispatch);
          successCount = result.insertedCount;
          errorCount += result.insertErrors;
        } catch (e: any) {
          errorCount += leadIds.length;
          lastError = e?.message || "Erro desconhecido";
        }
        setDispatchProgress({ current: totalContacts, total: totalContacts, errors: errorCount, errorDetails: [] });
      } else {
        const leadIds = Array.from(selectedLeads);
        const totalContacts = leadIds.length;
        setDispatchProgress({ current: 0, total: totalContacts, errors: 0, errorDetails: [] });
        const errorDetails: Array<{ phone: string; reason: string }> = [];
        let processed = 0;
        
        const seenPhones2 = new Set<string>();
        let accountRR2 = 0;
        for (const leadId of leadIds) {
          if (cancelRef.current) break;
          const lead = leads?.find((l) => l.id === leadId);
          if (!lead) continue;
          const normPhone = lead.phone.replace(/\D/g, "");
          if (seenPhones2.has(normPhone)) { processed++; continue; }
          seenPhones2.add(normPhone);
          try {
            const accountId = accountIds[accountRR2 % accountIds.length];
            accountRR2++;
            const body: any = { phone: lead.phone, lead_id: lead.id, account_id: accountId };
            if (sendType === "template" && selectedTemplate?.template_name) {
              body.template_name = selectedTemplate.template_name;
              body.template_language = selectedTemplate.template_language || "pt_BR";
              body.template_params = resolveParams((selectedTemplate.template_params || []) as any[], lead.name, "");
            } else {
              body.message = customMessage.replace(/\{nome\}/g, lead.name.split(" ")[0]);
            }
            const { data: sendData2, error } = await supabase.functions.invoke("whatsapp-cloud-send", { body });
            if (error) throw error;
            if (sendData2?.error) throw new Error(sendData2.error);
            successCount++;
          } catch (e: any) {
            errorCount++;
            lastError = e?.message || "Erro desconhecido";
            errorDetails.push({ phone: lead.phone, reason: e?.message || "Erro desconhecido" });
          }
          processed++;
          setDispatchProgress({ current: processed, total: totalContacts, errors: errorCount, errorDetails: [...errorDetails] });
        }
      }
    }

    setIsSending(false);
    const action = sendType === "flow" ? "fluxo(s) iniciado(s)" : "mensagem(ns) enviada(s)";
    if (successCount > 0) toast.success(`${successCount} ${action} com sucesso!`);
    if (errorCount > 0) toast.error(`${errorCount} falharam. ${lastError}`);
    if (successCount > 0) {
      setSelectedLeads(new Set());
      setCsvSelectedIdxs(new Set());
    }
  };

  const activeCount = mode === "csv" ? csvSelectedIdxs.size : selectedLeads.size;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="queue" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="queue" className="gap-1.5">
            <Send size={14} /> Fila de Disparos
          </TabsTrigger>
          <TabsTrigger value="simple" className="gap-1.5">
            <MessageCircle size={14} /> Disparo Simples
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-1.5">
            <Users size={14} /> Importar Contatos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4">
          <BroadcastQueue />
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          <ContactImporter />
        </TabsContent>

        <TabsContent value="simple" className="mt-4 space-y-6">

      {/* Mode toggle */}
      <div className="flex flex-wrap gap-2">
        <Button variant={mode === "leads" ? "default" : "outline"} size="sm" onClick={() => setMode("leads")}>
          <Users size={14} className="mr-1.5" /> Leads cadastrados
        </Button>
        <Button variant={mode === "csv" ? "default" : "outline"} size="sm" onClick={() => setMode("csv")}>
          <FileText size={14} className="mr-1.5" /> Importar CSV
        </Button>
        <Button variant="outline" size="sm" onClick={handleLoadLastBroadcast}>
          <ArrowLeft size={14} className="mr-1.5" /> Último disparo
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowAddLead(!showAddLead)}>
          <Users size={14} className="mr-1.5" /> {showAddLead ? "Fechar" : "Adicionar lead"}
        </Button>
      </div>

      {/* Add lead form */}
      {showAddLead && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome</Label>
                <Input placeholder="Nome do lead" value={newLeadName} onChange={(e) => setNewLeadName(e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefone</Label>
                <Input placeholder="5511999999999" value={newLeadPhone} onChange={(e) => setNewLeadPhone(e.target.value)} className="h-9 text-sm font-mono" />
              </div>
              <div className="flex items-end">
                <Button onClick={handleAddLead} disabled={isAddingLead} size="sm" className="w-full">
                  {isAddingLead ? "Salvando..." : "Adicionar"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: Contact selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users size={18} />
              {mode === "csv" ? `Contatos importados (${csvSelectedIdxs.size}/${csvRows.length})` : `Selecionar Leads (${selectedLeads.size})`}
            </CardTitle>
            {mode === "leads" && (
              <div className="relative mt-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar lead..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            )}
            {mode === "csv" && csvRows.length === 0 && (
              <div className="mt-2">
                <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                <Button variant="outline" size="sm" className="w-full" onClick={() => csvInputRef.current?.click()}>
                  <FileText size={14} className="mr-1.5" /> Selecionar arquivo CSV
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Colunas obrigatórias: <code>nome</code>, <code>telefone</code><br />
                  Coluna opcional: <code>codigo</code>
                </p>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {mode === "leads" && (
              <>
                <div className="px-4 py-2 border-b border-border">
                  <button onClick={toggleAll} className="text-xs text-primary hover:underline">
                    {selectedLeads.size === filteredLeads.length ? "Desmarcar todos" : "Selecionar todos"}
                  </button>
                </div>
                <ScrollArea className="h-[320px]">
                  {filteredLeads.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => toggleLead(lead.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/40",
                        selectedLeads.has(lead.id) && "bg-primary/5"
                      )}
                    >
                      <Checkbox checked={selectedLeads.has(lead.id)} className="pointer-events-none" />
                      <Avatar className="w-8 h-8">
                        {lead.photo_url && <AvatarImage src={lead.photo_url} />}
                        <AvatarFallback className={cn(getAvatarColor(lead.name), "text-white text-xs")}>
                          {getInitials(lead.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{lead.name}</p>
                        <p className="text-xs text-muted-foreground">{lead.phone}</p>
                      </div>
                    </button>
                  ))}
                  {filteredLeads.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead encontrado</p>
                  )}
                </ScrollArea>
              </>
            )}

            {mode === "csv" && csvRows.length > 0 && (
              <>
                <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                  <button onClick={toggleCsvAll} className="text-xs text-primary hover:underline">
                    {csvSelectedIdxs.size === csvRows.length ? "Desmarcar todos" : "Selecionar todos"}
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => csvInputRef.current?.click()} className="text-xs text-primary hover:underline">
                      Reimportar
                    </button>
                    <button onClick={() => { setCsvRows([]); setCsvSelectedIdxs(new Set()); }} className="text-xs text-destructive hover:underline">
                      Limpar
                    </button>
                  </div>
                  <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                </div>
                <ScrollArea className="h-[320px]">
                  {csvRows.map((row, idx) => (
                    <button
                      key={idx}
                      onClick={() => toggleCsvRow(idx)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/40",
                        csvSelectedIdxs.has(idx) && "bg-primary/5"
                      )}
                    >
                      <Checkbox checked={csvSelectedIdxs.has(idx)} className="pointer-events-none" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{row.nome}</p>
                        <p className="text-xs text-muted-foreground">{row.telefone}</p>
                      </div>
                      {row.codigo && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          <Package size={10} className="mr-1" />
                          {row.codigo}
                        </Badge>
                      )}
                    </button>
                  ))}
                </ScrollArea>
              </>
            )}
          </CardContent>
        </Card>

        {/* Right: Message / Template / Flow */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send size={18} />
              Tipo de Disparo
            </CardTitle>
            <CardDescription>
              Escolha enviar um template, iniciar um fluxo ou mensagem personalizada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Send type selector */}
            <div className="flex gap-2">
              <Button variant={sendType === "template" ? "default" : "outline"} size="sm" onClick={() => { setSendType("template"); setSelectedFlowId(null); }}>
                <FileText size={14} className="mr-1.5" /> Template
              </Button>
              <Button variant={sendType === "flow" ? "default" : "outline"} size="sm" onClick={() => { setSendType("flow"); setSelectedTemplateId(null); setCustomMessage(""); }}>
                <Package size={14} className="mr-1.5" /> Fluxo
              </Button>
              <Button variant={sendType === "custom" ? "default" : "outline"} size="sm" onClick={() => { setSendType("custom"); setSelectedTemplateId(null); setSelectedFlowId(null); }}>
                <MessageCircle size={14} className="mr-1.5" /> Personalizada
              </Button>
            </div>

            {/* Template selection */}
            {sendType === "template" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Template aprovado pela Meta</Label>
                  <select
                    value={selectedTemplateId || ""}
                    onChange={(e) => setSelectedTemplateId(e.target.value || null)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Selecione um template...</option>
                    {templates?.map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.template_name ? `(API: ${t.template_name})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedTemplate && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Pré-visualização:</p>
                    <p className="text-sm whitespace-pre-wrap">{selectedTemplate.content}</p>
                    {selectedTemplate.template_name && (
                      <Badge variant="secondary" className="mt-1 text-xs">API: {selectedTemplate.template_name}</Badge>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Flow selection */}
            {sendType === "flow" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Fluxo ativo</Label>
                  <select
                    value={selectedFlowId || ""}
                    onChange={(e) => setSelectedFlowId(e.target.value || null)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Selecione um fluxo...</option>
                    {flows?.map((f: any) => (
                      <option key={f.id} value={f.id}>
                        {f.name} {f.description ? `— ${f.description}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedFlow && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Fluxo selecionado:</p>
                    <p className="text-sm font-medium">{selectedFlow.name}</p>
                    {selectedFlow.description && <p className="text-xs text-muted-foreground">{selectedFlow.description}</p>}
                  </div>
                )}
                {(!flows || flows.length === 0) && (
                  <p className="text-xs text-muted-foreground">Nenhum fluxo ativo encontrado. Crie um fluxo abaixo primeiro.</p>
                )}
              </div>
            )}

            {/* Custom message */}
            {sendType === "custom" && (
              <div className="space-y-2">
                <Label>Mensagem personalizada (use {"{nome}"}, {"{codigo}"})</Label>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="Olá {nome}! Seu código: {codigo}"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[120px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  rows={5}
                />
              </div>
            )}

            {sendType !== "flow" && (
              <AccountSelector
                accounts={accounts}
                selectedIds={selectedAccountIds}
                onToggle={toggleAccount}
                mode="multi"
                label="Contas para envio"
              />
            )}

            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {sendType === "flow"
                  ? "⚠️ O fluxo será iniciado para cada contato selecionado. As mensagens serão enviadas conforme as etapas configuradas."
                  : "⚠️ Para contatos que não enviaram mensagem nas últimas 24h, use um template aprovado pela Meta."}
              </p>
            </div>

            <Button
              onClick={handleSendBroadcast}
              disabled={isSending || activeCount === 0 || (sendType === "template" && !selectedTemplateId) || (sendType === "flow" && !selectedFlowId) || (sendType === "custom" && !customMessage.trim())}
              className="w-full"
            >
              {isSending ? (
                "Enviando..."
              ) : (
                <>
                  <Send size={16} />
                  {sendType === "flow" ? `Iniciar fluxo para ${activeCount} contato(s)` : `Disparar para ${activeCount} contato(s)`}
                </>
              )}
            </Button>

            {/* Progress bar */}
            {dispatchProgress && (
              <div className="space-y-2 mt-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-muted-foreground">
                      {isSending ? (cancelRef.current ? "Cancelando..." : "Processando...") : "Concluído"}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-muted-foreground">
                        {dispatchProgress.current}/{dispatchProgress.total} ({Math.round((dispatchProgress.current / Math.max(dispatchProgress.total, 1)) * 100)}%)
                      </span>
                      {isSending && !cancelRef.current && (
                        <Button size="sm" variant="destructive" className="h-5 text-[10px] px-2" onClick={() => { cancelRef.current = true; }}>
                          Pausar
                        </Button>
                      )}
                    </div>
                  </div>
                  <Progress value={(dispatchProgress.current / Math.max(dispatchProgress.total, 1)) * 100} className="h-2.5 bg-muted" />
                </div>
                
                {dispatchProgress.errors > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-destructive font-medium">
                      ⚠️ {dispatchProgress.errors} erro(s) encontrado(s)
                    </p>
                    {dispatchProgress.errorDetails.length > 0 && (
                      <ScrollArea className="h-[100px] rounded border bg-muted/30">
                        <div className="p-2 space-y-1">
                          {dispatchProgress.errorDetails.slice(0, 50).map((err, i) => (
                            <div key={i} className="text-[10px] flex items-start gap-1">
                              <AlertCircle size={10} className="text-destructive shrink-0 mt-0.5" />
                              <span className="font-mono text-muted-foreground">{err.phone}</span>
                              <span className="text-destructive truncate">— {err.reason}</span>
                            </div>
                          ))}
                          {dispatchProgress.errorDetails.length > 50 && (
                            <p className="text-[10px] text-muted-foreground">... e mais {dispatchProgress.errorDetails.length - 50} erro(s)</p>
                          )}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                )}
                
                {!isSending && dispatchProgress.errors === 0 && dispatchProgress.current === dispatchProgress.total && (
                  <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 size={14} /> Todos processados com sucesso!
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

        </TabsContent>
      </Tabs>

      {/* Template Manager */}
      <TemplateManager />

      {/* Template & Account overview bar */}
      <TemplateAccountBar />
    </div>
  );
}

/* ══════════════════════════════════════════════════
   CHAT TAB COMPONENT
   ══════════════════════════════════════════════════ */
function CloudChatTab() {
  const { user } = useAuth();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);
  const [filterLabelId, setFilterLabelId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [labelsDialogOpen, setLabelsDialogOpen] = useState(false);
  const { accounts } = useWhatsAppAccounts();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { labels, leadLabelsMap } = useLabels();

  // Fetch profiles for assignment
  const { data: profiles = [] } = useQuery({
    queryKey: ["chat-profiles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, display_name");
      return data || [];
    },
  });

  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts]);
  const accountIdsKey = useMemo(() => accountIds.slice().sort().join(","), [accountIds]);

  const { data: visibleLeadIds = [] } = useQuery({
    queryKey: ["cloud-chat-visible-leads", user?.id, accountIdsKey],
    enabled: !!user && accountIds.length > 0,
    queryFn: async () => {
      const leadIds = new Set<string>();

      const { data: ownMessageLogs } = await supabase
        .from("message_logs")
        .select("lead_id")
        .not("lead_id", "is", null);

      for (const log of ownMessageLogs || []) {
        if (log.lead_id) leadIds.add(log.lead_id);
      }

      const { data: scopedMessages } = await supabase
        .from("chat_messages")
        .select("lead_id, account_id")
        .in("account_id", accountIds);

      for (const scopedMessage of scopedMessages || []) {
        if (scopedMessage.lead_id) leadIds.add(scopedMessage.lead_id);
      }

      return Array.from(leadIds);
    },
  });

  const visibleLeadIdsKey = useMemo(() => visibleLeadIds.slice().sort().join(","), [visibleLeadIds]);

  const { data: leads } = useQuery({
    queryKey: ["cloud-chat-leads", user?.id, visibleLeadIdsKey],
    enabled: !!user,
    queryFn: async () => {
      if (visibleLeadIds.length === 0) return [];
      const { data } = await supabase
        .from("leads")
        .select("id, name, phone, photo_url, assigned_to, last_outbound_at, last_inbound_at, chat_status")
        .in("id", visibleLeadIds)
        .order("name");
      return data || [];
    },
  });

  const { data: leadAccountMap } = useQuery({
    queryKey: ["cloud-chat-lead-accounts", user?.id, accountIdsKey],
    enabled: !!user && accountIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, Set<string>>();

      const { data: ownMessageLogs } = await supabase
        .from("message_logs")
        .select("lead_id, account_id")
        .not("lead_id", "is", null)
        .not("account_id", "is", null);

      for (const log of ownMessageLogs || []) {
        if (!log.account_id || !log.lead_id) continue;
        if (!map.has(log.account_id)) map.set(log.account_id, new Set());
        map.get(log.account_id)!.add(log.lead_id);
      }

      const { data: scopedMessages } = await supabase
        .from("chat_messages")
        .select("lead_id, account_id")
        .in("account_id", accountIds);

      for (const scopedMessage of scopedMessages || []) {
        if (!scopedMessage.account_id || !scopedMessage.lead_id) continue;
        if (!map.has(scopedMessage.account_id)) map.set(scopedMessage.account_id, new Set());
        map.get(scopedMessage.account_id)!.add(scopedMessage.lead_id);
      }

      return map;
    },
  });

  const { data: latestMessages } = useQuery({
    queryKey: ["cloud-chat-latest", user?.id, accountIdsKey, visibleLeadIdsKey],
    enabled: !!user,
    queryFn: async () => {
      const map = new Map<string, { content: string; created_at: string; direction: string; account_id: string | null }>();
      if (visibleLeadIds.length === 0 || accountIds.length === 0) return map;

      const { data } = await supabase
        .from("chat_messages")
        .select("lead_id, content, created_at, direction, account_id")
        .in("lead_id", visibleLeadIds)
        .in("account_id", accountIds)
        .order("created_at", { ascending: false });

      for (const item of data || []) {
        if (!map.has(item.lead_id)) map.set(item.lead_id, item);
      }
      return map;
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["cloud-chat-messages", user?.id, selectedLeadId, accountIdsKey],
    queryFn: async () => {
      if (!selectedLeadId || accountIds.length === 0) return [];
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("lead_id", selectedLeadId)
        .in("account_id", accountIds)
        .order("created_at", { ascending: true });
      return data || [];
    },
    enabled: !!selectedLeadId && accountIds.length > 0,
  });

  const { templates } = useUserTemplates();

  const selectedLead = leads?.find((l) => l.id === selectedLeadId);
  const activeAccountId = useMemo(() => {
    if (filterAccountId) return filterAccountId;
    if (selectedLeadId) {
      const latestForLead = latestMessages?.get(selectedLeadId);
      if (latestForLead?.account_id) return latestForLead.account_id;
    }
    return accounts[0]?.id || null;
  }, [filterAccountId, selectedLeadId, latestMessages, accounts]);

  // 24h window helper
  const get24hWindow = (lead: any) => {
    const timestamps = [lead.last_inbound_at, lead.last_outbound_at]
      .filter(Boolean)
      .map((value: string) => new Date(value).getTime())
      .filter((value) => !Number.isNaN(value));

    if (timestamps.length === 0) return { active: false, remaining: 0, label: "Fechada" };

    const lastActivity = Math.max(...timestamps);
    const now = new Date();
    const diff = 24 * 60 * 60 * 1000 - (now.getTime() - lastActivity);
    if (diff <= 0) return { active: false, remaining: 0, label: "Fechada" };
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
    return { active: true, remaining: diff, label: `${hours}h${mins.toString().padStart(2, "0")}m` };
  };

  // Assign lead to user
  const assignMutation = useMutation({
    mutationFn: async ({ leadId, userId }: { leadId: string; userId: string | null }) => {
      const { error } = await supabase.from("leads").update({ assigned_to: userId }).eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-leads"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("cloud-chat-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => {
        queryClient.invalidateQueries({ queryKey: ["cloud-chat-messages", user?.id, selectedLeadId] });
        queryClient.invalidateQueries({ queryKey: ["cloud-chat-latest"] });
        queryClient.invalidateQueries({ queryKey: ["cloud-chat-leads"] });
        queryClient.invalidateQueries({ queryKey: ["cloud-chat-lead-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["cloud-chat-visible-leads"] });
      })
      .subscribe();
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-messages", user?.id, selectedLeadId] });
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-latest"] });
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-lead-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-visible-leads"] });
    }, 5000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [selectedLeadId, queryClient, user?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 100) + "px";
    }
  }, [message]);

  const sendMutation = useMutation({
    mutationFn: async ({ text, mediaUrl, mediaType, templateName, templateLanguage, templateParams }: { text?: string; mediaUrl?: string; mediaType?: string; templateName?: string; templateLanguage?: string; templateParams?: any[] }) => {
      if (!selectedLead) throw new Error("No lead");
      if (!activeAccountId) throw new Error("Nenhuma conta disponível para envio");
      const { data, error } = await supabase.functions.invoke("whatsapp-cloud-send", {
        body: { phone: selectedLead.phone, message: text || "", lead_id: selectedLead.id, media_url: mediaUrl, media_type: mediaType, template_name: templateName, template_language: templateLanguage, template_params: templateParams, account_id: activeAccountId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-messages", user?.id, selectedLeadId] });
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-latest"] });
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-leads"] });
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-lead-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-visible-leads"] });
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });

  const uploadAndSendMedia = useCallback(async (file: File) => {
    if (!selectedLead) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("lead_id", selectedLead.id);
      const { data, error } = await supabase.functions.invoke("chat-upload-media", { body: formData });
      if (error) throw error;
      sendMutation.mutate({ mediaUrl: data.url, mediaType: data.media_type });
    } catch (err: any) {
      toast.error(`Erro no upload: ${err.message}`);
    }
  }, [selectedLead, sendMutation]);

  const handleAudioRecorded = useCallback((blob: Blob) => {
    uploadAndSendMedia(new File([blob], "audio.webm", { type: "audio/webm" }));
  }, [uploadAndSendMedia]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAndSendMedia(file);
    if (e.target) e.target.value = "";
  }, [uploadAndSendMedia]);

  const handleSend = () => { const t = message.trim(); if (t) sendMutation.mutate({ text: t }); };
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  const filteredLeads = useMemo(() => {
    if (!leads || !latestMessages) return [];
    const s = search.toLowerCase();
    return leads.filter((l) => {
      if (!latestMessages.has(l.id)) return false;
      if (!(l.name.toLowerCase().includes(s) || l.phone.includes(s))) return false;
      if (filterAccountId && !leadAccountMap?.get(filterAccountId)?.has(l.id)) return false;
      if (filterLabelId && !leadLabelsMap.get(l.id)?.has(filterLabelId)) return false;
      if (filterStatus === "open") {
        const w = get24hWindow(l);
        if (!w.active) return false;
      }
      if (filterStatus === "closed") {
        const w = get24hWindow(l);
        if (w.active) return false;
      }
      if (filterStatus === "mine" && l.assigned_to !== user?.id) return false;
      if (filterStatus === "unassigned" && l.assigned_to) return false;
      return true;
    });
  }, [leads, search, latestMessages, filterAccountId, leadAccountMap, filterLabelId, leadLabelsMap, filterStatus, user]);

  const sortedLeads = useMemo(() => {
    return [...filteredLeads].sort((a, b) => {
      const ma = latestMessages?.get(a.id);
      const mb = latestMessages?.get(b.id);
      if (ma && mb) return new Date(mb.created_at).getTime() - new Date(ma.created_at).getTime();
      if (ma) return -1;
      if (mb) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredLeads, latestMessages]);

  const groupedMessages = useMemo(() => {
    if (!messages) return [];
    const groups: { date: Date; messages: typeof messages }[] = [];
    for (const msg of messages) {
      const msgDate = new Date(msg.created_at);
      const last = groups[groups.length - 1];
      if (last && isSameDay(last.date, msgDate)) last.messages.push(msg);
      else groups.push({ date: msgDate, messages: [msg] });
    }
    return groups;
  }, [messages]);

  return (
    <>
      <ChatLabelsManager open={labelsDialogOpen} onOpenChange={setLabelsDialogOpen} />
      <div className="flex h-full flex-1 overflow-hidden bg-card min-h-0">
        {/* Contact list */}
        <div className={cn("w-[300px] flex flex-col border-r border-border", selectedLeadId ? "hidden md:flex" : "flex flex-1 md:flex-none md:w-[300px]")}>
          <div className="p-2.5 border-b border-border space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar lead..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
            </div>
            {/* Filters row */}
            <div className="flex gap-1 flex-wrap">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">Todos</option>
                <option value="open">🟢 Janela aberta</option>
                <option value="closed">🔴 Janela fechada</option>
                <option value="mine">👤 Meus</option>
                <option value="unassigned">⚪ Sem atendente</option>
              </select>
              {labels.length > 0 && (
                <select
                  value={filterLabelId || ""}
                  onChange={(e) => setFilterLabelId(e.target.value || null)}
                  className="rounded-md border border-input bg-background px-2 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Etiqueta</option>
                  {labels.map((l: any) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              )}
              {accounts.length > 1 && (
                <select
                  value={filterAccountId || ""}
                  onChange={(e) => setFilterAccountId(e.target.value || null)}
                  className="rounded-md border border-input bg-background px-2 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Conta</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
              <button
                onClick={() => setLabelsDialogOpen(true)}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Gerenciar etiquetas"
              >
                <Tag size={14} />
              </button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            {sortedLeads.map((lead) => {
              const latest = latestMessages?.get(lead.id);
              const window24h = get24hWindow(lead);
              const leadLabelIds = leadLabelsMap.get(lead.id);
              const assignedProfile = profiles.find((p) => p.user_id === lead.assigned_to);
              return (
                <button
                  key={lead.id}
                  onClick={() => setSelectedLeadId(lead.id)}
                  className={cn("w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors", lead.id === selectedLeadId && "bg-accent/80")}
                >
                  <Avatar className="w-9 h-9">
                    {lead.photo_url && <AvatarImage src={lead.photo_url} />}
                    <AvatarFallback className={cn(getAvatarColor(lead.name), "text-white text-xs")}>{getInitials(lead.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{lead.name}</p>
                      <span className={cn("w-2 h-2 rounded-full flex-shrink-0", window24h.active ? "bg-emerald-500" : "bg-destructive/50")} title={window24h.active ? `Janela: ${window24h.label}` : "Janela fechada"} />
                    </div>
                    {latest && <p className="text-xs text-muted-foreground truncate">{latest.content}</p>}
                    <div className="flex items-center gap-1 mt-0.5">
                      {leadLabelIds && labels.filter((l: any) => leadLabelIds.has(l.id)).slice(0, 2).map((l: any) => (
                        <span key={l.id} className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} title={l.name} />
                      ))}
                      {assignedProfile && (
                        <span className="text-[9px] text-muted-foreground ml-auto">👤 {assignedProfile.display_name?.split(" ")[0]}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {latest && <span className="text-[10px] text-muted-foreground">{isToday(new Date(latest.created_at)) ? format(new Date(latest.created_at), "HH:mm") : format(new Date(latest.created_at), "dd/MM")}</span>}
                    {window24h.active && <span className="text-[9px] text-emerald-600 font-medium">{window24h.label}</span>}
                  </div>
                </button>
              );
            })}
          </ScrollArea>
        </div>

        {/* Chat area */}
        {selectedLeadId && selectedLead ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Header */}
            <div className="px-3 py-2 flex items-center gap-2 border-b border-border bg-muted/30">
              <button onClick={() => setSelectedLeadId(null)} className="md:hidden p-1 rounded hover:bg-accent">
                <ArrowLeft size={18} />
              </button>
              <Avatar className="w-8 h-8">
                {selectedLead.photo_url && <AvatarImage src={selectedLead.photo_url} />}
                <AvatarFallback className={cn(getAvatarColor(selectedLead.name), "text-white text-xs")}>{getInitials(selectedLead.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{selectedLead.name}</p>
                  {(() => {
                    const w = get24hWindow(selectedLead);
                    return (
                      <Badge variant={w.active ? "default" : "secondary"} className={cn("text-[10px] px-1.5 py-0", w.active ? "bg-emerald-600" : "")}>
                        {w.active ? `⏱ ${w.label}` : "Janela fechada"}
                      </Badge>
                    );
                  })()}
                </div>
                <p className="text-[11px] text-muted-foreground">{selectedLead.phone}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Assign to user */}
                <select
                  value={selectedLead.assigned_to || ""}
                  onChange={(e) => assignMutation.mutate({ leadId: selectedLead.id, userId: e.target.value || null })}
                  className="rounded-md border border-input bg-background px-2 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-w-[120px]"
                >
                  <option value="">Sem atendente</option>
                  {profiles.map((p) => (
                    <option key={p.user_id} value={p.user_id}>{p.display_name || "Usuário"}</option>
                  ))}
                </select>
                {/* Labels dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                      <Tag size={14} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Etiquetas</div>
                    <LeadLabelSelector leadId={selectedLead.id} labels={labels} leadLabelsMap={leadLabelsMap} />
                    {labels.length === 0 && (
                      <p className="text-xs text-muted-foreground px-2 py-2">Crie etiquetas primeiro</p>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Lead labels bar */}
            {(() => {
              const ids = leadLabelsMap.get(selectedLead.id);
              const activeLabels = ids ? labels.filter((l: any) => ids.has(l.id)) : [];
              if (activeLabels.length === 0) return null;
              return (
                <div className="px-3 py-1.5 border-b border-border flex gap-1 flex-wrap bg-muted/20">
                  {activeLabels.map((l: any) => (
                    <Badge key={l.id} style={{ backgroundColor: l.color, color: "#fff" }} className="text-[10px]">
                      {l.name}
                    </Badge>
                  ))}
                </div>
              );
            })()}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-2" style={{ backgroundColor: "hsl(30 20% 93%)", backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.02'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")` }}>
              {messages?.length === 0 && (
                <div className="flex justify-center py-8">
                  <div className="bg-card/90 backdrop-blur rounded-lg px-5 py-2 shadow-sm">
                    <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda 💬</p>
                  </div>
                </div>
              )}
              {groupedMessages.map((group, gi) => (
                <div key={gi}>
                  <div className="flex justify-center my-2">
                    <span className="bg-card/90 backdrop-blur text-muted-foreground text-[11px] font-medium px-3 py-1 rounded-md shadow-sm uppercase tracking-wide">
                      {formatDateSeparator(group.date)}
                    </span>
                  </div>
                  {group.messages.map((msg, mi) => {
                    const isOutbound = msg.direction === "outbound";
                    const prevMsg = mi > 0 ? group.messages[mi - 1] : null;
                    const showTail = !prevMsg || prevMsg.direction !== msg.direction;
                    return (
                      <div key={msg.id} className={cn("flex mb-[2px]", isOutbound ? "justify-end" : "justify-start", showTail && "mt-2")}>
                        <div className={cn(
                          "relative max-w-[85%] px-[9px] pt-[6px] pb-2 text-[13px] leading-[18px] shadow-sm",
                          isOutbound ? "bg-[#d9fdd3] text-[#111b21] rounded-lg" : "bg-card text-foreground rounded-lg",
                          showTail && isOutbound && "rounded-tr-none",
                          showTail && !isOutbound && "rounded-tl-none"
                        )}>
                          {showTail && (
                            <div className={cn("absolute top-0 w-2 h-3", isOutbound ? "-right-2" : "-left-2")}>
                              <svg viewBox="0 0 8 13" width="8" height="13">
                                {isOutbound ? (
                                  <path fill="#d9fdd3" d="M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" />
                                ) : (
                                  <path fill="hsl(var(--card))" d="M6.467 3.568 0 12.193V1h5.188c1.77 0 2.338 1.156 1.28 2.568z" />
                                )}
                              </svg>
                            </div>
                          )}
                          {msg.media_url && msg.media_type ? (
                            <div className="mb-1">
                              <ChatMediaBubble mediaType={msg.media_type} mediaUrl={msg.media_url} caption={msg.media_type !== "audio" ? msg.content : undefined} isOutbound={isOutbound} />
                              <span className="inline-block w-[55px]" />
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-words">
                              {msg.content}
                              <span className="inline-block w-[55px]" />
                            </p>
                          )}
                          <span className={cn("absolute bottom-[4px] right-[6px] flex items-center gap-[2px]", isOutbound ? "text-[#667781]" : "text-muted-foreground")}>
                            <span className="text-[11px] leading-none">{format(new Date(msg.created_at), "HH:mm")}</span>
                            {isOutbound && <CheckCheck size={13} className={msg.status === "read" ? "text-sky-400" : "opacity-60"} />}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input area */}
            <div className="px-3 py-2 bg-muted/50 border-t border-border">
              {(() => {
                const w = get24hWindow(selectedLead);
                if (!w.active) {
                  return (
                    <div className="flex items-center justify-center gap-2 py-2">
                      <Badge variant="secondary" className="text-xs">🔒 Janela de 24h fechada</Badge>
                      <p className="text-xs text-muted-foreground">Use um template para reabrir a conversa</p>
                      {templates && templates.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="gap-1 text-xs h-7">
                              <FileText size={12} /> Enviar Template
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-72 max-h-64 overflow-y-auto">
                            {templates.filter((t: any) => t.template_name).map((t: any) => (
                              <DropdownMenuItem
                                key={t.id}
                                onClick={() => {
                                  const resolvedParams = ((t.template_params || []) as any[]).map((p: any) => {
                                    const text = typeof p === "string" ? p : p?.text || "";
                                    return { type: "text", text: text.replace(/\{nome\}/g, selectedLead?.name?.split(" ")[0] || "") };
                                  });
                                  const hasUnresolved = resolvedParams.some((p: any) => !p.text || /\{.*\}/.test(p.text));
                                  if (hasUnresolved) { toast.error("Template requer parâmetros manuais. Use a aba Disparo."); return; }
                                  sendMutation.mutate({ templateName: t.template_name, templateLanguage: t.template_language || "pt_BR", templateParams: resolvedParams });
                                }}
                                className="flex flex-col items-start gap-0.5"
                              >
                                <span className="font-medium text-sm">{t.name}</span>
                                <span className="text-xs text-muted-foreground line-clamp-2">{t.content}</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
              <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={handleFileSelect} />
              <div className="flex items-end gap-1.5">
                {templates && templates.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mb-[2px]">
                        <FileText size={18} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-72 max-h-64 overflow-y-auto">
                      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase">Templates</div>
                      {templates.map((t: any) => (
                        <DropdownMenuItem 
                          key={t.id} 
                          onClick={() => {
                            if (t.template_name) {
                              const resolvedParams = ((t.template_params || []) as any[]).map((p: any) => {
                                const text = typeof p === "string" ? p : p?.text || "";
                                return { type: "text", text: text.replace(/\{nome\}/g, selectedLead?.name?.split(" ")[0] || "") };
                              });
                              const hasUnresolved = resolvedParams.some((p: any) => !p.text || /\{.*\}/.test(p.text));
                              if (hasUnresolved) { toast.error("Este template requer parâmetros que não podem ser preenchidos automaticamente no chat. Use a aba Rastreio ou Disparo."); return; }
                              sendMutation.mutate({ templateName: t.template_name, templateLanguage: t.template_language || "pt_BR", templateParams: resolvedParams });
                            } else {
                              setMessage(t.content);
                            }
                          }} 
                          className="flex flex-col items-start gap-0.5"
                        >
                          <span className="font-medium text-sm flex items-center gap-1.5">
                            {t.name}
                            {t.template_name && <Badge variant="secondary" className="text-[10px] px-1 py-0">API</Badge>}
                          </span>
                          <span className="text-xs text-muted-foreground line-clamp-2">{t.content}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mb-[2px]">
                  <Paperclip size={18} />
                </button>
                <div className="flex-1 bg-card rounded-lg border border-border shadow-sm overflow-hidden">
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Digite uma mensagem"
                    className="w-full px-3 py-[8px] text-[13px] bg-transparent outline-none resize-none placeholder:text-muted-foreground max-h-[100px]"
                    rows={1}
                    style={{ minHeight: "34px" }}
                  />
                </div>
                {message.trim() ? (
                  <button onClick={handleSend} disabled={sendMutation.isPending} className="p-2 rounded-full flex-shrink-0 mb-[2px] bg-primary text-primary-foreground hover:opacity-90 transition-colors">
                    <Send size={16} />
                  </button>
                ) : (
                  <AudioRecorder onRecorded={handleAudioRecorded} disabled={sendMutation.isPending} />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-muted/20">
            <div className="text-center space-y-2">
              <MessageCircle size={48} className="mx-auto text-muted-foreground/30" />
              <p className="text-muted-foreground text-sm">Selecione um lead para conversar</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════ */
export default function WhatsAppApi() {
  const { user, session, signOut } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: isAdmin } = useQuery({
    queryKey: ["user-role", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState("webhook");
  const [flowTriggerType, setFlowTriggerType] = useState<string | undefined>(undefined);

  const handleCreateFlowFromWebhook = useCallback((triggerType: string) => {
    setFlowTriggerType(triggerType);
    setActiveMainTab("flows");
  }, []);

  const [verifyToken, setVerifyToken] = useState("");
  const [isSavingToken, setIsSavingToken] = useState(false);

  // Load verify token from database
  useEffect(() => {
    supabase.from("app_settings").select("value").eq("key", "whatsapp_verify_token").maybeSingle().then(({ data }) => {
      if (data?.value) {
        setVerifyToken(data.value);
      } else {
        // Generate default token if none exists
        const generated = "meno_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
        setVerifyToken(generated);
      }
    });
  }, []);

  const handleSaveVerifyToken = async () => {
    if (!verifyToken.trim()) {
      toast.error("Informe um token de verificação.");
      return;
    }
    setIsSavingToken(true);
    try {
      const { error } = await supabase.from("app_settings").upsert({ key: "whatsapp_verify_token", value: verifyToken.trim(), updated_at: new Date().toISOString() });
      if (error) throw error;
      toast.success("Token de verificação salvo com sucesso!");
    } catch (e: any) {
      toast.error("Erro ao salvar token: " + e.message);
    } finally {
      setIsSavingToken(false);
    }
  };
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Olá! Esta é uma mensagem de teste do Prime Chat.");
  const [isTesting, setIsTesting] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const isAuthenticated = Boolean(session?.access_token);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-cloud-webhook`;

  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ["whatsapp-accounts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_accounts")
        .select("*")
        .order("is_default", { ascending: false })
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const defaultAccount = accounts?.find((a: any) => a.is_default) || accounts?.[0];

  const { data: limitsData } = useQuery({
    queryKey: ["whatsapp-limits-inline", user?.id],
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("whatsapp-limits");
      if (error) {
        if (isUnauthorizedFunctionError(error)) {
          return [] as Array<{ account_id: string; messaging_limit_tier: string | null; quality_rating: string | null; error?: string }>;
        }
        throw error;
      }
      return (data?.limits || []) as Array<{ account_id: string; messaging_limit_tier: string | null; quality_rating: string | null; error?: string }>;
    },
    refetchInterval: isAuthenticated ? 60000 : false,
    staleTime: 30000,
    retry: false,
  });

  const limitsMap = useMemo(() => {
    const map = new Map<string, { tier: string | null; quality: string | null }>();
    if (limitsData) {
      for (const l of limitsData) {
        map.set(l.account_id, { tier: l.messaging_limit_tier, quality: l.quality_rating });
      }
    }
    return map;
  }, [limitsData]);

  // Auto-select default account for test tab
  useEffect(() => {
    if (!selectedAccountId && defaultAccount) {
      setSelectedAccountId(defaultAccount.id);
    }
  }, [defaultAccount, selectedAccountId]);

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success("URL do webhook copiada!");
  };

  const resetForm = () => {
    setAccountName("");
    setPhoneNumberId("");
    setAccessToken("");
    setBusinessAccountId("");
    setIsDefault(false);
    setEditingAccount(null);
    setIsAddingAccount(false);
  };

  const handleMetaOAuth = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("meta-oauth-url", {
        body: { redirect_uri: META_REDIRECT_URI },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const oauthUrl = data?.oauth_url ?? data?.url;
      if (oauthUrl) {
        window.location.href = oauthUrl;
      } else {
        toast.error("Não foi possível gerar a URL de autenticação.");
      }
    } catch (err: any) {
      toast.error(`Erro ao conectar com Meta: ${err.message}`);
    }
  };

  const startEditing = (account: any) => {
    setEditingAccount(account);
    setAccountName(account.name);
    setPhoneNumberId(account.phone_number_id);
    setAccessToken(account.access_token);
    setBusinessAccountId(account.business_account_id || "");
    setIsDefault(account.is_default);
    setIsAddingAccount(true);
  };

  const handleSaveAccount = async () => {
    if (!accountName.trim() || !phoneNumberId.trim() || !accessToken.trim()) {
      toast.error("Preencha o nome, Phone Number ID e Access Token.");
      return;
    }
    setIsSaving(true);
    try {
      const payload: any = {
        name: accountName.trim(),
        phone_number_id: phoneNumberId.trim(),
        business_account_id: businessAccountId.trim() || null,
        access_token: accessToken.trim(),
        is_default: isDefault || (accounts?.length === 0),
      };

      if (!editingAccount) {
        payload.user_id = user?.id;
      }

      if (editingAccount) {
        const { error } = await supabase
          .from("whatsapp_accounts")
          .update(payload)
          .eq("id", editingAccount.id);
        if (error) throw error;
        toast.success("Conta atualizada!");
      } else {
        const { error } = await supabase
          .from("whatsapp_accounts")
          .insert(payload);
        if (error) throw error;
        toast.success("Conta adicionada!");
      }
      queryClient.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      resetForm();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta conta?")) return;
    const { error } = await supabase.from("whatsapp_accounts").delete().eq("id", id);
    if (error) {
      toast.error(`Erro: ${error.message}`);
    } else {
      toast.success("Conta excluída!");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
    }
  };

  const handleSetDefault = async (id: string) => {
    const { error } = await supabase
      .from("whatsapp_accounts")
      .update({ is_default: true })
      .eq("id", id);
    if (error) {
      toast.error(`Erro: ${error.message}`);
    } else {
      toast.success("Conta definida como padrão!");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
    }
  };

  const handleTestMessage = async () => {
    if (!testPhone) {
      toast.error("Informe o número de telefone para teste.");
      return;
    }
    if (!selectedAccountId) {
      toast.error("Selecione uma conta para enviar.");
      return;
    }
    setIsTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-cloud-send", {
        body: { phone: testPhone, message: testMessage, account_id: selectedAccountId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Mensagem de teste enviada com sucesso!");
    } catch (err: any) {
      toast.error(`Erro ao enviar mensagem: ${err.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  

  return (
    <div className="animate-fade-in">
      <Tabs value={activeMainTab} onValueChange={(v) => { setActiveMainTab(v); if (v !== "flows") setFlowTriggerType(undefined); }} className="flex h-screen gap-0" orientation="vertical">
        {/* Sidebar */}
        <div className={cn("shrink-0 border-r border-sidebar-border gradient-header flex flex-col transition-all duration-300", sidebarCollapsed ? "w-14" : "w-56")}>
          <div className="p-3 border-b border-sidebar-border flex items-center justify-between">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2.5 animate-fade-in">
                <div className="w-8 h-8 rounded-lg bg-whatsapp/20 flex items-center justify-center">
                  <MessageCircle size={16} className="text-whatsapp" />
                </div>
                <div>
                  <h1 className="text-sm font-display font-bold text-white">Prime Chat</h1>
                  <p className="text-[10px] text-white/50 leading-none">WhatsApp Cloud API</p>
                </div>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
          {/* Platform selector */}
          <div className="px-2 pt-2 pb-1">
            <div className={cn("flex items-center rounded-lg bg-white/10 p-0.5", sidebarCollapsed ? "flex-col gap-0.5" : "")}>
              <button
                className={cn(
                  "flex items-center gap-1.5 rounded-md text-xs font-medium transition-all bg-white/20 text-white shadow-sm",
                  sidebarCollapsed ? "p-1.5 w-full justify-center" : "flex-1 px-2.5 py-1.5 justify-center"
                )}
              >
                <MessageCircle size={13} />
                {!sidebarCollapsed && "WhatsApp"}
              </button>
              <button
                onClick={() => navigate("/instagram")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md text-xs font-medium transition-all text-white/50 hover:text-white/80",
                  sidebarCollapsed ? "p-1.5 w-full justify-center" : "flex-1 px-2.5 py-1.5 justify-center"
                )}
              >
                <Instagram size={13} />
                {!sidebarCollapsed && "Instagram"}
              </button>
            </div>
          </div>
          <TabsList className="flex flex-col items-stretch bg-transparent h-auto p-2 gap-0.5">
            <TabsTrigger value="webhook" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", sidebarCollapsed && "justify-center px-0")}>
              <Webhook size={16} />
              {!sidebarCollapsed && <span>Webhooks</span>}
            </TabsTrigger>
            <TabsTrigger value="broadcast" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", sidebarCollapsed && "justify-center px-0")}>
              <Package size={16} />
              {!sidebarCollapsed && <span>Disparo</span>}
            </TabsTrigger>
            <TabsTrigger value="chat" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", sidebarCollapsed && "justify-center px-0")}>
              <MessageCircle size={16} />
              {!sidebarCollapsed && <span>Chat</span>}
            </TabsTrigger>
            <TabsTrigger value="history" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", sidebarCollapsed && "justify-center px-0")}>
              <BarChart3 size={16} />
              {!sidebarCollapsed && <span>Histórico</span>}
            </TabsTrigger>
            <TabsTrigger value="analytics" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", sidebarCollapsed && "justify-center px-0")}>
              <TrendingUp size={16} />
              {!sidebarCollapsed && <span>Analytics</span>}
            </TabsTrigger>
            <TabsTrigger value="flows" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", sidebarCollapsed && "justify-center px-0")}>
              <GitBranch size={16} />
              {!sidebarCollapsed && <span>Fluxos</span>}
            </TabsTrigger>
            <TabsTrigger value="config" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", sidebarCollapsed && "justify-center px-0")}>
              <Key size={16} />
              {!sidebarCollapsed && <span>Configuração</span>}
            </TabsTrigger>
          </TabsList>
          <div className="mt-auto border-t border-sidebar-border p-2 space-y-0.5">
            {isAdmin && !sidebarCollapsed && (
              <>
                <button onClick={() => navigate("/auth/meta/callback")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
                  <Plug size={16} /> Conexão Meta
                </button>
                {user?.email === "admin@primechat.com" && (
                  <button onClick={() => navigate("/admin/users")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
                    <Users size={16} /> Usuários
                  </button>
                )}
              </>
            )}
            {isAdmin && sidebarCollapsed && (
              <>
                <button onClick={() => navigate("/auth/meta/callback")} className="w-full flex justify-center py-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors" title="Conexão Meta">
                  <Plug size={16} />
                </button>
                {user?.email === "admin@primechat.com" && (
                  <button onClick={() => navigate("/admin/users")} className="w-full flex justify-center py-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors" title="Usuários">
                    <Users size={16} />
                  </button>
                )}
              </>
            )}
            {!sidebarCollapsed && (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</span>
              </div>
            )}
            <div className={cn("flex items-center gap-1", sidebarCollapsed ? "flex-col px-0" : "px-1")}>
              {!sidebarCollapsed && <ThemeToggle collapsed={false} />}
              {sidebarCollapsed && <ThemeToggle collapsed={true} />}
              <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent" title="Sair">
                <LogOut size={16} />
              </Button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          {/* Non-chat tabs get padding */}
          <TabsContent value="config" className="space-y-4 p-6 flex-1 m-0">

          {/* Existing accounts list */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Key size={20} />
                    Contas da Meta
                  </CardTitle>
                  <CardDescription>
                    Gerencie suas contas do WhatsApp Business. Obtenha credenciais no{" "}
                    <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
                      Facebook Developers <ExternalLink size={12} />
                    </a>
                  </CardDescription>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="gap-1.5">
                      <span className="text-lg leading-none">+</span> Nova Conta <ChevronDown size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => { resetForm(); setIsAddingAccount(true); }} className="gap-2">
                      <Key size={14} /> Manual (credenciais)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleMetaOAuth} className="gap-2">
                      <ExternalLink size={14} /> Conectar via Meta OAuth
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent>
              {accountsLoading ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Carregando...</p>
              ) : !accounts || accounts.length === 0 ? (
                <div className="text-center py-8 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                    <Key size={24} className="text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">Nenhuma conta configurada</p>
                  <Button variant="outline" size="sm" onClick={() => { resetForm(); setIsDefault(true); setIsAddingAccount(true); }}>
                    Adicionar primeira conta
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {accounts.map((account: any) => {
                    const lim = limitsMap.get(account.id);
                    const tierLabels: Record<string, string> = {
                      TIER_NOT_SET: "Não definido",
                      TIER_50: "50/dia",
                      TIER_250: "250/dia",
                      TIER_1K: "1K/dia",
                      TIER_10K: "10K/dia",
                      TIER_100K: "100K/dia",
                      TIER_UNLIMITED: "Ilimitado",
                    };
                    const qualityColors: Record<string, string> = {
                      GREEN: "text-emerald-500",
                      YELLOW: "text-amber-500",
                      RED: "text-destructive",
                    };
                    const qualityLabels: Record<string, string> = {
                      GREEN: "Alta",
                      YELLOW: "Média",
                      RED: "Baixa",
                    };

                    return (
                      <div key={account.id} className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                            <MessageCircle size={18} className="text-primary-foreground" />
                          </div>

                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-sm">{account.name}</p>
                              {account.is_default && (
                                <Badge variant="default" className="text-[10px] px-1.5 py-0">Padrão</Badge>
                              )}
                            </div>

                            <div className="space-y-1 text-xs text-muted-foreground">
                              <p className="break-all">
                                Phone Number ID: <span className="font-mono text-foreground/80">{account.phone_number_id}</span>
                              </p>
                              {account.business_account_id && (
                                <p className="break-all">
                                  Business Account ID: <span className="font-mono text-foreground/80">{account.business_account_id}</span>
                                </p>
                              )}
                              <p className="break-all">
                                Access Token: <span className="font-mono text-foreground/80">••••••••{account.access_token?.slice(-8)}</span>
                              </p>
                            </div>

                            {lim && (
                              <div className="flex flex-wrap items-center gap-3 pt-1">
                                {lim.tier && (
                                  <span className="text-[11px] font-medium text-muted-foreground">
                                    📨 {tierLabels[lim.tier] || lim.tier}
                                  </span>
                                )}
                                {lim.quality && (
                                  <span className={`text-[11px] font-medium ${qualityColors[lim.quality] || "text-muted-foreground"}`}>
                                    🛡️ {qualityLabels[lim.quality] || lim.quality}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {!account.is_default && (
                              <Button variant="ghost" size="sm" onClick={() => handleSetDefault(account.id)} className="text-xs h-8 gap-1 text-muted-foreground hover:text-foreground">
                                <Star size={14} /> Padrão
                              </Button>
                            )}

                            <Button variant="outline" size="sm" onClick={() => startEditing(account)} className="text-xs h-8 gap-1">
                              <Pencil size={14} /> Configurações
                            </Button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical size={16} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={() => startEditing(account)} className="gap-2">
                                  <Pencil size={14} /> Editar conta
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  setEditingAccount(account);
                                  setAccountName(account.name);
                                  setPhoneNumberId(account.phone_number_id);
                                  setAccessToken("");
                                  setBusinessAccountId(account.business_account_id || "");
                                  setIsDefault(account.is_default);
                                  setIsAddingAccount(true);
                                }} className="gap-2">
                                  <KeyRound size={14} /> Atualizar token
                                </DropdownMenuItem>
                                {!account.is_default && (
                                  <DropdownMenuItem onClick={() => handleSetDefault(account.id)} className="gap-2">
                                    <Star size={14} /> Definir como padrão
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleDeleteAccount(account.id)} className="gap-2 text-destructive focus:text-destructive">
                                  <Trash2 size={14} /> Excluir conta
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {isAddingAccount && (
            <Card className="border-primary/30">
              <CardHeader>
                <CardTitle className="text-base">
                  {editingAccount ? `Configurações completas: ${editingAccount.name}` : "Nova Conta"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="accountName">Nome da Conta</Label>
                  <Input id="accountName" placeholder="Ex: Minha Loja Principal" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phoneNumberId">Phone Number ID</Label>
                  <Input id="phoneNumberId" placeholder="Ex: 123456789012345" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="businessAccountId">Business Account ID</Label>
                  <Input id="businessAccountId" placeholder="Ex: 987654321098765" value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="accessToken">Access Token (permanente)</Label>
                  <Input id="accessToken" type="password" placeholder="EAAxxxxxxx..." value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Use um token permanente do System User no Business Manager.</p>
                </div>

                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <p className="text-sm font-medium flex items-center gap-2"><Link2 size={16} /> Webhook do WhatsApp</p>
                  <p className="text-xs text-muted-foreground">Configure este webhook no App do Facebook para receber mensagens.</p>
                  <div className="space-y-2">
                    <Label>URL do Webhook (Callback URL)</Label>
                    <div className="flex gap-2">
                      <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                      <Button variant="outline" size="icon" onClick={handleCopyWebhook}><Copy size={16} /></Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="verifyToken">Verify Token</Label>
                    <div className="flex gap-2">
                      <Input id="verifyToken" placeholder="Defina um token de verificação" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} />
                      <Button onClick={handleSaveVerifyToken} disabled={isSavingToken} variant="default" size="sm" className="shrink-0">
                        {isSavingToken ? "Salvando..." : <><CheckCircle2 size={16} /> Salvar</>}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Use este valor no campo "Verify Token" ao configurar o webhook no Facebook.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox id="isDefault" checked={isDefault} onCheckedChange={(v) => setIsDefault(!!v)} />
                  <Label htmlFor="isDefault" className="text-sm cursor-pointer">Definir como conta padrão</Label>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSaveAccount} disabled={isSaving}>
                    {isSaving ? "Salvando..." : editingAccount ? "Atualizar" : "Salvar Conta"}
                  </Button>
                  <Button variant="outline" onClick={resetForm}>Cancelar</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Webhook Tab (Event Webhooks) ── */}
        <TabsContent value="webhook" className="space-y-4 p-6 max-w-6xl overflow-auto">
          <WebhookEndpoints onCreateFlow={handleCreateFlowFromWebhook} />
        </TabsContent>


        {/* ── Broadcast Tab ── */}
        <TabsContent value="broadcast" className="space-y-4 p-6 max-w-6xl overflow-auto">
          <BroadcastTab />
        </TabsContent>

        {/* ── Chat Tab — full height, no padding */}
        <TabsContent value="chat" className="flex-1 flex flex-col m-0 p-0 min-h-0">
          <CloudChatTab />
        </TabsContent>

        {/* ── Flows Tab ── */}
        <TabsContent value="flows" className="space-y-4 p-6 max-w-6xl flex-1 overflow-auto">
          <FlowBuilder key={flowTriggerType || "default"} initialTriggerType={flowTriggerType} />
        </TabsContent>

        {/* ── Analytics Tab ── */}
        <TabsContent value="analytics" className="space-y-4 p-6 max-w-6xl overflow-auto">
          <CampaignAnalytics />
        </TabsContent>

        {/* ── History Tab ── */}
        <TabsContent value="history" className="space-y-4 p-6 max-w-6xl overflow-auto">
          <SendingMetrics />
        </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
