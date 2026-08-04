import { isAuthorized, json } from "../lib/auth.js";

const MAX_DATA_URL_LENGTH = 4_000_000;
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sku: { type: ["string", "null"] },
    barcode: { type: ["string", "null"] },
    productName: { type: ["string", "null"] },
    visibleText: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: ["sku", "barcode", "productName", "visibleText", "summary", "confidence"]
};

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  if (!isAuthorized(request)) return json(response, 401, { error: "PIN invalide" });
  if (!process.env.OPENAI_API_KEY) return json(response, 503, { error: "OPENAI_API_KEY n’est pas configurée dans Vercel" });

  const image = request.body?.image;
  if (typeof image !== "string" || !image.startsWith("data:image/")) return json(response, 400, { error: "Image invalide" });
  if (image.length > MAX_DATA_URL_LENGTH) return json(response, 413, { error: "Image trop volumineuse" });

  try {
    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || "gpt-5.6",
        store: false,
        max_output_tokens: 500,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: "Analyse cette étiquette de magasin. Extrais seulement ce qui est réellement visible. Le SKU est le numéro d’article interne, souvent distinct du prix. N’invente rien. Si un champ est illisible, retourne null. Résume brièvement les indices qui justifient le résultat." },
            { type: "input_image", image_url: image, detail: "high" }
          ]
        }],
        text: { format: { type: "json_schema", name: "store_label_extraction", strict: true, schema } }
      })
    });
    const data = await apiResponse.json();
    if (!apiResponse.ok) return json(response, apiResponse.status, { error: data.error?.message || "Erreur OpenAI" });
    const text = extractOutputText(data);
    if (!text) return json(response, 502, { error: "Aucun résultat d’analyse reçu" });
    return json(response, 200, JSON.parse(text));
  } catch (error) {
    return json(response, 500, { error: error.message || "Erreur pendant l’analyse" });
  }
}
