import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    if (!file || !leadId) {
      return new Response(
        JSON.stringify({ error: "file and lead_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine media type
    let mediaType = "document";
    if (file.type.startsWith("image/")) mediaType = "image";
    else if (file.type.startsWith("audio/")) mediaType = "audio";
    else if (file.type.startsWith("video/")) mediaType = "video";

    const ext = file.name.split(".").pop() || "bin";
    const path = `outgoing/${leadId}/${crypto.randomUUID()}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(path, arrayBuffer, { contentType: file.type, upsert: true });

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
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
