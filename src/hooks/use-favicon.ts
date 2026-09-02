import { useEffect } from "react";

/**
 * Troca o ícone da aba enquanto a tela estiver montada.
 *
 * Dois produtos na mesma origem dividem o `index.html`, logo dividem o favicon
 * declarado nele. Quem deixa o Metrik aberto numa aba e o chat em outra vê o
 * mesmo ícone nas duas — e passa a abrir a aba errada.
 *
 * O ícone anterior é restaurado ao sair, senão voltar ao chat manteria o
 * ícone do Metrik até recarregar a página.
 *
 * Limite conhecido: alguns navegadores guardam o favicon com força e só
 * atualizam depois de um recarregamento. Não há como contornar isso do lado da
 * página, e é preferível a alternativa — servir dois domínios só por causa de
 * um ícone.
 */
export function useFavicon(href: string) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;

    const anterior = { href: link.href, type: link.type };
    link.href = href;
    link.type = href.endsWith(".svg") ? "image/svg+xml" : "image/png";

    return () => {
      link.href = anterior.href;
      link.type = anterior.type;
    };
  }, [href]);
}
