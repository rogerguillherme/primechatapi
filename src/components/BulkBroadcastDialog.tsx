import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X, Image as ImageIcon, Send, Megaphone, Loader2, Trash2, Filter, Upload, AlertTriangle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { analyzeTemplateContent, spamLevelLabel, suggestionsFor } from "@/lib/spamAnalyzer";


interface BulkBroadcastDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string;
  accountName: string;
}

function getInitials(name: string) {
  return (name || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function BulkBroadcastDialog({ open, onOpenChange, accountId, accountName }: BulkBroadcastDialogProps) {
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(5);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>("");

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setExcludedIds(new Set());
      setSearch("");
    }
  }, [open]);

  // Carrega TODOS os leads do tenant que já têm mensagem nesta conta (= contatos do WhatsApp)
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["bulk-leads", accountId],
    enabled: open && !!accountId,
    queryFn: async () => {
      // Descobre o dono da conta para evitar vazamento de leads de outros tenants
      const { data: acc, error: accErr } = await supabase
        .from("whatsapp_accounts")
        .select("user_id")
        .eq("id", accountId)
        .maybeSingle();
      if (accErr) throw accErr;
      if (!acc?.user_id) return [];

      // Pega lead_ids únicos que têm mensagem nesta conta
      const { data: msgs, error } = await supabase
        .from("chat_messages")
        .select("lead_id")
        .eq("account_id", accountId)
        .limit(50000);
      if (error) throw error;
      const ids = Array.from(new Set((msgs || []).map((m: any) => m.lead_id).filter(Boolean)));
      if (ids.length === 0) return [];

      // Busca SOMENTE leads pertencentes ao mesmo dono da conta
      const out: any[] = [];
      const chunk = 500;
      for (let i = 0; i < ids.length; i += chunk) {
        const slice = ids.slice(i, i + chunk);
        const { data } = await supabase
          .from("leads")
          .select("id, name, phone, photo_url, user_id")
          .in("id", slice)
          .eq("user_id", acc.user_id);
        if (data) out.push(...data);
      }
      return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    },
  });

  // Disparos anteriores para usar como filtro de exclusão
  const { data: previousJobs = [] } = useQuery({
    queryKey: ["bulk-prev-jobs", accountId],
    enabled: open && !!accountId,
    queryFn: async () => {
      const { data } = await supabase
        .from("broadcast_jobs")
        .select("id, template_name, total_leads, created_at, status")
        .or(`account_id.eq.${accountId},account_ids.cs.{${accountId}}`)
        .order("created_at", { ascending: false })
        .limit(50);
      return data || [];
    },
  });

  const excludeFromPreviousJob = async (jobId: string) => {
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
    const ids: string[] = data.lead_ids || [];
    const validIds = new Set(leads.map((l: any) => l.id));
    let count = 0;
    setExcludedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (validIds.has(id) && !next.has(id)) {
          next.add(id);
          count++;
        }
      }
      return next;
    });
    toast.success(`${count} contato(s) excluído(s) deste disparo`);
    setFilterOpen(false);
    setSelectedJobId("");
  };

  const normalizePhone = (p: string) => (p || "").replace(/\D/g, "");

  const excludeFromCsv = async (file: File) => {
    try {
      const text = await file.text();
      // Extract anything that looks like a phone (digits with optional separators)
      const lines = text.split(/[\r\n,;]+/);
      const phones = new Set<string>();
      for (const line of lines) {
        const digits = normalizePhone(line);
        if (digits.length >= 8) {
          // Match by last 8 digits to be resilient to country codes
          phones.add(digits.slice(-8));
        }
      }
      if (phones.size === 0) {
        toast.error("Nenhum telefone válido encontrado no arquivo");
        return;
      }
      let count = 0;
      setExcludedIds((prev) => {
        const next = new Set(prev);
        for (const l of leads) {
          const tail = normalizePhone(l.phone).slice(-8);
          if (tail && phones.has(tail) && !next.has(l.id)) {
            next.add(l.id);
            count++;
          }
        }
        return next;
      });
      toast.success(`${count} contato(s) excluído(s) a partir da lista (${phones.size} telefones)`);
      setFilterOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao processar arquivo");
    }
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return leads;
    return leads.filter((l: any) =>
      l.name?.toLowerCase().includes(s) || l.phone?.includes(s)
    );
  }, [leads, search]);

  const includedCount = leads.length - excludedIds.size;

  const toggleExclude = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const excludeAllFiltered = () => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      for (const l of filtered) next.add(l.id);
      return next;
    });
  };

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `bulk-broadcast/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("chat-media").upload(path, file);
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
      setImageUrl(pub.publicUrl);
      toast.success("Imagem carregada");
    } catch (err: any) {
      toast.error(err.message || "Erro no upload");
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (!message.trim()) {
      toast.error("Escreva uma mensagem");
      return;
    }
    if (includedCount === 0) {
      toast.error("Nenhum contato selecionado");
      return;
    }
    if (delayMin > delayMax) {
      toast.error("Delay mínimo não pode ser maior que máximo");
      return;
    }

    // Anti-ban v2 — bloqueio de conteúdo crítico
    const spam = analyzeTemplateContent(message);
    if (spam.risk_level === "critical") {
      toast.error("Conteúdo bloqueado: risco crítico de spam. Revise o texto antes de disparar.");
      return;
    }
    if (spam.risk_level === "high") {
      const ok = window.confirm(
        `Atenção: o conteúdo tem alto risco de spam (score ${spam.spam_score}/100).\n\nIsso pode comprometer a reputação do seu número na Meta.\n\nDeseja continuar mesmo assim?`,
      );
      if (!ok) return;
    }


    const leadIds = leads.filter((l: any) => !excludedIds.has(l.id)).map((l: any) => l.id);
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("evolution-bulk-broadcast", {
        body: {
          account_id: accountId,
          lead_ids: leadIds,
          message: message.trim(),
          image_url: imageUrl || undefined,
          delay_min: delayMin,
          delay_max: delayMax,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Disparo iniciado para ${leadIds.length} contatos`);
      onOpenChange(false);
      setMessage("");
      setImageUrl("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao iniciar disparo");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Megaphone size={18} className="text-primary" />
            Disparo em Massa — {accountName}
          </DialogTitle>
          <DialogDescription>
            Envia para todos os contatos da conta. Você pode pesquisar e excluir números antes de disparar.
            Use {"{primeiro_nome}"} para personalizar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 overflow-hidden flex-1">
          {/* LEFT: Mensagem */}
          <div className="flex flex-col gap-3 min-h-0">
            <div>
              <Label className="text-xs">Mensagem</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Olá {primeiro_nome}, tudo bem?..."
                className="mt-1 min-h-[140px] text-sm"
                maxLength={4000}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Variáveis: {"{nome}"}, {"{primeiro_nome}"}, {"{telefone}"}
              </p>

              {/* Anti-ban v2 — Spam content score + transparência */}
              {message.trim().length > 0 && (() => {
                const a = analyzeTemplateContent(message);
                const tips = suggestionsFor(a.warnings);
                const tone =
                  a.risk_level === "critical" ? "border-destructive/60 bg-destructive/10 text-destructive" :
                  a.risk_level === "high" ? "border-destructive/40 bg-destructive/5 text-destructive" :
                  a.risk_level === "medium" ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" :
                  "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400";
                const Icon = a.risk_level === "low" ? ShieldCheck : AlertTriangle;
                return (
                  <div className={cn("mt-2 rounded-md border p-2 text-[11px] space-y-2", tone)}>
                    <div className="flex items-center gap-2 font-medium">
                      <Icon size={12} />
                      <span>Risco de spam: {spamLevelLabel(a.risk_level)} ({a.spam_score}/100)</span>
                    </div>
                    {a.warnings.length > 0 && (
                      <div>
                        <p className="font-medium opacity-80">Por que foi marcada:</p>
                        <ul className="mt-0.5 ml-4 list-disc space-y-0.5 opacity-90">
                          {a.warnings.slice(0, 5).map((w) => (
                            <li key={w.code}>
                              {w.label}{w.detail ? ` — ${w.detail}` : ""} <span className="opacity-60">(+{w.weight})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {tips.length > 0 && (
                      <div>
                        <p className="font-medium opacity-80">Sugestões de correção:</p>
                        <ul className="mt-0.5 ml-4 list-disc space-y-0.5 opacity-90">
                          {tips.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>



            <div>
              <Label className="text-xs">Imagem (opcional)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="URL ou faça upload"
                  className="text-sm h-9"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    if (e.target) e.target.value = "";
                  }}
                />
              </div>
              {imageUrl && (
                <div className="mt-2 relative inline-block">
                  <img src={imageUrl} alt="preview" className="max-h-24 rounded border border-border" />
                  <button
                    onClick={() => setImageUrl("")}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Delay mín (s)</Label>
                <Input
                  type="number"
                  min={0}
                  value={delayMin}
                  onChange={(e) => setDelayMin(Math.max(0, parseInt(e.target.value) || 0))}
                  className="h-9 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Delay máx (s)</Label>
                <Input
                  type="number"
                  min={0}
                  value={delayMax}
                  onChange={(e) => setDelayMax(Math.max(0, parseInt(e.target.value) || 0))}
                  className="h-9 text-sm mt-1"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Anti-ban: ordem embaralhada, sufixo invisível e pausa em 5 erros consecutivos.
            </p>
          </div>

          {/* RIGHT: Lista de contatos */}
          <div className="flex flex-col gap-2 min-h-0 border border-border rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">
                Contatos: <Badge variant="default" className="ml-1">{includedCount}</Badge>{" "}
                <span className="text-muted-foreground">/ {leads.length}</span>
                {excludedIds.size > 0 && (
                  <span className="text-destructive ml-2">{excludedIds.size} excluído(s)</span>
                )}
              </Label>
              {excludedIds.size > 0 && (
                <button
                  onClick={() => setExcludedIds(new Set())}
                  className="text-[10px] text-primary hover:underline"
                >
                  restaurar todos
                </button>
              )}
            </div>

            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="pl-7 h-8 text-xs"
              />
            </div>

            {/* Filtros de exclusão */}
            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs justify-start">
                  <Filter size={12} className="mr-1" /> Excluir leads de…
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" align="start">
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-semibold">Disparo anterior</Label>
                    <p className="text-[10px] text-muted-foreground mb-1.5">
                      Remove contatos que já receberam um disparo selecionado.
                    </p>
                    <div className="flex gap-1.5">
                      <Select value={selectedJobId} onValueChange={setSelectedJobId}>
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
                        disabled={!selectedJobId}
                        onClick={() => excludeFromPreviousJob(selectedJobId)}
                      >
                        Aplicar
                      </Button>
                    </div>
                  </div>

                  <div className="border-t border-border pt-3">
                    <Label className="text-xs font-semibold">Lista importada</Label>
                    <p className="text-[10px] text-muted-foreground mb-1.5">
                      CSV/TXT com telefones (um por linha). Compara pelos últimos 8 dígitos.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs w-full"
                      onClick={() => csvRef.current?.click()}
                    >
                      <Upload size={12} className="mr-1" /> Enviar arquivo
                    </Button>
                    <input
                      ref={csvRef}
                      type="file"
                      accept=".csv,.txt,text/csv,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) excludeFromCsv(f);
                        if (e.target) e.target.value = "";
                      }}
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {search && filtered.length > 0 && (
              <button
                onClick={excludeAllFiltered}
                className="text-[10px] text-destructive hover:underline self-start flex items-center gap-1"
              >
                <Trash2 size={10} /> Excluir todos os {filtered.length} resultados
              </button>
            )}

            <ScrollArea className="flex-1 min-h-[240px] max-h-[320px]">
              {isLoading ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                  <Loader2 size={14} className="animate-spin mr-2" /> Carregando contatos...
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  {leads.length === 0 ? "Nenhum contato encontrado nesta conta." : "Nenhum resultado."}
                </p>
              ) : (
                filtered.map((lead: any) => {
                  const excluded = excludedIds.has(lead.id);
                  return (
                    <div
                      key={lead.id}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-xs",
                        excluded ? "opacity-40 line-through" : "hover:bg-accent/50"
                      )}
                    >
                      <Avatar className="w-6 h-6">
                        {lead.photo_url && <AvatarImage src={lead.photo_url} />}
                        <AvatarFallback className="text-[9px]">{getInitials(lead.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{lead.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{lead.phone}</p>
                      </div>
                      <button
                        onClick={() => toggleExclude(lead.id)}
                        className={cn(
                          "p-1 rounded transition-colors",
                          excluded
                            ? "text-primary hover:bg-primary/10"
                            : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        )}
                        title={excluded ? "Restaurar" : "Excluir do disparo"}
                      >
                        {excluded ? <X size={12} className="rotate-45" /> : <X size={12} />}
                      </button>
                    </div>
                  );
                })
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="p-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending || includedCount === 0 || !message.trim()}>
            {sending ? (
              <><Loader2 size={14} className="animate-spin mr-1" /> Iniciando...</>
            ) : (
              <><Send size={14} className="mr-1" /> Disparar para {includedCount}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
