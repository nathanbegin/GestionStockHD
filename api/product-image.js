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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non permise" });
  }

  const sku = String(req.query?.sku || "").replace(/\D/g, "");
  if (!/^(?:1000|1001)\d{6}$/.test(sku)) {
    return res.status(400).json({ error: "Numéro d’article Home Depot invalide" });
  }

  const productUrl = `https://www.homedepot.ca/product/${sku}`;
  try {
    const response = await fetch(productUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GestionStockHD/1.0; +https://github.com/nathanbegin/GestionStockHD)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-CA,fr;q=0.9,en;q=0.7"
      }
    });

    if (!response.ok) {
      return res.status(response.status === 404 ? 404 : 502).json({
        error: response.status === 404 ? "Produit introuvable" : "Home Depot ne répond pas correctement",
        productUrl
      });
    }

    const html = await response.text();
    const imageUrl = firstProductImage(html);
    if (!imageUrl) {
      return res.status(404).json({ error: "Image produit introuvable", productUrl: response.url || productUrl });
    }

    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json({ sku, imageUrl, productUrl: response.url || productUrl });
  } catch {
    return res.status(502).json({ error: "Impossible de joindre Home Depot", productUrl });
  }
}
