import { useCallback, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlignLeft, ArrowDown, ArrowUp, Clock, Loader2, MessageSquareDashed, MousePointerClick,
  Paperclip, Play, Plus, Trash2, Upload, Workflow,
} from "lucide-react";

/**
 * Blocos suportados dentro de uma sequência (formato "Data Crazy"):
 * um único cartão empilhando atrasos, textos, arquivos, botões e espera de resposta.
 */
export type SequenceBlockType = "delay" | "text" | "media" | "buttons" | "user_input";

export interface SequenceBlock {
  id: string;
  type: SequenceBlockType;
  /** delay: duração em segundos */
  seconds?: number;
  /** text / buttons: corpo da mensagem. media: legenda */
  text?: string;
  /** media */
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  fileName?: string;
  /** buttons: títulos dos botões (máx. 3 na Meta) */
  buttons?: string[];
  /** user_input: minutos de espera antes de seguir sem resposta */
  timeoutMinutes?: number;
}

export interface GeneratedSequenceStep {
  type: "message" | "delay" | "interactive_buttons" | "no_response";
  data: Record<string, unknown>;
}

const BLOCK_META: Record<SequenceBlockType, { label: string; description: string; icon: typeof Clock }> = {
  delay: { label: "Atraso de tempo", description: "Aguarda antes do próximo bloco", icon: Clock },
  text: { label: "Mensagem de texto", description: "Envia um texto simples", icon: AlignLeft },
  media: { label: "Arquivo anexo", description: "Imagem, áudio, vídeo ou documento", icon: Paperclip },
  buttons: { label: "Botões", description: "Mensagem com botões de resposta", icon: MousePointerClick },
  user_input: { label: "Entrada do usuário", description: "Espera a resposta do contato", icon: MessageSquareDashed },
};

const newBlock = (type: SequenceBlockType): SequenceBlock => {
  const base: SequenceBlock = { id: crypto.randomUUID(), type };
  if (type === "delay") return { ...base, seconds: 30 };
  if (type === "text") return { ...base, text: "" };
  if (type === "media") return { ...base, text: "", mediaUrl: "", mediaType: "image" };
  if (type === "buttons") return { ...base, text: "", buttons: ["Continuar"] };
  return { ...base, timeoutMinutes: 10 };
};

const guessMediaType = (file: File): SequenceBlock["mediaType"] => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
};

/** Converte os blocos visuais nos passos reais do motor de fluxos. */
export const compileSequence = (blocks: SequenceBlock[]): GeneratedSequenceStep[] => {
  const steps: GeneratedSequenceStep[] = [];

  for (const block of blocks) {
    if (block.type === "delay") {
      const seconds = Math.max(1, Number(block.seconds) || 1);
      steps.push({
        type: "delay",
        data: { delay_minutes: 0, delay_min_seconds: seconds, delay_max_seconds: seconds },
      });
      continue;
    }

    if (block.type === "text") {
      steps.push({
        type: "message",
        data: {
          custom_message: block.text?.trim() || "",
          template_id: null,
          media_url: null,
          media_type: null,
          message_variations: [],
          template_variations: [],
        },
      });
      continue;
    }

    if (block.type === "media") {
      steps.push({
        type: "message",
        data: {
          custom_message: block.text?.trim() || "",
          template_id: null,
          media_url: block.mediaUrl || null,
          media_type: block.mediaType || null,
          file_name: block.fileName || null,
          message_variations: [],
          template_variations: [],
        },
      });
      continue;
    }

    if (block.type === "buttons") {
      steps.push({
        type: "interactive_buttons",
        data: {
          custom_message: block.text?.trim() || "",
          buttons: (block.buttons || [])
            .filter((title) => title && title.trim())
            .slice(0, 3)
            .map((title) => ({ id: crypto.randomUUID(), title: title.trim() })),
        },
      });
      continue;
    }

    steps.push({
      type: "no_response",
      data: { timeout_minutes: Math.max(1, Number(block.timeoutMinutes) || 10) },
    });
  }

  return steps;
};

