import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SmokeBackground } from "@/components/SmokeBackground";

import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { flowDedupKey, filterLeadsAlreadySent, registerSentLeads } from "@/lib/sendDedup";

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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Phone, Key, Link2, Send, CheckCircle2, AlertCircle, Copy, ExternalLink,
  Package, MessageCircle, Search, FileText, Check, CheckCheck, Paperclip,
  Truck, Users, ArrowLeft, BarChart3, MoreVertical, Pencil, Trash2, Star,
  KeyRound, ChevronDown, Webhook, LogOut, Plug, Tag, ChevronLeft, ChevronRight,
  Instagram, GitBranch, TrendingUp, Bot, Volume2, Sparkles, DollarSign,
  QrCode, RefreshCw, Loader2, Smartphone, Filter, Upload, UserMinus,
  Home, KanbanSquare, Menu, X, Clock, Megaphone,
} from "lucide-react";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { FlowBuilder } from "@/components/FlowBuilder";
import { TemplateManager } from "@/components/TemplateManager";
import { EvolutionBroadcastTab } from "@/components/EvolutionBroadcastTab";
import QRCodeLib from "qrcode";

// Converte o retorno do Evolution em um data-url renderizável.
// O Evolution pode devolver: base64 PNG puro, data:image/png;base64,..., ou apenas a string do QR (ex: "2@AQUMum+...").
async function resolveQrToDataUrl(raw: string): Promise<string> {
  const value = raw.trim();
  if (value.startsWith("data:image")) return value;
  // Heurística: base64 PNG puro costuma começar com "iVBOR"
  if (/^[A-Za-z0-9+/=]+$/.test(value) && value.length > 200 && value.startsWith("iVBOR")) {
    return `data:image/png;base64,${value}`;
  }
  // Caso contrário, tratamos como payload do QR e geramos a imagem localmente
  return await QRCodeLib.toDataURL(value, { width: 320, margin: 1 });
}

function normalizePairingCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim();
  // Evolution às vezes devolve o payload bruto do QR em "code"; isso não é código de pareamento.
  if (!code || code.length > 32 || code.includes("@") || code.includes(",")) return null;
  return code;
}
import { BroadcastQueue } from "@/components/BroadcastQueue";
import { ContactImporter } from "@/components/ContactImporter";
import { SendingMetrics } from "@/components/SendingMetrics";
import { CampaignAnalytics } from "@/components/CampaignAnalytics";
import { TemplateAccountBar } from "@/components/TemplateAccountBar";
import { WebhookEndpoints } from "@/components/WebhookEndpoints";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { AccountSelector } from "@/components/AccountSelector";
import { AiAssistantSettings } from "@/components/AiAssistantSettings";
import { VoiceStudio } from "@/components/VoiceStudio";
import { AiAgentConfig } from "@/components/AiAgentConfig";
import { FinancialTab } from "@/components/FinancialTab";
import { MetritoTab } from "@/components/MetritoTab";
import { CloudChatTab } from "@/components/CloudChatTab";
import { DashboardHome } from "@/pages/DashboardHome";
import { HomeViewSetting } from "@/components/settings/HomeViewSetting";
import { LeadDistributionSettings } from "@/components/settings/LeadDistributionSettings";
import { ShareLinksSettings } from "@/components/settings/ShareLinksSettings";
import { StageAutomationsSettings } from "@/components/settings/StageAutomationsSettings";
import { ChatLabelsSettings } from "@/components/settings/ChatLabelsSettings";
import { ChatShortcutsSettings } from "@/components/settings/ChatShortcutsSettings";

import { TemplateStudio } from "@/components/templates/TemplateStudio";
import { LeadsKanban } from "@/components/kanban/LeadsKanban";
import { TeamManagement } from "@/components/team/TeamManagement";

const isUnauthorizedFunctionError = (error: unknown) =>
  error instanceof Error && error.message.includes("401");

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const isTransientEvolutionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /503|temporarily unavailable|failed to fetch|edge runtime/i.test(message);
};

