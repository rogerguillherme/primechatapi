import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, X, Tag } from "lucide-react";

const LABEL_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
];

export function useLabels() {
  const { user } = useAuth();

  const { data: labels = [] } = useQuery({
    queryKey: ["chat-labels"],
    queryFn: async () => {
      const { data } = await supabase.from("chat_labels").select("*").order("name");
      return data || [];
    },
  });

  const { data: leadLabelsMap = new Map() } = useQuery({
    queryKey: ["lead-labels-map"],
    queryFn: async () => {
      const { data } = await supabase.from("lead_labels").select("lead_id, label_id");
      const map = new Map<string, Set<string>>();
      for (const ll of data || []) {
        if (!map.has(ll.lead_id)) map.set(ll.lead_id, new Set());
        map.get(ll.lead_id)!.add(ll.label_id);
      }
      return map;
    },
  });

  return { labels, leadLabelsMap, userId: user?.id };
}

export function ChatLabelsManager({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(LABEL_COLORS[0]);

  const { labels } = useLabels();

  const createMut = useMutation({
    mutationFn: async () => {
      if (!newName.trim() || !user) return;
      const { error } = await supabase.from("chat_labels").insert({ name: newName.trim(), color: newColor, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewName("");
      queryClient.invalidateQueries({ queryKey: ["chat-labels"] });
      toast.success("Etiqueta criada!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chat_labels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-labels"] });
      queryClient.invalidateQueries({ queryKey: ["lead-labels-map"] });
      toast.success("Etiqueta removida!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tag size={18} /> Gerenciar Etiquetas</DialogTitle>
          <DialogDescription>Crie etiquetas para organizar seus atendimentos</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Nome da etiqueta"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") createMut.mutate(); }}
            />
            <Button size="sm" onClick={() => createMut.mutate()} disabled={!newName.trim()}>
              <Plus size={14} />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{ backgroundColor: c, borderColor: newColor === c ? "hsl(var(--foreground))" : "transparent" }}
              />
            ))}
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {labels.map((label: any) => (
              <div key={label.id} className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-accent/40">
                <Badge style={{ backgroundColor: label.color, color: "#fff" }} className="text-xs">
                  {label.name}
                </Badge>
                <button onClick={() => deleteMut.mutate(label.id)} className="text-muted-foreground hover:text-destructive">
                  <X size={14} />
                </button>
              </div>
            ))}
            {labels.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhuma etiqueta criada</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LeadLabelSelector({ leadId, labels, leadLabelsMap }: { leadId: string; labels: any[]; leadLabelsMap: Map<string, Set<string>> }) {
  const queryClient = useQueryClient();
  const currentLabels = leadLabelsMap.get(leadId) || new Set();

  const toggleLabel = async (labelId: string) => {
    if (currentLabels.has(labelId)) {
      await supabase.from("lead_labels").delete().eq("lead_id", leadId).eq("label_id", labelId);
    } else {
      await supabase.from("lead_labels").insert({ lead_id: leadId, label_id: labelId });
    }
    queryClient.invalidateQueries({ queryKey: ["lead-labels-map"] });
  };

  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label: any) => (
        <button
          key={label.id}
          onClick={() => toggleLabel(label.id)}
          className="transition-all"
        >
          <Badge
            variant={currentLabels.has(label.id) ? "default" : "outline"}
            style={currentLabels.has(label.id) ? { backgroundColor: label.color, color: "#fff", borderColor: label.color } : { borderColor: label.color, color: label.color }}
            className="text-[10px] cursor-pointer hover:opacity-80"
          >
            {label.name}
          </Badge>
        </button>
      ))}
    </div>
  );
}
