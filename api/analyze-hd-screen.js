import { getAuthContext, json, sendError } from "../lib/auth.js";

const MAX_DATA_URL_LENGTH = 4_000_000;
const MAX_DEPARTMENTS = 60;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    isHomeDepotScreen: { type: "boolean" },
    screenConfidence: { type: "number", minimum: 0, maximum: 1 },
    sku: { type: ["string", "null"] },
    productName: { type: ["string", "null"] },
    modelNumber: { type: ["string", "null"] },
    upc: { type: ["string", "null"] },
    price: { type: ["string", "null"] },
    unit: { type: ["string", "null"] },
    pack: { type: ["string", "null"] },
    onHand: { type: ["string", "null"] },
    aisleBay: { type: ["string", "null"] },
    ohmPlus: { type: ["string", "null"] },
    overhead: { type: ["string", "null"] },
    xMerch: { type: ["string", "null"] },
    active: { type: ["boolean", "null"] },
    suggestedDepartment: { type: ["string", "null"] },
    departmentConfidence: { type: "number", minimum: 0, maximum: 1 },
    visibleText: { type: ["string", "null"] },
    summary: { type: ["string", "null"] }
  },
  required: [
    "isHomeDepotScreen",
    "screenConfidence",
    "sku",
    "productName",
    "modelNumber",
    "upc",
    "price",
    "unit",
    "pack",
    "onHand",
    "aisleBay",
    "ohmPlus",
    "overhead",
    "xMerch",
    "active",
    "suggestedDepartment",
    "departmentConfidence",
    "visibleText",
    "summary"
  ]
};

function clean(value, max = 180) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text || /^(?:n\/?a|none|null|—|-)$/i.test(text)) return null;
  return text.slice(0, max);
}

function normalizeComparable(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-CA");
}

function requestedDepartments(body) {
  const result = [];
  const seen = new Set();
  for (const raw of Array.isArray(body?.departments) ? body.departments : []) {
    const value = clean(raw, 80);
    const key = normalizeComparable(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= MAX_DEPARTMENTS) break;
  }
  return result;
}

function extractSku(...values) {
  for (const value of values) {
    const match = String(value || "").match(/(?:^|\D)((?:1000|1001)(?:[\s-]*\d){6})(?!\d)/);
    if (!match) continue;
    const digits = match[1].replace(/\D/g, "");
    if (/^(?:1000|1001)\d{6}$/.test(digits)) {
      return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
    }
  }
  return null;
}

function normalizeLocation(value) {
  const raw = clean(value, 80);
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[‐‑‒–—−_\s]+/g, "-");
  let match = compact.match(/^([A-Z]{1,4})-?(\d{1,6})$/);
  if (match) return `${match[1]}-${match[2]}`;
  match = compact.match(/^(\d{2})-?(\d{3})$/);
  if (match) return `${match[1]}-${match[2]}`;
  return raw;
}

