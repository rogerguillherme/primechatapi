import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useTeamContext, useTeamMembers, teamApi, ACCESS_LEVEL_LABELS, ACCESS_LEVEL_DESCRIPTIONS,
  type AccessLevel, type LeadScope,
} from "@/hooks/use-team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, Pencil, Users, Shield } from "lucide-react";

type MemberLevel = Exclude<AccessLevel, "owner">;

const LEVELS: MemberLevel[] = ["manager", "broadcast", "chat", "readonly"];

interface FormState {
  email: string;
  password: string;
  display_name: string;
  access_level: MemberLevel;
  lead_scope: LeadScope;
}

const EMPTY_FORM: FormState = {
  email: "",
  password: "",
  display_name: "",
  access_level: "chat",
  lead_scope: "assigned",
};

export function TeamManagement() {
  const queryClient = useQueryClient();
  const { data: team } = useTeamContext();
  const canManage = !!team?.canManageTeam;
  const { data: members = [], isLoading, isError, error } = useTeamMembers(canManage);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["team-members"] });

  const saveMember = useMutation({
    mutationFn: async () => {
      if (editingId) {
        return teamApi.update({
          member_user_id: editingId,
          access_level: form.access_level,
          lead_scope: form.lead_scope,
          ...(form.password.trim() ? { password: form.password.trim() } : {}),
        });
      }
      if (!form.email.trim()) throw new Error("Informe o email do colaborador");
      if (form.password.trim().length < 8) throw new Error("A senha precisa ter no mínimo 8 caracteres");
      return teamApi.create({
        email: form.email.trim(),
        password: form.password.trim(),
        display_name: form.display_name.trim(),
        access_level: form.access_level,
        lead_scope: form.lead_scope,
      });
    },
    onSuccess: () => {
      toast.success(editingId ? "Colaborador atualizado" : "Colaborador criado");
      invalidate();
      setDialogOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: (memberUserId: string) => teamApi.remove(memberUserId),
    onSuccess: () => {
      toast.success("Acesso removido");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!canManage) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Shield size={36} className="text-muted-foreground" />
          <p className="font-medium">Acesso restrito</p>
          <p className="text-sm text-muted-foreground max-w-md">
            Apenas o dono da conta pode criar e gerenciar acessos de colaboradores.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Equipe</h2>
            <p className="text-xs text-muted-foreground">
              Crie acessos para colaboradores e defina o que cada um pode fazer
            </p>
          </div>
        </div>
        <Button
          className="gap-2"
          onClick={() => {
            setEditingId(null);
            setForm(EMPTY_FORM);
            setDialogOpen(true);
          }}
        >
          <Plus size={15} /> Novo colaborador
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {(error as Error)?.message || "Não foi possível carregar a equipe."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Acesso</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead className="w-[100px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.member_user_id}>
                    <TableCell className="font-medium">{m.display_name || "—"}</TableCell>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ACCESS_LEVEL_LABELS[m.access_level]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.lead_scope === "all" ? "Todos os leads" : "Apenas atribuídos"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditingId(m.member_user_id);
                            setForm({
                              email: m.email,
                              password: "",
                              display_name: m.display_name,
                              access_level: m.access_level,
                              lead_scope: m.lead_scope,
                            });
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Remover o acesso de ${m.email}?`)) {
                              removeMember.mutate(m.member_user_id);
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {members.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Nenhum colaborador cadastrado
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar colaborador" : "Novo colaborador"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Ajuste as permissões ou defina uma nova senha."
                : "Crie o acesso e escolha o nível de permissão."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!editingId && (
              <>
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input
                    value={form.display_name}
                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                    placeholder="Nome do colaborador"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="colaborador@empresa.com"
                  />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Senha {editingId && <span className="text-muted-foreground">(opcional)</span>}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editingId ? "Deixe vazio para manter" : "Mínimo 8 caracteres"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de acesso</Label>
              <Select
                value={form.access_level}
                onValueChange={(v) => setForm({ ...form, access_level: v as MemberLevel })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEVELS.map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>{ACCESS_LEVEL_LABELS[lvl]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ACCESS_LEVEL_DESCRIPTIONS[form.access_level]}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Leads visíveis</Label>
              <Select
                value={form.lead_scope}
                onValueChange={(v) => setForm({ ...form, lead_scope: v as LeadScope })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os leads da conta</SelectItem>
                  <SelectItem value="assigned">Apenas leads atribuídos a ele</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveMember.mutate()} disabled={saveMember.isPending}>
              {saveMember.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
