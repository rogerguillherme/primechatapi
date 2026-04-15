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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get active connection
    const { data: connection } = await adminClient
      .from("instagram_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "connected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!connection) {
      return new Response(JSON.stringify({ error: "Nenhuma conta Instagram conectada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = connection.access_token;
    const igUserId = connection.instagram_user_id;

    // Fetch profile info
    const profileRes = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}?fields=id,username,name,profile_picture_url,followers_count,follows_count,media_count,biography&access_token=${accessToken}`
    );
    const profile = await profileRes.json();

    if (!profileRes.ok) {
      console.error("Profile fetch failed:", profile);
      return new Response(JSON.stringify({ error: "Erro ao buscar perfil", details: profile }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch recent media with comments
    let media: any[] = [];
    try {
      const mediaRes = await fetch(
        `https://graph.facebook.com/v19.0/${igUserId}/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink,comments{id,text,username,timestamp,like_count}&limit=20&access_token=${accessToken}`
      );
      const mediaData = await mediaRes.json();
      if (mediaRes.ok && mediaData?.data) {
        media = mediaData.data;
      }
    } catch (e) {
      console.error("Media fetch error:", e);
    }

    // Fetch insights (last 30 days) - only for business accounts
    let insights: any = null;
    try {
      const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
      const until = Math.floor(Date.now() / 1000);
      const insightsRes = await fetch(
        `https://graph.facebook.com/v19.0/${igUserId}/insights?metric=impressions,reach,profile_views&period=day&since=${since}&until=${until}&access_token=${accessToken}`
      );
      const insightsData = await insightsRes.json();
      if (insightsRes.ok && insightsData?.data) {
        insights = {};
        for (const metric of insightsData.data) {
          const total = metric.values?.reduce((sum: number, v: any) => sum + (v.value || 0), 0) || 0;
          insights[metric.name] = total;
        }
      }
    } catch (e) {
      console.error("Insights fetch error:", e);
    }

    // Fetch conversations count
    let conversationCount = 0;
    try {
      const convRes = await fetch(
        `https://graph.facebook.com/v19.0/${igUserId}/conversations?fields=id&limit=0&access_token=${accessToken}`
      );
      const convData = await convRes.json();
      // The summary or data length gives us a count
      conversationCount = convData?.data?.length || 0;
    } catch (e) {
      console.error("Conversations fetch error:", e);
    }

    return new Response(
      JSON.stringify({
        profile: {
          id: profile.id,
          username: profile.username,
          name: profile.name,
          profile_picture_url: profile.profile_picture_url,
          followers_count: profile.followers_count || 0,
          follows_count: profile.follows_count || 0,
          media_count: profile.media_count || 0,
          biography: profile.biography || "",
        },
        media,
        insights,
        conversation_count: conversationCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Instagram fetch data error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