function getOutputText(data) {
  for (const item of data?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

function getRefusal(data) {
  for (const item of data?.output || []) {
    for (const content of item.content || []) {
      if (content?.type === "refusal") return content.refusal || "Analyse refusée";
    }
  }
  return null;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  try { await getAuthContext(request); } catch (error) { return sendError(response, error); }
  if (!process.env.OPENAI_API_KEY) return json(response, 503, { error: "OPENAI_API_KEY n’est pas configurée dans Vercel" });

  const image = request.body?.image;
  if (typeof image !== "string" || !image.startsWith("data:image/")) return json(response, 400, { error: "Image invalide" });
  if (image.length > MAX_DATA_URL_LENGTH) return json(response, 413, { error: "Image trop volumineuse" });

  const departments = requestedDepartments(request.body);
  const departmentInstruction = departments.length
    ? `Si tu peux déduire raisonnablement le département du produit, choisis uniquement un libellé EXACT dans cette liste JSON : ${JSON.stringify(departments)}. Sinon retourne null.`
    : "Aucun département n'est fourni : retourne suggestedDepartment à null et departmentConfidence à 0.";
  const model = process.env.OPENAI_VISION_MODEL || "gpt-5-nano";

  const requestBody = {
    model,
    store: false,
    max_output_tokens: 1800,
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Analyse une PHOTO D'ÉCRAN d'un terminal/téléphone Home Depot affichant Article Lookup. Ne traite pas ceci comme une étiquette produit. Lis uniquement ce qui est réellement visible à l'écran et n'invente aucune valeur.

Champs Home Depot à rechercher en priorité : numéro d'article de 10 chiffres commençant par 1000 ou 1001, description du produit, Model#, UPC#, prix actuel, unité (ex. Each), Pack, On Hand, Aisle - Bay, OHM+, Overhead, X-Merch et état Active/inactive.

Règles :
- sku doit être retourné au format 1000 123 456.
- aisleBay doit contenir seulement l'emplacement, ex. 15-001.
- ohmPlus doit contenir seulement l'emplacement de la ligne OHM+, sans ajouter le caractère +.
- overhead doit contenir seulement l'emplacement de la ligne Overhead. Si l'écran montre N/A, retourne null.
- xMerch : si N/A, retourne null.
- onHand peut conserver l'unité visible, ex. "15 ea".
- price doit contenir uniquement le prix visible, ex. "34.98".
- active vaut true seulement si l'état Active est clairement visible, false si Inactive est clairement visible, sinon null.
- isHomeDepotScreen vaut true seulement si l'image ressemble réellement à un écran Home Depot/Article Lookup contenant des données article; sinon false.
- visibleText doit rester un résumé compact du texte utile, pas une transcription gigantesque.
${departmentInstruction}
Réponds strictement selon le schéma JSON demandé.`
        },
        { type: "input_image", image_url: image, detail: "high" }
      ]
    }],
    text: {
      format: {
        type: "json_schema",
        name: "home_depot_screen_extraction",
        strict: true,
        schema
      }
    }
  };
  if (/^gpt-5(?:-|$)/.test(model)) requestBody.reasoning = { effort: "minimal" };

  try {
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
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { return json(response, 502, { error: "OpenAI a retourné une réponse illisible" }); }

    if (!apiResponse.ok) return json(response, apiResponse.status, { error: data?.error?.message || `Erreur OpenAI (${apiResponse.status})` });
    const refusal = getRefusal(data);
    if (refusal) return json(response, 422, { error: refusal });
    const text = getOutputText(data);
    if (!text) return json(response, 502, { error: "OpenAI n’a retourné aucun résultat d’analyse" });

    let result;
    try { result = JSON.parse(text); }
    catch { return json(response, 502, { error: "Le résultat d’analyse n’était pas un JSON valide" }); }

    result.sku = extractSku(result.sku, result.visibleText, result.summary);
    result.productName = clean(result.productName, 180);
    result.modelNumber = clean(result.modelNumber, 80);
    result.upc = clean(result.upc, 80);
    result.price = clean(result.price, 40);
    result.unit = clean(result.unit, 40);
    result.pack = clean(result.pack, 40);
    result.onHand = clean(result.onHand, 40);
    result.aisleBay = normalizeLocation(result.aisleBay);
    result.ohmPlus = normalizeLocation(result.ohmPlus);
    result.overhead = normalizeLocation(result.overhead);
    result.xMerch = normalizeLocation(result.xMerch);
    result.visibleText = clean(result.visibleText, 900);
    result.summary = clean(result.summary, 500);

    const department = departments.find(name => normalizeComparable(name) === normalizeComparable(result.suggestedDepartment)) || null;
    result.suggestedDepartment = department;
    result.departmentConfidence = department ? Math.max(0, Math.min(1, Number(result.departmentConfidence) || 0)) : 0;

    return json(response, 200, result);
  } catch (error) {
    console.error("Erreur interne /api/analyze-hd-screen", error);
    return json(response, 500, { error: error?.message || "Erreur pendant l’analyse de l’écran" });
  }
}
