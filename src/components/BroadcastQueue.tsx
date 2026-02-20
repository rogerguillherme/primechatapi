import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  Send, Users, Search, FileText, ArrowLeft, Trash2, Plus, CheckCircle2,
  AlertCircle, Loader2, ChevronDown, ChevronUp, MessageCircle, Upload,
} from "lucide-react";
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
  customParams: Record<number, string>; // index -> value override
  status: "pending" | "sending" | "done" | "error";
  successCount: number;
  errorCount: number;
  lastError: string;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export function BroadcastQueue() {
  const { accounts, defaultAccount } = useWhatsAppAccounts();
  const queryClient = useQueryClient();

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Data queries
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

  const { data: accountTemplates } = useQuery({
    queryKey: ["account-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("account_templates").select("*");
      return (data || []) as { id: string; account_id: string; template_id: string }[];
    },
  });

  const addQueueItem = () => {
    const newItem: QueueItem = {
      id: generateId(),
      accountId: defaultAccount?.id || accounts[0]?.id || "",
      templateId: "",
      leadSource: "manual",
      selectedLeadIds: new Set(),
      customParams: {},
      status: "pending",
      successCount: 0,
      errorCount: 0,
      lastError: "",
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
    const windowMs = 5 * 60 * 1000;
    const cutoff = new Date(latestDate.getTime() - windowMs).toISOString();

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
      // Use custom param if set, otherwise use default
      const customValue = customParams[i];
      if (customValue !== undefined && customValue !== "") {
        const resolved = customValue
          .replace(/\{nome\}/g, nome.split(" ")[0])
          .replace(/\{codigo\}/g, "-");
        return { type: "text", text: resolved };
      }
      const text = typeof p === "string" ? p : p?.text || "";
      return {
        type: "text",
        text: text.replace(/\{nome\}/g, nome.split(" ")[0]).replace(/\{codigo\}/g, "-"),
      };
    });
  };

  const handleSendAll = async () => {
    const pendingItems = queue.filter((item) => item.status === "pending");
    if (pendingItems.length === 0) {
      toast.error("Nenhum item pendente na fila.");
      return;
    }

    for (const item of pendingItems) {
      if (!item.accountId) {
        toast.error("Selecione uma conta para todos os itens.");
        return;
      }
      if (!item.templateId) {
        toast.error("Selecione um template para todos os itens.");
        return;
      }
      if (item.selectedLeadIds.size === 0) {
        toast.error("Selecione pelo menos um lead em cada item.");
        return;
      }
    }

    setIsSendingAll(true);

    for (const item of pendingItems) {
      updateQueueItem(item.id, { status: "sending" });
      const template = templates?.find((t: any) => t.id === item.templateId);
      let successCount = 0;
      let errorCount = 0;
      let lastError = "";

      for (const leadId of item.selectedLeadIds) {
        const lead = leads?.find((l) => l.id === leadId);
        if (!lead) continue;

        try {
          const body: any = {
            phone: lead.phone,
            lead_id: lead.id,
            account_id: item.accountId,
          };
          if (template?.template_name) {
            body.template_name = template.template_name;
            body.template_language = template.template_language || "pt_BR";
            body.template_params = resolveParams(
              (template.template_params || []) as any[],
              lead.name,
              item.customParams
            );
          }
          const { data: sendData, error } = await supabase.functions.invoke(
            "whatsapp-cloud-send",
            { body }
          );
          if (error) throw error;
          if (sendData?.error) throw new Error(sendData.error);
          successCount++;
        } catch (e: any) {
          errorCount++;
          lastError = e?.message || "Erro desconhecido";
        }
      }

      updateQueueItem(item.id, {
        status: errorCount > 0 && successCount === 0 ? "error" : "done",
        successCount,
        errorCount,
        lastError,
      });
    }

    setIsSendingAll(false);
    toast.success("Fila de disparos processada!");
  };

  const totalPending = queue.filter((i) => i.status === "pending").length;
  const totalLeads = queue
    .filter((i) => i.status === "pending")
    .reduce((acc, i) => acc + i.selectedLeadIds.size, 0);

  return (
    <div className="space-y-4">
      {/* Queue header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Send size={16} /> Fila de Disparos
          </h3>
          <p className="text-xs text-muted-foreground">
            Adicione itens com conta, template e lista de leads diferentes. Dispare todos de uma vez.
          </p>
        </div>
        <Button size="sm" onClick={addQueueItem}>
          <Plus size={14} /> Adicionar Disparo
        </Button>
      </div>

      {/* Queue items */}
      {queue.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum disparo na fila. Clique em "Adicionar Disparo" para começar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {queue.map((item, index) => (
            <QueueItemCard
              key={item.id}
              item={item}
              index={index}
              accounts={accounts}
              templates={templates || []}
              accountTemplates={accountTemplates || []}
              leads={leads || []}
              isExpanded={expandedItemId === item.id}
              onToggleExpand={() =>
                setExpandedItemId(expandedItemId === item.id ? null : item.id)
              }
              onUpdate={(updates) => updateQueueItem(item.id, updates)}
              onRemove={() => removeQueueItem(item.id)}
              onLoadLastBroadcast={() => loadLastBroadcastLeads(item.id)}
              disabled={isSendingAll}
            />
          ))}
        </div>
      )}

      {/* Send all button */}
      {queue.length > 0 && (
        <Button
          onClick={handleSendAll}
          disabled={isSendingAll || totalPending === 0}
          className="w-full"
          size="lg"
        >
          {isSendingAll ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Enviando...
            </>
          ) : (
            <>
              <Send size={16} /> Disparar {totalPending} item(ns) — {totalLeads} lead(s) total
            </>
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
  accounts: any[];
  templates: any[];
  accountTemplates: { id: string; account_id: string; template_id: string }[];
  leads: any[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (updates: Partial<QueueItem>) => void;
  onRemove: () => void;
  onLoadLastBroadcast: () => void;
  disabled: boolean;
}

function QueueItemCard({
  item,
  index,
  accounts,
  templates,
  accountTemplates,
  leads,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onRemove,
  onLoadLastBroadcast,
  disabled,
}: QueueItemCardProps) {
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Column mapping modal state
  const [columnMapOpen, setColumnMapOpen] = useState(false);
  const [sheetColumns, setSheetColumns] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<Record<string, any>[]>([]);
  // mapping: col name -> field ("phone" | "name" | "param_0" | "param_1" | ... | "ignore")
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  const account = accounts.find((a) => a.id === item.accountId);
  const template = templates.find((t: any) => t.id === item.templateId);
  const templateParamCount = Array.isArray(template?.template_params)
    ? (template.template_params as any[]).length
    : 0;

  const normalizePhone = (raw: string) => raw.replace(/\D/g, "");

  const extractPhonesFromText = (text: string) => {
    const lines = text.split(/[\r\n,;]+/).map((l) => l.trim()).filter(Boolean);
    return lines.map(normalizePhone).filter((p) => p.length >= 10);
  };

  const matchPhonesToLeads = (phones: string[]) => {
    if (phones.length === 0) {
      toast.error("Nenhum número válido encontrado no arquivo.");
      return;
    }
    const matchedIds = new Set<string>();
    for (const lead of leads) {
      const leadPhone = normalizePhone(lead.phone);
      if (phones.some((p) => leadPhone.endsWith(p) || p.endsWith(leadPhone))) {
        matchedIds.add(lead.id);
      }
    }
    if (matchedIds.size === 0) {
      toast.error(`Nenhum lead encontrado para os ${phones.length} números importados.`);
    } else {
      onUpdate({ selectedLeadIds: matchedIds, leadSource: "manual" });
      toast.success(`${matchedIds.size} lead(s) encontrado(s) de ${phones.length} número(s) importados.`);
    }
  };

  const getFieldLabel = (field: string) => {
    if (field === "phone") return "📞 Telefone";
    if (field === "name") return "👤 Nome";
    if (field === "ignore") return "— Ignorar";
    if (field.startsWith("param_")) {
      const idx = parseInt(field.replace("param_", ""), 10);
      return `🔧 Parâmetro {{${idx + 1}}}`;
    }
    return field;
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

  const handleConfirmColumnMap = () => {
    const phoneCol = Object.entries(columnMapping).find(([, v]) => v === "phone")?.[0];
    if (!phoneCol) {
      toast.error("Selecione qual coluna é o Telefone.");
      return;
    }

    const phones = sheetRows
      .map((row) => normalizePhone(String(row[phoneCol] ?? "").trim()))
      .filter((p) => p.length >= 10);

    // Build custom params overrides from mapped columns
    const paramOverrides: Record<number, string[]> = {};
    for (const [col, field] of Object.entries(columnMapping)) {
      if (field.startsWith("param_")) {
        const idx = parseInt(field.replace("param_", ""), 10);
        paramOverrides[idx] = sheetRows.map((row) => String(row[col] ?? ""));
      }
    }

    setColumnMapOpen(false);
    matchPhonesToLeads(phones);
  };

  const autoDetectMapping = (cols: string[]): Record<string, string> => {
    const mapping: Record<string, string> = {};
    let paramIdx = 0;
    for (const col of cols) {
      const lower = col.toLowerCase();
      if (/tel|phone|fone|celular|whatsapp|numero|número/.test(lower)) {
        mapping[col] = "phone";
      } else if (/nome|name|cliente/.test(lower)) {
        mapping[col] = "name";
      } else if (/param|codigo|código|cod\.?$/.test(lower) && paramIdx < templateParamCount) {
        mapping[col] = `param_${paramIdx++}`;
      } else {
        mapping[col] = "ignore";
      }
    }
    return mapping;
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isExcel = /\.(xlsx?|xls)$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (isExcel) {
        const buffer = ev.target?.result as ArrayBuffer;
        if (!buffer) return;
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
        if (rows.length === 0) {
          toast.error("Planilha vazia ou sem dados.");
          return;
        }
        const cols = Object.keys(rows[0]);
        setSheetColumns(cols);
        setSheetRows(rows);
        setColumnMapping(autoDetectMapping(cols));
        setColumnMapOpen(true);
      } else {
        const text = ev.target?.result as string;
        if (!text) return;
        matchPhonesToLeads(extractPhonesFromText(text));
      }
    };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
    e.target.value = "";
  };

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
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
      onUpdate({
        selectedLeadIds: new Set(filteredLeads.map((l: any) => l.id)),
        leadSource: "manual",
      });
    }
  };

  const statusIcon =
    item.status === "done" ? (
      <CheckCircle2 size={16} className="text-green-500" />
    ) : item.status === "error" ? (
      <AlertCircle size={16} className="text-destructive" />
    ) : item.status === "sending" ? (
      <Loader2 size={16} className="animate-spin text-primary" />
    ) : null;

  return (
    <>
    {/* Column mapping modal */}
    <Dialog open={columnMapOpen} onOpenChange={setColumnMapOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Selecionar colunas do arquivo</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <p className="text-xs text-muted-foreground">
            Defina o significado de cada coluna da planilha. A coluna <strong>Telefone</strong> é obrigatória.
          </p>

          {/* Column mapping table */}
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-1/2">Coluna na planilha</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-1/2">Representa</th>
                </tr>
              </thead>
              <tbody>
                {sheetColumns.map((col, idx) => (
                  <tr key={col} className={cn("border-t", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                    <td className="px-3 py-2">
                      <div>
                        <p className="font-medium text-sm truncate max-w-[180px]">{col}</p>
                        {sheetRows[0] && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                            ex: {String(sheetRows[0][col] ?? "—")}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={columnMapping[col] ?? "ignore"}
                        onValueChange={(val) =>
                          setColumnMapping((prev) => ({ ...prev, [col]: val }))
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableFields().map((f) => (
                            <SelectItem key={f.value} value={f.value} className="text-xs">
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Validation hint */}
          {!Object.values(columnMapping).includes("phone") && (
            <p className="text-xs text-destructive">
              ⚠️ Selecione ao menos uma coluna como <strong>Telefone</strong>.
            </p>
          )}

          <p className="text-[10px] text-muted-foreground">
            {sheetRows.length} linha(s) encontrada(s) na planilha.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setColumnMapOpen(false)}>Cancelar</Button>
          <Button
            onClick={handleConfirmColumnMap}
            disabled={!Object.values(columnMapping).includes("phone")}
          >
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
          <span className="text-sm truncate">
            {account?.name || "Sem conta"}
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm truncate text-muted-foreground">
            {template?.name || "Sem template"}
          </span>
          <Badge variant="secondary" className="text-xs ml-auto shrink-0">
            {item.selectedLeadIds.size} lead(s)
          </Badge>
        </div>
        {item.status === "done" && (
          <span className="text-xs text-green-600">
            ✓ {item.successCount} ok{item.errorCount > 0 ? `, ${item.errorCount} erro(s)` : ""}
          </span>
        )}
        {item.status === "error" && (
          <span className="text-xs text-destructive truncate max-w-[200px]">
            {item.lastError}
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {item.status === "pending" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 size={14} />
            </Button>
          )}
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

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
                <option key={a.id} value={a.id}>
                  {a.name} {a.is_default ? "(padrão)" : ""}
                </option>
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
                  // Hide templates that are not approved on Meta (if status is known)
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
            {template && template.template_params && Array.isArray(template.template_params) && (template.template_params as any[]).length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">Parâmetros do Template</Label>
                <div className="space-y-1.5">
                  {(template.template_params as any[]).map((_: any, i: number) => {
                    const defaultText = typeof _ === "string" ? _ : _?.text || "";
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground whitespace-nowrap w-12 shrink-0">{`{{${i + 1}}}`}</span>
                        <Input
                          placeholder={defaultText || `Valor para {{${i + 1}}}. Use {nome} para nome do lead`}
                          value={item.customParams?.[i] ?? defaultText}
                          onChange={(e) => {
                            const next = { ...item.customParams, [i]: e.target.value };
                            onUpdate({ customParams: next } as any);
                          }}
                          className="h-7 text-xs"
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Use <code className="bg-muted px-1 rounded">{"{nome}"}</code> para inserir o primeiro nome do lead automaticamente.
                </p>
              </div>
            )}
          </div>

          {/* Lead selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                Leads ({item.selectedLeadIds.size} selecionados)
              </Label>
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.xls,.xlsx"
                  className="hidden"
                  onChange={handleFileImport}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={12} className="mr-1" /> Importar CSV / XLS
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onLoadLastBroadcast}
                >
                  <ArrowLeft size={12} className="mr-1" /> Último disparo
                </Button>
              </div>
            </div>

            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Buscar lead..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>

            <div className="border rounded-md">
              <div className="px-3 py-1.5 border-b">
                <button
                  onClick={toggleAll}
                  className="text-xs text-primary hover:underline"
                >
                  {item.selectedLeadIds.size === filteredLeads.length
                    ? "Desmarcar todos"
                    : "Selecionar todos"}
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
                    <Checkbox
                      checked={item.selectedLeadIds.has(lead.id)}
                      className="pointer-events-none"
                    />
                    <Avatar className="w-6 h-6">
                      {lead.photo_url && <AvatarImage src={lead.photo_url} />}
                      <AvatarFallback
                        className={cn(
                          getAvatarColor(lead.name),
                          "text-white text-[10px]"
                        )}
                      >
                        {getInitials(lead.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{lead.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {lead.phone}
                      </p>
                    </div>
                  </button>
                ))}
                {filteredLeads.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    Nenhum lead encontrado
                  </p>
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
