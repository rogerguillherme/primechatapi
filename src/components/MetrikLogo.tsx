/**
 * Marca do Métrik.
 *
 * A arte é a que o Roger enviou: o M em relevo com a seta de crescimento
 * atravessando e as barras subindo. Vem como PNG e não como SVG porque o
 * degradê e o brilho de relevo do original não sobrevivem a uma vetorização
 * feita no olho — e marca redesenhada "quase igual" fica pior que a original.
 *
 * O arquivo traz símbolo em cima e wordmark embaixo. Num cabeçalho de 30px o
 * wordmark viraria borrão, e o dele é verde quase preto: sobre o casco escuro
 * do app sumiria de vez. Então recortamos a faixa do símbolo e escrevemos
 * "Métrik" ao lado como texto — legível, acompanha o tema, e lido por leitor
 * de tela.
 */

/** Fração da altura da arte ocupada pelo símbolo, antes do wordmark começar. */
const FAIXA_SIMBOLO = 0.72;

export function MetrikLogo({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // Para a faixa do símbolo preencher o quadrado, a arte inteira precisa ser
  // maior que ele na mesma proporção — e recentrada, já que sobra dos lados.
  const escala = 1 / FAIXA_SIMBOLO;
  const sobra = (escala - 1) / 2;

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-block",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
      role="img"
      aria-label="Métrik"
    >
      <img
        src="/metrik-logo.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{
          position: "absolute",
          top: `-${sobra * 30}%`,
          left: `-${sobra * 100}%`,
          width: `${escala * 100}%`,
          height: "auto",
        }}
      />
    </span>
  );
}
