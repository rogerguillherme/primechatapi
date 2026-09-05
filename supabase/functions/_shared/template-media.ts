// Mirrors a WhatsApp template's example header asset into public storage.
//
// Why: template headers expose their sample media as a signed, short-lived
// scontent.whatsapp.net URL. Meta's own media downloader frequently fails to
// fetch that URL when it is passed back as a header `link`, which makes the
// send fail (#131053 / #132012) or get accepted but never delivered.
// Re-hosting the asset on a stable public URL fixes it.

const BUCKET = "chat-media";
const PREFIX = "template-headers";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

function needsMirror(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.endsWith("whatsapp.net") || host.endsWith("fbcdn.net") || host.endsWith("cdninstagram.com");
  } catch {
    return false;
  }
}

/**
 * Returns a stable, publicly fetchable URL for the template header media.
 * Falls back to the original URL if mirroring is not possible.
 */
export async function resolveTemplateHeaderLink(
  supabase: any,
  originalUrl: string,
  cacheKey: string,
  format: "image" | "video" | "document",
): Promise<string> {
  if (!originalUrl || !needsMirror(originalUrl)) return originalUrl;

  const safeKey = cacheKey.replace(/[^a-zA-Z0-9._-]/g, "_");

  try {
    const res = await fetch(originalUrl);
    if (!res.ok) {
      console.error("Template header mirror: download failed", res.status);
      return originalUrl;
    }
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
    const ext = EXT_BY_MIME[contentType] || (format === "image" ? "jpg" : format === "video" ? "mp4" : "pdf");
    const path = `${PREFIX}/${safeKey}.${ext}`;
    const bytes = new Uint8Array(await res.arrayBuffer());

    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: contentType || "application/octet-stream",
      upsert: true,
    });
    if (error) {
      console.error("Template header mirror: upload failed", error.message);
      return originalUrl;
    }

    // Bucket is private: Meta fetches the asset through a long-lived signed URL.
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    return data?.signedUrl || originalUrl;
  } catch (e) {
    console.error("Template header mirror: unexpected error", e);
    return originalUrl;
  }
}
