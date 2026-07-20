import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Shield, User, Loader2, ArrowLeft, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface AppUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  display_name: string;
  role: string;
}

class AdminFetchError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminFetchError";
    this.status = status;
  }
}

const PASSWORD_HELPER_TEXT = "Use 10+ caracteres com maiúscula, minúscula, número e símbolo.";

function getPasswordValidationError(password: string, required: boolean) {
  const value = password.trim();

  if (!value) {
    return required ? "Senha é obrigatória para novos usuários" : null;
  }

  if (value.length < 10) return "A senha precisa ter no mínimo 10 caracteres";
  if (!/[a-z]/.test(value)) return "Inclua pelo menos uma letra minúscula";
  if (!/[A-Z]/.test(value)) return "Inclua pelo menos uma letra maiúscula";
  if (!/\d/.test(value)) return "Inclua pelo menos um número";
  if (!/[^A-Za-z0-9]/.test(value)) return "Inclua pelo menos um símbolo";

  return null;
}

async function expireLocalSession() {
  await supabase.auth.signOut({ scope: "local" });
  const redirectTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/auth?redirect=${encodeURIComponent(redirectTo)}`);
}

async function adminFetch(action: string, method: string, body?: any) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) {
    await expireLocalSession();
    throw new AdminFetchError("Sessão expirada. Faça login novamente.", 401);
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    await expireLocalSession();
    throw new AdminFetchError("Sessão expirada. Faça login novamente.", 401);
  }

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const res = await fetch(
    `https://${projectId}.supabase.co/functions/v1/admin-users?action=${action}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  );
  const responseText = await res.text();
  let data: any = {};

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { error: responseText || "Erro desconhecido" };
  }

  if (!res.ok || data?.success === false) {
    if (res.status === 401) {
      await expireLocalSession();
      throw new AdminFetchError("Sessão expirada. Faça login novamente.", 401);
    }

    throw new AdminFetchError(data?.error || "Erro desconhecido", res.status);
  }

  return data;
}

export default function AdminUsers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [form, setForm] = useState({ email: "", password: "", display_name: "", role: "user" });

  const isSuperAdmin = user?.email === "admin@primechat.com";

  const { data: users = [], isLoading, isError, error: usersError } = useQuery<AppUser[], Error>({
    queryKey: ["admin-users"],
    queryFn: () => adminFetch("list", "GET"),
    enabled: isSuperAdmin,
    retry: false,
    throwOnError: false,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => adminFetch("create", "POST", data),
    onSuccess: () => {
      toast.success("Usuário criado!");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      closeDialog();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => adminFetch("update", "PUT", data),
    onSuccess: () => {
      toast.success("Usuário atualizado!");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      closeDialog();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (user_id: string) => adminFetch("delete", "DELETE", { user_id }),
    onSuccess: () => {
      toast.success("Usuário excluído!");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingUser(null);
    setForm({ email: "", password: "", display_name: "", role: "user" });
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm({ email: "", password: "", display_name: "", role: "user" });
    setDialogOpen(true);
  };

  const openEdit = (u: AppUser) => {
    setEditingUser(u);
    setForm({ email: u.email, password: "", display_name: u.display_name, role: u.role });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const passwordError = getPasswordValidationError(form.password, !editingUser);

    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    const normalizedPassword = form.password.trim();

    if (editingUser) {
      updateMutation.mutate({
        user_id: editingUser.id,
        email: form.email !== editingUser.email ? form.email : undefined,
        password: normalizedPassword ? normalizedPassword : undefined,
        display_name: form.display_name,
        role: form.role,
      });
    } else {
      createMutation.mutate({ ...form, password: normalizedPassword });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const passwordValidationMessage = getPasswordValidationError(form.password, !editingUser);

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Shield size={48} className="text-muted-foreground" />
        <h2 className="text-xl font-semibold">Acesso Restrito</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Apenas a conta principal (admin@primechat.com) pode gerenciar usuários do sistema.
        </p>
        <Button variant="outline" onClick={() => navigate("/")}>
          <ArrowLeft size={16} className="mr-2" /> Voltar ao início
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold">Gerenciar Usuários</h1>
            <p className="text-sm text-muted-foreground">Crie, edite e remova contas de acesso</p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus size={16} /> Novo Usuário
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
              <Shield size={36} className="text-muted-foreground" />
              <div className="space-y-1">
                <p className="font-medium">Não foi possível carregar os usuários</p>
                <p className="text-sm text-muted-foreground">{usersError?.message || "Tente novamente em instantes."}</p>
              </div>
              <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["admin-users"] })}>
                <RefreshCw size={16} className="mr-2" /> Tentar novamente
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead className="w-[100px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.display_name || "—"}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="gap-1">
                        {u.role === "admin" ? <Shield size={12} /> : <User size={12} />}
                        {u.role === "admin" ? "Admin" : "Usuário"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {u.last_sign_in_at
                        ? new Date(u.last_sign_in_at).toLocaleDateString("pt-BR", {
                            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
                          })
                        : "Nunca"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(u)}>
                          <Pencil size={14} />
                        </Button>
                        {u.id !== user?.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm("Tem certeza que deseja excluir este usuário?")) {
                                deleteMutation.mutate(u.id);
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      Nenhum usuário encontrado
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
            <DialogTitle>{editingUser ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "Atualize os dados do usuário" : "Crie uma nova conta de acesso ao sistema"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="Nome do usuário" required />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" required />
            </div>
            <div className="space-y-1.5">
              <Label>Senha {editingUser && <span className="text-muted-foreground">(deixe vazio para manter)</span>}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editingUser ? "Digite apenas se quiser alterar" : "Senha forte obrigatória"}
                required={!editingUser}
              />
              <p className="text-xs text-muted-foreground">{PASSWORD_HELPER_TEXT}</p>
              {form.password && passwordValidationMessage && (
                <p className="text-xs text-destructive">{passwordValidationMessage}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Cargo</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Usuário</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingUser ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
