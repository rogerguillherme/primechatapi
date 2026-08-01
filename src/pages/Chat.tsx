import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search, Send, MessageSquare, FileText, User, Smile, Check, CheckCheck,
  MoreVertical, Phone, Video, ArrowLeft, Image, Paperclip, Mic,
  ShoppingBag, Clock, MessageCircleReply, RotateCcw, AlertCircle,
  Bot, Users, PowerOff,
} from "lucide-react";
import { format, isToday, isYesterday, isSameDay, addDays, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";
import { ChatMediaBubble } from "@/components/ChatMediaBubble";
import { AudioRecorder } from "@/components/AudioRecorder";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import { DeleteOldLeadsDialog } from "@/components/chat/DeleteOldLeadsDialog";
import { Trash2 } from "lucide-react";

type ChatTab = "novos_pedidos" | "aguardando_respostas" | "respondidas" | "reembolso";

const CHAT_TABS: { value: ChatTab; label: string; icon: React.ReactNode }[] = [
  { value: "aguardando_respostas", label: "Aguardando", icon: <Clock size={14} /> },
  { value: "respondidas", label: "Respondidas", icon: <MessageCircleReply size={14} /> },
  { value: "novos_pedidos", label: "Novos Pedidos", icon: <ShoppingBag size={14} /> },
  { value: "reembolso", label: "Reembolso", icon: <RotateCcw size={14} /> },
];

// Generate consistent avatar color from name
function getAvatarColor(name: string) {
  const colors = [
    "bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-rose-600",
    "bg-cyan-600", "bg-indigo-600", "bg-pink-600", "bg-teal-600",
  ];
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

function StatusIcon({ status }: { status: string }) {
  if (status === "failed") return <AlertCircle size={14} className="text-destructive" aria-label="Falha no envio" />;
  if (status === "read") return <CheckCheck size={14} className="text-sky-400" />;
  if (status === "delivered") return <CheckCheck size={14} className="opacity-60" />;
  return <Check size={14} className="opacity-60" />;
}

export default function Chat() {
  const [searchParams] = useSearchParams();
  const initialLeadId = searchParams.get("lead");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(initialLeadId);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "7d" | "30d">("all");
  const [message, setMessage] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [activeTab, setActiveTab] = useState<ChatTab>("aguardando_respostas");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { accounts, defaultAccount } = useWhatsAppAccounts();


  // Fetch leads
  const { data: leads } = useQuery({
    queryKey: ["chat-leads"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, name, phone, email, photo_url, chat_status, updated_at, last_inbound_at, last_outbound_at")
        .order("updated_at", { ascending: false })
        .limit(5000);
      return data || [];
    },
  });

  // Single server-side query: latest message per lead + accounts used per lead
  const { data: leadSummaries } = useQuery({
    queryKey: ["chat-lead-summaries"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("get_chat_lead_summaries", { p_limit: 5000 });
      return (data || []) as Array<{
        lead_id: string;
        content: string;
        created_at: string;
        direction: string;
        status: string | null;
        account_id: string | null;
        account_ids: string[] | null;
      }>;
    },
    staleTime: 15000,
  });

  const leadAccountMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of leadSummaries || []) {
      for (const accId of row.account_ids || []) {
        if (!map.has(accId)) map.set(accId, new Set());
        map.get(accId)!.add(row.lead_id);
      }
    }
    return map;
  }, [leadSummaries]);

  const latestMessages = useMemo(() => {
    const map = new Map<string, { content: string; created_at: string; direction: string; status: string | null; account_id: string | null }>();
    for (const row of leadSummaries || []) {
      map.set(row.lead_id, {
        content: row.content,
        created_at: row.created_at,
        direction: row.direction,
        status: row.status,
        account_id: row.account_id,
      });
    }
    return map;
  }, [leadSummaries]);


  // Fetch messages for selected lead
  const { data: messages } = useQuery({
    queryKey: ["chat-messages", selectedLeadId],
    queryFn: async () => {
      if (!selectedLeadId) return [];
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("lead_id", selectedLeadId)
        .order("created_at", { ascending: true });
      return data || [];
    },
    enabled: !!selectedLeadId,
  });

  // AI: per-lead toggle
  const { data: leadAiEnabled } = useQuery({
    queryKey: ["lead-ai", selectedLeadId],
    queryFn: async () => {
      if (!selectedLeadId) return false;
      const { data } = await supabase
        .from("leads")
        .select("ai_enabled")
        .eq("id", selectedLeadId)
        .maybeSingle();
      return !!data?.ai_enabled;
    },
    enabled: !!selectedLeadId,
  });

  const toggleLeadAi = useMutation({
    mutationFn: async (next: boolean) => {
      if (!selectedLeadId) return;
      const { error } = await supabase
        .from("leads")
        .update({ ai_enabled: next })
        .eq("id", selectedLeadId);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      queryClient.invalidateQueries({ queryKey: ["lead-ai", selectedLeadId] });
      toast({
        title: next ? "Agente IA ativado nesta conversa" : "Agente IA desativado nesta conversa",
      });
    },
    onError: () => toast({ title: "Erro ao atualizar agente", variant: "destructive" }),
  });

  // AI: global mode (off | all | selected)
  const { data: aiMode } = useQuery({
    queryKey: ["ai-auto-reply-mode"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "ai_auto_reply_mode")
        .maybeSingle();
      const v = (data?.value || "off") as "off" | "all" | "selected";
      return v;
    },
  });

  const setAiMode = useMutation({
    mutationFn: async (mode: "off" | "all" | "selected") => {
      await supabase.from("app_settings").upsert(
        { key: "ai_auto_reply_mode", value: mode, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      await supabase.from("app_settings").upsert(
        { key: "ai_auto_reply_enabled", value: mode === "all" ? "true" : "false", updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      return mode;
    },
    onSuccess: (mode) => {
      queryClient.invalidateQueries({ queryKey: ["ai-auto-reply-mode"] });
      const label = mode === "all" ? "todas as conversas" : mode === "selected" ? "conversas selecionadas" : "desativado";
      toast({ title: `Agente IA: ${label}` });
    },
  });

  // Auto-select the most relevant account for the current lead
  useEffect(() => {
    if (selectedAccountId || !selectedLeadId) return;

    const lastLeadAccountId = messages?.slice().reverse().find((msg) => msg.account_id)?.account_id;
    if (lastLeadAccountId) {
      setSelectedAccountId(lastLeadAccountId);
      return;
    }

    if (defaultAccount) {
      setSelectedAccountId(defaultAccount.id);
    }
  }, [defaultAccount, selectedAccountId, selectedLeadId, messages]);

  // Fetch templates scoped to user's accounts
  const { templates } = useUserTemplates();

  // Fetch expiration days per lead
  const { data: leadExpirationMap } = useQuery({
    queryKey: ["chat-lead-expirations"],
    queryFn: async () => {
      const { data: orders } = await supabase
        .from("orders")
        .select("lead_id, product_id, created_at")
        .eq("status", "approved")
        .order("created_at", { ascending: true });
      if (!orders) return new Map<string, number>();

      const productIds = [...new Set(orders.map((o) => o.product_id).filter(Boolean))] as string[];
      const { data: productItems } = await supabase
        .from("product_items")
        .select("product_id, item_id, quantity")
        .in("product_id", productIds);

      const productCompositionMap = new Map<string, { item_id: string; quantity: number }[]>();
      for (const pi of productItems || []) {
        if (!productCompositionMap.has(pi.product_id)) productCompositionMap.set(pi.product_id, []);
        productCompositionMap.get(pi.product_id)!.push({ item_id: pi.item_id, quantity: pi.quantity });
      }

      const leadMap = new Map<string, { earliest: Date; itemQtyMap: Map<string, number> }>();
      for (const order of orders) {
        if (!leadMap.has(order.lead_id)) {
          leadMap.set(order.lead_id, { earliest: new Date(order.created_at), itemQtyMap: new Map() });
        }
        const entry = leadMap.get(order.lead_id)!;
        const composition = order.product_id ? productCompositionMap.get(order.product_id) : null;
        if (composition) {
          for (const { item_id, quantity } of composition) {
            entry.itemQtyMap.set(item_id, (entry.itemQtyMap.get(item_id) || 0) + quantity);
          }
        } else {
          entry.itemQtyMap.set("unknown", (entry.itemQtyMap.get("unknown") || 0) + 1);
        }
      }

      const result = new Map<string, number>();
      for (const [leadId, { earliest, itemQtyMap }] of leadMap) {
        const maxQty = Math.max(...Array.from(itemQtyMap.values()), 1);
        const expirationDate = addDays(earliest, maxQty * 30);
        result.set(leadId, differenceInDays(expirationDate, new Date()));
      }
      return result;
    },
  });

  // Realtime + polling fallback
  useEffect(() => {
    const channel = supabase
      .channel("chat-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages" },
        (payload) => {
          const row: any = payload.new ?? payload.old;
          if (row?.lead_id === selectedLeadId) {
            queryClient.invalidateQueries({ queryKey: ["chat-messages", selectedLeadId] });
          }
          queryClient.invalidateQueries({ queryKey: ["chat-lead-summaries"] });
          queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
        }
      )
      .subscribe();

    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", selectedLeadId] });
      queryClient.invalidateQueries({ queryKey: ["chat-lead-summaries"] });
      queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [selectedLeadId, queryClient]);

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [message]);

  const selectedLead = leads?.find((l) => l.id === selectedLeadId);

  const sendMutation = useMutation({
    mutationFn: async ({ text, mediaUrl, mediaType }: { text?: string; mediaUrl?: string; mediaType?: string }) => {
      if (!selectedLead) throw new Error("No lead selected");
      const { data, error } = await supabase.functions.invoke("whatsapp-cloud-send", {
        body: {
          phone: selectedLead.phone,
          message: text || "",
          lead_id: selectedLead.id,
          media_url: mediaUrl || undefined,
          media_type: mediaType || undefined,
          account_id: selectedAccountId || undefined,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["chat-messages", selectedLeadId] });
      queryClient.invalidateQueries({ queryKey: ["chat-lead-summaries"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    },
  });

  const uploadAndSendMedia = useCallback(async (file: File) => {
    if (!selectedLead) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("lead_id", selectedLead.id);

      const { data, error } = await supabase.functions.invoke("chat-upload-media", {
        body: formData,
      });
      if (error) throw error;

      sendMutation.mutate({ mediaUrl: data.url, mediaType: data.media_type });
    } catch (err: any) {
      toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
    }
  }, [selectedLead, sendMutation, toast]);

  const handleAudioRecorded = useCallback((blob: Blob) => {
    const file = new File([blob], "audio.webm", { type: "audio/webm" });
    uploadAndSendMedia(file);
  }, [uploadAndSendMedia]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAndSendMedia(file);
    if (e.target) e.target.value = "";
  }, [uploadAndSendMedia]);

  const handleSend = () => {
    const text = message.trim();
    if (!text) return;
    sendMutation.mutate({ text });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    const s = search.toLowerCase();
    const now = Date.now();
    const cutoff =
      dateFilter === "today" ? now - 24 * 60 * 60 * 1000 :
      dateFilter === "7d" ? now - 7 * 24 * 60 * 60 * 1000 :
      dateFilter === "30d" ? now - 30 * 24 * 60 * 60 * 1000 : 0;
    return leads.filter((l) => {
      if (l.chat_status !== activeTab) return false;
      if (!(l.name.toLowerCase().includes(s) || l.phone.includes(s) || l.email?.toLowerCase().includes(s))) return false;
      if (filterAccountId && !leadAccountMap?.get(filterAccountId)?.has(l.id)) return false;
      if (cutoff > 0) {
        const latest = latestMessages?.get(l.id);
        const ts = latest
          ? new Date(latest.created_at).getTime()
          : new Date((l as any).updated_at || (l as any).last_inbound_at || (l as any).last_outbound_at || 0).getTime();
        if (ts < cutoff) return false;
      }
      return true;
    });
  }, [leads, search, activeTab, filterAccountId, leadAccountMap, dateFilter, latestMessages]);

  const tabCounts = useMemo(() => {
    if (!leads) return {} as Record<ChatTab, number>;
    const counts: Record<string, number> = {};
    for (const l of leads) {
      counts[l.chat_status] = (counts[l.chat_status] || 0) + 1;
    }
    return counts;
  }, [leads]);

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

  // Group messages by date
  const groupedMessages = useMemo(() => {
    if (!messages) return [];
    const groups: { date: Date; messages: typeof messages }[] = [];
    for (const msg of messages) {
      const msgDate = new Date(msg.created_at);
      const last = groups[groups.length - 1];
      if (last && isSameDay(last.date, msgDate)) {
        last.messages.push(msg);
      } else {
        groups.push({ date: msgDate, messages: [msg] });
      }
    }
    return groups;
  }, [messages]);

  const formatSidebarTime = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return "Ontem";
    return format(d, "dd/MM/yy");
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] -m-6 lg:-m-8">
      {/* ===== LEFT PANEL - Contact list ===== */}
      <div className={cn(
        "w-[350px] flex flex-col border-r border-border bg-card",
        selectedLeadId ? "hidden lg:flex" : "flex flex-1 lg:flex-none lg:w-[350px]"
      )}>
        {/* Header */}
        <div className="h-14 px-4 flex items-center justify-between" style={{ background: "hsl(var(--sidebar-background))" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted/20 flex items-center justify-center">
              <MessageSquare size={20} className="text-sidebar-foreground" />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSearch(!showSearch)}
              className="p-2 rounded-full hover:bg-white/10 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
            >
              <Search size={18} />
            </button>
            <DeleteOldLeadsDialog
              trigger={
                <button
                  title="Excluir leads antigos por período"
                  className="p-2 rounded-full hover:bg-white/10 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              }
            />

            {/* Global AI mode menu — always visible */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  title="Configurar agente IA"
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    aiMode === "all"
                      ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                      : aiMode === "selected"
                      ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                      : "hover:bg-white/10 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                  )}
                >
                  <Bot size={18} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Agente IA — modo global
                </div>
                <DropdownMenuItem
                  onClick={() => setAiMode.mutate("off")}
                  className={cn("gap-2", aiMode === "off" && "bg-accent")}
                >
                  <PowerOff size={14} />
                  <div className="flex-1">
                    <p className="text-sm">Desativado</p>
                    <p className="text-[11px] text-muted-foreground">Não responde nenhuma conversa</p>
                  </div>
                  {aiMode === "off" && <Check size={14} />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setAiMode.mutate("all")}
                  className={cn("gap-2", aiMode === "all" && "bg-accent")}
                >
                  <Users size={14} />
                  <div className="flex-1">
                    <p className="text-sm">Todas as conversas</p>
                    <p className="text-[11px] text-muted-foreground">Responde qualquer mensagem recebida</p>
                  </div>
                  {aiMode === "all" && <Check size={14} />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setAiMode.mutate("selected")}
                  className={cn("gap-2", aiMode === "selected" && "bg-accent")}
                >
                  <MessageSquare size={14} />
                  <div className="flex-1">
                    <p className="text-sm">Conversas selecionadas</p>
                    <p className="text-[11px] text-muted-foreground">Apenas onde a IA foi ativada</p>
                  </div>
                  {aiMode === "selected" && <Check size={14} />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className="px-3 py-2 bg-card border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Pesquisar ou começar uma nova conversa"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm rounded-lg bg-muted/50 border-0 focus-visible:ring-1"
                autoFocus
              />
            </div>
          </div>
        )}

        {/* Date filter */}
        <div className="px-3 py-1.5 border-b border-border bg-card flex gap-1">
          {([
            { v: "all", l: "Todas" },
            { v: "today", l: "Hoje" },
            { v: "7d", l: "7 dias" },
            { v: "30d", l: "30 dias" },
          ] as const).map((o) => (
            <button
              key={o.v}
              onClick={() => setDateFilter(o.v)}
              className={cn(
                "flex-1 text-[11px] py-1 rounded-md transition-colors",
                dateFilter === o.v ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted"
              )}
            >
              {o.l}
            </button>
          ))}
        </div>

        {/* Account filter */}
        {accounts.length > 1 && (
          <div className="px-3 py-1.5 border-b border-border bg-card">
            <select
              value={filterAccountId || ""}
              onChange={(e) => setFilterAccountId(e.target.value || null)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Todos os números</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.is_default ? "(padrão)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Tab selector */}
        <div className="px-1.5 py-1.5 border-b border-border bg-card">
          <div className="flex gap-0.5">
            {CHAT_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-0.5 px-1 py-1.5 rounded-md text-[10px] font-medium transition-colors",
                  activeTab === tab.value
                    ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tabCounts[tab.value] ? (
                  <span className={cn(
                    "text-[9px] min-w-[14px] h-3.5 rounded-full flex items-center justify-center px-0.5",
                    activeTab === tab.value ? "bg-violet-200 text-violet-800 dark:bg-violet-800 dark:text-violet-200" : "bg-muted"
                  )}>
                    {tabCounts[tab.value]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* Contact list */}
        <ScrollArea className="flex-1">
          {sortedLeads.map((lead) => {
            const latest = latestMessages?.get(lead.id);
            const isSelected = lead.id === selectedLeadId;
            const avatarColor = getAvatarColor(lead.name);
            return (
              <button
                key={lead.id}
                onClick={() => setSelectedLeadId(lead.id)}
                className={cn(
                  "w-full text-left flex items-center gap-3 px-3 py-3 transition-colors",
                  isSelected ? "bg-accent/80" : "hover:bg-accent/40"
                )}
              >
                {/* Avatar */}
                <Avatar className="w-12 h-12 flex-shrink-0">
                  {lead.photo_url ? (
                    <AvatarImage src={lead.photo_url} alt={lead.name} />
                  ) : null}
                  <AvatarFallback className={cn(avatarColor, "text-white font-medium text-sm")}>
                    {getInitials(lead.name)}
                  </AvatarFallback>
                </Avatar>

                {/* Content */}
                <div className="flex-1 min-w-0 border-b border-border/40 pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="font-medium text-[15px] truncate">{lead.name}</p>
                      {leadExpirationMap?.has(lead.id) && (() => {
                        const days = leadExpirationMap.get(lead.id)!;
                        if (days < 0) return <Badge variant="destructive" className="text-[9px] px-1.5 py-0 flex-shrink-0">{Math.abs(days)}d</Badge>;
                        if (days <= 7) return <Badge variant="destructive" className="text-[9px] px-1.5 py-0 flex-shrink-0">{days}d</Badge>;
                        if (days <= 15) return <Badge className="bg-orange-500/15 text-orange-600 border-orange-500/30 text-[9px] px-1.5 py-0 flex-shrink-0">{days}d</Badge>;
                        if (days <= 30) return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 text-[9px] px-1.5 py-0 flex-shrink-0">{days}d</Badge>;
                        return <Badge variant="secondary" className="text-[9px] px-1.5 py-0 flex-shrink-0">{days}d</Badge>;
                      })()}
                    </div>
                    {latest && (
                      <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                        {formatSidebarTime(latest.created_at)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {latest?.direction === "outbound" && (
                      <CheckCheck size={14} className="text-sky-400 flex-shrink-0" />
                    )}
                    <p className="text-sm text-muted-foreground truncate">
                      {latest ? latest.content : "Iniciar conversa"}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </ScrollArea>
      </div>

      {/* ===== RIGHT PANEL - Chat area ===== */}
      <div className={cn(
        "flex-1 flex flex-col",
        !selectedLeadId ? "hidden lg:flex" : "flex"
      )}>
        {selectedLead ? (
          <>
            {/* Chat header */}
            <div className="h-14 px-4 flex items-center gap-3 border-b border-border" style={{ background: "hsl(var(--sidebar-background))" }}>
              <button
                onClick={() => setSelectedLeadId(null)}
                className="lg:hidden p-1 text-sidebar-foreground/70 hover:text-sidebar-foreground"
              >
                <ArrowLeft size={20} />
              </button>
              <Avatar className="w-10 h-10 flex-shrink-0">
                {selectedLead.photo_url ? (
                  <AvatarImage src={selectedLead.photo_url} alt={selectedLead.name} />
                ) : null}
                <AvatarFallback className={cn(getAvatarColor(selectedLead.name), "text-white font-medium text-sm")}>
                  {getInitials(selectedLead.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[15px] text-sidebar-foreground truncate">{selectedLead.name}</p>
                <p className="text-xs text-sidebar-foreground/50">{selectedLead.phone}</p>
              </div>
              {accounts.length > 1 && (
                <select
                  value={selectedAccountId || ""}
                  onChange={(e) => setSelectedAccountId(e.target.value || null)}
                  className="h-7 rounded-md border border-sidebar-foreground/20 bg-transparent px-2 text-xs text-sidebar-foreground focus:outline-none"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id} className="text-foreground bg-background">
                      {a.name} {a.is_default ? "(padrão)" : ""}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex items-center gap-1">
                {/* Per-conversation AI toggle */}
                <button
                  onClick={() => toggleLeadAi.mutate(!leadAiEnabled)}
                  disabled={toggleLeadAi.isPending}
                  title={
                    aiMode === "all"
                      ? "Agente IA respondendo todas as conversas"
                      : leadAiEnabled
                      ? "Agente IA ativo nesta conversa — clique para desativar"
                      : "Ativar agente IA nesta conversa"
                  }
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    leadAiEnabled || aiMode === "all"
                      ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                      : "hover:bg-white/10 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                  )}
                >
                  <Bot size={18} />
                </button>

                <button className="p-2 rounded-full hover:bg-white/10 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
                  <Search size={18} />
                </button>

                {/* Global AI mode menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      title="Configurar agente IA"
                      className="p-2 rounded-full hover:bg-white/10 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
                    >
                      <MoreVertical size={18} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Agente IA — modo global
                    </div>
                    <DropdownMenuItem
                      onClick={() => setAiMode.mutate("off")}
                      className={cn("gap-2", aiMode === "off" && "bg-accent")}
                    >
                      <PowerOff size={14} />
                      <div className="flex-1">
                        <p className="text-sm">Desativado</p>
                        <p className="text-[11px] text-muted-foreground">Não responde nenhuma conversa</p>
                      </div>
                      {aiMode === "off" && <Check size={14} />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setAiMode.mutate("all")}
                      className={cn("gap-2", aiMode === "all" && "bg-accent")}
                    >
                      <Users size={14} />
                      <div className="flex-1">
                        <p className="text-sm">Todas as conversas</p>
                        <p className="text-[11px] text-muted-foreground">Responde qualquer mensagem recebida</p>
                      </div>
                      {aiMode === "all" && <Check size={14} />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setAiMode.mutate("selected")}
                      className={cn("gap-2", aiMode === "selected" && "bg-accent")}
                    >
                      <MessageSquare size={14} />
                      <div className="flex-1">
                        <p className="text-sm">Conversas selecionadas</p>
                        <p className="text-[11px] text-muted-foreground">Apenas onde a IA foi ativada</p>
                      </div>
                      {aiMode === "selected" && <Check size={14} />}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Messages area with WhatsApp-style wallpaper */}
            <div
              className="flex-1 overflow-y-auto px-4 lg:px-16 py-4"
              style={{
                backgroundColor: "hsl(30 20% 93%)",
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.02'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
              }}
            >
              <div className="max-w-3xl mx-auto space-y-1">
                {messages?.length === 0 && (
                  <div className="flex justify-center py-10">
                    <div className="bg-card/90 backdrop-blur rounded-lg px-6 py-3 shadow-sm">
                      <p className="text-sm text-muted-foreground text-center">
                        Nenhuma mensagem ainda. Envie a primeira! 💬
                      </p>
                    </div>
                  </div>
                )}

                {groupedMessages.map((group, gi) => (
                  <div key={gi}>
                    {/* Date separator */}
                    <div className="flex justify-center my-3">
                      <span className="bg-card/90 backdrop-blur text-muted-foreground text-[11px] font-medium px-3 py-1 rounded-md shadow-sm uppercase tracking-wide">
                        {formatDateSeparator(group.date)}
                      </span>
                    </div>

                    {/* Messages */}
                    {group.messages.map((msg, mi) => {
                      const isOutbound = msg.direction === "outbound";
                      // Show tail on first message or when direction changes
                      const prevMsg = mi > 0 ? group.messages[mi - 1] : null;
                      const showTail = !prevMsg || prevMsg.direction !== msg.direction;

                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex mb-[2px]",
                            isOutbound ? "justify-end" : "justify-start",
                            showTail && "mt-2"
                          )}
                        >
                          <div
                            className={cn(
                              "relative max-w-[65%] px-[9px] pt-[6px] pb-2 text-[14.2px] leading-[19px] shadow-sm",
                              isOutbound
                                ? "bg-[#d9fdd3] text-[#111b21] rounded-lg"
                                : "bg-card text-foreground rounded-lg",
                              showTail && isOutbound && "rounded-tr-none",
                              showTail && !isOutbound && "rounded-tl-none"
                            )}
                          >
                            {/* Tail */}
                            {showTail && (
                              <div
                                className={cn(
                                  "absolute top-0 w-2 h-3",
                                  isOutbound
                                    ? "-right-2"
                                    : "-left-2"
                                )}
                              >
                                <svg viewBox="0 0 8 13" width="8" height="13">
                                  {isOutbound ? (
                                    <path fill="#d9fdd3" d="M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" />
                                  ) : (
                                    <path fill="hsl(var(--card))" d="M6.467 3.568 0 12.193V1h5.188c1.77 0 2.338 1.156 1.28 2.568z" />
                                  )}
                                </svg>
                              </div>
                            )}

                            {/* Media content */}
                            {msg.media_url && msg.media_type ? (
                              <div className="mb-1">
                                <ChatMediaBubble
                                  mediaType={msg.media_type}
                                  mediaUrl={msg.media_url}
                                  caption={msg.media_type !== "audio" ? msg.content : undefined}
                                  isOutbound={isOutbound}
                                />
                                <span className="inline-block w-[60px]" />
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap break-words">
                                {msg.content}
                                <span className="inline-block w-[60px]" />
                              </p>
                            )}

                            {/* Time + status */}
                            <span className={cn(
                              "absolute bottom-[5px] right-[7px] flex items-center gap-[2px]",
                              isOutbound ? "text-[#667781]" : "text-muted-foreground"
                            )}>
                              <span className="text-[11px] leading-none">
                                {format(new Date(msg.created_at), "HH:mm")}
                              </span>
                              {isOutbound && <StatusIcon status={msg.status} />}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Input area */}
            <div className="px-4 lg:px-5 py-2 bg-muted/50 border-t border-border">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                className="hidden"
                onChange={handleFileSelect}
              />
              <div className="flex items-end gap-2 max-w-3xl mx-auto">
                {/* Templates + Attachment */}
                <div className="flex items-center gap-0.5 flex-shrink-0 mb-[5px]">
                  {templates && templates.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                          <FileText size={22} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-72">
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Templates</div>
                        {templates.map((t) => (
                          <DropdownMenuItem key={t.id} onClick={() => setMessage(t.content)} className="flex flex-col items-start gap-0.5">
                            <span className="font-medium text-sm">{t.name}</span>
                            <span className="text-xs text-muted-foreground line-clamp-2">{t.content}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Paperclip size={22} />
                  </button>
                </div>

                {/* Message input */}
                <div className="flex-1 bg-card rounded-lg border border-border shadow-sm overflow-hidden">
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Digite uma mensagem"
                    className="w-full px-3 py-[9px] text-[15px] bg-transparent outline-none resize-none placeholder:text-muted-foreground max-h-[120px]"
                    rows={1}
                    style={{ minHeight: "38px" }}
                  />
                </div>

                {/* Send or Audio */}
                {message.trim() ? (
                  <button
                    onClick={handleSend}
                    disabled={sendMutation.isPending}
                    className="p-2.5 rounded-full flex-shrink-0 mb-[3px] bg-primary text-primary-foreground hover:opacity-90 transition-colors"
                  >
                    <Send size={20} />
                  </button>
                ) : (
                  <AudioRecorder onRecorded={handleAudioRecorded} disabled={sendMutation.isPending} />
                )}
              </div>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center bg-muted/30">
            <div className="text-center max-w-md">
              <div className="w-[200px] h-[200px] mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <MessageSquare size={80} className="text-primary/30" />
              </div>
              <h2 className="text-2xl font-display text-foreground/80 mb-2">Prime Chat</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Envie e receba mensagens dos seus leads via WhatsApp.<br />
                Selecione um contato para começar.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
