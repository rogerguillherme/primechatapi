// Run: node supabase/functions/_shared/test_media-limits.mjs
import assert from "node:assert/strict";
import { recusaDeMidia, videoRecusadoPelaUrl } from "./media-limits.mjs";

const ok = (r) => assert.equal(r, null, `deveria passar, recusou: ${r}`);
const recusa = (r, trecho) => {
  assert.ok(r, "deveria recusar e passou");
  assert.ok(r.includes(trecho), `esperava "${trecho}" em: ${r}`);
};

// ── vídeo: o caso que motivou isto ──
ok(recusaDeMidia("video", "video/mp4", "clipe.mp4", 5_000_000));
ok(recusaDeMidia("video", "video/3gpp", "clipe.3gp", 1_000_000));

// MOV do iPhone e WEBM do Chrome são os dois que mais aparecem.
recusa(recusaDeMidia("video", "video/quicktime", "IMG_0042.MOV", 4_000_000), "MOV");
recusa(recusaDeMidia("video", "video/webm", "gravacao.webm", 4_000_000), "não aceita este formato");

// Tamanho: o limite da Meta para vídeo é 16 MB.
recusa(recusaDeMidia("video", "video/mp4", "longo.mp4", 40 * 1024 * 1024), "40 MB");
ok(recusaDeMidia("video", "video/mp4", "limite.mp4", 16 * 1024 * 1024));

// Mime vazio ou genérico: a extensão decide.
ok(recusaDeMidia("video", "", "clipe.mp4", 1_000));
ok(recusaDeMidia("video", "application/octet-stream", "clipe.mp4", 1_000));
recusa(recusaDeMidia("video", "", "clipe.mkv", 1_000), "não aceita este formato");

// ── imagem ──
ok(recusaDeMidia("image", "image/jpeg", "foto.jpg", 1_000_000));
recusa(recusaDeMidia("image", "image/heic", "foto.heic", 1_000_000), "JPG e PNG");
recusa(recusaDeMidia("image", "image/png", "grande.png", 9 * 1024 * 1024), "imagem");

// ── áudio ──
ok(recusaDeMidia("audio", "audio/ogg", "voz.ogg", 200_000));
recusa(recusaDeMidia("audio", "audio/webm", "voz.webm", 200_000), "não aceita este formato");

// ── documento: qualquer formato, só o tamanho importa ──
ok(recusaDeMidia("document", "application/pdf", "contrato.pdf", 50 * 1024 * 1024));
ok(recusaDeMidia("document", "application/x-coisa", "arquivo.xyz", 1_000));
recusa(recusaDeMidia("document", "application/pdf", "enorme.pdf", 200 * 1024 * 1024), "documento");

// Tipo desconhecido não inventa regra.
ok(recusaDeMidia("sticker", "image/webp", "s.webp", 90_000));

// ── checagem por URL (envio de fluxo) ──
// Só recusa o que é reconhecidamente inaceitável.
recusa(videoRecusadoPelaUrl("https://x.co/a/IMG_1.MOV?token=abc"), "MOV");
recusa(videoRecusadoPelaUrl("https://x.co/a/v.webm"), "WEBM");

ok(videoRecusadoPelaUrl("https://x.co/a/v.mp4?token=abc"));
ok(videoRecusadoPelaUrl("https://x.co/a/v.3gp"));

// Sem extensão ou com extensão desconhecida, passa: recusar aqui travaria
// fluxo que funciona, o que é pior que deixar a Meta decidir.
ok(videoRecusadoPelaUrl("https://x.co/storage/abc123"));
ok(videoRecusadoPelaUrl("https://x.co/a/v.ogv"));
ok(videoRecusadoPelaUrl(""));

console.log("media-limits: all assertions passed");
