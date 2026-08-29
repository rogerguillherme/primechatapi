import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ChatMediaBubble } from "@/components/ChatMediaBubble";
import { AudioRecorder, audioFileFromBlob, validarAudio } from "@/components/AudioRecorder";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Search, Send, MessageSquare, FileText, Check, CheckCheck,
  MoreVertical, ArrowLeft, Paperclip, Clock, MessageCircleReply,
  ShoppingBag, RotateCcw, Tag, X, AlertCircle, Bot, Users, PowerOff, Megaphone,
  Info, Pencil, Columns3, Zap, Workflow, UserPlus, Pause, Play, Reply,
  CheckCircle2, Mail,
} from "lucide-react";
import { BulkBroadcastDialog } from "@/components/BulkBroadcastDialog";
import { ContactInfoSheet } from "@/components/chat/ContactInfoSheet";
import { EmojiPicker } from "@/components/chat/EmojiPicker";

import { startFlowForLead } from "@/lib/startFlowForLead";
import { functionErrorMessage } from "@/lib/functionError";
import { takePendingLead } from "@/lib/openLeadInChat";
import { interpolateForLead } from "@/lib/interpolate";
import { useTeamContext, useTeamMembers } from "@/hooks/use-team";
import { useToggleLeadLabel } from "@/hooks/use-chat-labels";
import { useAuth } from "@/contexts/AuthContext";

import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

/** Valor sentinela do filtro por vendedor: conversas sem responsável. */
const UNASSIGNED_AGENT = "__sem_dono__";

type ChatTab = "aguardando_respostas" | "respondidas" | "erro" | "finalizado";
type AiMode = "off" | "all" | "selected";

const CHAT_TABS: { value: ChatTab; label: string; icon: React.ReactNode }[] = [
  { value: "respondidas", label: "Respondidas", icon: <MessageCircleReply size={14} /> },
  { value: "aguardando_respostas", label: "Aguardando", icon: <Clock size={14} /> },
  { value: "finalizado", label: "Finalizados", icon: <CheckCircle2 size={14} /> },
  { value: "erro", label: "Erro", icon: <AlertCircle size={14} /> },
];

/** Marcações locais de "não lido" (por usuário, neste navegador). */


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

function StatusIcon({ status }: { status: string }) {
  if (status === "failed") return <AlertCircle size={14} className="text-destructive" aria-label="Falha no envio" />;
  if (status === "accepted" || status === "queued" || status === "processing") return <Clock size={14} className="opacity-60" aria-label="Aguardando confirmação da Meta" />;
  if (status === "read") return <CheckCheck size={14} className="text-sky-400" />;
  if (status === "delivered") return <CheckCheck size={14} className="opacity-60" />;
  return <Check size={14} className="opacity-60" />;
}

export interface CloudChatTabProps {
  /**
   * Avisa o shell quando uma conversa é aberta/fechada. No celular a barra
   * inferior desaparece com a conversa aberta, como no WhatsApp.
   */
  onConversationChange?: (open: boolean) => void;
}

