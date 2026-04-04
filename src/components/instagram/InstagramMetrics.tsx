import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Heart, MessageSquare, Eye, TrendingUp, TrendingDown, Instagram, ImageIcon } from "lucide-react";

function MetricCard({ title, value, change, changeType, icon: Icon }: {
  title: string;
  value: string;
  change?: string;
  changeType?: "up" | "down";
  icon: any;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {change && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${changeType === "up" ? "text-green-600" : "text-red-500"}`}>
                {changeType === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {change}
              </div>
            )}
          </div>
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/10 to-pink-500/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-purple-500" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function InstagramMetrics() {
  // Placeholder – will fetch real data from Instagram Graph API via edge function
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Métricas do Instagram</h2>
        <p className="text-sm text-muted-foreground">
          Acompanhe o desempenho da sua conta Instagram conectada
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Seguidores" value="—" icon={Users} />
        <MetricCard title="Engajamento" value="—" icon={Heart} />
        <MetricCard title="Mensagens (DMs)" value="—" icon={MessageSquare} />
        <MetricCard title="Impressões" value="—" icon={Eye} />
      </div>

      {/* Detailed cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4" /> Posts Recentes
            </CardTitle>
            <CardDescription>Desempenho dos últimos posts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Instagram className="h-10 w-10 opacity-20 mb-3" />
              <p className="text-sm">Conecte sua conta para ver os dados</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Crescimento
            </CardTitle>
            <CardDescription>Evolução de seguidores nos últimos 30 dias</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <TrendingUp className="h-10 w-10 opacity-20 mb-3" />
              <p className="text-sm">Conecte sua conta para ver os dados</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Stories
          </CardTitle>
          <CardDescription>Métricas de stories e respostas</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Instagram className="h-10 w-10 opacity-20 mb-3" />
            <p className="text-sm">Conecte sua conta para ver os dados</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
