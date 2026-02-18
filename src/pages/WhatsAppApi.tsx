import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
import { AudioRecorder } from "@/components/AudioRecorder";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Phone, Key, Link2, Send, CheckCircle2, AlertCircle, Copy, ExternalLink,
  Package, MessageCircle, Search, FileText, Check, CheckCheck, Paperclip,
  Truck, Users, ArrowLeft, BarChart3,
} from "lucide-react";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { FlowBuilder } from "@/components/FlowBuilder";
import { TemplateManager } from "@/components/TemplateManager";
import { SendingMetrics } from "@/components/SendingMetrics";

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
  const [messageTemplate, setMessageTemplate] = useState(
    "Olá {nome}! 📦 Seu pedido foi enviado!\n\nCódigo de rastreio: *{codigo}*\n\nAcompanhe em: https://www.linkcorreto.com.br/{codigo}"
  );

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

    for (const leadId of selectedLeads) {
      const lead = leads?.find((l) => l.id === leadId);
      if (!lead) continue;

      const finalMessage = messageTemplate
        .replace(/\{nome\}/g, lead.name.split(" ")[0])
        .replace(/\{codigo\}/g, trackingCode.trim());

      try {
        const { error } = await supabase.functions.invoke("whatsapp-cloud-send", {
          body: { phone: lead.phone, message: finalMessage },
        });
        if (error) throw error;
        successCount++;
      } catch {
        errorCount++;
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
  const [sendType, setSendType] = useState<"template" | "flow" | "custom">("template");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [customMessage, setCustomMessage] = useState("");
  // CSV state
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvSelectedIdxs, setCsvSelectedIdxs] = useState<Set<number>>(new Set());
  const csvInputRef = useRef<HTMLInputElement>(null);

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

  const { data: templates } = useQuery({
    queryKey: ["broadcast-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("chat_templates").select("*").order("name");
      return data || [];
    },
  });

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
    let successCount = 0;
    let errorCount = 0;

    // Helper to start a flow for a lead
    const startFlowForLead = async (leadId: string, codigo?: string) => {
      // Get first step
      const { data: steps } = await supabase
        .from("flow_steps")
        .select("*")
        .eq("flow_id", selectedFlowId!)
        .order("step_order")
        .limit(1);
      const firstStep = steps?.[0];
      if (!firstStep) throw new Error("Fluxo sem etapas");

      const execData: any = {
        flow_id: selectedFlowId!,
        lead_id: leadId,
        current_step_id: firstStep.id,
        status: firstStep.step_type === "delay" ? "waiting_delay" : firstStep.step_type === "condition" ? "waiting_reply" : "waiting_delay",
        next_action_at: firstStep.step_type === "delay"
          ? new Date(Date.now() + (firstStep.delay_minutes || 0) * 60 * 1000).toISOString()
          : new Date().toISOString(),
        metadata: { codigo: codigo || "" },
      };
      // Cancel any existing active executions for this lead before creating a new one
      await supabase
        .from("flow_executions")
        .update({ status: "cancelled" })
        .eq("lead_id", leadId)
        .in("status", ["running", "waiting_delay", "waiting_reply"]);

      await supabase.from("flow_executions").insert(execData);
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

    if (isCsv) {
      for (const idx of csvSelectedIdxs) {
        const row = csvRows[idx];
        if (!row) continue;
        try {
          if (sendType === "flow") {
            const leadId = await findLeadByPhone(row.telefone);
            if (!leadId) { errorCount++; continue; }
            await startFlowForLead(leadId, row.codigo);
          } else {
            const body: any = { phone: row.telefone };
            if (sendType === "template" && selectedTemplate?.template_name) {
              body.template_name = selectedTemplate.template_name;
              body.template_language = selectedTemplate.template_language || "pt_BR";
              body.template_params = resolveParams((selectedTemplate.template_params || []) as any[], row.nome, row.codigo);
            } else {
              body.message = customMessage
                .replace(/\{nome\}/g, row.nome.split(" ")[0])
                .replace(/\{codigo\}/g, row.codigo);
            }
            const { error } = await supabase.functions.invoke("whatsapp-cloud-send", { body });
            if (error) throw error;
          }
          successCount++;
        } catch {
          errorCount++;
        }
      }
    } else {
      for (const leadId of selectedLeads) {
        const lead = leads?.find((l) => l.id === leadId);
        if (!lead) continue;
        try {
          if (sendType === "flow") {
            await startFlowForLead(leadId);
          } else {
            const body: any = { phone: lead.phone, lead_id: lead.id };
            if (sendType === "template" && selectedTemplate?.template_name) {
              body.template_name = selectedTemplate.template_name;
              body.template_language = selectedTemplate.template_language || "pt_BR";
              body.template_params = resolveParams((selectedTemplate.template_params || []) as any[], lead.name, "");
            } else {
              body.message = customMessage.replace(/\{nome\}/g, lead.name.split(" ")[0]);
            }
            const { error } = await supabase.functions.invoke("whatsapp-cloud-send", { body });
            if (error) throw error;
          }
          successCount++;
        } catch {
          errorCount++;
        }
      }
    }

    setIsSending(false);
    const action = sendType === "flow" ? "fluxo(s) iniciado(s)" : "mensagem(ns) enviada(s)";
    if (successCount > 0) toast.success(`${successCount} ${action} com sucesso!`);
    if (errorCount > 0) toast.error(`${errorCount} falharam.`);
    if (successCount > 0) {
      setSelectedLeads(new Set());
      setCsvSelectedIdxs(new Set());
    }
  };

  const activeCount = mode === "csv" ? csvSelectedIdxs.size : selectedLeads.size;

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button variant={mode === "leads" ? "default" : "outline"} size="sm" onClick={() => setMode("leads")}>
          <Users size={14} className="mr-1.5" /> Leads cadastrados
        </Button>
        <Button variant={mode === "csv" ? "default" : "outline"} size="sm" onClick={() => setMode("csv")}>
          <FileText size={14} className="mr-1.5" /> Importar CSV
        </Button>
      </div>

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
          </CardContent>
        </Card>
      </div>

      {/* Template Manager */}
      <TemplateManager />

      {/* Flow Builder */}
      <FlowBuilder />
    </div>
  );
}