export function CloudChatTab({ onConversationChange }: CloudChatTabProps = {}) {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("aguardando_respostas");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);
  const [filterLabelIds, setFilterLabelIds] = useState<Set<string>>(new Set());
  // Conjunto vazio = todos. UNASSIGNED_AGENT participa como se fosse um
  // vendedor, para dar pra ver "Ana + sem responsável" numa tacada.
  const [filterAgentIds, setFilterAgentIds] = useState<Set<string>>(new Set());

  const toggleAgentFilter = (id: string) =>
    setFilterAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [showLabelFilter, setShowLabelFilter] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Painel de dados/edição do contato e atalhos do chat
  const [contactOpen, setContactOpen] = useState(false);
  const [contactTab, setContactTab] = useState<"info" | "edit">("info");
  const [shortcutQuery, setShortcutQuery] = useState<string | null>(null);
  const [shortcutIndex, setShortcutIndex] = useState(0);
  /** Mensagem selecionada para responder (citação WhatsApp). */
  const [replyTo, setReplyTo] = useState<any | null>(null);

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { accounts, defaultAccount } = useWhatsAppAccounts();
  const { templates } = useUserTemplates();

  useEffect(() => {
    if (!selectedAccountId && defaultAccount) setSelectedAccountId(defaultAccount.id);
  }, [defaultAccount, selectedAccountId]);

  // Veio de uma tela de vendas ("abrir conversa"): abre o lead pedido.
  useEffect(() => {
    const pending = takePendingLead();
    if (pending) setSelectedLeadId(pending);
  }, []);

  // Auto backfill profile photos for leads (once per account per session)
  useEffect(() => {
    if (!selectedAccountId) return;
    const key = `photos-backfilled-${selectedAccountId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    supabase.functions
      .invoke("evolution-backfill-photos", { body: { account_id: selectedAccountId, limit: 200 } })
      .then(({ data }: any) => {
        if (data?.updated > 0) {
          queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
        }
      })
      .catch(() => {});
  }, [selectedAccountId, queryClient]);

  // Fetch labels
  const { data: labels = [] } = useQuery({
    queryKey: ["chat-labels"],
    queryFn: async () => {
      const { data } = await supabase.from("chat_labels").select("*").order("name");
      return data || [];
    },
  });


  // Fetch leads (already carries the denormalized last-message summary).
  // 5000 leads por refetch travava a aba: o payload chegava a alguns MB e todo
  // evento de realtime refazia a conta. 800 cobre a caixa de entrada real
  // (a busca por telefone/nome continua feita no servidor quando preciso).
  const { data: leads } = useQuery({
    queryKey: ["chat-leads", "cloud", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("leads")
        .select(
          "id, name, phone, email, photo_url, chat_status, ai_enabled, assigned_to, updated_at, last_outbound_at, last_message_content, last_message_at, last_message_direction, last_message_status, last_message_account_id, account_ids, manually_unread"
        )
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(800);
      return (data || []) as any[];
    },
    // O canal de realtime já invalida esta query; o polling só duplicava carga.
    staleTime: 30_000,
  });


  // Etiquetas das conversas carregadas.
  //
  // Antes buscava `lead_labels` inteira e o Supabase cortava em 1.000 linhas
  // sem avisar: em conta grande, etiqueta de conversa antiga simplesmente não
  // aparecia. Agora pede só as dos leads em tela, em lotes — a URL não aguenta
  // 800 ids de uma vez.
  const loadedLeadIds = useMemo(() => (leads || []).map((l: any) => l.id), [leads]);

  const { data: leadLabelsMap } = useQuery({
    queryKey: ["lead-labels-map", loadedLeadIds.length],
    enabled: loadedLeadIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, Set<string>>();
      for (let i = 0; i < loadedLeadIds.length; i += 200) {
        const { data, error } = await supabase
          .from("lead_labels")
          .select("lead_id, label_id")
          .in("lead_id", loadedLeadIds.slice(i, i + 200));
        if (error) throw error;
        for (const ll of data || []) {
          if (!map.has(ll.lead_id)) map.set(ll.lead_id, new Set());
          map.get(ll.lead_id)!.add(ll.label_id);
        }
      }
      return map;
    },
  });

  const leadAccountMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const lead of leads || []) {
      for (const accId of lead.account_ids || []) {
        if (!map.has(accId)) map.set(accId, new Set());
        map.get(accId)!.add(lead.id);
      }
    }
    return map;
  }, [leads]);

  const latestMessages = useMemo(() => {
    const map = new Map<string, { content: string; created_at: string; direction: string; status: string | null }>();
    for (const lead of leads || []) {
      if (!lead.last_message_at) continue;
      map.set(lead.id, {
        content: lead.last_message_content || "",
        created_at: lead.last_message_at,
        direction: lead.last_message_direction || "outbound",
        status: lead.last_message_status,
      });
    }
    return map;
  }, [leads]);



  // A lead sits in "Erro" only while its most recent message is a failed outbound.
  // Once a new inbound message arrives (or a successful send happens), it moves out
  // to the tab defined by chat_status.
  const failedLeadIds = useMemo(() => {
    const set = new Set<string>();
    if (!latestMessages) return set;
    for (const [leadId, msg] of latestMessages) {
      if (msg.direction === "outbound" && msg.status === "failed") set.add(leadId);
    }
    return set;
  }, [latestMessages]);

  const { data: aiMode = "off" } = useQuery({
    queryKey: ["ai-auto-reply-mode"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "ai_auto_reply_mode")
        .maybeSingle();
      return (data?.value as AiMode | undefined) ?? "off";
    },
  });

  const setAiMode = useMutation({
    mutationFn: async (mode: AiMode) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          { key: "ai_auto_reply_mode", value: mode, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );
      if (error) throw error;
      return mode;
    },
    onSuccess: (mode) => {
      queryClient.setQueryData(["ai-auto-reply-mode"], mode);
      const label = mode === "all" ? "todas as conversas" : mode === "selected" ? "conversas selecionadas" : "desativado";
      toast.success(`Agente IA: ${label}`);
    },
    onError: () => toast.error("Erro ao atualizar agente IA"),
  });

  const toggleLeadAi = useMutation({
    mutationFn: async (next: boolean) => {
      if (!selectedLeadId) throw new Error("Nenhum contato selecionado");
      const { error } = await supabase
        .from("leads")
        .update({ ai_enabled: next })
        .eq("id", selectedLeadId);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      toast.success(next ? "Agente IA ativado nesta conversa" : "Agente IA desativado nesta conversa");
    },
    onError: () => toast.error("Erro ao atualizar agente IA"),
  });

  // Messages for selected lead — apenas as 300 mais recentes.
  // Conversas antigas chegavam a milhares de mensagens: o React renderizava
  // tudo de uma vez e a aba congelava ao abrir o contato.
  const { data: messages } = useQuery({
    queryKey: ["chat-messages", selectedLeadId],
    queryFn: async () => {
      if (!selectedLeadId) return [];
      // `*` já inclui error_code/error_title/error_details — são eles que
      // explicam a falha na bolha.
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("lead_id", selectedLeadId)
        .order("created_at", { ascending: false })
        .limit(300);
      return (data || []).slice().reverse();
    },
    enabled: !!selectedLeadId,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });


  // Keep a ref so the realtime callback always sees the latest selectedLeadId
  const selectedLeadIdRef = useRef(selectedLeadId);
  selectedLeadIdRef.current = selectedLeadId;

  useEffect(() => {
    onConversationChange?.(!!selectedLeadId);
    return () => onConversationChange?.(false);
  }, [selectedLeadId, onConversationChange]);


  // Realtime – global channel for sidebar (latest msgs / lead list).
  // Cada evento aqui dispara um refetch de ATÉ 5000 leads. Em disparo, com
  // milhares de eventos por hora, isso vira uma enxurrada de refetch que trava
  // a aba. Coalescemos os eventos numa janela curta: a lista continua viva,
  // mas atualiza no máximo uma vez a cada 3s. A conversa aberta não passa por
  // aqui — ela tem canal próprio com merge otimista, e segue instantânea.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      }, 3000);
    };

    const channel = supabase
      .channel("cloud-chat-global-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, scheduleRefresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Realtime – dedicated channel per selected lead, with optimistic cache merge
  // so new messages render IMMEDIATELY without waiting for a refetch or polling.
  useEffect(() => {
    if (!selectedLeadId) return;
    const leadId = selectedLeadId;
    const queryKey = ["chat-messages", leadId];

    const channel = supabase
      .channel(`cloud-chat-msgs-${leadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `lead_id=eq.${leadId}` },
        (payload) => {
          const newMsg = payload.new as any;
          queryClient.setQueryData<any[]>(queryKey, (prev) => {
            const list = prev || [];
            if (list.some((m) => m.id === newMsg.id)) return list;
            // Insert keeping ascending order by created_at
            const next = [...list, newMsg].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages", filter: `lead_id=eq.${leadId}` },
        (payload) => {
          const updated = payload.new as any;
          queryClient.setQueryData<any[]>(queryKey, (prev) =>
            (prev || []).map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages", filter: `lead_id=eq.${leadId}` },
        (payload) => {
          const oldMsg = payload.old as any;
          queryClient.setQueryData<any[]>(queryKey, (prev) =>
            (prev || []).filter((m) => m.id !== oldMsg.id)
          );
        }
      )
      .subscribe((status) => {
        // Safety net: if subscription drops, fall back to a refetch on (re)connect
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          queryClient.invalidateQueries({ queryKey });
        }
      });

    // Refetch immediately on lead switch / tab visibility regain
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    // Slow safety polling (only when this lead is open) — covers rare realtime gaps
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey });
    }, 30_000);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [selectedLeadId, queryClient]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [message]);

  const selectedLead = leads?.find((l) => l.id === selectedLeadId);
  const leadAiEnabled = !!selectedLead?.ai_enabled;

  // ── ETAPAS DO KANBAN ──
  const { data: pipelineStages } = useQuery({
    queryKey: ["pipeline-stages-chat"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, color, position")
        .order("position");
      if (error) throw error;
      return data || [];
    },
  });

  const moveLeadStage = useMutation({
    mutationFn: async (stageId: string) => {
      if (!selectedLeadId) throw new Error("Nenhuma conversa selecionada");
      const { error } = await supabase.from("leads").update({ stage_id: stageId }).eq("id", selectedLeadId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead movido de etapa");
      queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-leads"] });
      queryClient.invalidateQueries({ queryKey: ["contact-info-lead", selectedLeadId] });
    },
    onError: (err: any) => toast.error(err.message || "Erro ao mover lead"),
  });

  // ── ETIQUETAS ──
  // O movimento de coluna quando a etiqueta tem stage_id é feito pelo trigger
  // trg_apply_label_stage no banco — vale igual para o webhook.
  const toggleLeadLabel = useToggleLeadLabel(selectedLeadId);
  const leadLabelIds = (selectedLeadId && leadLabelsMap?.get(selectedLeadId)) || new Set<string>();

  // ── TRANSFERIR ATENDIMENTO ──
  const { data: teamCtx } = useTeamContext();
  // Donos e gerentes podem visualizar toda a equipe e filtrar os atendimentos.
  const canViewTeam = teamCtx?.accessLevel === "owner" || teamCtx?.accessLevel === "manager";
  const { data: teamMembers } = useTeamMembers(canViewTeam);

  /** Lista de atendentes disponíveis: o dono/eu + colaboradores. */
  const agents = useMemo(() => {
    const list: { id: string; label: string }[] = [];
    if (user?.id) list.push({ id: user.id, label: `Eu (${user.email ?? "minha conta"})` });
    for (const m of teamMembers || []) {
      if (m.member_user_id === user?.id) continue;
      list.push({ id: m.member_user_id, label: m.display_name || m.email });
    }
    return list;
  }, [teamMembers, user?.id, user?.email]);

  /** Rótulo do botão: nome quando é um só, contagem quando são vários. */
  /** Nome de quem enviou, para o histórico não perder a autoria numa
   *  transferência. Só aparece quando há equipe: sozinho, dizer "Eu" em toda
   *  mensagem é ruído. */
  const nomeDoAutor = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const a of agents) mapa.set(a.id, a.label);
    return (id: string | null | undefined) => (id ? mapa.get(id) ?? "Atendente" : null);
  }, [agents]);

  const agentFilterLabel = useMemo(() => {
    if (filterAgentIds.size === 0) return "Todos os vendedores";
    if (filterAgentIds.size === 1) {
      const [id] = [...filterAgentIds];
      if (id === UNASSIGNED_AGENT) return "Sem responsável";
      return agents.find((a) => a.id === id)?.label ?? "1 vendedor";
    }
    return `${filterAgentIds.size} vendedores`;
  }, [filterAgentIds, agents]);

  const transferLead = useMutation({
    mutationFn: async (assignedTo: string | null) => {
      if (!selectedLeadId) throw new Error("Nenhuma conversa selecionada");
      const { error } = await supabase
        .from("leads")
        .update({ assigned_to: assignedTo })
        .eq("id", selectedLeadId);
      if (error) throw error;
    },
    onSuccess: (_d, assignedTo) => {
      toast.success(assignedTo ? "Atendimento transferido" : "Atendente removido");
      queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-leads"] });
      queryClient.invalidateQueries({ queryKey: ["contact-info-lead", selectedLeadId] });
    },
    onError: (err: any) => toast.error(err.message || "Erro ao transferir atendimento"),
  });


  // ── ATALHOS DO CHAT ──
  const { data: shortcuts } = useQuery({
    queryKey: ["chat-shortcuts-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_shortcuts")
        .select("id, command, description, action_type, message, flow_id")
        .eq("active", true)
        .order("command");
      if (error) throw error;
      return data || [];
    },
  });

  // Fluxos para o seletor do cabeçalho.
  //
  // Lista TODOS, não só os ativos. `active` governa o disparo automático por
  // gatilho; iniciar um fluxo aqui é decisão explícita do atendente, numa
  // conversa específica. Filtrar por ativo fazia a lista vir vazia e o botão
  // parecer quebrado para quem tinha fluxo montado mas não publicado.
  const { data: flows } = useQuery({
    queryKey: ["chat-flows-all"],
    queryFn: async () => {
      // `as any` até os tipos serem regerados com a coluna `position`.
      const { data, error } = await (supabase as any)
        .from("flows")
        .select("id, name, active, position")
        // Mesma ordem escolhida no construtor: quem monta define o que vem
        // primeiro aqui.
        .order("position", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  // Execução em andamento do lead aberto — mostra qual fluxo está rodando e
  // permite pausar, retomar ou parar. Os status vivos são os mesmos que
  // startFlowForLead cancela, mais `paused`.
  const { data: runningExecution } = useQuery({
    queryKey: ["lead-flow-execution", selectedLeadId],
    enabled: !!selectedLeadId,
    queryFn: async () => {
      const { data } = await supabase
        .from("flow_executions")
        .select("id, flow_id, status, next_action_at, metadata")
        .eq("lead_id", selectedLeadId)
        .in("status", ["running", "waiting_delay", "waiting_reply", "waiting_no_response", "paused"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const isPaused = runningExecution?.status === "paused";

  const startFlow = useMutation({
    mutationFn: async (flowId: string) => {
      if (!selectedLead) throw new Error("Nenhuma conversa aberta");
      await startFlowForLead({
        flowId,
        leadId: selectedLead.id,
        accountId: selectedAccountId || defaultAccount?.id || null,
      });
    },
    onSuccess: (_data, flowId) => {
      const name = (flows || []).find((f: any) => f.id === flowId)?.name;
      toast.success(name ? `Fluxo "${name}" iniciado` : "Fluxo iniciado");
      queryClient.invalidateQueries({ queryKey: ["lead-flow-execution", selectedLeadId] });
    },
    onError: (e: Error) => {
      console.error("[fluxo] falha ao iniciar:", e);
      toast.error(e.message || "Erro ao iniciar fluxo");
    },
  });

  // Pausar não precisa de coluna nem migration: o processador só acorda
  // execução em `waiting_delay`/`waiting_no_response`, e a rotina que
  // desentrava execução travada só mexe em `running`. Um status `paused` fica
  // parado sozinho. Guardamos quanto faltava do delay para a retomada não
  // disparar tudo de uma vez.
  const pauseFlow = useMutation({
    mutationFn: async () => {
      if (!runningExecution?.id) return;
      const remainingMs = runningExecution.next_action_at
        ? Math.max(0, new Date(runningExecution.next_action_at).getTime() - Date.now())
        : null;
      const { error } = await supabase
        .from("flow_executions")
        .update({
          status: "paused",
          metadata: {
            ...((runningExecution.metadata as Record<string, unknown>) || {}),
            paused_from: runningExecution.status,
            paused_remaining_ms: remainingMs,
            paused_at: new Date().toISOString(),
          },
        })
        .eq("id", runningExecution.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fluxo pausado — retome quando quiser");
      queryClient.invalidateQueries({ queryKey: ["lead-flow-execution", selectedLeadId] });
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao pausar fluxo"),
  });

  const resumeFlow = useMutation({
    mutationFn: async () => {
      if (!runningExecution?.id) return;
      const md = (runningExecution.metadata as Record<string, any>) || {};
      const remainingMs = typeof md.paused_remaining_ms === "number" ? md.paused_remaining_ms : 0;
      const { error } = await supabase
        .from("flow_executions")
        .update({
          status: md.paused_from || "waiting_delay",
          next_action_at: new Date(Date.now() + remainingMs).toISOString(),
        })
        .eq("id", runningExecution.id);
      if (error) throw error;
      // Acorda o processador; o cron também passa por aqui periodicamente.
      supabase.functions.invoke("flow-processor", { body: { auto: true } }).catch(() => {});
    },
    onSuccess: () => {
      toast.success("Fluxo retomado");
      queryClient.invalidateQueries({ queryKey: ["lead-flow-execution", selectedLeadId] });
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao retomar fluxo"),
  });

  const stopFlow = useMutation({
    mutationFn: async () => {
      if (!runningExecution?.id) return;
      const { error } = await supabase
        .from("flow_executions")
        .update({ status: "cancelled" })
        .eq("id", runningExecution.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fluxo interrompido");
      queryClient.invalidateQueries({ queryKey: ["lead-flow-execution", selectedLeadId] });
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao interromper fluxo"),
  });

  const matchedShortcuts = useMemo(() => {
    if (shortcutQuery === null) return [];
    const q = shortcutQuery.toLowerCase();
    return (shortcuts || []).filter((s: any) => s.command.toLowerCase().startsWith(q)).slice(0, 8);
  }, [shortcuts, shortcutQuery]);


  const replyNowWithAi = useMutation({
    mutationFn: async () => {
      if (!selectedLead) throw new Error("Nenhum contato selecionado");
      // Find last inbound message
      const lastInbound = [...(messages || [])]
        .reverse()
        .find((m: any) => m.direction === "inbound");
      if (!lastInbound) throw new Error("Nenhuma mensagem do cliente para responder");
      const { data, error } = await supabase.functions.invoke("ai-auto-reply", {
        body: {
          lead_id: selectedLead.id,
          message: lastInbound.content,
          account_id: selectedAccountId || lastInbound.account_id || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.skipped) throw new Error(`IA não respondeu: ${(data as any).skipped}`);
      return data;
    },
    onSuccess: () => {
      toast.success("Agente IA respondeu a última mensagem");
      if (selectedLeadId) {
        queryClient.invalidateQueries({ queryKey: ["chat-messages", selectedLeadId] });
      }
    },
    onError: (e: any) => toast.error(e?.message || "Erro ao gerar resposta da IA"),
  });

  const handleToggleCurrentLeadAi = async () => {
    if (!selectedLeadId) return;
    const willEnable = !leadAiEnabled;
    if (aiMode !== "selected") setAiMode.mutate("selected");
    await toggleLeadAi.mutateAsync(willEnable);
    // When activating, immediately respond to the last inbound message
    if (willEnable) {
      const hasInbound = (messages || []).some((m: any) => m.direction === "inbound");
      if (hasInbound) {
        replyNowWithAi.mutate();
      }
    }
  };

  const sendMutation = useMutation({
    mutationFn: async ({ text, mediaUrl, mediaType }: { text?: string; mediaUrl?: string; mediaType?: string }) => {
      if (!selectedLead) throw new Error("No lead selected");
      // `zapi_message_id` guarda o ID da mensagem na Meta — necessário para citar (context).
      const replyToId: string | null = replyTo?.zapi_message_id || null;
      const { data, error } = await supabase.functions.invoke("whatsapp-cloud-send", {
        body: {
          phone: selectedLead.phone,
          message: text || "",
          lead_id: selectedLead.id,
          media_url: mediaUrl,
          media_type: mediaType,
          account_id: selectedAccountId,
          reply_to_message_id: replyToId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setMessage("");
      setReplyTo(null);
      queryClient.invalidateQueries({ queryKey: ["chat-messages", selectedLeadId] });
      queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
    },
    onError: async (err: any) =>
      toast.error(await functionErrorMessage(err, "Não foi possível enviar a mensagem")),
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
      // O motivo vem no corpo da resposta; sem isto vira "non-2xx status code".
      toast.error(await functionErrorMessage(err, "Não foi possível enviar o arquivo"));
    }
  }, [selectedLead, sendMutation]);

  const handleAudioRecorded = useCallback(async (blob: Blob) => {
    // Confere antes de subir: arquivo vazio ou corrompido vira uma recusa
    // obscura da Meta lá na frente.
    const problema = await validarAudio(blob);
    if (problema) {
      toast.error(problema);
      return;
    }
    uploadAndSendMedia(audioFileFromBlob(blob));
  }, [uploadAndSendMedia]);

  /* ---------------- Figurinhas reais (.webp) ---------------- */

  const { data: stickers = [] } = useQuery({
    queryKey: ["chat-stickers", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_stickers")
        .select("id, url")
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data || []) as { id: string; url: string }[];
    },
  });

  const [uploadingSticker, setUploadingSticker] = useState(false);

  /** Sobe o .webp, guarda na biblioteca do usuário e já envia ao lead. */
  const handleUploadSticker = useCallback(async (file: File) => {
    if (!selectedLead || !user?.id) return;
    const isWebp = file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp");
    if (!isWebp) {
      toast.error("A figurinha precisa ser um arquivo .webp");
      return;
    }
    setUploadingSticker(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("lead_id", selectedLead.id);
      formData.append("as_sticker", "1");
      const { data, error } = await supabase.functions.invoke("chat-upload-media", { body: formData });
      if (error) throw error;
      // Falha ao salvar na biblioteca não deve impedir o envio.
      const { error: insErr } = await supabase
        .from("chat_stickers")
        .insert({ user_id: user.id, url: data.url, label: file.name });
      if (insErr) console.warn("Figurinha não salva na biblioteca:", insErr.message);
      queryClient.invalidateQueries({ queryKey: ["chat-stickers", user.id] });
      sendMutation.mutate({ mediaUrl: data.url, mediaType: "sticker" });
    } catch (err: any) {
      toast.error(await functionErrorMessage(err, "Não foi possível enviar a figurinha"));
    } finally {
      setUploadingSticker(false);
    }
  }, [selectedLead, user?.id, queryClient, sendMutation]);

  const handleDeleteSticker = useCallback(async (sticker: { id: string }) => {
    const { error } = await supabase.from("chat_stickers").delete().eq("id", sticker.id);
    if (error) {
      toast.error("Não foi possível remover a figurinha");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["chat-stickers", user?.id] });
  }, [queryClient, user?.id]);

  /**
   * Guarda na biblioteca uma figurinha que apareceu na conversa.
   *
   * A mesma URL salva duas vezes encheria o seletor de repetições, então já
   * existente é tratado como sucesso — o operador queria a figurinha lá, e ela
   * está.
   */
  const handleSaveSticker = useCallback(async (mediaUrl: string) => {
    if (!user?.id) return;
    if (stickers.some((s) => s.url === mediaUrl)) {
      toast.info("Essa figurinha já está na sua biblioteca");
      return;
    }
    const { error } = await supabase
      .from("chat_stickers")
      .insert({ user_id: user.id, url: mediaUrl, label: "Recebida no chat" });
    if (error) {
      toast.error("Não foi possível salvar a figurinha");
      throw error;
    }
    queryClient.invalidateQueries({ queryKey: ["chat-stickers", user.id] });
    toast.success("Figurinha salva na biblioteca");
  }, [user?.id, stickers, queryClient]);


  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAndSendMedia(file);
    if (e.target) e.target.value = "";
  }, [uploadAndSendMedia]);

  /**
   * Janela de 24h da Meta: fora dela só template aprovado é aceito, e qualquer
   * outro envio volta com o erro 131047. Calculado a partir das mensagens já
   * carregadas — não custa consulta nova.
   *
   * Sem nenhuma mensagem recebida na conversa, a janela está fechada: ela só
   * abre quando o contato escreve.
   */
  const janela24h = useMemo(() => {
    const ultimaEntrada = (messages || []).find((m: any) => m.direction === "inbound");
    if (!ultimaEntrada) return { aberta: false, restamHoras: 0 };
    const passouMs = Date.now() - new Date(ultimaEntrada.created_at).getTime();
    const restamMs = 24 * 60 * 60 * 1000 - passouMs;
    return { aberta: restamMs > 0, restamHoras: Math.max(0, Math.floor(restamMs / 3600000)) };
  }, [messages]);

  const handleSend = () => {
    const text = message.trim();
    if (!text) return;
    sendMutation.mutate({ text });
  };

  /** Executa um atalho: dispara fluxo ou preenche mensagem rápida com variáveis resolvidas. */
  const runShortcut = useCallback(async (shortcut: any) => {
    setShortcutQuery(null);
    if (!selectedLead) return;

    if (shortcut.action_type === "flow") {
      try {
        await startFlowForLead({
          flowId: shortcut.flow_id,
          leadId: selectedLead.id,
          accountId: selectedAccountId || defaultAccount?.id || null,
        });
        setMessage("");
        toast.success(`Fluxo /${shortcut.command} iniciado`);
      } catch (err: any) {
        toast.error(err.message || "Erro ao iniciar fluxo");
      }
      return;
    }

    const text = interpolateForLead(shortcut.message || "", selectedLead);
    setMessage(text);
    textareaRef.current?.focus();
  }, [selectedLead, selectedAccountId, defaultAccount]);

  const handleMessageChange = (value: string) => {
    setMessage(value);
    const match = /^\/([\w-]*)$/.exec(value);
    if (match) {
      setShortcutQuery(match[1]);
      setShortcutIndex(0);
    } else if (shortcutQuery !== null) {
      setShortcutQuery(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (shortcutQuery !== null && matchedShortcuts.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setShortcutIndex((i) => (i + 1) % matchedShortcuts.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setShortcutIndex((i) => (i - 1 + matchedShortcuts.length) % matchedShortcuts.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        runShortcut(matchedShortcuts[shortcutIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShortcutQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    const s = search.toLowerCase();
    const seen = new Set<string>();
    return leads.filter((l) => {
      if (activeTab === "erro") {
        if (!failedLeadIds?.has(l.id)) return false;
      } else {
        // Exclude leads with failed messages from all other tabs — they live in "Erro"
        if (failedLeadIds?.has(l.id)) return false;
        if (l.chat_status !== activeTab) return false;
      }
      if (s && !l.name.toLowerCase().includes(s) && !l.phone.includes(s) && !l.email?.toLowerCase().includes(s)) return false;
      if (filterAccountId && !leadAccountMap?.get(filterAccountId)?.has(l.id)) return false;
      if (filterAgentIds.size > 0) {
        const chave = l.assigned_to || UNASSIGNED_AGENT;
        if (!filterAgentIds.has(chave)) return false;
      }
      if (filterLabelIds.size > 0) {
        const leadLbls = leadLabelsMap?.get(l.id);
        if (!leadLbls) return false;
        for (const lid of filterLabelIds) {
          if (!leadLbls.has(lid)) return false;
        }
      }
      // Dedupe by phone (leads list is ordered by recency upstream)
      const key = (l.phone || "").replace(/\D/g, "") || l.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [leads, search, activeTab, filterAccountId, filterAgentIds, leadAccountMap, filterLabelIds, leadLabelsMap, failedLeadIds]);

  const tabCounts = useMemo(() => {
    if (!leads) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    const seenByTab: Record<string, Set<string>> = {};
    for (const l of leads) {
      const tab = failedLeadIds?.has(l.id) ? "erro" : l.chat_status;
      if (!tab) continue;
      const key = (l.phone || "").replace(/\D/g, "") || l.id;
      if (!seenByTab[tab]) seenByTab[tab] = new Set();
      if (seenByTab[tab].has(key)) continue;
      seenByTab[tab].add(key);
      counts[tab] = (counts[tab] || 0) + 1;
    }
    return counts;
  }, [leads, failedLeadIds]);

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

  // Renderizar centenas de linhas de uma vez era o maior custo de layout da
  // aba. Mostramos um bloco por vez e crescemos sob demanda.
  const PAGE = 60;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [search, activeTab, filterAccountId, filterAgentIds, filterLabelIds]);
  const visibleLeads = useMemo(() => sortedLeads.slice(0, visibleCount), [sortedLeads, visibleCount]);


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

  const formatSidebarTime = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return "Ontem";
    return format(d, "dd/MM/yy");
  };

  /** Horário completo da última mensagem enviada (outbound) para o lead. */
  const formatLastOutbound = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isToday(d)) return `Enviado hoje ${format(d, "HH:mm")}`;
    if (isYesterday(d)) return `Enviado ontem ${format(d, "HH:mm")}`;
    return `Enviado ${format(d, "dd/MM/yy HH:mm")}`;
  };

  // ---- Marcação de "não lido" (persistida no banco) ---------------------
  // Antes ficava em localStorage e cada dispositivo tinha sua própria lista.
  // Agora a fonte da verdade é `leads.manually_unread`, então a marcação
  // aparece igual em celular e desktop.
  const unreadIds = useMemo(
    () =>
      new Set<string>(
        (leads || [])
          .filter((l: any) => l.manually_unread)
          .map((l: any) => l.id as string)
      ),
    [leads]
  );

  const setUnreadFlag = useCallback(
    async (leadId: string, value: boolean) => {
      // Atualização otimista: a lista responde na hora, o realtime confirma.
      queryClient.setQueryData(
        ["chat-leads", "cloud", user?.id],
        (prev: any) =>
          Array.isArray(prev)
            ? prev.map((l: any) =>
                l.id === leadId ? { ...l, manually_unread: value } : l
              )
            : prev
      );
      const { error } = await (supabase as any)
        .from("leads")
        .update({ manually_unread: value })
        .eq("id", leadId);
      if (error) {
        // Falhou: recarrega para não deixar estado divergente em tela.
        queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
        toast.error("Não foi possível salvar a marcação de não lido");
      }
    },
    [queryClient, user?.id]
  );

  const toggleUnread = useCallback(
    (leadId: string) => {
      const next = !unreadIds.has(leadId);
      if (next && selectedLeadId === leadId) setSelectedLeadId(null);
      void setUnreadFlag(leadId, next);
    },
    [unreadIds, setUnreadFlag, selectedLeadId]
  );

  // Abrir a conversa limpa a marcação manual de não lido.
  useEffect(() => {
    if (!selectedLeadId || !unreadIds.has(selectedLeadId)) return;
    void setUnreadFlag(selectedLeadId, false);
  }, [selectedLeadId, unreadIds, setUnreadFlag]);

  // ---- Finalizar conversa ----------------------------------------------
  const finalizeLead = useMutation({
    mutationFn: async ({ leadId, done }: { leadId: string; done: boolean }) => {
      const { error } = await supabase
        .from("leads")
        .update({ chat_status: done ? "finalizado" : "respondidas" })
        .eq("id", leadId);
      if (error) throw error;
      return done;
    },
    onSuccess: (done, { leadId }) => {
      if (done && selectedLeadId === leadId) setSelectedLeadId(null);
      queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      toast.success(done ? "Conversa finalizada" : "Conversa reaberta");
    },
    onError: (e: any) => toast.error(e?.message || "Não foi possível atualizar a conversa"),
  });

  const toggleLabelFilter = (labelId: string) => {
    setFilterLabelIds((prev) => {
      const next = new Set(prev);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  };

  // Get labels for a specific lead
  const getLeadLabels = (leadId: string) => {
    const labelIds = leadLabelsMap?.get(leadId);
    if (!labelIds) return [];
    return labels.filter((l) => labelIds.has(l.id));
  };

  return (
    <div className="flex h-full overflow-hidden bg-background lg:rounded-lg lg:border lg:border-border">
      {/* LEFT PANEL - Contact list */}
      <div className={cn(
        "w-[340px] flex flex-col border-r border-border",
        selectedLeadId ? "hidden lg:flex" : "flex flex-1 lg:flex-none lg:w-[340px]"
      )}>
        {/* Search */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar contato..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            {accounts.length > 1 && (
              <select
                value={filterAccountId || ""}
                onChange={(e) => setFilterAccountId(e.target.value || null)}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="">Todos os números</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
            {agents.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-left truncate"
                    aria-label="Filtrar por vendedor"
                  >
                    {agentFilterLabel}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem
                    onClick={() => setFilterAgentIds(new Set())}
                    className="gap-2"
                  >
                    <span className="flex-1">Todos os vendedores</span>
                    {filterAgentIds.size === 0 && <Check size={14} className="opacity-60" />}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {/* onSelect com preventDefault: sem isso o menu fecha a cada
                      clique e escolher dois atendentes vira quatro cliques. */}
                  {[{ id: UNASSIGNED_AGENT, label: "Sem responsável" }, ...agents].map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      onSelect={(e) => { e.preventDefault(); toggleAgentFilter(a.id); }}
                      className="gap-2"
                    >
                      <span className="flex-1 truncate">{a.label}</span>
                      {filterAgentIds.has(a.id) && <Check size={14} className="opacity-60" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {(() => {
              const evoAccount =
                accounts.find((a: any) => a.id === filterAccountId && a.provider === "evolution") ||
                accounts.find((a: any) => a.id === selectedAccountId && a.provider === "evolution") ||
                accounts.find((a: any) => a.provider === "evolution");
              if (!evoAccount) return null;
              return (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setBulkOpen(true)}
                  title={`Disparo em massa para ${evoAccount.name}`}
                >
                  <Megaphone size={12} />
                  Disparo
                </Button>
              );
            })()}
            <Button
              variant={showLabelFilter ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowLabelFilter(!showLabelFilter)}
            >
              <Tag size={12} />
              Tags
              {filterLabelIds.size > 0 && (
                <Badge variant="secondary" className="h-4 text-[9px] px-1 ml-0.5">{filterLabelIds.size}</Badge>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={aiMode === "off" ? "outline" : "default"}
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  title="Configurar agente IA"
                >
                  <Bot size={12} />
                  IA
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Agente IA</div>
                <DropdownMenuItem onClick={() => setAiMode.mutate("off")} className={cn("gap-2", aiMode === "off" && "bg-accent")}>
                  <PowerOff size={14} />
                  <div className="flex-1">
                    <p className="text-sm">Desativado</p>
                    <p className="text-[11px] text-muted-foreground">Não responde nenhuma conversa</p>
                  </div>
                  {aiMode === "off" && <Check size={14} />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAiMode.mutate("all")} className={cn("gap-2", aiMode === "all" && "bg-accent")}>
                  <Users size={14} />
                  <div className="flex-1">
                    <p className="text-sm">Todas as conversas</p>
                    <p className="text-[11px] text-muted-foreground">Responde qualquer mensagem recebida</p>
                  </div>
                  {aiMode === "all" && <Check size={14} />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAiMode.mutate("selected")} className={cn("gap-2", aiMode === "selected" && "bg-accent")}>
                  <MessageSquare size={14} />
                  <div className="flex-1">
                    <p className="text-sm">Conversas selecionadas</p>
                    <p className="text-[11px] text-muted-foreground">Use o botão IA dentro do chat</p>
                  </div>
                  {aiMode === "selected" && <Check size={14} />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Label filter chips */}
        {showLabelFilter && labels.length > 0 && (
          <div className="px-3 py-2 border-b border-border flex flex-wrap gap-1.5">
            {labels.map((label) => (
              <button
                key={label.id}
                onClick={() => toggleLabelFilter(label.id)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                  filterLabelIds.has(label.id)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: label.color }} />
                {label.name}
                {filterLabelIds.has(label.id) && <X size={10} />}
              </button>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="px-2 py-2 border-b border-border">
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {CHAT_TABS.map((tab) => {
              const isActive = activeTab === tab.value;
              const isErro = tab.value === "erro";
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border",
                    isActive
                      ? isErro
                        ? "bg-destructive/10 text-destructive border-destructive/30"
                        : "bg-primary/10 text-primary border-primary/30"
                      : "text-muted-foreground border-transparent hover:bg-accent hover:text-foreground"
                  )}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  {tabCounts[tab.value] ? (
                    <span className={cn(
                      "text-[10px] min-w-[18px] h-4 rounded-full flex items-center justify-center px-1 font-semibold",
                      isActive
                        ? isErro ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    )}>
                      {tabCounts[tab.value]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Contact list */}
        <ScrollArea className="flex-1">
          {sortedLeads.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum contato encontrado.</p>
          )}
          {visibleLeads.map((lead) => {
            const latest = latestMessages?.get(lead.id);
            const isSelected = lead.id === selectedLeadId;
            const leadTags = getLeadLabels(lead.id);
            const isUnread = unreadIds.has(lead.id);
            const isDone = lead.chat_status === "finalizado";
            return (
              <div
                key={lead.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedLeadId(lead.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedLeadId(lead.id);
                  }
                }}
                className={cn(
                  "group w-full text-left flex items-center gap-3 px-3 py-3 transition-colors border-b border-border/30 cursor-pointer",
                  isSelected ? "bg-accent" : "hover:bg-accent/40",
                  isUnread && "bg-primary/5"
                )}
              >
                <Avatar className="w-10 h-10 flex-shrink-0">
                  {lead.photo_url && <AvatarImage src={lead.photo_url} alt={lead.name} />}
                  <AvatarFallback className={cn(getAvatarColor(lead.name), "text-white text-xs font-medium")}>
                    {getInitials(lead.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={cn("text-sm truncate", isUnread ? "font-bold" : "font-medium")}>{lead.name}</p>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      {isUnread && <span className="w-2 h-2 rounded-full bg-primary" />}
                      {latest && (
                        <span className="text-[11px] text-muted-foreground">
                          {formatSidebarTime(latest.created_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {latest?.direction === "outbound" && <CheckCheck size={12} className="text-sky-400 shrink-0" />}
                    <p className="text-xs text-muted-foreground truncate">
                      {latest ? latest.content : "Iniciar conversa"}
                    </p>
                  </div>
                  {lead.last_outbound_at && (
                    <p className="text-[10px] text-muted-foreground/80 mt-0.5 truncate">
                      {formatLastOutbound(lead.last_outbound_at)}
                    </p>
                  )}
                  {leadTags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {leadTags.slice(0, 3).map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] border border-border"
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </span>
                      ))}
                      {leadTags.length > 3 && (
                        <span className="text-[9px] text-muted-foreground">+{leadTags.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
                {/* Em toque não existe hover: escondidos por opacidade, esses botões
                    eram inalcançáveis em tablet. Visíveis por padrão; o
                    comportamento de aparecer no hover fica só no desktop. */}
                <div className="flex flex-col gap-1 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    title={isUnread ? "Marcar como lido" : "Marcar como não lido"}
                    onClick={(e) => { e.stopPropagation(); toggleUnread(lead.id); }}
                    className={cn(
                      "p-1 rounded-md hover:bg-accent",
                      isUnread ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Mail size={14} />
                  </button>
                  <button
                    type="button"
                    title={isDone ? "Reabrir conversa" : "Finalizar conversa"}
                    onClick={(e) => { e.stopPropagation(); finalizeLead.mutate({ leadId: lead.id, done: !isDone }); }}
                    className={cn(
                      "p-1 rounded-md hover:bg-accent",
                      isDone ? "text-emerald-500" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {isDone ? <RotateCcw size={14} /> : <CheckCircle2 size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
          {visibleLeads.length < sortedLeads.length && (
            <button
              onClick={() => setVisibleCount((c) => c + 60)}
              className="w-full py-3 text-xs text-muted-foreground hover:bg-accent/40 transition-colors"
            >
              Carregar mais ({sortedLeads.length - visibleLeads.length} restantes)
            </button>
          )}
        </ScrollArea>
      </div>

      {/* RIGHT PANEL - Chat area */}
      <div className={cn("flex-1 flex flex-col min-w-0", !selectedLeadId ? "hidden lg:flex" : "flex")}>
        {selectedLead ? (
          <>
            {/* Header */}
            <div className="h-14 px-4 flex items-center gap-3 border-b border-border bg-card">
              <button onClick={() => setSelectedLeadId(null)} className="lg:hidden p-1 text-muted-foreground hover:text-foreground">
                <ArrowLeft size={18} />
              </button>
              <Avatar className="w-9 h-9">
                {selectedLead.photo_url && <AvatarImage src={selectedLead.photo_url} />}
                <AvatarFallback className={cn(getAvatarColor(selectedLead.name), "text-white text-xs")}>
                  {getInitials(selectedLead.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{selectedLead.name}</p>
                <p className="text-[11px] text-muted-foreground">{selectedLead.phone}</p>
              </div>
              {accounts.length > 1 && (
                <select
                  value={selectedAccountId || ""}
                  onChange={(e) => setSelectedAccountId(e.target.value || null)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}

              {/* Dados do contato */}
              <button
                onClick={() => { setContactTab("info"); setContactOpen(true); }}
                title="Ver dados do contato"
                className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Info size={18} />
              </button>

              {/* Editar contato */}
              <button
                onClick={() => { setContactTab("edit"); setContactOpen(true); }}
                title="Editar contato"
                className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil size={18} />
              </button>

              {/* Fluxo ativo na conversa */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title={
                      isPaused
                        ? "Fluxo pausado nesta conversa"
                        : runningExecution
                          ? "Fluxo em andamento nesta conversa"
                          : "Iniciar um fluxo nesta conversa"
                    }
                    className={cn(
                      "p-2 rounded-full hover:bg-accent transition-colors",
                      isPaused
                        ? "text-amber-500"
                        : runningExecution
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Workflow size={18} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[30rem] max-h-[85vh] overflow-hidden p-0">
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
                    {isPaused
                      ? "Fluxo pausado"
                      : runningExecution
                        ? "Trocar fluxo da conversa"
                        : "Iniciar fluxo nesta conversa"}
                  </div>
                  {(flows || []).length === 0 && (
                    <div className="px-3 py-3 text-sm text-muted-foreground">
                      Nenhum fluxo criado ainda. Monte um no Flow Builder.
                    </div>
                  )}
                  {/* Lista rolável: com muitos fluxos o menu não estoura a tela
                      e as ações (pausar/parar) continuam sempre visíveis.

                      Cada linha tem botões explícitos: clicar no nome não
                      dispara nada. Iniciar fluxo manda mensagem para o lead —
                      um clique errado na lista não pode ser irreversível. */}
                  <div className="max-h-[34rem] overflow-y-auto overscroll-contain px-1 py-1">
                    {(flows || []).map((flow: any) => {
                      const emAndamento = runningExecution?.flow_id === flow.id;
                      const ocupado =
                        startFlow.isPending || pauseFlow.isPending || resumeFlow.isPending;
                      return (
                        <div
                          key={flow.id}
                          className="flex items-center gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent/60"
                        >
                          <Workflow
                            size={15}
                            className={cn("shrink-0", emAndamento ? "text-primary" : "opacity-60")}
                          />
                          {/* Nome inteiro em até duas linhas: fluxo costuma ter
                              nome descritivo, e cortar no meio esconde
                              justamente o que diferencia um do outro. */}
                          <div className="flex-1 min-w-0">
                            <span className="block leading-snug line-clamp-2">{flow.name}</span>
                            {emAndamento && (
                              <span className="text-[10px] text-muted-foreground">
                                {isPaused ? "pausado nesta conversa" : "em andamento nesta conversa"}
                              </span>
                            )}
                          </div>
                          {!flow.active && (
                            <span className="text-[10px] text-muted-foreground shrink-0">inativo</span>
                          )}

                          {emAndamento ? (
                            <button
                              type="button"
                              onClick={() => (isPaused ? resumeFlow.mutate() : pauseFlow.mutate())}
                              disabled={ocupado}
                              title={isPaused ? "Retomar fluxo" : "Pausar fluxo"}
                              className={cn(
                                "shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                                isPaused
                                  ? "border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                                  : "border-amber-500/40 text-amber-500 hover:bg-amber-500/10",
                              )}
                            >
                              {isPaused ? <Play size={13} /> : <Pause size={13} />}
                              {isPaused ? "Retomar" : "Pausar"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startFlow.mutate(flow.id)}
                              disabled={ocupado}
                              title="Iniciar este fluxo na conversa"
                              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                            >
                              <Play size={13} />
                              Iniciar
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {runningExecution && (
                    <div className="px-1 pb-1">
                      <DropdownMenuSeparator />
                      {isPaused ? (
                        <DropdownMenuItem
                          onClick={() => resumeFlow.mutate()}
                          disabled={resumeFlow.isPending}
                          className="gap-2"
                        >
                          <Play size={14} className="shrink-0" />
                          Retomar fluxo
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => pauseFlow.mutate()}
                          disabled={pauseFlow.isPending}
                          className="gap-2"
                        >
                          <Pause size={14} className="shrink-0" />
                          Pausar fluxo
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => stopFlow.mutate()}
                        disabled={stopFlow.isPending}
                        className="gap-2 text-destructive"
                      >
                        <X size={14} className="shrink-0" />
                        Parar fluxo em andamento
                      </DropdownMenuItem>
                    </div>
                  )}

                </DropdownMenuContent>
              </DropdownMenu>

              {/* Atalho direto: pausar/retomar o fluxo em andamento sem abrir o menu */}
              {runningExecution && (
                <button
                  onClick={() => (isPaused ? resumeFlow.mutate() : pauseFlow.mutate())}
                  disabled={pauseFlow.isPending || resumeFlow.isPending}
                  title={isPaused ? "Retomar fluxo" : "Pausar fluxo"}
                  className={cn(
                    "p-2 rounded-full hover:bg-accent transition-colors disabled:opacity-50",
                    isPaused ? "text-emerald-500" : "text-amber-500",
                  )}
                >
                  {isPaused ? <Play size={18} /> : <Pause size={18} />}
                </button>
              )}



              {/* Mover para outra etapa do Kanban */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Mover para outra etapa do Kanban"
                    className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Columns3 size={18} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Mover para etapa</div>
                  {(pipelineStages || []).length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma etapa criada no Kanban</div>
                  )}
                  {(pipelineStages || []).map((stage: any) => (
                    <DropdownMenuItem key={stage.id} onClick={() => moveLeadStage.mutate(stage.id)} className="gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: stage.color || "hsl(var(--primary))" }}
                      />
                      <span className="flex-1 truncate">{stage.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Etiquetas do lead */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Etiquetas desta conversa"
                    className={cn(
                      "p-2 rounded-full hover:bg-accent transition-colors",
                      leadLabelIds.size > 0 ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Tag size={18} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Etiquetas</div>
                  {labels.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhuma etiqueta criada. Crie em Configuração › Etiquetas do chat.
                    </div>
                  )}
                  {labels.map((label: any) => {
                    const applied = leadLabelIds.has(label.id);
                    const stage = (pipelineStages || []).find((s: any) => s.id === label.stage_id);
                    return (
                      <DropdownMenuItem
                        key={label.id}
                        className="gap-2"
                        disabled={toggleLeadLabel.isPending}
                        onSelect={(e) => {
                          e.preventDefault();
                          toggleLeadLabel.mutate(
                            { labelId: label.id, applied },
                            {
                              onSuccess: () =>
                                toast.success(
                                  applied
                                    ? "Etiqueta removida"
                                    : stage
                                    ? `Etiqueta aplicada — lead movido para ${stage.name}`
                                    : "Etiqueta aplicada",
                                ),
                            },
                          );
                        }}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: label.color || "hsl(var(--primary))" }}
                        />
                        <span className="flex-1 truncate">{label.name}</span>
                        {applied && <Check size={14} className="opacity-60" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Finalizar / reabrir o atendimento.
                  Existia só no cartão da lista, escondido atrás de hover — em
                  tablet nunca aparecia, e é aqui, com a conversa aberta, que a
                  pessoa termina o atendimento. */}
              {(() => {
                const conversaFinalizada = selectedLead.chat_status === "finalizado";
                return (
                  <button
                    type="button"
                    title={conversaFinalizada ? "Reabrir atendimento" : "Finalizar atendimento"}
                    aria-label={conversaFinalizada ? "Reabrir atendimento" : "Finalizar atendimento"}
                    onClick={() =>
                      finalizeLead.mutate({ leadId: selectedLead.id, done: !conversaFinalizada })
                    }
                    disabled={finalizeLead.isPending}
                    className={cn(
                      "p-2 rounded-full hover:bg-accent transition-colors",
                      conversaFinalizada
                        ? "text-emerald-500"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {conversaFinalizada ? <RotateCcw size={18} /> : <CheckCircle2 size={18} />}
                  </button>
                );
              })()}

              {/* Transferir atendimento para outro atendente */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Transferir para outro atendente"
                    className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <UserPlus size={18} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Transferir atendimento</div>
                  {agents.length <= 1 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum outro atendente. Convide sua equipe em Configurações › Equipe.
                    </div>
                  )}
                  {agents.map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      onClick={() => transferLead.mutate(a.id)}
                      disabled={transferLead.isPending || selectedLead?.assigned_to === a.id}
                      className="gap-2"
                    >
                      <Users size={14} className="opacity-60 shrink-0" />
                      <span className="flex-1 truncate">{a.label}</span>
                      {selectedLead?.assigned_to === a.id && <Check size={14} className="opacity-60" />}
                    </DropdownMenuItem>
                  ))}
                  {selectedLead?.assigned_to && (
                    <DropdownMenuItem onClick={() => transferLead.mutate(null)} className="gap-2 text-destructive">
                      <X size={14} className="shrink-0" />
                      Remover atendente
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                type="button"
                size="sm"
                variant={aiMode === "all" || leadAiEnabled ? "default" : "outline"}
                className="h-8 px-2 text-xs gap-1.5 shrink-0"
                onClick={handleToggleCurrentLeadAi}
                disabled={toggleLeadAi.isPending || setAiMode.isPending}
                title={
                  aiMode === "all"
                    ? "Agente IA ativo globalmente — clique para usar apenas conversas selecionadas"
                    : leadAiEnabled
                    ? "Agente IA ativo nesta conversa — clique para desativar"
                    : "Ativar agente IA nesta conversa"
                }
              >
                <Bot size={14} />
                IA {aiMode === "all" || leadAiEnabled ? "ON" : "OFF"}
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-4 bg-muted/20">
              <div className="max-w-3xl mx-auto space-y-1">
                {messages?.length === 0 && (
                  <div className="flex justify-center py-10">
                    <div className="bg-card rounded-lg px-6 py-3 shadow-sm">
                      <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda. Envie a primeira! 💬</p>
                    </div>
                  </div>
                )}
                {groupedMessages.map((group, gi) => (
                  <div key={gi}>
                    <div className="flex justify-center my-3">
                      <span className="bg-card text-muted-foreground text-[11px] font-medium px-3 py-1 rounded-md shadow-sm uppercase tracking-wide">
                        {formatDateSeparator(group.date)}
                      </span>
                    </div>
                    {group.messages.map((msg, mi) => {
                      const isOutbound = msg.direction === "outbound";
                      const prevMsg = mi > 0 ? group.messages[mi - 1] : null;
                      const showTail = !prevMsg || prevMsg.direction !== msg.direction;
                      return (
                        <div key={msg.id} className={cn("group flex mb-[2px] items-center gap-1", isOutbound ? "justify-end" : "justify-start", showTail && "mt-2")}>
                          {isOutbound && (
                            <button
                              type="button"
                              title="Responder"
                              onClick={() => { setReplyTo(msg); textareaRef.current?.focus(); }}
                              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-accent text-muted-foreground"
                            >
                              <Reply size={15} />
                            </button>
                          )}
                          <div className={cn(
                            "relative max-w-[65%] px-[9px] pt-[6px] pb-2 text-sm leading-[19px] shadow-sm rounded-lg",
                            isOutbound ? "bg-primary/10 text-foreground" : "bg-card text-foreground",
                            showTail && isOutbound && "rounded-tr-none",
                            showTail && !isOutbound && "rounded-tl-none"
                          )}>
                            {(msg as any).quoted_message && (
                              <div className={cn(
                                "mb-1 rounded-md border-l-4 px-2 py-1.5 text-xs",
                                isOutbound ? "border-primary bg-primary/15" : "border-primary bg-accent/60"
                              )}>
                                <p className="font-medium text-primary mb-0.5">
                                  {(msg as any).quoted_message.direction === "outbound" ? "Você" : (selectedLead?.name || "Lead")}
                                </p>
                                <p className="text-muted-foreground line-clamp-2 break-words">
                                  {(msg as any).quoted_message.content ||
                                    ((msg as any).quoted_message.media_type === "audio" ? "🎤 Áudio"
                                      : (msg as any).quoted_message.media_type === "image" ? "📷 Imagem"
                                      : (msg as any).quoted_message.media_type === "video" ? "🎥 Vídeo"
                                      : (msg as any).quoted_message.media_type ? "📎 Arquivo" : "Mensagem")}
                                </p>
                              </div>
                            )}
                            {isOutbound && agents.length > 1 && (msg as any).sent_by && (
                              <p className="text-[10px] font-medium opacity-70 mb-0.5">
                                {nomeDoAutor((msg as any).sent_by)}
                              </p>
                            )}
                            {msg.media_url && msg.media_type ? (
                              <div className="mb-1">
                                <ChatMediaBubble mediaType={msg.media_type} mediaUrl={msg.media_url} caption={msg.media_type !== "audio" ? msg.content : undefined} isOutbound={isOutbound} onSaveSticker={handleSaveSticker} />
                                <span className="inline-block w-[60px]" />
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap break-words">
                                {msg.content}
                                <span className="inline-block w-[60px]" />
                              </p>
                            )}
                            <span className="absolute bottom-[5px] right-[7px] flex items-center gap-[2px] text-muted-foreground">
                              <span className="text-[11px]">{format(new Date(msg.created_at), "HH:mm")}</span>
                              {isOutbound && <StatusIcon status={msg.status} />}
                            </span>
                          </div>
                          {/* O motivo da falha vinha da Meta e ficava só no
                              banco: a tela mostrava um ícone vermelho e nada
                              mais. Sem isto, "não está funcionando" é tudo o
                              que o operador consegue relatar. */}
                          {isOutbound && msg.status === "failed" && (
                            <p className="mt-1 text-[11px] leading-snug text-destructive break-words">
                              {msg.error_title || "Falha no envio"}
                              {msg.error_details ? `: ${msg.error_details}` : ""}
                              {msg.error_code ? ` (${msg.error_code})` : ""}
                            </p>
                          )}
                          {!isOutbound && (
                            <button
                              type="button"
                              title="Responder"
                              onClick={() => { setReplyTo(msg); textareaRef.current?.focus(); }}
                              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-accent text-muted-foreground"
                            >
                              <Reply size={15} />
                            </button>
                          )}
                        </div>
                      );

                    })}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Input */}
            <div className="px-4 py-2 bg-card border-t border-border">
              <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" className="hidden" onChange={handleFileSelect} />
              {replyTo && (
                <div className="max-w-3xl mx-auto mb-2 flex items-start gap-2 rounded-lg border-l-4 border-primary bg-accent/50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-primary">
                      {replyTo.direction === "outbound" ? "Você" : (selectedLead?.name || "Lead")}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {replyTo.content || (replyTo.media_type ? `[${replyTo.media_type}]` : "Mensagem")}
                    </p>
                    {!replyTo.zapi_message_id && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Esta mensagem não tem ID da Meta — será enviada sem citação.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    className="p-1 rounded-full hover:bg-accent text-muted-foreground"
                    title="Cancelar resposta"
                  >
                    <X size={15} />
                  </button>
                </div>
              )}

              {selectedLead && !janela24h.aberta && (
                <div className="max-w-3xl mx-auto mb-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <AlertCircle size={15} className="text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs leading-snug text-amber-700 dark:text-amber-400">
                    <b>Fora da janela de 24 horas.</b> O contato não escreve há mais de um dia,
                    então a Meta recusa mensagem livre — texto, áudio ou arquivo. Só um
                    <b> template aprovado</b> reabre a conversa.
                  </p>
                </div>
              )}

              <div className="flex items-end gap-2 max-w-3xl mx-auto">
                <div className="flex items-center gap-0.5 shrink-0 mb-[5px]">
                  {templates && templates.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground"><FileText size={20} /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-72">
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase">Templates</div>
                        {templates.map((t) => (
                          <DropdownMenuItem key={t.id} onClick={() => setMessage(t.content)} className="flex flex-col items-start gap-0.5">
                            <span className="font-medium text-sm">{t.name}</span>
                            <span className="text-xs text-muted-foreground line-clamp-2">{t.content}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground">
                    <Paperclip size={20} />
                  </button>

                  {/* Emojis e figurinhas */}
                  <EmojiPicker
                    disabled={sendMutation.isPending}
                    onSelect={(e) => handleMessageChange(message + e)}
                    onSendSticker={(e) => sendMutation.mutate({ text: e })}
                    stickers={stickers}
                    uploading={uploadingSticker}
                    onUploadSticker={handleUploadSticker}
                    onDeleteSticker={handleDeleteSticker}
                    onSendStickerImage={(s) => sendMutation.mutate({ mediaUrl: s.url, mediaType: "sticker" })}
                  />


                  {/* Atalhos: mensagens rápidas e fluxos */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        title="Atalhos (mensagens rápidas e fluxos)"
                        className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground"
                      >
                        <Zap size={20} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-72">
                      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase">
                        Atalhos
                      </div>
                      {(shortcuts || []).length === 0 && (
                        <div className="px-2 py-2 text-xs text-muted-foreground">
                          Nenhum atalho criado. Crie em Configurações → Atalhos do chat.
                        </div>
                      )}
                      <div className="max-h-64 overflow-y-auto">
                        {(shortcuts || []).map((s: any) => (
                          <DropdownMenuItem key={s.id} onClick={() => runShortcut(s)} className="gap-2 items-start">
                            {s.action_type === "flow"
                              ? <Workflow size={15} className="mt-0.5 text-primary flex-shrink-0" />
                              : <Zap size={15} className="mt-0.5 text-primary flex-shrink-0" />}
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">/{s.command}</p>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {s.description || (s.action_type === "flow" ? "Inicia um fluxo" : s.message)}
                              </p>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </div>

                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="relative flex-1">
                  {shortcutQuery !== null && matchedShortcuts.length > 0 && (
                    <div className="absolute bottom-full mb-2 left-0 right-0 z-30 rounded-lg border border-border bg-popover shadow-lg overflow-y-auto max-h-64">
                      {matchedShortcuts.map((s: any, i: number) => (
                        <button
                          key={s.id}
                          onClick={() => runShortcut(s)}
                          onMouseEnter={() => setShortcutIndex(i)}
                          className={cn(
                            "w-full text-left flex items-start gap-2 px-3 py-2",
                            i === shortcutIndex ? "bg-accent" : "hover:bg-accent/60"
                          )}
                        >
                          {s.action_type === "flow"
                            ? <Workflow size={15} className="mt-0.5 text-primary flex-shrink-0" />
                            : <Zap size={15} className="mt-0.5 text-primary flex-shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">/{s.command}</p>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {s.description || (s.action_type === "flow" ? "Inicia um fluxo" : s.message)}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="bg-background rounded-lg border border-border overflow-hidden">
                    <textarea
                      ref={textareaRef}
                      value={message}
                      onChange={(e) => handleMessageChange(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Digite uma mensagem ou / para atalhos"
                      className="w-full px-3 py-[9px] text-sm bg-transparent outline-none resize-none placeholder:text-muted-foreground max-h-[120px]"
                      rows={1}
                      style={{ minHeight: "38px" }}
                    />
                  </div>
                </div>
                {message.trim() ? (
                  <button onClick={handleSend} disabled={sendMutation.isPending} className="p-2.5 rounded-full shrink-0 mb-[3px] bg-primary text-primary-foreground hover:opacity-90">
                    <Send size={18} />
                  </button>
                ) : (
                  <AudioRecorder onRecorded={handleAudioRecorded}
                    onError={(m) => toast.error(m)} disabled={sendMutation.isPending} />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-muted/10">
            <MessageSquare size={48} className="text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Selecione um contato para iniciar</p>
          </div>
        )}
      </div>

      {(() => {
        const evoAccount =
          accounts.find((a: any) => a.id === filterAccountId && a.provider === "evolution") ||
          accounts.find((a: any) => a.id === selectedAccountId && a.provider === "evolution") ||
          accounts.find((a: any) => a.provider === "evolution");
        if (!evoAccount) return null;
        return (
          <BulkBroadcastDialog
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            accountId={evoAccount.id}
            accountName={evoAccount.name}
          />
        );
      })()}

      <ContactInfoSheet
        leadId={selectedLeadId}
        open={contactOpen}
        onOpenChange={setContactOpen}
        defaultTab={contactTab}
      />
    </div>
  );
}