interface SequenceComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recebe os passos compilados, na ordem, para virarem nós encadeados no canvas. */
  onGenerate: (steps: GeneratedSequenceStep[]) => void;
}

export function SequenceComposer({ open, onOpenChange, onGenerate }: SequenceComposerProps) {
  const [blocks, setBlocks] = useState<SequenceBlock[]>([
    newBlock("text"),
  ]);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const update = useCallback((id: string, patch: Partial<SequenceBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const remove = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const move = useCallback((id: string, direction: -1 | 1) => {
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const handleUpload = useCallback(async (blockId: string, file: File) => {
    if (file.size > 90 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx. 90MB).");
      return;
    }
    setUploadingId(blockId);
    try {
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      const path = `flow-sequence/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("chat-media")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (uploadError) throw uploadError;

      const { data: signed, error: signError } = await supabase.storage
        .from("chat-media")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signError) throw signError;

      update(blockId, {
        mediaUrl: signed?.signedUrl || "",
        mediaType: guessMediaType(file),
        fileName: file.name,
      });
      toast.success("Arquivo anexado.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Falha no upload.");
    } finally {
      setUploadingId(null);
    }
  }, [update]);

  const compiled = useMemo(() => compileSequence(blocks), [blocks]);

  const handleGenerate = () => {
    if (!blocks.length) {
      toast.error("Adicione pelo menos um bloco na sequência.");
      return;
    }
    const invalidText = blocks.find(
      (b) => (b.type === "text" || b.type === "buttons") && !b.text?.trim()
    );
    if (invalidText) {
      toast.error("Preencha o texto de todos os blocos de mensagem.");
      return;
    }
    const invalidMedia = blocks.find((b) => b.type === "media" && !b.mediaUrl);
    if (invalidMedia) {
      toast.error("Anexe o arquivo dos blocos de mídia (ou remova o bloco).");
      return;
    }

    onGenerate(compiled);
    onOpenChange(false);
    setBlocks([newBlock("text")]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Workflow size={16} className="text-primary" /> Sequência de mensagens
          </DialogTitle>
          <DialogDescription>
            Monte a sequência empilhando blocos na ordem de execução — atrasos, textos, arquivos,
            botões e espera de resposta. Ao gerar, cada bloco vira um passo encadeado no fluxo.
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-[1fr_240px] max-h-[65vh]">
          {/* Cartão da sequência */}
          <ScrollArea className="max-h-[65vh]">
            <div className="p-5">
              <div className="rounded-xl border border-border bg-card">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <Play size={14} className="text-primary" />
                  <span className="text-sm font-medium">Mensagem</span>
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {compiled.length} passo(s)
                  </Badge>
                </div>

                <div className="p-3 space-y-2">
                  {blocks.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      Nenhum bloco. Use o painel ao lado para adicionar.
                    </p>
                  )}

                  {blocks.map((block, index) => {
                    const meta = BLOCK_META[block.type];
                    const Icon = meta.icon;
                    return (
                      <div
                        key={block.id}
                        className={cn(
                          "rounded-lg border border-border bg-muted/40 px-3 py-2.5 space-y-2",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Icon size={14} className="text-muted-foreground shrink-0" />
                          <span className="text-xs font-medium">{meta.label}</span>
                          <span className="text-[10px] text-muted-foreground">#{index + 1}</span>
                          <div className="ml-auto flex items-center gap-0.5">
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6"
                              onClick={() => move(block.id, -1)}
                              disabled={index === 0}
                              aria-label="Mover para cima"
                            >
                              <ArrowUp size={12} />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6"
                              onClick={() => move(block.id, 1)}
                              disabled={index === blocks.length - 1}
                              aria-label="Mover para baixo"
                            >
                              <ArrowDown size={12} />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              onClick={() => remove(block.id)}
                              aria-label="Remover bloco"
                            >
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </div>

                        {block.type === "delay" && (
                          <div className="flex items-center gap-2">
                            <Label className="text-[11px] text-muted-foreground">Segundos</Label>
                            <Input
                              type="number" min={1}
                              className="h-8 w-24 text-xs"
                              value={block.seconds ?? 30}
                              onChange={(e) => update(block.id, { seconds: Number(e.target.value) })}
                            />
                          </div>
                        )}

                        {(block.type === "text" || block.type === "buttons") && (
                          <Textarea
                            className="text-xs min-h-[64px]"
                            placeholder="Escreva a mensagem... use {nome} para o nome do lead"
                            value={block.text ?? ""}
                            onChange={(e) => update(block.id, { text: e.target.value })}
                          />
                        )}

                        {block.type === "buttons" && (
                          <div className="space-y-1.5">
                            {(block.buttons || []).map((title, btnIndex) => (
                              <div key={btnIndex} className="flex items-center gap-1.5">
                                <Input
                                  className="h-8 text-xs"
                                  placeholder={`Botão ${btnIndex + 1}`}
                                  value={title}
                                  onChange={(e) => {
                                    const next = [...(block.buttons || [])];
                                    next[btnIndex] = e.target.value;
                                    update(block.id, { buttons: next });
                                  }}
                                />
                                <Button
                                  variant="ghost" size="icon" className="h-8 w-8"
                                  onClick={() =>
                                    update(block.id, {
                                      buttons: (block.buttons || []).filter((_, i) => i !== btnIndex),
                                    })
                                  }
                                  aria-label="Remover botão"
                                >
                                  <Trash2 size={12} />
                                </Button>
                              </div>
                            ))}
                            {(block.buttons?.length || 0) < 3 && (
                              <Button
                                variant="outline" size="sm" className="h-7 text-xs gap-1"
                                onClick={() =>
                                  update(block.id, { buttons: [...(block.buttons || []), ""] })
                                }
                              >
                                <Plus size={11} /> Botão
                              </Button>
                            )}
                          </div>
                        )}

                        {block.type === "media" && (
                          <div className="space-y-2">
                            <input
                              ref={(el) => { fileInputs.current[block.id] = el; }}
                              type="file"
                              accept="*/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleUpload(block.id, file);
                                e.target.value = "";
                              }}
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline" size="sm" className="h-8 text-xs gap-1.5"
                                disabled={uploadingId === block.id}
                                onClick={() => fileInputs.current[block.id]?.click()}
                              >
                                {uploadingId === block.id ? (
                                  <><Loader2 size={12} className="animate-spin" /> Enviando...</>
                                ) : (
                                  <><Upload size={12} /> {block.mediaUrl ? "Trocar arquivo" : "Anexar arquivo"}</>
                                )}
                              </Button>
                              {block.fileName && (
                                <span className="text-[11px] text-muted-foreground truncate">
                                  {block.fileName} · {block.mediaType}
                                </span>
                              )}
                            </div>
                            <Textarea
                              className="text-xs min-h-[48px]"
                              placeholder="Legenda (opcional)"
                              value={block.text ?? ""}
                              onChange={(e) => update(block.id, { text: e.target.value })}
                            />
                          </div>
                        )}

                        {block.type === "user_input" && (
                          <div className="flex items-center gap-2">
                            <Label className="text-[11px] text-muted-foreground">
                              Seguir sem resposta após (min)
                            </Label>
                            <Input
                              type="number" min={1}
                              className="h-8 w-24 text-xs"
                              value={block.timeoutMinutes ?? 10}
                              onChange={(e) => update(block.id, { timeoutMinutes: Number(e.target.value) })}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </ScrollArea>

          {/* Painel de blocos */}
          <div className="border-t md:border-t-0 md:border-l border-border p-4 space-y-2 bg-muted/20">
            <p className="text-xs font-medium text-muted-foreground">Adicionar bloco</p>
            {(Object.keys(BLOCK_META) as SequenceBlockType[]).map((type) => {
              const meta = BLOCK_META[type];
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setBlocks((prev) => [...prev, newBlock(type)])}
                  className="w-full text-left rounded-lg border border-border bg-card px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                >
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <Icon size={13} className="text-primary" /> {meta.label}
                  </span>
                  <span className="block text-[10px] text-muted-foreground mt-0.5">
                    {meta.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleGenerate} className="gap-1.5">
            <Plus size={13} /> Adicionar ao fluxo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
