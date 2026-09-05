import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Sem isto, qualquer exceção não tratada em qualquer componente deixa a tela
 * em branco — indistinguível de "o sistema caiu" para quem está atendendo.
 *
 * Precisa ser classe: React só oferece captura de erro de renderização por
 * componentDidCatch, que não tem equivalente em hook.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[erro na tela]", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md w-full space-y-4 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold">Esta tela travou</h1>
            <p className="text-sm text-muted-foreground">
              O restante do sistema continua funcionando. Recarregue para voltar —
              suas conversas e mensagens não foram afetadas.
            </p>
          </div>

          {/* A mensagem técnica fica à mão: é ela que torna o relato útil. */}
          <p className="text-xs font-mono text-muted-foreground bg-muted rounded-md p-2.5 break-words text-left">
            {error.message || String(error)}
          </p>

          <div className="flex gap-2 justify-center">
            <Button onClick={() => window.location.reload()} className="gap-1.5">
              <RotateCcw size={15} /> Recarregar
            </Button>
            <Button variant="outline" onClick={() => this.setState({ error: null })}>
              Tentar de novo
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
