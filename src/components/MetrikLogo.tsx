/**
 * Marca do Metrik.
 *
 * Três barras em arranjo de pódio: a do meio mais alta, a da esquerda em
 * segundo, a da direita em terceiro. Lê como gráfico de barras e como pódio ao
 * mesmo tempo — que é a diferença entre este produto e um painel de analytics
 * qualquer. O Metrik não mostra números, ele classifica gente.
 *
 * Um troféu diria "prêmio" e não diria "medição"; barras crescendo da esquerda
 * para a direita diriam "medição" e não diriam "disputa". O pódio diz as duas.
 *
 * A barra do primeiro lugar carrega o acento; as outras herdam a cor do texto
 * ao redor, então a marca funciona sobre fundo claro e escuro sem duas versões.
 */
export function MetrikLogo({
  size = 32,
  accent = "#f59e0b",
  className,
}: {
  size?: number;
  accent?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Metrik"
    >
      {/* Segundo lugar */}
      <rect x="2.5" y="11" width="5" height="10" rx="1.6" fill="currentColor" opacity="0.45" />
      {/* Primeiro lugar — o único elemento com cor própria */}
      <rect x="9.5" y="4" width="5" height="17" rx="1.6" fill={accent} />
      {/* Terceiro lugar */}
      <rect x="16.5" y="14" width="5" height="7" rx="1.6" fill="currentColor" opacity="0.28" />
      {/* A linha de base fecha o pódio; sem ela as barras flutuam e viram
          três retângulos soltos. */}
      <rect x="1.5" y="21.6" width="21" height="1.6" rx="0.8" fill="currentColor" opacity="0.7" />
    </svg>
  );
}
