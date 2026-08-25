import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Copy, ExternalLink, Link2, Loader2, Pencil, Plus, Trash2, Tag, Columns3 } from "lucide-react";

const NONE = "__none__";

interface ShareLink {
  id: string;
  name: string;
  account_id: string | null;
  phone: string;
  message: string;
  label_id: string | null;
  stage_id: string | null;
  active: boolean;
  click_count: number;
}

interface FormState {
  name: string;
  accountId: string;
  phone: string;
  message: string;
  labelId: string;
  stageId: string;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  accountId: NONE,
  phone: "",
  message: "",
  labelId: NONE,
  stageId: NONE,
  active: true,
};

/** Monta a URL wa.me com a frase pré-preenchida. */
function buildWaLink(phone: string, message: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  const base = `https://wa.me/${digits}`;
  return message.trim() ? `${base}?text=${encodeURIComponent(message.trim())}` : base;
}

export function ShareLinksSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { accounts } = useWhatsAppAccounts();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShareLink | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data: links = [], isLoading } = useQuery<ShareLink[]>({
    queryKey: ["share-links", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("share_links")
        .select("id, name, account_id, phone, message, label_id, stage_id, active, click_count")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ShareLink[];
    },
  });

  const { data: labels = [] } = useQuery({
    queryKey: ["chat-labels", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_labels")
        .select("id, name, color")
        .eq("user_id", user!.id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: stages = [] } = useQuery({
    queryKey: ["pipeline-stages-select", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, color, position")
        .eq("owner_id", user!.id)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  const labelMap = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const stageMap = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const save = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      const digits = form.phone.replace(/\D/g, "");
      if (!name) throw new Error("Informe um nome para o link");
      if (digits.length < 10) throw new Error("Informe o número com DDI e DDD (ex.: 5511999999999)");

      const payload = {
        user_id: user!.id,
        name,
        account_id: form.accountId === NONE ? null : form.accountId,
        phone: digits,
        message: form.message,
        label_id: form.labelId === NONE ? null : form.labelId,
        stage_id: form.stageId === NONE ? null : form.stageId,
        active: form.active,
      };

      if (editing) {
        const { error } = await supabase.from("share_links").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("share_links").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Link atualizado" : "Link criado");
      queryClient.invalidateQueries({ queryKey: ["share-links", user?.id] });
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("share_links").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Link removido");
      queryClient.invalidateQueries({ queryKey: ["share-links", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("share_links").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["share-links", user?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const openNew = () => {
    setEditing(null);
    const def = accounts.find((a: any) => a.is_default) ?? accounts[0];
    setForm({
      ...EMPTY_FORM,
      accountId: def?.id ?? NONE,
      phone: (def as any)?.display_phone_number?.replace(/\D/g, "") ?? "",
    });
    setDialogOpen(true);
  };

  const openEdit = (link: ShareLink) => {
    setEditing(link);
    setForm({
      name: link.name,
      accountId: link.account_id ?? NONE,
      phone: link.phone,
      message: link.message ?? "",
      labelId: link.label_id ?? NONE,
      stageId: link.stage_id ?? NONE,
      active: link.active,
    });
    setDialogOpen(true);
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Links de compartilhamento do número
          </CardTitle>
          <CardDescription>
            Gere um link wa.me com frase pré-preenchida. Quando o lead enviar essa frase, ele recebe
            automaticamente a etiqueta e entra na coluna escolhida do Kanban.
          </CardDescription>
        </div>
        <Button onClick={openNew} className="gap-2 shrink-0">
          <Plus size={15} /> Novo link
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhum link criado ainda.
          </p>
        ) : (
          links.map((link) => {
            const url = buildWaLink(link.phone, link.message);
            const label = link.label_id ? labelMap.get(link.label_id) : null;
            const stage = link.stage_id ? stageMap.get(link.stage_id) : null;
            return (
              <div key={link.id} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{link.name}</p>
                    <p className="text-xs text-muted-foreground truncate">+{link.phone}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={link.active}
                      onCheckedChange={(active) => toggleActive.mutate({ id: link.id, active })}
                      aria-label="Ativar link"
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(link)}>
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Remover o link "${link.name}"?`)) remove.mutate(link.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>

                {link.message && (
                  <p className="text-xs text-muted-foreground line-clamp-2">“{link.message}”</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {label && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Tag size={10} style={{ color: label.color }} /> {label.name}
                    </Badge>
                  )}
                  {stage && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Columns3 size={10} style={{ color: stage.color }} /> {stage.name}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {link.click_count} entradas
                  </Badge>
                </div>

                <div className="flex gap-2">
                  <Input readOnly value={url} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copy(url)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" asChild>
                    <a href={url} target="_blank" rel="noreferrer noopener" aria-label="Abrir link">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar link" : "Novo link de compartilhamento"}</DialogTitle>
            <DialogDescription>
              Defina o número, a frase que o lead enviará, a etiqueta e a coluna de entrada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome interno</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex.: Bio do Instagram"
              />
            </div>

            {accounts.length > 0 && (
              <div className="space-y-1.5">
                <Label>Conta WhatsApp</Label>
                <Select
                  value={form.accountId}
                  onValueChange={(v) => {
                    const acc: any = accounts.find((a: any) => a.id === v);
                    setForm((prev) => ({
                      ...prev,
                      accountId: v,
                      phone: acc?.display_phone_number?.replace(/\D/g, "") || prev.phone,
                    }));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Número manual</SelectItem>
                    {accounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} {a.display_phone_number ? `· ${a.display_phone_number}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Número (DDI + DDD + número)</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="5511999999999"
                inputMode="numeric"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Frase pré-preenchida</Label>
              <Textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Olá! Vi seu Instagram e quero saber mais sobre o acompanhamento."
                rows={3}
              />
              <p className="text-[11px] text-muted-foreground">
                Use uma frase única por link (mínimo 8 caracteres) — é por ela que o sistema
                identifica a origem do lead.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Etiqueta aplicada</Label>
                <Select value={form.labelId} onValueChange={(v) => setForm({ ...form, labelId: v })}>
                  <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhuma</SelectItem>
                    {labels.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Coluna de entrada</Label>
                <Select value={form.stageId} onValueChange={(v) => setForm({ ...form, stageId: v })}>
                  <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhuma</SelectItem>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm">Link ativo</Label>
                <p className="text-xs text-muted-foreground">Desative para parar a atribuição automática.</p>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(active) => setForm({ ...form, active })}
              />
            </div>

            {form.phone && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Pré-visualização</p>
                <p className="font-mono text-xs break-all">{buildWaLink(form.phone, form.message)}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
