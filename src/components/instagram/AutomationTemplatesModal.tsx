import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Zap, Sparkles, Plus, MessageCircle, Send, Clock, Bot, Link2, ShoppingBag, TrendingUp, Heart, Users, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AutomationTemplate {
  id: string;
  title: string;
  description: string;
  badge?: "POPULAR" | "PRO" | "NOVO";
  type: "Quick Automation" | "Flow Builder";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  category: "leads" | "trafego" | "engajamento" | "seguidores";
  trigger: "comment_keyword" | "any_comment" | "story_mention";
  triggerLabel: string; // "Comentário na publicação", "DM", "Resposta ao story"
  keywords?: string[];
  flow: {
    name: string;
    steps: Array<{
      type: "reply_comment" | "send_dm" | "delay";
      message: string;
      delay_seconds?: number;
    }>;
  };
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "send-link-dm",
    title: "Enviar links automaticamente por DM no comentário",
    description: "Envie um link sempre que alguém comentar em uma publicação ou reel",
    badge: "POPULAR",
    type: "Quick Automation",
    icon: Link2,
    category: "trafego",
    trigger: "comment_keyword",
    triggerLabel: "Comentário na publicação",
    keywords: ["link", "quero", "info"],
    flow: {
      name: "Enviar link via DM",
      steps: [
        { type: "reply_comment", message: "Te mandei no Direct! 📩 ||| Acabei de te enviar a info no Direct ✨" },
        { type: "delay", message: "", delay_seconds: 3 },
        { type: "send_dm", message: "Oi {{nome}}! 👋\n\nAqui está o link que pediu:\n👉 https://seulink.com\n\nQualquer dúvida me chama! 💬" },
      ],
    },
  },
  {
    id: "leads-stories",
    title: "Gere leads com stories",
    description: "Aproveite ofertas exclusivas nos Stories para transformar leads em clientes",
    type: "Quick Automation",
    icon: TrendingUp,
    category: "leads",
    trigger: "story_mention",
    triggerLabel: "Resposta ao story",
    flow: {
      name: "Captura de leads via Story",
      steps: [
        { type: "send_dm", message: "Oi {{nome}}! Vi que respondeu meu story 🎁\n\nTenho uma oferta exclusiva pra você. Quer saber mais?" },
      ],
    },
  },
  {
    id: "reply-all-dms",
    title: "Responda todas as suas DMs",
    description: "Envie respostas automaticamente quando alguém te enviar uma DM",
    type: "Quick Automation",
    icon: MessageCircle,
    category: "engajamento",
    trigger: "any_comment",
    triggerLabel: "DM",
    flow: {
      name: "Resposta automática DMs",
      steps: [
        { type: "send_dm", message: "Oi {{nome}}! Recebi sua mensagem 💬\n\nEm breve te respondo pessoalmente. Enquanto isso, dá uma olhada nos meus destaques! ✨" },
      ],
    },
  },
  {
    id: "grow-followers-comments",
    title: "Aumente seus seguidores com comentários",
    description: "Use comentários do Instagram para fazer sua conta crescer",
    badge: "PRO",
    type: "Quick Automation",
    icon: Users,
    category: "seguidores",
    trigger: "any_comment",
    triggerLabel: "Comentário em tempo real",
    flow: {
      name: "Engajamento para crescimento",
      steps: [
        { type: "reply_comment", message: "Obrigado pelo comentário, {{nome}}! ❤️ ||| Que comentário incrível! 🚀 ||| Adorei sua participação 🙌" },
        { type: "delay", message: "", delay_seconds: 5 },
        { type: "send_dm", message: "Oi {{nome}}! Vi seu comentário e quis te agradecer 💜\n\nMe segue por lá pra mais conteúdo? Tô postando coisas novas toda semana!" },
      ],
    },
  },
  {
    id: "affiliate-products",
    title: "Enviar links de produtos afiliados",
    description: "Inclua um cartão do produto com fotos e links das suas colaborações de afiliado",
    type: "Quick Automation",
    icon: ShoppingBag,
    category: "trafego",
    trigger: "comment_keyword",
    triggerLabel: "Comentário na publicação",
    keywords: ["preço", "comprar", "link", "onde"],
    flow: {
      name: "Link de produto afiliado",
      steps: [
        { type: "reply_comment", message: "Te mandei no DM! 🛍️" },
        { type: "delay", message: "", delay_seconds: 2 },
        { type: "send_dm", message: "Oi {{nome}}! 💝\n\nAqui está o link do produto:\n👉 https://seulink.com\n\n*Cupom de desconto:* PRIME10\n\nQualquer dúvida me chama! ✨" },
      ],
    },
  },
  {
    id: "ai-conversation",
    title: "Automatize conversas com IA",
    description: "Deixe a IA te ajudar a mostrar suas ofertas e recomendar produtos — tudo automatizado",
    type: "Flow Builder",
    icon: Bot,
    category: "engajamento",
    trigger: "any_comment",
    triggerLabel: "DM",
    flow: {
      name: "Atendimento com IA",
      steps: [
        { type: "send_dm", message: "Oi {{nome}}! Sou o assistente virtual 🤖\n\nComo posso te ajudar hoje?\n\n1️⃣ Conhecer produtos\n2️⃣ Ver ofertas\n3️⃣ Tirar dúvidas" },
      ],
    },
  },
  {
    id: "leads-stories-2",
    title: "Gere leads dos stories",
    description: "Use ofertas por tempo limitado nos Stories para converter leads",
    type: "Flow Builder",
    icon: Megaphone,
    category: "leads",
    trigger: "story_mention",
    triggerLabel: "Resposta ao story",
    flow: {
      name: "Oferta por tempo limitado",
      steps: [
        { type: "send_dm", message: "🔥 Vi sua resposta no story, {{nome}}!\n\n⏰ A oferta acaba em 24h:\n👉 https://seulink.com\n\nGaranta o seu agora!" },
      ],
    },
  },
  {
    id: "reply-comments-via-dm",
    title: "Responda comentários via DM",
    description: "Envie uma linha de produtos usando DMs do Instagram",
    type: "Flow Builder",
    icon: Send,
    category: "trafego",
    trigger: "any_comment",
    triggerLabel: "Comentário na publicação",
    flow: {
      name: "Comentário → DM com produtos",
      steps: [
        { type: "reply_comment", message: "Obrigado, {{nome}}! Te mandei opções no Direct 💌" },
        { type: "delay", message: "", delay_seconds: 3 },
        { type: "send_dm", message: "Oi {{nome}}! Aqui estão nossos produtos: 🛍️\n\n• Produto 1: https://link1.com\n• Produto 2: https://link2.com\n• Produto 3: https://link3.com\n\nQual te interessou mais?" },
      ],
    },
  },
  {
    id: "engage-likes",
    title: "Curtidas geram engajamento",
    description: "Reaja a cada novo comentário com mensagens variadas para manter o engajamento alto",
    type: "Quick Automation",
    icon: Heart,
    category: "engajamento",
    trigger: "any_comment",
    triggerLabel: "Comentário em tempo real",
    flow: {
      name: "Engajamento contínuo",
      steps: [
        { type: "reply_comment", message: "❤️ ||| 🔥 ||| 🙌 ||| Obrigado! ||| Que demais! ✨ ||| Adorei! 🚀" },
      ],
    },
  },
];

