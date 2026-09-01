import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recusaDeMidia } from "../_shared/media-limits.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const leadId = formData.get("lead_id") as string;
    // Figurinha: o cliente marca explicitamente para não cair como imagem comum.
    const asSticker = String(formData.get("as_sticker") || "") === "1";

    if (!file || !leadId) {
      return new Response(
        JSON.stringify({ error: "file and lead_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine media type
    let mediaType = "document";
    if (asSticker) {
      // A Meta só aceita figurinha em WebP; estático até 100KB.
      const isWebp = file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp");
      if (!isWebp) {
        return new Response(
          JSON.stringify({ error: "Figurinha precisa ser um arquivo .webp" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (file.size > 500 * 1024) {
        return new Response(
          JSON.stringify({ error: "Figurinha muito grande (máx. 500KB; estáticas até 100KB)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      mediaType = "sticker";
    }
    else if (file.type.startsWith("image/")) mediaType = "image";
    else if (file.type.startsWith("audio/")) mediaType = "audio";
    else if (file.type.startsWith("video/")) mediaType = "video";

    // Recusar aqui, antes de subir. O caminho antigo aceitava qualquer
    // `video/*`, gravava no storage e mandava por link — e a Meta recusava
    // depois, em inglês e por código. Com vídeo isso é pior que com áudio: a
    // pessoa espera o upload de dezenas de MB para só então descobrir que o
    // formato nunca serviu.
    const recusa = recusaDeMidia(mediaType, file.type, file.name, file.size);
    if (recusa) {
      return new Response(
        JSON.stringify({ error: recusa }),
        { status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ext = file.name.split(".").pop() || "bin";
    const path = asSticker
      ? `stickers/${leadId}/${crypto.randomUUID()}.webp`
      : `outgoing/${leadId}/${crypto.randomUUID()}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(path, arrayBuffer, { contentType: asSticker ? "image/webp" : file.type, upsert: true });

    if (uploadError) throw uploadError;

    const { data: signed, error: signErr } = await supabase.storage
      .from("chat-media")
      .createSignedUrl(path, 60 * 60 * 24 * 365);

    if (signErr || !signed?.signedUrl) throw signErr || new Error("Falha ao gerar URL assinada");

    return new Response(
      JSON.stringify({
        success: true,
        url: signed.signedUrl,
        media_type: mediaType,
        file_name: file.name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error uploading media:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
