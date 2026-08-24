import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Clock } from "lucide-react";

export default function TrialExpired() {
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-elevated text-center">
        <CardHeader className="space-y-3">
          <div className="mx-auto w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <Clock className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl font-display">Seu acesso expirou</CardTitle>
          <CardDescription>
            O período de acesso desta conta chegou ao fim. Fale com a gente para liberar novamente o Prime Chat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={() => signOut()}>
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
