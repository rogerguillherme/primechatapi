import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Zap, MessageSquare, Clock, Trash2, Instagram } from "lucide-react";
import { toast } from "sonner";

interface Automation {
  id: string;
  name: string;
  trigger: string;
  response: string;
  active: boolean;
  delay_seconds: number;
}

export function InstagramAutomations() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("keyword");
  const [keyword, setKeyword] = useState("");
  const [response, setResponse] = useState("");
  const [delay, setDelay] = useState(0);

  const handleCreate = () => {
    if (!name || !response) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    const newAutomation: Automation = {
      id: crypto.randomUUID(),
      name,
      trigger: trigger === "keyword" ? `Palavra-chave: ${keyword}` : trigger === "story_reply" ? "Resposta ao Story" : "Nova mensagem",
      response,
      active: true,
      delay_seconds: delay,
    };
    setAutomations([...automations, newAutomation]);
    setShowForm(false);
    setName("");
    setKeyword("");
    setResponse("");
    setDelay(0);
    toast.success("Automação criada!");
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Automações do Instagram</h2>
          <p className="text-sm text-muted-foreground">
            Configure respostas automáticas para DMs, menções e stories
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="h-4 w-4" /> Nova Automação
        </Button>
      </div>

      {showForm && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">Nova Automação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome da automação</Label>
                <Input placeholder="Ex: Resposta boas-vindas" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Tipo de gatilho</Label>
                <Select value={trigger} onValueChange={setTrigger}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keyword">Palavra-chave</SelectItem>
                    <SelectItem value="story_reply">Resposta ao Story</SelectItem>
                    <SelectItem value="new_dm">Qualquer nova DM</SelectItem>
                    <SelectItem value="mention">Menção</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {trigger === "keyword" && (
              <div className="space-y-2">
                <Label>Palavra-chave</Label>
                <Input placeholder="Ex: preço, promoção, link" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              </div>
            )}

            <div className="space-y-2">
              <Label>Mensagem de resposta</Label>
              <Textarea placeholder="Digite a resposta automática..." value={response} onChange={(e) => setResponse(e.target.value)} rows={3} />
            </div>

            <div className="space-y-2">
              <Label>Atraso (segundos)</Label>
              <Input type="number" min={0} value={delay} onChange={(e) => setDelay(Number(e.target.value))} className="max-w-[120px]" />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleCreate}>Criar Automação</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {automations.length === 0 && !showForm ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Zap className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">Nenhuma automação configurada</p>
            <p className="text-sm text-muted-foreground mt-1">Crie automações para responder DMs automaticamente</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {automations.map((auto) => (
            <Card key={auto.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/10 to-pink-500/10 flex items-center justify-center">
                      <Instagram className="h-5 w-5 text-purple-500" />
                    </div>
                    <div>
                      <p className="font-medium">{auto.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-xs">{auto.trigger}</Badge>
                        {auto.delay_seconds > 0 && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Clock className="h-3 w-3" /> {auto.delay_seconds}s
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={auto.active}
                      onCheckedChange={(checked) =>
                        setAutomations(automations.map((a) => (a.id === auto.id ? { ...a, active: checked } : a)))
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setAutomations(automations.filter((a) => a.id !== auto.id))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2 pl-[52px]">
                  <MessageSquare className="h-3 w-3 inline mr-1" />
                  {auto.response}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
