import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeamContext, useTeamMembers, ACCESS_LEVEL_LABELS } from "@/hooks/use-team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Plus, Loader2, Trash2, GripVertical, UserCheck, Columns3, Pencil, KanbanSquare,
  Check, Users,
} from "lucide-react";

interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
}

interface KanbanLead {
  id: string;
  name: string;
  phone: string;
  stage_id: string | null;
  assigned_to: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
}

/** Valor sentinela do filtro: leads sem responsável. */
const UNASSIGNED = "__sem_dono__";

const STAGE_COLORS = ["#6366f1", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6"];

// Colunas iniciais espelham as etapas do chat, para que os dois módulos falem
// a mesma língua. Colunas extras podem ser criadas livremente pelo usuário.
const DEFAULT_STAGES = [
  { name: "Aguardando", color: "#f59e0b" },
  { name: "Respondidas", color: "#22c55e" },
  { name: "Novos Pedidos", color: "#0ea5e9" },
  { name: "Reembolso", color: "#ef4444" },
];

// Quantidade de cartões carregados por coluna. Contas com dezenas de milhares de
// leads travavam ao buscar tudo de uma vez; aqui buscamos apenas o topo de cada
// coluna e exibimos o total real via contagem no servidor.
const CARDS_PER_COLUMN = 100;

interface ColumnData {
  leads: KanbanLead[];
  /** Só quem já trocou mensagem — é o número que corresponde a "entrou no chat". */
  total: number;
  /** Todo lead da etapa, qualquer origem — usado só pra saber se falta carregar cartão. */
  totalAll: number;
}

export function LeadsKanban() {
  const queryClient = useQueryClient();
  const { data: team } = useTeamContext();
  const ownerId = team?.ownerId;
  const canEdit = !!team?.canEditLeads;
  const canManageStages = team?.accessLevel === "owner" || team?.accessLevel === "manager";

  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [stageForm, setStageForm] = useState({ name: "", color: STAGE_COLORS[0] });
  // Filtro por vendedor. "" = todos; SEM_DONO = leads sem responsável, que é
  // o recorte que mais interessa a quem administra.
  const [filterAgentIds, setFilterAgentIds] = useState<Set<string>>(new Set());

  const toggleAgentFilter = (id: string) =>
    setFilterAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const { data: stages = [], isLoading: stagesLoading } = useQuery<Stage[]>({
    queryKey: ["pipeline-stages", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, color, position")
        .eq("owner_id", ownerId!)
        .order("position", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const stageKey = stages.map((s) => s.id).join(",");

  const { data: columnData, isLoading: leadsLoading } = useQuery<Record<string, ColumnData>>({
    queryKey: ["kanban-columns", ownerId, stageKey, [...filterAgentIds].sort().join(",")],
    enabled: !!ownerId && !stagesLoading,
    staleTime: 30_000,
    queryFn: async () => {
      const targets: Array<{ key: string; stageId: string | null }> = [
        { key: "none", stageId: null },
        ...stages.map((s) => ({ key: s.id, stageId: s.id })),
      ];

      const results = await Promise.all(
        targets.map(async ({ key, stageId }) => {
          // Compartilhado por cartões e pela contagem "com conversa": os
          // filtros de etapa/vendedor valem pros dois, só a exigência de
          // mensagem muda entre eles.
          const withFilters = (q: any) => {
            q = stageId ? q.eq("stage_id", stageId) : q.is("stage_id", null);
            if (filterAgentIds.size > 0) {
              const semDono = filterAgentIds.has(UNASSIGNED);
              const ids = [...filterAgentIds].filter((v) => v !== UNASSIGNED);
              if (semDono && ids.length > 0) {
                // "Ana e sem responsável" precisa de OR: um `in` sozinho
                // nunca casa com nulo.
                q = q.or(`assigned_to.in.(${ids.join(",")}),assigned_to.is.null`);
              } else if (semDono) {
                q = q.is("assigned_to", null);
              } else {
                q = q.in("assigned_to", ids);
              }
            }
            return q;
          };

          // Cartões: continuam mostrando todo lead da etapa, mesmo os criados
          // só por compra (ex.: Hubla) sem conversa — quem move um pedido pro
          // funil manualmente não pode ver o cartão sumir. O count aqui (sem
          // filtro) alimenta só o aviso de paginação, não o total exibido.
          const cardsQuery = withFilters(
            supabase
              .from("leads")
              .select("id, name, phone, stage_id, assigned_to, last_message_content, last_message_at", {
                count: "exact",
              })
              .eq("user_id", ownerId!),
          )
            .order("last_message_at", { ascending: false, nullsFirst: false })
            .range(0, CARDS_PER_COLUMN - 1);

          // Total: só conta quem já MANDOU mensagem — last_message_at não
          // serve aqui porque também é gravado em envio da própria conta (um
          // disparo pra lead comprado via Hubla, por exemplo, carimba
          // last_message_at sem o lead nunca ter respondido). last_inbound_at
          // só é preenchido pelo trigger quando direction='inbound', então é
          // o sinal real de "entrou no chat".
          const countQuery = withFilters(
            supabase
              .from("leads")
              .select("id", { count: "exact", head: true })
              .eq("user_id", ownerId!)
              .not("last_inbound_at", "is", null),
          );

          const [cardsRes, countRes] = await Promise.all([cardsQuery, countQuery]);
          if (cardsRes.error) throw cardsRes.error;
          if (countRes.error) throw countRes.error;
          return [key, {
            leads: (cardsRes.data ?? []) as KanbanLead[],
            total: countRes.count ?? 0,
            totalAll: cardsRes.count ?? 0,
          }] as const;
        }),
      );

      return Object.fromEntries(results);
    },
  });

  const canViewTeam = team?.accessLevel === "owner" || team?.accessLevel === "manager";
  const { data: members = [] } = useTeamMembers(canViewTeam);

  /** Nome quando é um só, contagem quando são vários. */
  const agentFilterLabel = useMemo(() => {
    if (filterAgentIds.size === 0) return "Todos os vendedores";
    if (filterAgentIds.size === 1) {
      const [id] = [...filterAgentIds];
      if (id === UNASSIGNED) return "Sem responsável";
      const m = members.find((x) => x.member_user_id === id);
      return m ? (m.display_name || m.email) : "1 vendedor";
    }
    return `${filterAgentIds.size} vendedores`;
  }, [filterAgentIds, members]);

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => map.set(m.member_user_id, m.display_name || m.email));
    return map;
  }, [members]);

  const totalLeads = useMemo(
    () => Object.values(columnData ?? {}).reduce((sum, c) => sum + c.total, 0),
    [columnData],
  );


  const saveStage = useMutation({
    mutationFn: async () => {
      const name = stageForm.name.trim();
      if (!name) throw new Error("Informe o nome da etapa");

      if (editingStage) {
        const { error } = await supabase
          .from("pipeline_stages")
          .update({ name, color: stageForm.color })
          .eq("id", editingStage.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("pipeline_stages").insert({
          owner_id: ownerId!,
          name,
          color: stageForm.color,
          position: stages.length,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingStage ? "Etapa atualizada" : "Etapa criada");
      queryClient.invalidateQueries({ queryKey: ["pipeline-stages", ownerId] });
      setStageDialogOpen(false);
      setEditingStage(null);
      setStageForm({ name: "", color: STAGE_COLORS[0] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createDefaults = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("pipeline_stages").insert(
        DEFAULT_STAGES.map((s, i) => ({ owner_id: ownerId!, name: s.name, color: s.color, position: i })),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Funil padrão criado");
      queryClient.invalidateQueries({ queryKey: ["pipeline-stages", ownerId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Semeia automaticamente as colunas espelhando as etapas do chat na primeira
  // visita, para o Kanban nunca aparecer vazio.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (!ownerId || stagesLoading || stages.length > 0 || !canManageStages) return;
    seededRef.current = true;
    createDefaults.mutate();
  }, [ownerId, stagesLoading, stages.length, canManageStages, createDefaults]);


  const deleteStage = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pipeline_stages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Etapa removida");
      queryClient.invalidateQueries({ queryKey: ["pipeline-stages", ownerId] });
      queryClient.invalidateQueries({ queryKey: ["kanban-columns", ownerId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveLead = useMutation({
    mutationFn: async ({ leadId, stageId }: { leadId: string; stageId: string | null }) => {
      const { error } = await supabase.from("leads").update({ stage_id: stageId }).eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kanban-columns", ownerId] }),
    onError: (e: Error) => toast.error(`Não foi possível mover o lead: ${e.message}`),
  });

  const assignLead = useMutation({
    mutationFn: async ({ leadId, userId }: { leadId: string; userId: string | null }) => {
      const { error } = await supabase.from("leads").update({ assigned_to: userId }).eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Responsável atualizado");
      queryClient.invalidateQueries({ queryKey: ["kanban-columns", ownerId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDrop = (stageId: string | null) => {
    setDragOverStage(null);
    if (!draggingLeadId || !canEdit) return;
    const all = Object.values(columnData ?? {}).flatMap((c) => c.leads);
    const lead = all.find((l) => l.id === draggingLeadId);
    setDraggingLeadId(null);
    if (!lead || (lead.stage_id ?? null) === stageId) return;
    moveLead.mutate({ leadId: lead.id, stageId });
  };

  if (stagesLoading || leadsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const columns: Array<{ id: string; name: string; color: string; stageId: string | null }> = [
    { id: "none", name: "Sem etapa", color: "#64748b", stageId: null },
    ...stages.map((s) => ({ id: s.id, name: s.name, color: s.color, stageId: s.id })),
  ];

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KanbanSquare size={20} className="text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Kanban de Leads</h2>
            <p className="text-xs text-muted-foreground">
              {totalLeads.toLocaleString("pt-BR")} leads · arraste os cartões entre as etapas
            </p>

          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {members.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 gap-2 font-normal">
                  <Users size={15} className="opacity-60" />
                  {agentFilterLabel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => setFilterAgentIds(new Set())} className="gap-2">
                  <span className="flex-1">Todos os vendedores</span>
                  {filterAgentIds.size === 0 && <Check size={14} className="opacity-60" />}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* preventDefault mantém o menu aberto: escolher dois
                    atendentes não pode custar quatro cliques. */}
                {[{ id: UNASSIGNED, nome: "Sem responsável" },
                  ...members.map((m) => ({ id: m.member_user_id, nome: m.display_name || m.email }))
                ].map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    onSelect={(e) => { e.preventDefault(); toggleAgentFilter(a.id); }}
                    className="gap-2"
                  >
                    <span className="flex-1 truncate">{a.nome}</span>
                    {filterAgentIds.has(a.id) && <Check size={14} className="opacity-60" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        {canManageStages && (
          <div className="flex gap-2">
            {stages.length === 0 && (
              <Button
                variant="outline"
                onClick={() => createDefaults.mutate()}
                disabled={createDefaults.isPending}
                className="gap-2"
              >
                <Columns3 size={15} /> Criar funil padrão
              </Button>
            )}
            <Button
              onClick={() => {
                setEditingStage(null);
                setStageForm({ name: "", color: STAGE_COLORS[stages.length % STAGE_COLORS.length] });
                setStageDialogOpen(true);
              }}
              className="gap-2"
            >
              <Plus size={15} /> Nova etapa
            </Button>
          </div>
        )}
        </div>
      </div>

      {stages.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          Nenhuma etapa criada ainda. Crie as etapas do seu funil para organizar os leads.
        </Card>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto pb-3">
          <div className="flex gap-3 h-full min-h-[400px]">
            {columns.map((col) => {
              const colInfo = columnData?.[col.id] ?? { leads: [], total: 0, totalAll: 0 };
              const colLeads = colInfo.leads;

              return (
                <div
                  key={col.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverStage(col.id);
                  }}
                  onDragLeave={() => setDragOverStage((prev) => (prev === col.id ? null : prev))}
                  onDrop={() => handleDrop(col.stageId)}
                  className={cn(
                    "w-[280px] shrink-0 flex flex-col rounded-xl border bg-card/60 backdrop-blur-xl transition-colors",
                    dragOverStage === col.id && "border-primary bg-primary/5",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                      <span className="text-sm font-medium truncate">{col.name}</span>
                      <Badge variant="secondary" className="shrink-0">
                        {colInfo.total.toLocaleString("pt-BR")}
                      </Badge>

                    </div>
                    {canManageStages && col.stageId && (
                      <div className="flex gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            const stage = stages.find((s) => s.id === col.stageId)!;
                            setEditingStage(stage);
                            setStageForm({ name: stage.name, color: stage.color });
                            setStageDialogOpen(true);
                          }}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Remover a etapa "${col.name}"? Os leads voltam para "Sem etapa".`)) {
                              deleteStage.mutate(col.stageId!);
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {colLeads.slice(0, 200).map((lead) => (
                      <div
                        key={lead.id}
                        draggable={canEdit}
                        onDragStart={() => setDraggingLeadId(lead.id)}
                        onDragEnd={() => setDraggingLeadId(null)}
                        className={cn(
                          "group rounded-lg border bg-background/80 p-2.5 text-sm shadow-sm transition-all",
                          canEdit && "cursor-grab active:cursor-grabbing hover:border-primary/50",
                          draggingLeadId === lead.id && "opacity-50",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{lead.name || lead.phone}</p>
                            <p className="text-xs text-muted-foreground truncate">{lead.phone}</p>
                          </div>
                          {canEdit && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                                  <GripVertical size={13} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel>Mover para</DropdownMenuLabel>
                                {columns
                                  .filter((c) => c.id !== col.id)
                                  .map((c) => (
                                    <DropdownMenuItem
                                      key={c.id}
                                      onClick={() => moveLead.mutate({ leadId: lead.id, stageId: c.stageId })}
                                    >
                                      <span className="h-2 w-2 rounded-full mr-2" style={{ backgroundColor: c.color }} />
                                      {c.name}
                                    </DropdownMenuItem>
                                  ))}
                                {members.length > 0 && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel>Atribuir a</DropdownMenuLabel>
                                    {members.map((m) => (
                                      <DropdownMenuItem
                                        key={m.member_user_id}
                                        onClick={() => assignLead.mutate({ leadId: lead.id, userId: m.member_user_id })}
                                      >
                                        <UserCheck size={13} className="mr-2" />
                                        {m.display_name || m.email}
                                        <span className="ml-auto text-[10px] text-muted-foreground">
                                          {ACCESS_LEVEL_LABELS[m.access_level]}
                                        </span>
                                      </DropdownMenuItem>
                                    ))}
                                    <DropdownMenuItem
                                      onClick={() => assignLead.mutate({ leadId: lead.id, userId: null })}
                                    >
                                      Remover responsável
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                        {lead.last_message_content && (
                          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                            {lead.last_message_content}
                          </p>
                        )}
                        {lead.assigned_to && (
                          <Badge variant="outline" className="mt-2 gap-1 text-[10px]">
                            <UserCheck size={10} />
                            {memberNames.get(lead.assigned_to) || "Responsável"}
                          </Badge>
                        )}
                      </div>
                    ))}
                    {colLeads.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-6">Nenhum lead</p>
                    )}
                    {colInfo.totalAll > colLeads.length && (
                      <p className="text-[11px] text-muted-foreground text-center py-2">
                        +{(colInfo.totalAll - colLeads.length).toLocaleString("pt-BR")} leads não exibidos
                      </p>
                    )}

                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingStage ? "Editar etapa" : "Nova etapa"}</DialogTitle>
            <DialogDescription>Defina o nome e a cor da coluna do funil.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={stageForm.name}
                onChange={(e) => setStageForm({ ...stageForm, name: e.target.value })}
                placeholder="Ex.: Negociação"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cor</Label>
              <div className="flex gap-2">
                {STAGE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setStageForm({ ...stageForm, color: c })}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition-transform",
                      stageForm.color === c ? "border-foreground scale-110" : "border-transparent",
                    )}
                    style={{ backgroundColor: c }}
                    aria-label={`Cor ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStageDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveStage.mutate()} disabled={saveStage.isPending}>
              {saveStage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