const CATEGORIES = [
  { id: "all", label: "Todos os modelos" },
  { id: "_objective_header", label: "Por objetivo", header: true },
  { id: "seguidores", label: "Aumente seus seguidores" },
  { id: "engajamento", label: "Engaje seu público" },
  { id: "trafego", label: "Direcionar tráfego" },
  { id: "_trigger_header", label: "Por gatilho", header: true },
  { id: "trigger:comment_keyword", label: "Comentário na publicação" },
  { id: "trigger:any_comment", label: "DM" },
  { id: "trigger:story_mention", label: "Resposta ao story" },
  { id: "trigger:realtime", label: "Comentário em tempo real" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: AutomationTemplate) => void;
  onStartBlank: () => void;
}

export function AutomationTemplatesModal({ open, onOpenChange, onSelect, onStartBlank }: Props) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const filtered = useMemo(() => {
    let list = AUTOMATION_TEMPLATES;
    if (activeCategory.startsWith("trigger:")) {
      const trig = activeCategory.replace("trigger:", "");
      if (trig === "realtime") {
        list = list.filter((t) => t.triggerLabel.toLowerCase().includes("tempo real"));
      } else {
        list = list.filter((t) => t.trigger === trig);
      }
    } else if (activeCategory !== "all") {
      list = list.filter((t) => t.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [search, activeCategory]);

  const recommended = filtered.slice(0, 3);
  const more = filtered.slice(3);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-xl font-display">Modelos</DialogTitle>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              onOpenChange(false);
              onStartBlank();
            }}
          >
            <Plus size={14} /> Começar Do Zero
          </Button>
        </DialogHeader>

        <div className="px-6 pt-4 pb-3 border-b">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar modelos do Instagram..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
        </div>

        <div className="grid grid-cols-[220px_1fr] flex-1 min-h-0">
          {/* Sidebar */}
          <ScrollArea className="border-r max-h-[60vh]">
            <div className="p-3 space-y-1">
              {CATEGORIES.map((cat) =>
                cat.header ? (
                  <p
                    key={cat.id}
                    className="px-3 pt-4 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                  >
                    {cat.label}
                  </p>
                ) : (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                      activeCategory === cat.id
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    {cat.label}
                  </button>
                )
              )}
            </div>
          </ScrollArea>

          {/* Templates grid */}
          <ScrollArea className="max-h-[60vh]">
            <div className="p-6 space-y-6">
              {recommended.length > 0 && (
                <section>
                  <h3 className="text-base font-semibold mb-3">Recomendados</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {recommended.map((tpl) => (
                      <TemplateCard key={tpl.id} template={tpl} onSelect={onSelect} onClose={() => onOpenChange(false)} />
                    ))}
                  </div>
                </section>
              )}
              {more.length > 0 && (
                <section>
                  <h3 className="text-base font-semibold mb-3">Descubra mais modelos</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {more.map((tpl) => (
                      <TemplateCard key={tpl.id} template={tpl} onSelect={onSelect} onClose={() => onOpenChange(false)} />
                    ))}
                  </div>
                </section>
              )}
              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Sparkles size={32} className="mb-3 opacity-30" />
                  <p className="text-sm">Nenhum modelo encontrado</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({
  template,
  onSelect,
  onClose,
}: {
  template: AutomationTemplate;
  onSelect: (t: AutomationTemplate) => void;
  onClose: () => void;
}) {
  const Icon = template.icon;
  return (
    <button
      onClick={() => {
        onSelect(template);
        onClose();
      }}
      className="text-left rounded-xl border bg-card p-4 hover:border-primary hover:shadow-md transition-all group min-h-[180px] flex flex-col"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
          <Icon size={18} className="text-primary" />
        </div>
        {template.badge && (
          <Badge
            className={cn(
              "text-[10px] font-bold",
              template.badge === "POPULAR" && "bg-orange-500 hover:bg-orange-500 text-white",
              template.badge === "PRO" && "bg-blue-600 hover:bg-blue-600 text-white",
              template.badge === "NOVO" && "bg-emerald-500 hover:bg-emerald-500 text-white"
            )}
          >
            {template.badge}
          </Badge>
        )}
      </div>
      <h4 className="font-semibold text-sm leading-snug mb-2 line-clamp-2">{template.title}</h4>
      <p className="text-xs text-muted-foreground line-clamp-3 flex-1">{template.description}</p>
      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t">
        {template.type === "Quick Automation" ? (
          <Zap size={11} className="text-muted-foreground" />
        ) : (
          <Sparkles size={11} className="text-muted-foreground" />
        )}
        <span className="text-[11px] text-muted-foreground">{template.type}</span>
      </div>
    </button>
  );
}
