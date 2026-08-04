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


function extractSkuDigits(...values) {
  for (const value of values) {
    const text = String(value || "").replace(/[–—−]/g, "-");
    const match = text.match(/(?:^|\D)((?:1000|1001)(?:[\s-]*\d){6})(?!\d)/);
    if (!match) continue;
    const digits = match[1].replace(/\D/g, "");
    if (/^(?:1000|1001)\d{6}$/.test(digits)) return digits;
  }
  return "";
}

function formatSku(digits) {
  return digits ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)}` : null;
}

function getOutputText(data) {
  for (const item of data?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
}

function getRefusal(data) {
  for (const item of data?.output || []) {
    for (const content of item.content || []) {
      if (content?.type === "refusal") {
        return content.refusal || "L’analyse de cette image a été refusée.";
      }
    }
  }
  return null;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return json(response, 405, { error: "Méthode non permise" });
  }
  if (!isAuthorized(request)) {
    return json(response, 401, { error: "PIN invalide" });
  }
  if (!process.env.OPENAI_API_KEY) {
    return json(response, 503, { error: "OPENAI_API_KEY n’est pas configurée dans Vercel" });
  }

  const image = request.body?.image;
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return json(response, 400, { error: "Image invalide" });
  }
  if (image.length > MAX_DATA_URL_LENGTH) {
    return json(response, 413, { error: "Image trop volumineuse" });
  }

  const model = process.env.OPENAI_VISION_MODEL || "gpt-5-nano";

  try {
    const requestBody = {
      model,
      store: false,
      max_output_tokens: 1200,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Analyse cette étiquette de magasin. Le numéro d’article interne contient exactement 10 chiffres, commence par 1000 ou 1001, et peut être imprimé comme 1001-123456, 1001123456 ou 1001 123 456. Extrais ce numéro dans le champ sku et retourne-le au format 1001 123 456. Ne confonds pas le SKU avec le prix ou un autre code-barres. Extrais uniquement les informations réellement visibles. N’invente rien. Si un champ est illisible, retourne null. Réponds selon le schéma JSON demandé."
          },
          { type: "input_image", image_url: image, detail: "high" }
        ]
      }],
      text: {
        format: {
          type: "json_schema",
          name: "store_label_extraction",
          strict: true,
          schema
        }
      }
    };

    // GPT-5 nano raisonne par défaut. Une faible limite de sortie peut donc être
    // consommée avant la génération du JSON. L'effort minimal réduit ce risque,
    // accélère la réponse et diminue le coût.
    if (/^gpt-5(?:-|$)/.test(model)) {
      requestBody.reasoning = { effort: "minimal" };
    }

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    const raw = await apiResponse.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      console.error("Réponse OpenAI non JSON", {
        status: apiResponse.status,
        requestId: apiResponse.headers.get("x-request-id"),
        preview: raw.slice(0, 300)
      });
      return json(response, 502, { error: "OpenAI a retourné une réponse illisible" });
    }

    if (!apiResponse.ok) {
      console.error("Erreur OpenAI", {
        status: apiResponse.status,
        requestId: apiResponse.headers.get("x-request-id"),
        code: data?.error?.code,
        message: data?.error?.message
      });
      return json(response, apiResponse.status, {
        error: data?.error?.message || `Erreur OpenAI (${apiResponse.status})`
      });
    }

    const refusal = getRefusal(data);
    if (refusal) {
      return json(response, 422, { error: refusal });
    }

    const text = getOutputText(data);
    if (!text) {
      const incompleteReason = data?.incomplete_details?.reason;
      console.error("Réponse OpenAI sans output_text", {
        status: data?.status,
        incompleteReason,
        model: data?.model,
        outputTypes: (data?.output || []).map(item => item?.type),
        usage: data?.usage
      });

      if (data?.status === "incomplete") {
        return json(response, 502, {
          error: `Analyse OpenAI incomplète${incompleteReason ? ` : ${incompleteReason}` : ""}. Réessaie avec la nouvelle version.`
        });
      }

      return json(response, 502, {
        error: "OpenAI n’a retourné aucun texte d’analyse. Consulte les journaux Vercel de /api/analyze."
      });
    }

    try {
      const result = JSON.parse(text);
      const skuDigits = extractSkuDigits(result.sku, result.visibleText, result.summary);
      result.sku = formatSku(skuDigits);
      return json(response, 200, result);
    } catch {
      console.error("JSON structuré OpenAI invalide", {
        requestId: apiResponse.headers.get("x-request-id"),
        preview: text.slice(0, 300)
      });
      return json(response, 502, { error: "Le résultat d’analyse n’était pas un JSON valide" });
    }
  } catch (error) {
    console.error("Erreur interne /api/analyze", error);
    return json(response, 500, { error: error?.message || "Erreur pendant l’analyse" });
  }
}
