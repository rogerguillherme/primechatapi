// O que a Meta aceita em cada tipo de mídia.
//
// Sem conferir aqui, o arquivo sobe inteiro para o storage, o envio sai, e a
// recusa chega depois — em inglês, com código numérico, e às vezes só de forma
// assíncrona. Foi assim com o áudio: cinco rodadas para descobrir que o
// problema era o container. Vídeo tem exatamente a mesma armadilha, e é pior,
// porque o operador espera o upload de dezenas de MB antes de saber.
//
// Limites da documentação da Cloud API (2026-09).

const REGRAS = {
  image: {
    mimes: ["image/jpeg", "image/png"],
    exts: ["jpg", "jpeg", "png"],
    maxBytes: 5 * 1024 * 1024,
    aceitos: "JPG e PNG",
  },
  video: {
    // A Meta aceita só estes dois containers. MOV do iPhone e WEBM do Chrome
    // são recusados, e é o que mais aparece na prática.
    mimes: ["video/mp4", "video/3gpp"],
    exts: ["mp4", "3gp", "3gpp"],
    maxBytes: 16 * 1024 * 1024,
    aceitos: "MP4 e 3GP",
  },
  audio: {
    mimes: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"],
    exts: ["aac", "m4a", "mp3", "amr", "ogg"],
    maxBytes: 16 * 1024 * 1024,
    aceitos: "AAC, M4A, MP3, AMR e OGG",
  },
  document: {
    mimes: null, // qualquer um
    exts: null,
    maxBytes: 100 * 1024 * 1024,
    aceitos: "qualquer arquivo",
  },
};

function mb(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`.replace(".", ",");
}

/**
 * @param {string} mediaType image | video | audio | document
 * @param {string} mime content-type do arquivo
 * @param {string} nome nome do arquivo (a extensão desempata quando o mime vem vazio)
 * @param {number} tamanho bytes
 * @returns {string|null} a recusa em português, ou null se estiver tudo certo
 */
export function recusaDeMidia(mediaType, mime, nome, tamanho) {
  const regra = REGRAS[mediaType];
  if (!regra) return null;

  if (typeof tamanho === "number" && tamanho > regra.maxBytes) {
    return (
      `Este arquivo tem ${mb(tamanho)} e o WhatsApp aceita no máximo ` +
      `${mb(regra.maxBytes)} para ${mediaType === "video" ? "vídeo" : mediaType === "audio" ? "áudio" : mediaType === "image" ? "imagem" : "documento"}. ` +
      `Reduza o arquivo e tente de novo.`
    );
  }

  if (!regra.mimes) return null;

  const base = String(mime || "").split(";")[0].trim().toLowerCase();
  const ext = String(nome || "").split("?")[0].split(".").pop()?.toLowerCase() || "";

  // O mime pode vir vazio ou genérico (application/octet-stream) dependendo do
  // navegador; a extensão é o segundo voto, não o primeiro.
  if (regra.mimes.includes(base)) return null;
  if (!base || base === "application/octet-stream") {
    if (regra.exts.includes(ext)) return null;
  }
  if (regra.exts.includes(ext) && base.startsWith(mediaType + "/")) return null;

  const oQueVeio = base || (ext ? `.${ext}` : "desconhecido");
  return (
    `O WhatsApp não aceita este formato (${oQueVeio}). ` +
    `Aceitos: ${regra.aceitos}.` +
    (mediaType === "video"
      ? " Vídeo de iPhone costuma vir em MOV e precisa ser convertido para MP4."
      : "")
  );
}

// Extensões de vídeo que a Meta com certeza recusa. É a lista do que aparece
// na prática — não é uma lista de "tudo que não é mp4".
const VIDEO_RECUSADO = {
  mov: "MOV (vídeo de iPhone)",
  webm: "WEBM",
  avi: "AVI",
  mkv: "MKV",
  wmv: "WMV",
  flv: "FLV",
  m4v: "M4V",
};

/**
 * Checagem para quando só se tem a URL — envio de fluxo, por exemplo.
 *
 * Deliberadamente mais estreita que `recusaDeMidia`: recusa só o que é
 * reconhecidamente inaceitável. URL sem extensão, ou com extensão que não
 * conhecemos, passa e a Meta decide — errar para o lado de recusar travaria
 * fluxo que hoje funciona, o que é pior que o problema.
 */
export function videoRecusadoPelaUrl(url) {
  const ext = String(url || "").split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() || "";
  const rotulo = VIDEO_RECUSADO[ext];
  if (!rotulo) return null;
  return `O WhatsApp não aceita vídeo em ${rotulo}. Converta para MP4 e atualize o passo do fluxo.`;
}
