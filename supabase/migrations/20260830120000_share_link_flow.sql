-- Fluxo disparado pela frase do link de compartilhamento.
--
-- É o caso do anúncio: o criativo leva a um wa.me com frase pronta, o lead
-- manda essa frase e o atendimento já começa sozinho. O link de
-- compartilhamento já gerava a URL e o webhook já reconhecia a frase para
-- aplicar etiqueta e coluna — faltava iniciar o fluxo.
ALTER TABLE public.share_links
  ADD COLUMN IF NOT EXISTS flow_id uuid REFERENCES public.flows(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.share_links.flow_id IS
  'Fluxo iniciado quando a frase deste link chega como primeira mensagem.';
