import { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MessageCircle, User, Mail, Lock, IdCard, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cpfValido, maskCpf } from "@/lib/cpf";

export default function TrialSignup() {
  const { session, loading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cpf, setCpf] = useState("");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("A senha precisa ter no mínimo 6 caracteres");
      return;
    }
    const cpfDigits = cpf.replace(/\D/g, "");
    if (!cpfValido(cpf)) {
      toast.error("CPF inválido");
      return;
    }

    setIsLoading(true);
    try {
      // Confere ANTES de criar a conta — dá um erro claro em vez da
      // mensagem genérica que o Supabase Auth devolve quando o cadastro
      // falha por trás (a constraint no banco é a trava de verdade; isto
      // só existe pra avisar direito).
      const { data: check, error: checkError } = await supabase.functions.invoke("check-trial-cpf", {
        body: { cpf: cpfDigits },
      });
      if (checkError) throw new Error("Não consegui validar o CPF agora. Tente de novo em instantes.");
      if (check?.error) throw new Error(check.error);
      if (check?.available === false) {
        throw new Error("Esse CPF já usou o teste grátis. Se a conta expirou, fale com a gente pra continuar.");
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name, signup_source: "trial", cpf: cpfDigits },
        },
      });
      if (error) throw error;

      if (data.session) {
        toast.success("Conta criada! Seu teste grátis de 7 dias começou.");
        window.location.href = "/";
        return;
      }

      // Email confirmation required before a session is issued
      setDone(true);
    } catch (err: any) {
      // Corrida rara (duas abas ao mesmo tempo) cai na constraint do banco
      // em vez do check prévio — mesma mensagem nos dois casos.
      const msg = /duplicate key|profiles_cpf_unique/i.test(err?.message || "")
        ? "Esse CPF já usou o teste grátis. Se a conta expirou, fale com a gente pra continuar."
        : err?.message || "Erro ao criar conta";
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md shadow-elevated text-center">
          <CardContent className="pt-6 space-y-3">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
            <CardTitle>Confirme seu email</CardTitle>
            <CardDescription>
              Enviamos um link de confirmação para <strong>{email}</strong>. Clique nele para ativar seu teste grátis de 7 dias.
            </CardDescription>
            <Link to="/auth" className="text-sm text-primary underline block mt-4">
              Já confirmou? Entrar
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-elevated">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
            <MessageCircle className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-display">Teste grátis por 7 dias</CardTitle>
          <CardDescription>Crie sua conta no Prime Chat — sem cartão de crédito.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nome</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="name" placeholder="Seu nome" className="pl-9" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cpf">CPF</Label>
              <div className="relative">
                <IdCard className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="cpf"
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  className="pl-9"
                  value={cpf}
                  onChange={(e) => setCpf(maskCpf(e.target.value))}
                  maxLength={14}
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">Um teste grátis por CPF.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="email" type="email" placeholder="seu@email.com" className="pl-9" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="password" type="password" placeholder="••••••••" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Começar teste grátis"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Já tem conta? <Link to="/auth" className="text-primary underline">Entrar</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
