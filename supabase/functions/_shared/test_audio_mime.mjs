// Self-check do rótulo de mime do áudio.
// Errar aqui não quebra nada visivelmente: o upload falha, o envio cai no
// `link` e a mensagem chega ao cliente marcada como "encaminhada".
// Run: node supabase/functions/_shared/test_audio_mime.mjs
import assert from "node:assert/strict";

const AUDIO_MIME_BY_EXT = {
  mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4",
  aac: "audio/aac", amr: "audio/amr",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
};
const AUDIO_EXT_BY_MIME = {
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac",
  "audio/amr": "amr", "audio/ogg": "ogg",
};

function resolveAudioMime(rawType, ext) {
  const mime = AUDIO_EXT_BY_MIME[rawType] ? rawType : AUDIO_MIME_BY_EXT[ext];
  if (!mime) return null;
  return { mime, fileExt: AUDIO_EXT_BY_MIME[mime] };
}

// content-type confiável passa direto
assert.deepEqual(resolveAudioMime("audio/mpeg", "mp3"), { mime: "audio/mpeg", fileExt: "mp3" });
assert.deepEqual(resolveAudioMime("audio/mp4", "m4a"), { mime: "audio/mp4", fileExt: "m4a" });

// o bug que gerou o 131053: formato desconhecido era declarado como ogg, e a
// Meta recusava porque os bytes não eram ogg. Agora recusa antes de mentir.
assert.equal(resolveAudioMime("audio/webm", "webm"), null, "webm nao e aceito");
assert.equal(resolveAudioMime("application/octet-stream", "bin"), null, "extensao desconhecida");
assert.equal(resolveAudioMime("", ""), null, "sem tipo nem extensao");

// content-type inútil mas extensão conhecida: usa a extensão
assert.deepEqual(resolveAudioMime("application/octet-stream", "mp4"), { mime: "audio/mp4", fileExt: "m4a" });
assert.deepEqual(resolveAudioMime("", "m4a"), { mime: "audio/mp4", fileExt: "m4a" });
assert.deepEqual(resolveAudioMime("audio/webm", "m4a"), { mime: "audio/mp4", fileExt: "m4a" });
assert.deepEqual(resolveAudioMime("audio/x-m4a", "mp3"), { mime: "audio/mpeg", fileExt: "mp3" });

// extensão e mime sempre coerentes entre si
for (const [ext, mime] of Object.entries(AUDIO_MIME_BY_EXT)) {
  const r = resolveAudioMime("", ext);
  assert.equal(r.mime, mime, `ext ${ext}`);
  assert.equal(AUDIO_MIME_BY_EXT[r.fileExt], r.mime, `coerencia ${ext}`);
}

console.log("audio mime: all assertions passed");
