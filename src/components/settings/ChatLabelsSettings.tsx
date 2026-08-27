import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamContext } from "@/hooks/use-team";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Columns3, Loader2, Pencil, Plus, Tag, Trash2 } from "lucide-react";

const NONE = "__none__";

const LABEL_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
];

interface LabelRow {
  id: string;
  name: string;
  color: string;
  stage_id: string | null;
}

interface FormState {
  name: string;
  color: string;
  stageId: string;
}

const EMPTY_FORM: FormState = { name: "", color: LABEL_COLORS[0], stageId: NONE };

/** Etiquetas do chat: criar, renomear, trocar cor, ligar a uma coluna do Kanban. */
export function ChatLabelsSettings() {
  const { user } = useAuth();
  const { data: team } = useTeamContext();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LabelRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data: labels = [], isLoading } = useQuery<LabelRow[]>({
    queryKey: ["chat-labels"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_labels")
        .select("id, name, color, stage_id")
        .order("name");
      if (error) throw error;
      return (data ?? []) as LabelRow[];
    },
  });

  const { data: stages = [] } = useQuery({
    queryKey: ["pipeline-stages-labels"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, color, position")
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  const stageName = (id: string | null) =>
    stages.find((s: any) => s.id === id) as any | undefined;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["chat-labels"] });
    queryClient.invalidateQueries({ queryKey: ["chat-labels-contact"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sessão expirada");
      const name = form.name.trim();
      if (!name) throw new Error("Informe o nome da etiqueta");
      const payload = {
        name,
        color: form.color,
        stage_id: form.stageId === NONE ? null : form.stageId,
      };
      if (editing) {
        const { error } = await supabase.from("chat_labels").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("chat_labels")
          // Etiqueta pertence à CONTA, não a quem clicou: um gerente criando
          // uma etiqueta em nome do dono precisa que o resto da equipe a veja.
          .insert({ ...payload, user_id: team?.ownerId ?? user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Etiqueta atualizada" : "Etiqueta criada");
      refresh();
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (label: LabelRow) => {
      // Avisa o impacto ANTES de apagar: lead_labels some em cascata e
      // share_links.label_id vira NULL (ON DELETE SET NULL), o que desconfigura
      // o link de compartilhamento sem avisar ninguém.
      const [{ count: leadCount }, { count: linkCount }] = await Promise.all([
        supabase
          .from("lead_labels")
          .select("id", { count: "exact", head: true })
          .eq("label_id", label.id),
        supabase
          .from("share_links")
          .select("id", { count: "exact", head: true })
          .eq("label_id", label.id),
      ]);

      const warnings = [
        `Remover a etiqueta "${label.name}"?`,
        leadCount
          ? `Ela está aplicada em ${leadCount} ${leadCount === 1 ? "lead" : "leads"} e será retirada de todos.`
          : "Nenhum lead usa esta etiqueta.",
      ];
      if (linkCount) {
        warnings.push(
          `${linkCount} ${linkCount === 1 ? "link de compartilhamento ficará" : "links de compartilhamento ficarão"} sem etiqueta.`,
        );
      }
      if (!confirm(warnings.join("\n\n"))) return false;

      const { error } = await supabase.from("chat_labels").delete().eq("id", label.id);
      if (error) throw error;
      return true;
    },
    onSuccess: (removed) => {
      if (!removed) return;
      toast.success("Etiqueta removida");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["lead-labels-map"] });
      queryClient.invalidateQueries({ queryKey: ["share-links", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (label: LabelRow) => {
    setEditing(label);
    setForm({
      name: label.name,
      color: label.color || LABEL_COLORS[0],
      stageId: label.stage_id ?? NONE,
    });
    setDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4" /> Etiquetas do chat
          </CardTitle>
          <CardDescription>
            Organize os atendimentos por etiqueta. Se a etiqueta tiver uma coluna associada, aplicá-la
            move o lead para essa coluna do Kanban — retirar a etiqueta não traz o lead de volta.
          </CardDescription>
        </div>
        <Button onClick={openNew} className="gap-2 shrink-0">
          <Plus size={15} /> Nova etiqueta
        </Button>
      </CardHeader>

      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : labels.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma etiqueta criada ainda.
          </p>
        ) : (
          labels.map((label) => {
            const stage = stageName(label.stage_id);
            return (
              <div
                key={label.id}
                className="flex items-center gap-3 rounded-lg border bg-card p-3"
              >
                <Badge style={{ backgroundColor: label.color, color: "#fff" }} className="text-xs">
                  {label.name}
                </Badge>
                {stage ? (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Columns3 size={10} style={{ color: stage.color }} /> move para {stage.name}
                  </Badge>
                ) : (
                  <span className="text-[11px] text-muted-foreground">sem coluna associada</span>
                )}
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(label)}>
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => remove.mutate(label)}
                    disabled={remove.isPending}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar etiqueta" : "Nova etiqueta"}</DialogTitle>
            <DialogDescription>
              Nome, cor e — se quiser — a coluna do Kanban para onde o lead vai ao receber a etiqueta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex.: Quer comprar"
                onKeyDown={(e) => { if (e.key === "Enter") save.mutate(); }}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-1.5">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Cor ${c}`}
                    onClick={() => setForm({ ...form, color: c })}
                    className="w-7 h-7 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: c,
                      borderColor: form.color === c ? "hsl(var(--foreground))" : "transparent",
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Ao aplicar, mover para a coluna</Label>
              <Select value={form.stageId} onValueChange={(v) => setForm({ ...form, stageId: v })}>
                <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhuma (etiqueta sem efeito no Kanban)</SelectItem>
                  {stages.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name.trim()}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
