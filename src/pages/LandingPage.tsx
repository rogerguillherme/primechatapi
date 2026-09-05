import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  MessageSquare, Zap, Users, BarChart3, Send, Bot, 
  Shield, Clock, ArrowRight, CheckCircle2, Star
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const features = [
  {
    icon: Send,
    title: "Disparos em Massa",
    description: "Envie mensagens para milhares de contatos com templates aprovados pelo WhatsApp.",
  },
  {
    icon: Bot,
    title: "Fluxos Automatizados",
    description: "Crie automações inteligentes com condições, delays e respostas interativas.",
  },
  {
    icon: Users,
    title: "Gestão de Leads",
    description: "Importe, organize e segmente seus contatos com labels e filtros avançados.",
  },
  {
    icon: BarChart3,
    title: "Análise de Campanhas",
    description: "Acompanhe entregas, leituras, cliques e taxa de erro em tempo real.",
  },
  {
    icon: MessageSquare,
    title: "Chat Integrado",
    description: "Responda seus leads diretamente pela plataforma com suporte a mídia.",
  },
  {
    icon: Shield,
    title: "Multi-Contas",
    description: "Gerencie múltiplos números WhatsApp com isolamento total de dados.",
  },
];

const plans = [
  {
    name: "Starter",
    price: "197",
    period: "/mês",
    features: [
      "1 número WhatsApp",
      "Até 5.000 disparos/dia",
      "Fluxos básicos",
      "Chat integrado",
      "Suporte por e-mail",
    ],
    highlight: false,
  },
  {
    name: "Pro",
    price: "497",
    period: "/mês",
    features: [
      "3 números WhatsApp",
      "Até 30.000 disparos/dia",
      "Fluxos ilimitados",
      "Analytics avançado",
      "Webhooks customizados",
      "Suporte prioritário",
    ],
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Sob consulta",
    period: "",
    features: [
      "Números ilimitados",
      "Disparos ilimitados",
      "API dedicada",
      "Gerente de conta",
      "SLA garantido",
      "Onboarding personalizado",
    ],
    highlight: false,
  },
];

const testimonials = [
  {
    name: "Rafael M.",
    role: "CEO, Digital Agency",
    text: "Triplicamos nossa taxa de conversão usando os fluxos automatizados da PrimeChat.",
    stars: 5,
  },
  {
    name: "Amanda S.",
    role: "Head de Marketing",
    text: "A melhor plataforma de disparos que já usei. Interface limpa e resultados reais.",
    stars: 5,
  },
  {
    name: "Lucas P.",
    role: "Infoprodutor",
    text: "Consegui recuperar 40% dos carrinhos abandonados com as automações.",
    stars: 5,
  },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              PrimeChat
            </span>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Recursos</a>
            <a href="#pricing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Planos</a>
            <a href="#testimonials" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Depoimentos</a>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")}>
              Entrar
            </Button>
            <Button size="sm" onClick={() => navigate("/auth")}>
              Começar grátis
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/10" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground">
              <Zap className="h-3.5 w-3.5 text-primary" />
              Plataforma #1 de WhatsApp Marketing
            </div>
            <h1
              className="mb-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Dispare, automatize e{" "}
              <span className="bg-gradient-to-r from-primary to-accent-foreground bg-clip-text text-transparent">
                converta mais
              </span>{" "}
              pelo WhatsApp
            </h1>
            <p className="mb-10 text-lg text-muted-foreground sm:text-xl">
              Envie campanhas em massa, crie fluxos inteligentes e gerencie todos os seus leads 
              em uma única plataforma conectada à API oficial do WhatsApp.
            </p>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Button size="lg" className="gap-2 px-8 text-base" onClick={() => navigate("/auth")}>
                Começar agora <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="lg" className="gap-2 px-8 text-base" asChild>
                <a href="#features">Ver recursos</a>
              </Button>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> API oficial Meta</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Sem banimento</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Setup em 5 min</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border bg-card/50 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Tudo que você precisa para escalar no WhatsApp
            </h2>
            <p className="text-muted-foreground">
              Ferramentas profissionais para marketing, vendas e atendimento via WhatsApp.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title} className="border-border bg-card transition-shadow hover:shadow-md">
                <CardContent className="p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-t border-border py-16">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-4 sm:px-6 lg:grid-cols-4">
          {[
            { value: "10M+", label: "Mensagens enviadas" },
            { value: "500+", label: "Empresas ativas" },
            { value: "99.8%", label: "Uptime" },
            { value: "< 2s", label: "Tempo de entrega" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-3xl font-bold text-primary sm:text-4xl" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {s.value}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border bg-card/50 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Planos que cabem no seu bolso
            </h2>
            <p className="text-muted-foreground">Escolha o plano ideal e comece a converter hoje.</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => (
              <Card
                key={p.name}
                className={`relative border-border bg-card transition-shadow ${
                  p.highlight ? "ring-2 ring-primary shadow-lg" : "hover:shadow-md"
                }`}
              >
                {p.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground">
                    Mais popular
                  </div>
                )}
                <CardContent className="p-8">
                  <h3 className="mb-2 text-xl font-bold">{p.name}</h3>
                  <div className="mb-6">
                    <span className="text-4xl font-extrabold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      {p.price.startsWith("Sob") ? "" : "R$ "}
                      {p.price}
                    </span>
                    <span className="text-muted-foreground">{p.period}</span>
                  </div>
                  <ul className="mb-8 space-y-3">
                    {p.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {feat}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={p.highlight ? "default" : "outline"}
                    onClick={() => navigate("/auth")}
                  >
                    {p.price.startsWith("Sob") ? "Falar com vendas" : "Começar agora"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="border-t border-border py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Quem usa, recomenda
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t) => (
              <Card key={t.name} className="border-border bg-card">
                <CardContent className="p-6">
                  <div className="mb-3 flex gap-0.5">
                    {Array.from({ length: t.stars }).map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                    ))}
                  </div>
                  <p className="mb-4 text-sm leading-relaxed text-muted-foreground">"{t.text}"</p>
                  <div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-primary/5 py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <Clock className="mx-auto mb-4 h-10 w-10 text-primary" />
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Comece a converter agora
          </h2>
          <p className="mb-8 text-muted-foreground">
            Configure em minutos. Sem cartão de crédito. Cancele quando quiser.
          </p>
          <Button size="lg" className="gap-2 px-10 text-base" onClick={() => navigate("/auth")}>
            Criar conta grátis <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>PrimeChat</span>
            </div>
            <p className="text-xs text-muted-foreground">© 2026 PrimeChat. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