/* ══════════════════════════════════════════════════
   CHAT TAB COMPONENT
   ══════════════════════════════════════════════════ */
function CloudChatTab() {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: leads } = useQuery({
    queryKey: ["cloud-chat-leads"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, name, phone, photo_url")
        .order("name");
      return data || [];
    },
  });

  const { data: latestMessages } = useQuery({
    queryKey: ["cloud-chat-latest"],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("lead_id, content, created_at, direction")
        .order("created_at", { ascending: false });
      const map = new Map<string, { content: string; created_at: string; direction: string }>();
      for (const m of data || []) {
        if (!map.has(m.lead_id)) map.set(m.lead_id, m);
      }
      return map;
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["cloud-chat-messages", selectedLeadId],
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

  const { data: templates } = useQuery({
    queryKey: ["chat-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("chat_templates").select("*").order("name");
      return data || [];
    },
  });

  const selectedLead = leads?.find((l) => l.id === selectedLeadId);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("cloud-chat-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => {
        queryClient.invalidateQueries({ queryKey: ["cloud-chat-messages", selectedLeadId] });
        queryClient.invalidateQueries({ queryKey: ["cloud-chat-latest"] });
      })
      .subscribe();
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-messages", selectedLeadId] });
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-latest"] });
    }, 5000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [selectedLeadId, queryClient]);

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
      const { data, error } = await supabase.functions.invoke("whatsapp-cloud-send", {
        body: { phone: selectedLead.phone, message: text || "", lead_id: selectedLead.id, media_url: mediaUrl, media_type: mediaType, template_name: templateName, template_language: templateLanguage, template_params: templateParams },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-messages", selectedLeadId] });
      queryClient.invalidateQueries({ queryKey: ["cloud-chat-latest"] });
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
    return leads.filter((l) => latestMessages.has(l.id) && (l.name.toLowerCase().includes(s) || l.phone.includes(s)));
  }, [leads, search, latestMessages]);

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
    <div className="flex h-[520px] rounded-lg border border-border overflow-hidden bg-card">
      {/* Contact list */}
      <div className={cn("w-[280px] flex flex-col border-r border-border", selectedLeadId ? "hidden md:flex" : "flex flex-1 md:flex-none md:w-[280px]")}>
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar lead..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {sortedLeads.map((lead) => {
            const latest = latestMessages?.get(lead.id);
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
                  <p className="text-sm font-medium truncate">{lead.name}</p>
                  {latest && <p className="text-xs text-muted-foreground truncate">{latest.content}</p>}
                </div>
                {latest && <span className="text-[10px] text-muted-foreground flex-shrink-0">{isToday(new Date(latest.created_at)) ? format(new Date(latest.created_at), "HH:mm") : format(new Date(latest.created_at), "dd/MM")}</span>}
              </button>
            );
          })}
        </ScrollArea>
      </div>

      {/* Chat area */}
      {selectedLeadId && selectedLead ? (
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="h-12 px-3 flex items-center gap-2 border-b border-border bg-muted/30">
            <button onClick={() => setSelectedLeadId(null)} className="md:hidden p-1 rounded hover:bg-accent">
              <ArrowLeft size={18} />
            </button>
            <Avatar className="w-8 h-8">
              {selectedLead.photo_url && <AvatarImage src={selectedLead.photo_url} />}
              <AvatarFallback className={cn(getAvatarColor(selectedLead.name), "text-white text-xs")}>{getInitials(selectedLead.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{selectedLead.name}</p>
              <p className="text-[11px] text-muted-foreground">{selectedLead.phone}</p>
            </div>
          </div>

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
                              return {
                                type: "text",
                                text: text.replace(/\{nome\}/g, selectedLead?.name?.split(" ")[0] || ""),
                              };
                            });
                            // Check if any param still has unresolved placeholders or is empty
                            const hasUnresolved = resolvedParams.some((p: any) => !p.text || /\{.*\}/.test(p.text));
                            if (hasUnresolved) {
                              toast.error("Este template requer parâmetros que não podem ser preenchidos automaticamente no chat. Use a aba Rastreio ou Disparo.");
                              return;
                            }
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
  );
}

