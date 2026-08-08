import { json } from "../lib/auth.js";

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function firstProductImage(html) {
  const metaPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i
  ];
  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }

  const jsonImage = html.match(/"image"\s*:\s*(?:\[\s*)?["'](https?:\\?\/\\?\/[^"']+)["']/i);
  if (jsonImage?.[1]) return decodeHtml(jsonImage[1].replace(/\\\//g, "/"));
  return "";
}

async function productImage(request, response, rawSku) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return json(response, 405, { error: "Méthode non permise" });
  }

  const sku = String(rawSku || "").replace(/\D/g, "");
  if (!/^(?:1000|1001)\d{6}$/.test(sku)) {
    return json(response, 400, { error: "Numéro d’article Home Depot invalide" });
  }

  const productUrl = `https://www.homedepot.ca/product/${sku}`;
  try {
    const upstream = await fetch(productUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GestionStockHD/1.0; +https://github.com/nathanbegin/GestionStockHD)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-CA,fr;q=0.9,en;q=0.7"
      }
    });

    if (!upstream.ok) {
      return json(response, upstream.status === 404 ? 404 : 502, {
        error: upstream.status === 404 ? "Produit introuvable" : "Home Depot ne répond pas correctement",
        productUrl
      });
    }

    const html = await upstream.text();
    const imageUrl = firstProductImage(html);
    if (!imageUrl) {
      return json(response, 404, { error: "Image produit introuvable", productUrl: upstream.url || productUrl });
    }

    response.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return json(response, 200, { sku, imageUrl, productUrl: upstream.url || productUrl });
  } catch {
    return json(response, 502, { error: "Impossible de joindre Home Depot", productUrl });
  }
}

export default async function handler(request, response) {
  if (request.query?.sku) return productImage(request, response, request.query.sku);

  const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  const authConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
  return json(response, 200, {
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    supabaseConfigured,
    authConfigured,
    realtimeConfigured: authConfigured,
    photoStorageConfigured: supabaseConfigured,
    bootstrapConfigured: Boolean(process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.APP_PIN),
    time: new Date().toISOString()
  });
}