const invokeEvolutionInstance = async (body: Record<string, unknown>, retries = 4) => {
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
  const { user } = useAuth();
  const [mode, setMode] = useState<"leads" | "csv">("leads");
  const [search, setSearch] = useState("");
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [isSending, setIsSending] = useState(false);
  const cancelRef = useRef(false);
  const [sendType, setSendType] = useState<"template" | "flow" | "custom">("template");
  /** Horário programado (datetime-local). Vazio = enviar imediatamente. */
  const [scheduleAt, setScheduleAt] = useState<string>("");
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
  // Exclude audience state
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeJobId, setExcludeJobId] = useState<string>("");
  const excludeCsvRef = useRef<HTMLInputElement>(null);

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

  const { data: accountTemplates = [] } = useQuery({
    queryKey: ["account-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("account_templates").select("*");
      return (data || []) as { id: string; account_id: string; template_id: string }[];
    },
  });

  const selectedAccountIdsArray = useMemo(() => Array.from(selectedAccountIds), [selectedAccountIds]);

  const availableTemplates = useMemo(() => {
    return (templates || []).filter((template: any) => {
      if (template.meta_status !== "APPROVED") return false;

      const linkedAccounts = accountTemplates.filter((link) => link.template_id === template.id);
      if (selectedAccountIdsArray.length === 0 || linkedAccounts.length === 0) return true;

      return selectedAccountIdsArray.every((accountId) =>
        linkedAccounts.some((link) => link.account_id === accountId)
      );
    });
  }, [templates, accountTemplates, selectedAccountIdsArray]);

  const { data: flows } = useQuery({
    queryKey: ["broadcast-flows"],
    queryFn: async () => {
      const { data } = await supabase.from("flows").select("*").eq("active", true).order("name");
      return data || [];
    },
  });

  // Disparos anteriores para usar como filtro de exclusão
  const { data: previousJobs = [] } = useQuery({
    queryKey: ["broadcast-prev-jobs-tab"],
    queryFn: async () => {
      const { data } = await supabase
        .from("broadcast_jobs")
        .select("id, template_name, total_leads, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      return data || [];
    },
  });

  const normalizePhoneDigits = (p: string) => (p || "").replace(/\D/g, "");

  const applyExcludeFromJob = async (jobId: string) => {
    if (!jobId) return;
    const { data, error } = await supabase
      .from("broadcast_jobs")
      .select("lead_ids")
      .eq("id", jobId)
      .maybeSingle();
    if (error || !data) {
      toast.error("Erro ao carregar disparo");
      return;
    }
    const excludeIds = new Set<string>(data.lead_ids || []);
    // Build phone tail set for csv mode using leads table
    let csvExcludedTails = new Set<string>();
    if (mode === "csv" && excludeIds.size > 0) {
      const ids = Array.from(excludeIds);
      const out: string[] = [];
      const chunk = 500;
      for (let i = 0; i < ids.length; i += chunk) {
        const slice = ids.slice(i, i + chunk);
        const { data: phs } = await supabase.from("leads").select("phone").in("id", slice);
        if (phs) for (const p of phs) out.push(normalizePhoneDigits(p.phone).slice(-8));
      }
      csvExcludedTails = new Set(out);
    }

    let removed = 0;
    if (mode === "leads") {
      setSelectedLeads((prev) => {
        const next = new Set(prev);
        for (const id of excludeIds) if (next.delete(id)) removed++;
        return next;
      });
    } else {
      setCsvSelectedIdxs((prev) => {
        const next = new Set(prev);
        for (const idx of Array.from(prev)) {
          const tail = normalizePhoneDigits(csvRows[idx]?.telefone || "").slice(-8);
          if (tail && csvExcludedTails.has(tail)) {
            next.delete(idx);
            removed++;
          }
        }
        return next;
      });
    }
    toast.success(`${removed} contato(s) removido(s) do disparo`);
    setExcludeOpen(false);
    setExcludeJobId("");
  };

  const applyExcludeFromFile = async (file: File) => {
    try {
      const text = await file.text();
      const lines = text.split(/[\r\n,;]+/);
      const tails = new Set<string>();
      for (const line of lines) {
        const digits = normalizePhoneDigits(line);
        if (digits.length >= 8) tails.add(digits.slice(-8));
      }
      if (tails.size === 0) {
        toast.error("Nenhum telefone válido encontrado");
        return;
      }
      let removed = 0;
      if (mode === "leads") {
        const leadsById = new Map((leads || []).map((l: any) => [l.id, l]));
        setSelectedLeads((prev) => {
          const next = new Set(prev);
          for (const id of Array.from(prev)) {
            const l: any = leadsById.get(id);
            const tail = normalizePhoneDigits(l?.phone || "").slice(-8);
            if (tail && tails.has(tail)) {
              next.delete(id);
              removed++;
            }
          }
          return next;
        });
      } else {
        setCsvSelectedIdxs((prev) => {
          const next = new Set(prev);
          for (const idx of Array.from(prev)) {
            const tail = normalizePhoneDigits(csvRows[idx]?.telefone || "").slice(-8);
            if (tail && tails.has(tail)) {
              next.delete(idx);
              removed++;
            }
          }
          return next;
        });
      }
      toast.success(`${removed} contato(s) removido(s) (${tails.size} telefones na lista)`);
      setExcludeOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao processar arquivo");
    }
  };


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
      const { data, error } = await supabase.from("leads").insert({ name: newLeadName.trim(), phone: cleanPhone, origin: "manual", user_id: user?.id }).select("id").single();
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

  const selectedTemplate = availableTemplates.find((t: any) => t.id === selectedTemplateId);
  const selectedFlow = flows?.find((f: any) => f.id === selectedFlowId);

  useEffect(() => {
    if (selectedTemplateId && !availableTemplates.some((template: any) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(null);
    }
  }, [availableTemplates, selectedTemplateId]);

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
      toast.error("Selecione um template aprovado para as contas escolhidas.");
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

    // ── AGENDAMENTO ──
    // Quando um horário é informado, as execuções do fluxo são criadas já com
    // `next_action_at` no futuro. O cron do flow-processor as coleta no horário,
    // então nada é enviado antes da hora marcada.
    const scheduledIso = scheduleAt ? new Date(scheduleAt).toISOString() : null;
    const scheduledBaseMs = scheduledIso ? new Date(scheduledIso).getTime() : Date.now();
    const isScheduled = !!scheduledIso && scheduledBaseMs > Date.now();

    // Helper to start a flow for a single lead (used for small batches)
    const startFlowForLead = async (leadId: string, flowId: string, codigo?: string) => {
      // ── BLOQUEIO DE DUPLICIDADE (mesmo fluxo/campanha) ──
      const flowNameSingle = flows?.find((f: any) => f.id === flowId)?.name || null;
      const dedupKeysSingle = [flowDedupKey(flowNameSingle)].filter(Boolean) as string[];
      let phoneMapSingle: Record<string, string> = {};
      if (user?.id && dedupKeysSingle.length > 0) {
        const res = await filterLeadsAlreadySent(user.id, dedupKeysSingle, [leadId]);
        phoneMapSingle = res.phoneByLeadId;
        if (res.blockedLeadIds.length > 0) {
          throw new Error(`Lead já recebeu "${flowNameSingle}" (ou uma variação da mesma campanha).`);
        }
      }

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
          ? new Date(scheduledBaseMs + ((firstStep.delay_minutes || 0) * 60 + (firstStep.delay_min_seconds || 0)) * 1000).toISOString()
          : firstStep.step_type === "no_response"
            ? new Date(scheduledBaseMs + (firstStep.timeout_minutes || 10) * 60 * 1000).toISOString()
            : new Date(scheduledBaseMs).toISOString();

      await supabase
        .from("flow_executions")
        .update({ status: "cancelled" })
        .eq("lead_id", leadId)
        .in("status", ["running", "waiting_delay", "waiting_reply", "waiting_no_response"]);

      const flowAccountId = selectedAccountIds.size > 0 ? Array.from(selectedAccountIds)[0] : (defaultAccount?.id || null);
      const { error: insertExecutionError } = await supabase.from("flow_executions").insert({
        flow_id: flowId,
        lead_id: leadId,
        current_step_id: firstStep.id,
        status: firstStepStatus,
        next_action_at: firstStepNextActionAt,
        metadata: { codigo: codigo || "", account_id: flowAccountId },
      });
      if (insertExecutionError) throw new Error(`Erro ao iniciar execução do fluxo: ${insertExecutionError.message}`);

      if (user?.id && dedupKeysSingle.length > 0) {
        await registerSentLeads(user.id, dedupKeysSingle, [leadId], phoneMapSingle, {
          campaignName: flowNameSingle,
        });
      }

    };

    // Bulk flow dispatch: insert all executions, then trigger processor once
    const startFlowBulk = async (leadIdsInput: string[], flowId: string, codigoMap?: Record<string, string>) => {
      // ── BLOQUEIO DE DUPLICIDADE ──
      // Um lead nunca recebe o mesmo fluxo/template duas vezes. Fluxos que são
      // variações de volume da mesma campanha (ex.: "HOJE BM2 (10K)" e
      // "HOJE BM2 (2K)") compartilham a mesma chave, então quem recebeu um
      // não recebe o outro.
      const flowName = flows?.find((f: any) => f.id === flowId)?.name || null;
      const dedupKeys = [flowDedupKey(flowName)].filter(Boolean) as string[];
      let leadIds = leadIdsInput;
      let phoneByLeadId: Record<string, string> = {};
      let blockedCount = 0;

      if (user?.id && dedupKeys.length > 0) {
        const res = await filterLeadsAlreadySent(user.id, dedupKeys, leadIdsInput);
        leadIds = res.allowedLeadIds;
        phoneByLeadId = res.phoneByLeadId;
        blockedCount = res.blockedLeadIds.length;
        if (blockedCount > 0) {
          toast.info(`${blockedCount} lead(s) ignorado(s): já receberam "${flowName}" (ou uma variação da mesma campanha).`);
        }
        if (leadIds.length === 0) {
          return { insertedCount: 0, insertErrors: 0, blockedCount };
        }
      }

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
          ? new Date(scheduledBaseMs + ((firstStep.delay_minutes || 0) * 60 + (firstStep.delay_min_seconds || 0)) * 1000).toISOString()
          : firstStep.step_type === "no_response"
            ? new Date(scheduledBaseMs + (firstStep.timeout_minutes || 10) * 60 * 1000).toISOString()
            : new Date(scheduledBaseMs).toISOString();

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

      const flowAccountIdBulk = selectedAccountIds.size > 0 ? Array.from(selectedAccountIds)[0] : (defaultAccount?.id || null);
      for (let i = 0; i < leadIds.length; i += INSERT_BATCH) {
        const batch = leadIds.slice(i, i + INSERT_BATCH);
        const rows = batch.map((leadId) => ({
          flow_id: flowId,
          lead_id: leadId,
          current_step_id: firstStep!.id,
          status: firstStepStatus,
          next_action_at: firstStepNextActionAt,
          metadata: { codigo: codigoMap?.[leadId] || "", account_id: flowAccountIdBulk },
        }));

        const { error: batchError } = await supabase.from("flow_executions").insert(rows);
        if (batchError) {
          console.error("Batch insert error:", batchError);
          insertErrors += batch.length;
        } else {
          insertedCount += batch.length;
          // Registra para bloquear reenvio futuro do mesmo fluxo/campanha
          if (user?.id && dedupKeys.length > 0) {
            await registerSentLeads(user.id, dedupKeys, batch, phoneByLeadId, {
              campaignName: flowName,
            });
          }
        }
      }

      // Disparos imediatos acordam o processor na hora; agendados ficam
      // aguardando o cron do flow-processor atingir o horário marcado.
      if (!isScheduled) {
        supabase.functions.invoke("flow-processor", { body: { auto: true } }).catch((e: any) =>
          console.error("Failed to invoke flow-processor:", e)
        );
      }

      return { insertedCount, insertErrors, blockedCount };

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
            user_id: user?.id,
          }));
          
          const { data: upserted, error: upsertErr } = await supabase
            .from("leads")
            .insert(upsertRows)
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
            // Upsert lead so the message shows in the chat thread
            const phoneNormalized = row.telefone.replace(/\D/g, "");
            const phoneWithDdi = phoneNormalized.length <= 11 ? `55${phoneNormalized}` : phoneNormalized;
            let leadIdForSend: string | null = null;
            try {
              const { data: existingLead } = await supabase
                .from("leads")
                .select("id")
                .eq("phone", phoneWithDdi)
                .eq("user_id", user?.id)
                .maybeSingle();
              if (existingLead?.id) {
                leadIdForSend = existingLead.id;
              } else {
                const { data: newLead } = await supabase
                  .from("leads")
                  .insert({
                    phone: phoneWithDdi,
                    name: row.nome || `Contato ${phoneNormalized.slice(-4)}`,
                    origin: "csv_import",
                    user_id: user?.id,
                  })
                  .select("id")
                  .single();
                leadIdForSend = newLead?.id || null;
              }
            } catch {
              // Non-fatal: send anyway; message just won't appear in chat
            }
            const body: any = { phone: row.telefone, account_id: accountId };
            if (leadIdForSend) body.lead_id = leadIdForSend;
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
          
          // Adiciona cadência (0.5s a 1.5s) entre disparos manuais para evitar bloqueios por volume instantâneo
          if (processed < totalContacts) {
            const sleepMs = 500 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, sleepMs));
          }
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
              body.message = customMessage
                .replace(/\{nome\}/g, (lead.name || "").split(" ")[0] || "")
                .replace(/\{nome_completo\}/g, lead.name || "")
                .replace(/\{telefone\}/g, lead.phone || "")
                .replace(/\{email\}/g, (lead as any).email || "");
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

          // Adiciona cadência (0.5s a 1.5s) entre disparos manuais
          if (processed < totalContacts) {
            const sleepMs = 500 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, sleepMs));
          }
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
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-5 h-auto">
          <TabsTrigger value="queue" className="gap-1.5">
            <Send size={14} /> Fila de Disparos
          </TabsTrigger>
          <TabsTrigger value="simple" className="gap-1.5">
            <MessageCircle size={14} /> Disparo API
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5">
            <MessageCircle size={14} /> Disparo WhatsApp
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <FileText size={14} /> Templates
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

        <TabsContent value="whatsapp" className="mt-4">
          <EvolutionBroadcastTab />
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

        {/* Excluir público antes do disparo */}
        <Popover open={excludeOpen} onOpenChange={setExcludeOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <UserMinus size={14} className="mr-1.5" /> Excluir público
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-3" align="start">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold mb-1">Remover quem já recebeu um disparo</p>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Desmarca da seleção atual quem está em um disparo anterior.
                </p>
                <div className="flex gap-1.5">
                  <Select value={excludeJobId} onValueChange={setExcludeJobId}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="Selecione um disparo..." />
                    </SelectTrigger>
                    <SelectContent>
                      {previousJobs.length === 0 ? (
                        <div className="text-xs text-muted-foreground p-2">Nenhum disparo anterior.</div>
                      ) : (
                        previousJobs.map((j: any) => (
                          <SelectItem key={j.id} value={j.id} className="text-xs">
                            {j.template_name || "Disparo"} • {j.total_leads} • {format(new Date(j.created_at), "dd/MM HH:mm")}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!excludeJobId}
                    onClick={() => applyExcludeFromJob(excludeJobId)}
                  >
                    Aplicar
                  </Button>
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-xs font-semibold mb-1">Remover por lista importada</p>
                <p className="text-[11px] text-muted-foreground mb-2">
                  CSV/TXT com telefones (um por linha). Compara pelos últimos 8 dígitos.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs w-full"
                  onClick={() => excludeCsvRef.current?.click()}
                >
                  <Upload size={12} className="mr-1.5" /> Enviar arquivo
                </Button>
                <input
                  ref={excludeCsvRef}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) applyExcludeFromFile(f);
                    if (e.target) e.target.value = "";
                  }}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
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
                    {availableTemplates.map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.template_name ? `(API: ${t.template_name})` : ""}
                      </option>
                    ))}
                  </select>
                  {availableTemplates.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nenhum template aprovado está disponível para as contas selecionadas.
                    </p>
                  )}
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

                {/* Agendamento por horário específico */}
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  <Label className="flex items-center gap-1.5">
                    <Clock size={14} /> Enviar em horário programado (opcional)
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    {scheduleAt && (
                      <Button variant="ghost" size="sm" onClick={() => setScheduleAt("")}>
                        Limpar
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {scheduleAt
                      ? `As mensagens só sairão a partir de ${new Date(scheduleAt).toLocaleString("pt-BR")} (horário do seu dispositivo).`
                      : "Deixe vazio para iniciar o fluxo imediatamente."}
                  </p>
                </div>
              </div>
            )}

            {/* Custom message */}
            {sendType === "custom" && (
              <div className="space-y-2">
                <Label>Mensagem personalizada</Label>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="Olá {nome}! Seu código: {codigo}"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[120px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  rows={5}
                />
                <p className="text-[11px] text-muted-foreground">
                  Variáveis disponíveis: <code>{"{nome}"}</code>, <code>{"{nome_completo}"}</code>,{" "}
                  <code>{"{telefone}"}</code>, <code>{"{email}"}</code>
                  {mode === "csv" && <> e <code>{"{codigo}"}</code></>}. Requer janela de conversa aberta (24h) ou uso posterior via API.
                </p>
              </div>
            )}

            {sendType !== "flow" ? (
              <AccountSelector
                accounts={accounts}
                selectedIds={selectedAccountIds}
                onToggle={toggleAccount}
                mode="multi"
                label="Contas para envio"
              />
            ) : (
              <AccountSelector
                accounts={accounts}
                selectedIds={selectedAccountIds}
                onToggle={(id) => setSelectedAccountIds(new Set([id]))}
                mode="single"
                label="Número que vai enviar o fluxo"
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
                  {sendType === "flow" && scheduleAt
                    ? `Agendar fluxo para ${activeCount} contato(s)`
                    : sendType === "flow" ? `Iniciar fluxo para ${activeCount} contato(s)` : `Disparar para ${activeCount} contato(s)`}
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

        {/* ── Sub-aba Templates (sincronização automática com a Meta) ── */}
        <TabsContent value="templates" className="mt-4">
          <TemplateManager autoSync />
        </TabsContent>
      </Tabs>



    </div>
  );
}

/* ══════════════════════════════════════════════════
   CHAT TAB COMPONENT
   ══════════════════════════════════════════════════ */
// CloudChatTab is now imported from @/components/CloudChatTab

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
  const [provider, setProvider] = useState<"meta_cloud" | "d360" | "evolution">("meta_cloud");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobile = useIsMobile();
  // Em telas pequenas o menu nunca fica no modo "colapsado" (ícones): ele vira gaveta.
  const navCollapsed = sidebarCollapsed && !isMobile;
  const [activeMainTab, setActiveMainTab] = useState("home");
  const [flowTriggerType, setFlowTriggerType] = useState<string | undefined>(undefined);
  const [flowEditId, setFlowEditId] = useState<string | undefined>(undefined);
  const [flowEditorOpen, setFlowEditorOpen] = useState(false);

  const handleCreateFlowFromWebhook = useCallback((triggerType: string) => {
    setFlowEditId(undefined);
    setFlowTriggerType(triggerType);
    setFlowEditorOpen(true);
    setActiveMainTab("flows");
  }, []);

  const handleSelectFlowFromWebhook = useCallback((flowId: string, triggerType: string) => {
    setFlowTriggerType(undefined);
    setFlowEditId(flowId);
    setFlowEditorOpen(true);
    setActiveMainTab("flows");
  }, []);

  const [verifyToken, setVerifyToken] = useState("prime_chat_verify_2026");
  const [isSavingToken, setIsSavingToken] = useState(false);

  // O verify token pertence ao app Meta e é compartilhado entre as contas.
  // Apenas administradores podem alterar a configuração global.
  useEffect(() => {
    if (!isAdmin) return;

    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "whatsapp_verify_token")
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          toast.error("Não foi possível carregar o token de verificação.");
          return;
        }
        if (data?.value) setVerifyToken(data.value);
      });
  }, [isAdmin]);

  const handleSaveVerifyToken = async () => {
    if (!isAdmin) {
      toast.error("Somente o administrador pode alterar o token global.");
      return;
    }
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
    queryKey: ["whatsapp-limits", user?.id],
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
    refetchInterval: isAuthenticated ? 300000 : false,
    staleTime: 240000,
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
    setProvider("meta_cloud");
    setPhoneNumberId("");
    setAccessToken("");
    setBusinessAccountId("");
    setApiKey("");
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
    setProvider((account.provider as "meta_cloud" | "d360" | "evolution") || "meta_cloud");
    setPhoneNumberId(account.phone_number_id);
    setAccessToken(account.access_token);
    setBusinessAccountId(account.business_account_id || "");
    setApiKey(account.api_key || "");
    setIsDefault(account.is_default);
    setIsAddingAccount(true);
  };

  const handleSaveAccount = async () => {
    if (!accountName.trim()) {
      toast.error("Informe o nome da conta.");
      return;
    }
    if (provider === "meta_cloud") {
      if (!phoneNumberId.trim()) {
        toast.error("Informe o Phone Number ID.");
        return;
      }
      if (!accessToken.trim()) {
        toast.error("Informe o Access Token da Meta.");
        return;
      }
    }
    if (provider === "d360" && !apiKey.trim()) {
      toast.error("Informe a D360-API-KEY do 360dialog.");
      return;
    }
    if (provider === "evolution") {
      if (!businessAccountId.trim()) {
        toast.error("Informe a URL do servidor Evolution (ex: https://evolution.seudominio.com).");
        return;
      }
      if (!phoneNumberId.trim()) {
        toast.error("Informe o nome da Instance da Evolution.");
        return;
      }
      if (!apiKey.trim()) {
        toast.error("Informe a API Key da Evolution (apikey global ou da instance).");
        return;
      }
    }
    setIsSaving(true);
    try {
      // d360/evolution não usam phone_number_id real (instance), mas a coluna no banco é NOT NULL
      const isApiKeyProvider = provider === "d360" || provider === "evolution";
      const syntheticPrefix = provider === "evolution" ? "evo" : "d360";
      const effectivePhoneNumberId = isApiKeyProvider
        ? (phoneNumberId.trim() || (editingAccount?.phone_number_id) || `${syntheticPrefix}_${crypto.randomUUID().slice(0, 12)}`)
        : phoneNumberId.trim();

      const payload: any = {
        name: accountName.trim(),
        provider,
        phone_number_id: effectivePhoneNumberId,
        business_account_id:
          provider === "meta_cloud" ? (businessAccountId.trim() || null)
          : provider === "evolution" ? businessAccountId.trim().replace(/\/+$/, "")
          : null,
        access_token: provider === "meta_cloud" ? accessToken.trim() : (apiKey.trim() || provider),
        api_key: isApiKeyProvider ? apiKey.trim() : null,
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

      // Auto-subscribe webhook (delivered/read/failed updates)
      if (payload.business_account_id) {
        try {
          const { data: subData } = await supabase.functions.invoke("whatsapp-subscribe-webhook", {
            body: {},
          });
          const failed = (subData?.results || []).filter((r: any) => !r.ok);
          if (failed.length > 0) {
            toast.warning("Webhook não foi ativado. Verifique no WhatsApp Manager → Webhooks e clique em Subscribe.");
          } else {
            toast.success("Webhook ativado! Status delivered/read funcionarão automaticamente.");
          }
        } catch (subErr) {
          console.warn("Subscribe webhook failed:", subErr);
        }
      }

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

  /* ── QR Code (Evolution) state ── */
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrMode, setQrMode] = useState<"new" | "existing">("new");
  const [qrAccountId, setQrAccountId] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrPairingCode, setQrPairingCode] = useState<string | null>(null);
  const [qrConnState, setQrConnState] = useState<string>("connecting");
  const [qrName, setQrName] = useState("");
  const [qrServerUrl, setQrServerUrl] = useState("");
  const [qrInstance, setQrInstance] = useState("");
  const [qrApiKey, setQrApiKey] = useState("");
  const qrPollRef = useRef<number | null>(null);
  const qrRefreshRef = useRef<number | null>(null);
  const healthPollRef = useRef<number | null>(null);
  const reopenedForRef = useRef<Set<string>>(new Set());
  const [autoReconnect, setAutoReconnect] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("evo_auto_reconnect") !== "false";
  });

  const stopQrPolling = useCallback(() => {
    if (qrPollRef.current) { clearInterval(qrPollRef.current); qrPollRef.current = null; }
    if (qrRefreshRef.current) { clearInterval(qrRefreshRef.current); qrRefreshRef.current = null; }
  }, []);

  const fetchQrForAccount = useCallback(async (accountId: string) => {
    try {
      const data = await invokeEvolutionInstance({ action: "connect", account_id: accountId });
      if (data?.qr_code) {
        const url = await resolveQrToDataUrl(String(data.qr_code));
        setQrImage(url);
      }
      setQrPairingCode(normalizePairingCode(data?.pairing_code));
    } catch (e: any) {
      console.error("QR refresh failed:", e);
    }
  }, []);

  const pollQrStatus = useCallback(async (accountId: string) => {
    try {
      const data = await invokeEvolutionInstance({ action: "status", account_id: accountId }, 1);
      const state = String(data?.state || "unknown");
      setQrConnState(state);
      if (state === "open") {
        stopQrPolling();
        reopenedForRef.current.delete(accountId);
        toast.success("WhatsApp conectado com sucesso! 🎉");
        queryClient.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
        setTimeout(() => setQrDialogOpen(false), 1500);
      } else if (state === "close" || state === "disconnected") {
        // QR expirou ou caiu — força refresh do QR
        fetchQrForAccount(accountId);
      }
    } catch (e) {
      console.warn("Status poll failed:", e);
    }
  }, [stopQrPolling, queryClient, fetchQrForAccount]);

  const startQrPolling = useCallback((accountId: string) => {
    stopQrPolling();
    qrPollRef.current = window.setInterval(() => pollQrStatus(accountId), 3000) as any;
    qrRefreshRef.current = window.setInterval(() => fetchQrForAccount(accountId), 30000) as any;
  }, [pollQrStatus, fetchQrForAccount, stopQrPolling]);

  const openQrDialogForExisting = useCallback((account: any) => {
    setQrMode("existing");
    setQrAccountId(account.id);
    setQrImage(null);
    setQrPairingCode(null);
    setQrConnState("connecting");
    setQrDialogOpen(true);
    setQrLoading(true);
    fetchQrForAccount(account.id).finally(() => setQrLoading(false));
    startQrPolling(account.id);
  }, [fetchQrForAccount, startQrPolling]);

  const openQrDialogForNew = () => {
    setQrMode("new");
    setQrAccountId(null);
    setQrImage(null);
    setQrPairingCode(null);
    setQrConnState("connecting");
    setQrName("");
    setQrServerUrl("");
    setQrInstance("");
    setQrApiKey("");
    setQrDialogOpen(true);
  };

  const handleCreateAndConnect = async () => {
    if (!qrName.trim()) {
      toast.error("Informe o nome da conta.");
      return;
    }
    setQrLoading(true);
    try {
      const data = await invokeEvolutionInstance({
        action: "create_and_connect",
        name: qrName.trim(),
        is_default: (accounts?.length || 0) === 0,
      });

      toast.success(data?.already_existed ? "Instância já existia — gerando QR…" : "Instância criada! Escaneie o QR.");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-accounts"] });

      if (data?.qr_code) {
        const url = await resolveQrToDataUrl(String(data.qr_code));
        setQrImage(url);
      }
      setQrPairingCode(normalizePairingCode(data?.pairing_code));
      if (data?.account_id) {
        setQrAccountId(data.account_id);
        setQrMode("existing");
        startQrPolling(data.account_id);
      }
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    } finally {
      setQrLoading(false);
    }
  };

  useEffect(() => {
    if (!qrDialogOpen) stopQrPolling();
    return stopQrPolling;
  }, [qrDialogOpen, stopQrPolling]);

  // ── Health monitor: detecta queda de instâncias Evolution e reabre QR automaticamente
  useEffect(() => {
    if (!autoReconnect) {
      if (healthPollRef.current) { clearInterval(healthPollRef.current); healthPollRef.current = null; }
      return;
    }
    const check = async () => {
      // Não interfere se já existe um modal aberto
      if (qrDialogOpen) return;
      const evoAccounts = (accounts || []).filter((a: any) => a.provider === "evolution");
      if (evoAccounts.length === 0) return;

      for (const acc of evoAccounts) {
        try {
          const data = await invokeEvolutionInstance({ action: "status", account_id: acc.id }, 1);
          const state = String(data?.state || "unknown");
          if (state === "close" || state === "disconnected") {
            if (reopenedForRef.current.has(acc.id)) continue;
            reopenedForRef.current.add(acc.id);
            toast.warning(`"${acc.name}" desconectou — reabrindo QR para reconexão…`);
            openQrDialogForExisting(acc);
            return; // 1 reconexão por ciclo
          }
          if (state === "open") {
            reopenedForRef.current.delete(acc.id);
          }
        } catch (e) {
          console.warn("Health check falhou para", acc.name, e);
        }
      }
    };
    // Primeira verificação após 5s, depois a cada 20s
    const t0 = window.setTimeout(check, 5000);
    healthPollRef.current = window.setInterval(check, 20000) as any;
    return () => {
      clearTimeout(t0);
      if (healthPollRef.current) { clearInterval(healthPollRef.current); healthPollRef.current = null; }
    };
  }, [autoReconnect, accounts, qrDialogOpen, openQrDialogForExisting]);

  const toggleAutoReconnect = useCallback((next: boolean) => {
    setAutoReconnect(next);
    try { localStorage.setItem("evo_auto_reconnect", next ? "true" : "false"); } catch {}
    toast.info(next ? "Reconexão automática ativada" : "Reconexão automática desativada");
  }, []);

  return (
    <div className="animate-fade-in relative">
      <SmokeBackground />
      <Tabs value={activeMainTab} onValueChange={(v) => { setActiveMainTab(v); setMobileNavOpen(false); if (v !== "flows") setFlowTriggerType(undefined); }} className="relative z-10 flex flex-col md:flex-row h-[100dvh] gap-0" orientation="vertical">
        {/* Barra superior (mobile) */}
        <div className="md:hidden shrink-0 glass-sidebar flex items-center gap-2 px-3 py-2.5 border-b border-white/10">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Abrir menu"
            className="p-2 -ml-1 rounded-md text-white/80 hover:bg-white/10 transition-colors"
          >
            <Menu size={20} />
          </button>
          <div className="w-7 h-7 rounded-lg bg-whatsapp/20 flex items-center justify-center shrink-0">
            <MessageCircle size={15} className="text-whatsapp" />
          </div>
          <h1 className="text-sm font-display font-bold text-white truncate">Prime Chat</h1>
        </div>

        {/* Overlay do menu mobile */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
        )}

        {/* Sidebar */}
        <div className={cn(
          "shrink-0 glass-sidebar flex-col transition-all duration-300",
          "fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] overflow-y-auto",
          "md:relative md:z-auto md:w-56 md:max-w-none md:overflow-y-auto",
          mobileNavOpen ? "flex" : "hidden md:flex",
          navCollapsed && "md:w-14"
        )}>
          <div className="glass-sheen pointer-events-none absolute inset-0" />
          <div className="relative p-3 border-b border-white/10 flex items-center justify-between">

            {!navCollapsed && (
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
              className="hidden md:block p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              {navCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <button
              onClick={() => setMobileNavOpen(false)}
              aria-label="Fechar menu"
              className="md:hidden p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          {/* Platform selector */}
          <div className="px-2 pt-2 pb-1">
            <div className={cn("flex items-center rounded-lg bg-white/10 p-0.5", navCollapsed ? "flex-col gap-0.5" : "")}>
              <button
                className={cn(
                  "flex items-center gap-1.5 rounded-md text-xs font-medium transition-all bg-white/20 text-white shadow-sm",
                  navCollapsed ? "p-1.5 w-full justify-center" : "flex-1 px-2.5 py-1.5 justify-center"
                )}
              >
                <MessageCircle size={13} />
                {!navCollapsed && "WhatsApp"}
              </button>
              <button
                onClick={() => navigate("/instagram")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md text-xs font-medium transition-all text-white/50 hover:text-white/80",
                  navCollapsed ? "p-1.5 w-full justify-center" : "flex-1 px-2.5 py-1.5 justify-center"
                )}
              >
                <Instagram size={13} />
                {!navCollapsed && "Instagram"}
              </button>
            </div>
          </div>
          <TabsList className="flex flex-col items-stretch bg-transparent h-auto p-2 gap-0.5">
            <TabsTrigger value="home" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <Home size={16} />
              {!navCollapsed && <span>Início</span>}
            </TabsTrigger>
            <TabsTrigger value="chat" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <MessageCircle size={16} />
              {!navCollapsed && <span>Conversas</span>}
            </TabsTrigger>
            <TabsTrigger value="broadcast" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <Send size={16} />
              {!navCollapsed && <span>Campanhas</span>}
            </TabsTrigger>
            <TabsTrigger value="templates" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <FileText size={16} />
              {!navCollapsed && <span>Templates</span>}
            </TabsTrigger>
            <TabsTrigger value="history" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <BarChart3 size={16} />
              {!navCollapsed && <span>Histórico</span>}
            </TabsTrigger>
            <TabsTrigger value="kanban" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <KanbanSquare size={16} />
              {!navCollapsed && <span>Kanban</span>}
            </TabsTrigger>
            <TabsTrigger value="team" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <Users size={16} />
              {!navCollapsed && <span>Equipe</span>}
            </TabsTrigger>
            {!navCollapsed && (
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 px-3 pt-3 pb-1 font-semibold">Automação</p>
            )}
            {navCollapsed && <div className="h-px bg-sidebar-border/40 mx-2 my-2" />}
            <TabsTrigger value="flows" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <GitBranch size={16} />
              {!navCollapsed && <span>Fluxos</span>}
            </TabsTrigger>
            <TabsTrigger value="ai-agent" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <Bot size={16} />
              {!navCollapsed && <span className="flex items-center gap-1.5">Agente IA <span className="text-[9px] px-1 py-0.5 rounded bg-ai/20 text-ai font-bold">PRO</span></span>}
            </TabsTrigger>
            <TabsTrigger value="ai-assistant" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <Sparkles size={16} />
              {!navCollapsed && <span>Assistente IA</span>}
            </TabsTrigger>
            <TabsTrigger value="voice-studio" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <Volume2 size={16} />
              {!navCollapsed && <span className="flex items-center gap-1.5">Vozes IA <span className="text-[9px] px-1 py-0.5 rounded bg-ai/20 text-ai font-bold">SCALE</span></span>}
            </TabsTrigger>
            {!navCollapsed && (
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 px-3 pt-3 pb-1 font-semibold">Análise</p>
            )}
            {navCollapsed && <div className="h-px bg-sidebar-border/40 mx-2 my-2" />}
            <TabsTrigger value="analytics" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <TrendingUp size={16} />
              {!navCollapsed && <span>Performance</span>}
            </TabsTrigger>
            <TabsTrigger value="financial" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <DollarSign size={16} />
              {!navCollapsed && <span>Financeiro</span>}
            </TabsTrigger>
            <TabsTrigger value="metrito" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <Megaphone size={16} />
              {!navCollapsed && <span>Tráfego Pago</span>}
            </TabsTrigger>
            {!navCollapsed && (
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 px-3 pt-3 pb-1 font-semibold">Sistema</p>
            )}
            {navCollapsed && <div className="h-px bg-sidebar-border/40 mx-2 my-2" />}
            <TabsTrigger value="webhook" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <Webhook size={16} />
              {!navCollapsed && <span>Integrações</span>}
            </TabsTrigger>
            <TabsTrigger value="config" className={cn("justify-start rounded-lg text-sidebar-foreground data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground data-[state=active]:shadow-sm hover:bg-sidebar-accent gap-2.5 text-sm px-3 py-2.5 transition-all", navCollapsed && "justify-center px-0")}>
              <Key size={16} />
              {!navCollapsed && <span>Configuração</span>}
            </TabsTrigger>
          </TabsList>
          <div className="mt-auto border-t border-sidebar-border p-2 space-y-0.5">
            {isAdmin && !navCollapsed && (
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
            {isAdmin && navCollapsed && (
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
            {!navCollapsed && (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</span>
              </div>
            )}
            <div className={cn("flex items-center gap-1", navCollapsed ? "flex-col px-0" : "px-1")}>
              {!navCollapsed && <ThemeToggle collapsed={false} />}
              {navCollapsed && <ThemeToggle collapsed={true} />}
              <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent" title="Sair">
                <LogOut size={16} />
              </Button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-x-hidden">
          {/* Non-chat tabs get padding */}
          <TabsContent value="config" className="space-y-4 p-4 sm:p-6 m-0 flex-1 overflow-y-auto">

          {/* Preferência da tela inicial */}
          <HomeViewSetting />

          {/* Distribuição inteligente de leads (conta específica) */}
          <LeadDistributionSettings />

          {/* Links de compartilhamento do número (frase, etiqueta e coluna) */}
          <ShareLinksSettings />

          {/* Fluxos automáticos de mudança de coluna no Kanban */}
          <StageAutomationsSettings />

          {/* Etiquetas do chat (nome, cor e coluna associada) */}
          <ChatLabelsSettings />

          {/* Atalhos digitáveis do chat (/fluxo1, /oi ...) */}
          <ChatShortcutsSettings />





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
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem onClick={() => { resetForm(); setProvider("meta_cloud"); setIsAddingAccount(true); }} className="gap-2">
                      <Key size={14} /> Meta Cloud (manual)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleMetaOAuth} className="gap-2">
                      <ExternalLink size={14} /> Conectar via Meta OAuth
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { resetForm(); setProvider("d360"); setIsAddingAccount(true); }} className="gap-2">
                      <MessageCircle size={14} /> 360dialog
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { resetForm(); setProvider("evolution"); setIsAddingAccount(true); }} className="gap-2">
                      <MessageCircle size={14} /> Evolution API (manual)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={openQrDialogForNew} className="gap-2">
                      <QrCode size={14} /> Conectar via QR Code (Evolution)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => toggleAutoReconnect(!autoReconnect)} className="gap-2">
                      <RefreshCw size={14} /> Reconexão automática: {autoReconnect ? "ON" : "OFF"}
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
                              {account.provider === "d360" ? (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">360dialog</Badge>
                              ) : account.provider === "evolution" ? (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Evolution API</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">Meta Cloud</Badge>
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

                            {account.provider === "evolution" && (
                              <Button variant="default" size="sm" onClick={() => openQrDialogForExisting(account)} className="text-xs h-8 gap-1">
                                <QrCode size={14} /> Conectar (QR)
                              </Button>
                            )}

                            {account.provider === "meta_cloud" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-8 gap-1"
                                onClick={async () => {
                                  const t = toast.loading("Re-inscrevendo webhook com override_callback_uri...");
                                  try {
                                    const { data, error } = await supabase.functions.invoke(
                                      "whatsapp-subscribe-webhook",
                                      { body: { account_id: account.id } },
                                    );
                                    if (error) throw error;
                                    const r = data?.results?.[0];
                                    if (r?.ok) {
                                      toast.success("Webhook re-inscrito com sucesso!", { id: t });
                                      queryClient.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
                                    } else {
                                      toast.error(`Falha: ${r?.error || "erro desconhecido"}`, { id: t });
                                    }
                                  } catch (e: any) {
                                    toast.error(e.message, { id: t });
                                  }
                                }}
                              >
                                <Plug size={14} /> Re-inscrever Webhook
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
                                <DropdownMenuItem
                                  onClick={async () => {
                                    const t = toast.loading("Ativando webhook na Meta...");
                                    try {
                                      const { data } = await supabase.functions.invoke(
                                        "whatsapp-subscribe-webhook",
                                        { body: { account_id: account.id } },
                                      );
                                      const r = data?.results?.[0];
                                      if (r?.ok) {
                                        toast.success("Webhook ativado! Status delivered/read funcionarão.", { id: t });
                                      } else {
                                        toast.error(`Falha: ${r?.error || "erro desconhecido"}`, { id: t });
                                      }
                                    } catch (e: any) {
                                      toast.error(e.message, { id: t });
                                    }
                                  }}
                                  className="gap-2"
                                >
                                  <Plug size={14} /> Reativar Webhook
                                </DropdownMenuItem>
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
                  <Label>Provedor</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setProvider("meta_cloud")}
                      className={`text-left rounded-lg border p-3 transition-colors ${
                        provider === "meta_cloud" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <p className="text-sm font-medium">Meta Cloud API</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Conexão oficial via Facebook Business</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProvider("d360")}
                      className={`text-left rounded-lg border p-3 transition-colors ${
                        provider === "d360" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <p className="text-sm font-medium">360dialog</p>
                      <p className="text-xs text-muted-foreground mt-0.5">BSP via D360-API-KEY</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProvider("evolution")}
                      className={`text-left rounded-lg border p-3 transition-colors ${
                        provider === "evolution" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <p className="text-sm font-medium">Evolution API</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Self-hosted (Hetzner) — texto, mídia, botões e listas</p>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="accountName">Nome da Conta</Label>
                  <Input id="accountName" placeholder="Ex: Minha Loja Principal" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
                </div>

                {provider === "meta_cloud" && (
                  <>
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
                  </>
                )}

                {provider === "d360" && (
                  <div className="space-y-2">
                    <Label htmlFor="apiKey">D360-API-KEY</Label>
                    <Input id="apiKey" type="password" placeholder="Sua D360-API-KEY..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      Gere no Hub do 360dialog em <span className="font-mono">API Keys</span>. A chave já identifica o número — Phone Number ID não é necessário.
                    </p>
                  </div>
                )}

                {provider === "evolution" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="evoServer">URL do servidor Evolution</Label>
                      <Input
                        id="evoServer"
                        placeholder="https://evolution.seudominio.com"
                        value={businessAccountId}
                        onChange={(e) => setBusinessAccountId(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Endereço da sua instância self-hosted (sem barra final). Ex: <span className="font-mono">https://evolution.app.com.br</span>
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phoneNumberId">Instance Name</Label>
                      <Input
                        id="phoneNumberId"
                        placeholder="ex: suporte-gabriel"
                        value={phoneNumberId}
                        onChange={(e) => setPhoneNumberId(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Nome da instance criado no Evolution Manager.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="apiKey">API Key (apikey)</Label>
                      <Input id="apiKey" type="password" placeholder="apikey global ou específica da instance" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                      <p className="text-xs text-muted-foreground">
                        Use a <span className="font-mono">AUTHENTICATION_API_KEY</span> global ou a <span className="font-mono">apikey</span> da instance. Enviada como header <span className="font-mono">apikey</span>.
                      </p>
                    </div>
                  </>
                )}

                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <p className="text-sm font-medium flex items-center gap-2"><Link2 size={16} /> Webhook do WhatsApp</p>
                  <p className="text-xs text-muted-foreground">
                    {provider === "d360"
                      ? "Cole esta URL no campo 'Webhook URL' do Hub do 360dialog (WhatsApp Accounts → seu número → Webhook). Não é necessário Verify Token."
                      : provider === "evolution"
                      ? "Configure no Evolution Manager: Instance → Webhook → cole a URL abaixo e ative os eventos MESSAGES_UPSERT e MESSAGES_UPDATE."
                      : "Configure este webhook no App do Facebook para receber mensagens."}
                  </p>
                  <div className="space-y-2">
                    <Label>URL do Webhook (Callback URL)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={
                          provider === "d360"
                            ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/d360-webhook`
                            : provider === "evolution"
                            ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evolution-webhook${editingAccount?.id ? `?account_id=${editingAccount.id}` : ""}`
                            : webhookUrl
                        }
                        readOnly
                        className="font-mono text-xs"
                      />
                      <Button variant="outline" size="icon" onClick={() => {
                        const url = provider === "d360"
                          ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/d360-webhook`
                          : provider === "evolution"
                          ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evolution-webhook${editingAccount?.id ? `?account_id=${editingAccount.id}` : ""}`
                          : webhookUrl;
                        navigator.clipboard.writeText(url);
                        toast.success("URL copiada!");
                      }}><Copy size={16} /></Button>
                    </div>
                  </div>
                  {provider === "meta_cloud" && (
                  <div className="space-y-2">
                    <Label htmlFor="verifyToken">Verify Token</Label>
                    <div className="flex gap-2">
                      <Input
                        id="verifyToken"
                        placeholder="Defina um token de verificação"
                        value={verifyToken}
                        onChange={(e) => setVerifyToken(e.target.value)}
                        readOnly={!isAdmin}
                      />
                      {isAdmin && (
                        <Button onClick={handleSaveVerifyToken} disabled={isSavingToken} variant="default" size="sm" className="shrink-0">
                          {isSavingToken ? "Salvando..." : <><CheckCircle2 size={16} /> Salvar</>}
                        </Button>
                      )}
                      {!isAdmin && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          aria-label="Copiar verify token"
                          onClick={() => {
                            navigator.clipboard.writeText(verifyToken);
                            toast.success("Verify token copiado!");
                          }}
                        >
                          <Copy size={16} />
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isAdmin
                        ? 'Use este valor no campo "Verify Token" ao configurar o webhook no Facebook.'
                        : 'Este token é compartilhado pelo app Meta e gerenciado pelo administrador. Copie-o sem alterar.'}
                    </p>
                  </div>
                  )}
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

        {/* ── Home Tab (Dashboard) ── */}
        <TabsContent value="home" className="overflow-y-auto flex-1 m-0 p-0">
          <DashboardHome onNavigateTab={(t) => setActiveMainTab(t)} />
        </TabsContent>

        {/* ── Kanban Tab ── */}
        {/* ── Templates Tab ── */}
        <TabsContent value="templates" className="space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto flex-1 m-0">
          <TemplateStudio />
        </TabsContent>

        <TabsContent value="kanban" className="flex-1 overflow-hidden m-0 p-6">
          <LeadsKanban />
        </TabsContent>

        {/* ── Team Tab ── */}
        <TabsContent value="team" className="space-y-4 p-4 sm:p-6 max-w-5xl overflow-y-auto flex-1 m-0">
          <TeamManagement />
        </TabsContent>



        {/* ── Webhook Tab (Event Webhooks) ── */}
        {/* ── Chat Tab ── */}
        <TabsContent value="chat" className="flex-1 overflow-hidden m-0 p-0">
          <CloudChatTab />
        </TabsContent>

        <TabsContent value="webhook" className="space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto flex-1 m-0">
          <WebhookEndpoints onCreateFlow={handleCreateFlowFromWebhook} onSelectFlow={handleSelectFlowFromWebhook} />
        </TabsContent>


        {/* ── Broadcast Tab ── */}
        <TabsContent value="broadcast" className="space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto flex-1 m-0">
          <BroadcastTab />
        </TabsContent>


        {/* ── Flows Tab ── */}
        <TabsContent
          value="flows"
          className={cn(
            "flex-1 m-0",
            flowEditorOpen
              ? "h-full overflow-hidden p-0 max-w-none"
              : "space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto"
          )}
        >
          <FlowBuilder
            key={flowTriggerType || flowEditId || "default"}
            initialTriggerType={flowTriggerType}
            initialFlowId={flowEditId}
            onEditorOpen={() => setFlowEditorOpen(true)}
            onEditorClose={() => { setFlowEditorOpen(false); setFlowEditId(undefined); setFlowTriggerType(undefined); }}
          />
        </TabsContent>

        {/* ── Analytics Tab ── */}
        <TabsContent value="analytics" className="space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto flex-1 m-0">
          <CampaignAnalytics />
        </TabsContent>

        {/* ── History Tab ── */}
        <TabsContent value="history" className="space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto flex-1 m-0">
          <SendingMetrics />
        </TabsContent>

        {/* ── AI Assistant Tab ── */}
        <TabsContent value="ai-assistant" className="space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto flex-1 m-0">
          <AiAssistantSettings />
        </TabsContent>
        {/* ── Voice Studio Tab ── */}
        <TabsContent value="voice-studio" className="space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto flex-1 m-0">
          <VoiceStudio />
        </TabsContent>

        {/* ── AI Agent Tab ── */}
        <TabsContent value="ai-agent" className="space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto flex-1 m-0">
          <AiAgentConfig />
        </TabsContent>

        {/* ── Financial Tab ── */}
        <TabsContent value="financial" className="space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto flex-1 m-0">
          <FinancialTab />
        </TabsContent>

        {/* ── Metrito (tráfego pago) Tab ── */}
        <TabsContent value="metrito" className="space-y-4 p-4 sm:p-6 max-w-6xl overflow-y-auto flex-1 m-0">
          <MetritoTab />
        </TabsContent>
        </div>
      </Tabs>

      {/* ── QR Code Dialog (Evolution) ── */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode size={20} />
              {qrMode === "new" ? "Conectar nova instância via QR" : "Escanear QR Code"}
            </DialogTitle>
            <DialogDescription>
              {qrMode === "new"
                ? "Crie uma nova instância no seu servidor Evolution e conecte um número WhatsApp."
                : "Abra o WhatsApp → Aparelhos conectados → Conectar um aparelho e aponte para o QR abaixo."}
            </DialogDescription>
          </DialogHeader>

          {qrMode === "new" && !qrAccountId ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="qrName">Nome da conta</Label>
                <Input
                  id="qrName"
                  placeholder="Ex: Suporte Loja"
                  value={qrName}
                  onChange={(e) => setQrName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter" && !qrLoading) handleCreateAndConnect(); }}
                />
                <p className="text-xs text-muted-foreground">
                  O servidor e a API Key são usados automaticamente das configurações do backend.
                  A instância será criada com base no nome.
                </p>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setQrDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleCreateAndConnect} disabled={qrLoading}>
                  {qrLoading ? <><Loader2 size={14} className="animate-spin mr-1" /> Gerando QR…</> : <><QrCode size={14} className="mr-1" /> Gerar QR Code</>}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col items-center justify-center gap-3 py-2">
                {qrLoading && !qrImage ? (
                  <div className="w-64 h-64 flex items-center justify-center bg-muted rounded-lg">
                    <Loader2 size={32} className="animate-spin text-muted-foreground" />
                  </div>
                ) : qrConnState === "open" ? (
                  <div className="w-64 h-64 flex flex-col items-center justify-center bg-emerald-500/10 rounded-lg gap-2">
                    <CheckCircle2 size={48} className="text-emerald-500" />
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Conectado!</p>
                  </div>
                ) : qrImage ? (
                  <img src={qrImage} alt="QR Code Evolution" className="w-64 h-64 rounded-lg border bg-white p-2" />
                ) : (
                  <div className="w-64 h-64 flex items-center justify-center bg-muted rounded-lg text-xs text-muted-foreground text-center px-4">
                    Aguardando QR Code do servidor…
                  </div>
                )}

                {qrPairingCode && qrConnState !== "open" && (
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">ou use o código de pareamento</p>
                    <p className="font-mono text-lg font-semibold tracking-widest">{qrPairingCode}</p>
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs">
                  <Smartphone size={14} className="text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Status: <span className="font-medium text-foreground capitalize">{qrConnState}</span>
                  </span>
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => qrAccountId && fetchQrForAccount(qrAccountId)}
                  disabled={!qrAccountId || qrConnState === "open"}
                >
                  <RefreshCw size={14} className="mr-1" /> Atualizar QR
                </Button>
                <Button onClick={() => setQrDialogOpen(false)}>Fechar</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>

  );
}