/* ══════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════ */
export default function WhatsAppApi() {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [verifyToken, setVerifyToken] = useState(() => {
    const stored = localStorage.getItem("whatsapp_verify_token");
    if (stored) return stored;
    const generated = "meno_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    localStorage.setItem("whatsapp_verify_token", generated);
    return generated;
  });
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Olá! Esta é uma mensagem de teste do Meno Lead.");
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connected" | "error">("idle");

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-cloud-webhook`;

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success("URL do webhook copiada!");
  };

  const handleSave = async () => {
    if (!phoneNumberId || !accessToken) {
      toast.error("Preencha o Phone Number ID e o Access Token.");
      return;
    }
    setIsSaving(true);
    try {
      toast.success("Configurações salvas! Configure os secrets no backend para ativar.");
      setConnectionStatus("connected");
    } catch {
      toast.error("Erro ao salvar configurações.");
      setConnectionStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestMessage = async () => {
    if (!testPhone) {
      toast.error("Informe o número de telefone para teste.");
      return;
    }
    setIsTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-cloud-send", {
        body: { phone: testPhone, message: testMessage },
      });
      if (error) throw error;
      toast.success("Mensagem de teste enviada com sucesso!");
    } catch (err: any) {
      toast.error(`Erro ao enviar mensagem: ${err.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="WhatsApp Cloud API"
        description="Gerencie sua integração com a API oficial do WhatsApp via Meta/Facebook"
      />

      <Tabs defaultValue="config" className="space-y-6">
        <div className="bg-card rounded-xl border border-border shadow-card p-1.5">
          <TabsList className="flex-wrap w-full bg-transparent gap-1 h-auto p-0">
            <TabsTrigger value="config" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm text-sm px-4 py-2.5 transition-all">
              Configuração
            </TabsTrigger>
            <TabsTrigger value="webhook" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm text-sm px-4 py-2.5 transition-all">
              Webhook
            </TabsTrigger>
            <TabsTrigger value="test" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm text-sm px-4 py-2.5 transition-all">
              Teste
            </TabsTrigger>
            <TabsTrigger value="broadcast" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm gap-1.5 text-sm px-4 py-2.5 transition-all">
              <Send size={14} />
              Disparo
            </TabsTrigger>
            <TabsTrigger value="chat" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm gap-1.5 text-sm px-4 py-2.5 transition-all">
              <MessageCircle size={14} />
              Chat
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm gap-1.5 text-sm px-4 py-2.5 transition-all">
              <BarChart3 size={14} />
              Histórico
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Config Tab ── */}
        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Key size={20} />
                    Credenciais da API
                  </CardTitle>
                  <CardDescription>
                    Obtenha essas informações no{" "}
                    <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
                      Facebook Developers <ExternalLink size={12} />
                    </a>
                  </CardDescription>
                </div>
                <Badge variant={connectionStatus === "connected" ? "default" : connectionStatus === "error" ? "destructive" : "secondary"} className="gap-1">
                  {connectionStatus === "connected" ? <><CheckCircle2 size={12} /> Conectado</> : connectionStatus === "error" ? <><AlertCircle size={12} /> Erro</> : "Não configurado"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="phoneNumberId">Phone Number ID</Label>
                  <Input id="phoneNumberId" placeholder="Ex: 123456789012345" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessAccountId">Business Account ID</Label>
                  <Input id="businessAccountId" placeholder="Ex: 987654321098765" value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="accessToken">Access Token (permanente)</Label>
                <Input id="accessToken" type="password" placeholder="EAAxxxxxxx..." value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
                <p className="text-xs text-muted-foreground">Use um token permanente do System User no Business Manager.</p>
              </div>
              <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
                {isSaving ? "Salvando..." : "Salvar Configurações"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Webhook Tab ── */}
        <TabsContent value="webhook" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Link2 size={20} /> Configuração do Webhook</CardTitle>
              <CardDescription>Configure este webhook no seu App do Facebook Developers para receber mensagens.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>URL do Webhook (Callback URL)</Label>
                <div className="flex gap-2">
                  <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={handleCopyWebhook}><Copy size={16} /></Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="verifyToken">Verify Token</Label>
                <Input id="verifyToken" placeholder="Defina um token de verificação" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} />
                <p className="text-xs text-muted-foreground">Use este mesmo valor no campo "Verify Token" ao configurar o webhook no Facebook.</p>
              </div>
              <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                <p className="text-sm font-medium">Passo a passo:</p>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Acesse seu App no Facebook Developers</li>
                  <li>Vá em WhatsApp → Configuração</li>
                  <li>Em "Webhook", clique em "Editar"</li>
                  <li>Cole a URL do webhook acima</li>
                  <li>Cole o Verify Token definido acima</li>
                  <li>Inscreva-se no campo <code className="bg-muted px-1 rounded">messages</code></li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Test Tab ── */}
        <TabsContent value="test" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Send size={20} /> Enviar Mensagem de Teste</CardTitle>
              <CardDescription>Teste a conexão enviando uma mensagem via WhatsApp Cloud API.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="testPhone">Número de Telefone</Label>
                  <div className="flex items-center gap-2">
                    <Phone size={16} className="text-muted-foreground" />
                    <Input id="testPhone" placeholder="5511999999999" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="testMessage">Mensagem</Label>
                  <Input id="testMessage" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} />
                </div>
              </div>
              <Button onClick={handleTestMessage} disabled={isTesting} className="w-full sm:w-auto">
                {isTesting ? "Enviando..." : "Enviar Teste"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>


        {/* ── Broadcast Tab ── */}
        <TabsContent value="broadcast" className="space-y-4">
          <BroadcastTab />
        </TabsContent>

        {/* ── Chat Tab ── */}
        <TabsContent value="chat" className="space-y-4">
          <CloudChatTab />
        </TabsContent>

        {/* ── History Tab ── */}
        <TabsContent value="history" className="space-y-4">
          <SendingMetrics />
        </TabsContent>
      </Tabs>
    </div>
  );
}
