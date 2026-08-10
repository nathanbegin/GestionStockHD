import { getAuthContext, json, sendError } from "./auth.js";

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
    departmentReason: { type: ["string", "null"] },
    visibleText: { type: ["string", "null"] },
    summary: { type: ["string", "null"] }
  },
  required: [
    "isHomeDepotScreen", "screenConfidence", "sku", "productName", "modelNumber", "upc", "price",
    "unit", "pack", "onHand", "aisleBay", "ohmPlus", "overhead", "xMerch", "active",
    "suggestedDepartment", "departmentConfidence", "departmentReason", "visibleText", "summary"
  ]
};

const departmentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestedDepartment: { type: ["string", "null"] },
    departmentConfidence: { type: "number", minimum: 0, maximum: 1 },
    departmentReason: { type: ["string", "null"] }
  },
  required: ["suggestedDepartment", "departmentConfidence", "departmentReason"]
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
    if (/^(?:1000|1001)\d{6}$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
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

function usefulProductName(value) {
  const text = clean(value, 180);
  if (!text || text.length < 8 || !/[A-Za-zÀ-ÿ]/.test(text)) return false;
  const normalized = normalizeComparable(text);
  if (/^(?:active|inactive|article lookup|stock|details|analytics)$/.test(normalized)) return false;
  if (/^(?:model|upc)\s*#?/i.test(text)) return false;
  return true;
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

async function openAiJson({ model, input, schema: outputSchema, name, maxOutputTokens = 900, reasoning = "minimal" }) {
  const requestBody = {
    model,
    store: false,
    max_output_tokens: maxOutputTokens,
    input,
    text: { format: { type: "json_schema", name, strict: true, schema: outputSchema } }
  };
  if (/^gpt-5(?:-|$)/.test(model)) requestBody.reasoning = { effort: reasoning };

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  const raw = await apiResponse.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error("OpenAI a retourné une réponse illisible"); }
  if (!apiResponse.ok) throw new Error(data?.error?.message || `Erreur OpenAI (${apiResponse.status})`);
  const refusal = getRefusal(data);
  if (refusal) throw new Error(refusal);
  const text = getOutputText(data);
  if (!text) throw new Error("OpenAI n’a retourné aucun résultat d’analyse");
  try { return JSON.parse(text); }
  catch { throw new Error("Le résultat d’analyse n’était pas un JSON valide"); }
}

async function classifyDepartment(model, result, departments) {
  if (!departments.length || !usefulProductName(result?.productName)) {
    return { suggestedDepartment: null, departmentConfidence: 0, departmentReason: null };
  }

  const description = clean(result.productName, 180);
  const modelNumber = clean(result.modelNumber, 80);
  const context = [
    `Description produit: ${description}`,
    modelNumber ? `Model #: ${modelNumber}` : "",
    result?.unit ? `Unité: ${clean(result.unit, 40)}` : ""
  ].filter(Boolean).join("\n");

  const classification = await openAiJson({
    model,
    maxOutputTokens: 450,
    reasoning: "minimal",
    name: "home_depot_department_classification",
    schema: departmentSchema,
    input: [{
      role: "user",
      content: [{
        type: "input_text",
        text: `Classe ce produit Home Depot dans UN département, uniquement parmi la liste fournie. La description produit est la source principale. Ne te base pas sur le numéro d'allée pour déterminer le département.

${context}

Départements autorisés: ${JSON.stringify(departments)}

Raisonne selon le TYPE DE PRODUIT. Exemples généraux : vis, boulons, écrous, clous, ancrages, attaches et petite quincaillerie vont normalement vers un département de quincaillerie s'il existe; tuyaux et robinets vers plomberie; fils, prises et luminaires vers électricité; peinture et accessoires de peinture vers peinture; bois de charpente et panneaux vers matériaux; portes, moulures et menuiserie vers menuiserie. Ces exemples servent seulement à comprendre les familles de produits : retourne toujours exactement un libellé présent dans la liste fournie.

Si aucun département de la liste n'est raisonnablement compatible, retourne null. departmentReason doit être une justification courte en français fondée sur la description.`
      }]
    }]
  });

  const exact = departments.find(name => normalizeComparable(name) === normalizeComparable(classification?.suggestedDepartment)) || null;
  return {
    suggestedDepartment: exact,
    departmentConfidence: exact ? Math.max(0, Math.min(1, Number(classification?.departmentConfidence) || 0)) : 0,
    departmentReason: exact ? clean(classification?.departmentReason, 240) : null
  };
}

export default async function analyzeHomeDepotScreen(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  try { await getAuthContext(request); } catch (error) { return sendError(response, error); }
  if (!process.env.OPENAI_API_KEY) return json(response, 503, { error: "OPENAI_API_KEY n’est pas configurée dans Vercel" });

  const image = request.body?.image;
  if (typeof image !== "string" || !image.startsWith("data:image/")) return json(response, 400, { error: "Image invalide" });
  if (image.length > MAX_DATA_URL_LENGTH) return json(response, 413, { error: "Image trop volumineuse" });

  const departments = requestedDepartments(request.body);
  const model = process.env.OPENAI_HD_SCREEN_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-5-nano";

  try {
    const result = await openAiJson({
      model,
      maxOutputTokens: 1900,
      reasoning: "low",
      name: "home_depot_screen_extraction",
      schema,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Analyse une PHOTO D'ÉCRAN d'un terminal/téléphone Home Depot affichant Article Lookup. Ne traite pas ceci comme une étiquette produit. Lis uniquement ce qui est réellement visible à l'écran et n'invente aucune valeur.

PRIORITÉ #1 — DESCRIPTION PRODUIT / productName :
- Cherche la GRANDE LIGNE DE DESCRIPTION DU PRODUIT dans la moitié centrale de l'écran.
- Elle se trouve généralement SOUS l'image du produit et/ou l'état Active, et JUSTE AU-DESSUS de la zone prix / Each / Pack.
- Cette ligne contient souvent la marque + le nom/type de produit + dimensions + quantité. Elle peut être longue.
- Transcris cette ligne aussi complètement et fidèlement que possible dans productName, y compris marque, dimensions, tirets, fractions et quantité visibles.
- Ne mets JAMAIS Model#, UPC#, Active, le prix, Aisle-Bay ou un emplacement dans productName.
- Si certaines lettres sont difficiles à lire, utilise le contexte visuel seulement pour relire les caractères, sans inventer un produit absent de l'écran.

Ensuite recherche : numéro d'article de 10 chiffres commençant par 1000 ou 1001, Model#, UPC#, prix actuel, unité (ex. Each), Pack, On Hand, Aisle - Bay, OHM+, Overhead, X-Merch et état Active/inactive.

Règles :
- sku doit être retourné au format 1000 123 456.
- aisleBay doit contenir seulement l'emplacement, ex. 15-001.
- ohmPlus doit contenir seulement l'emplacement de la ligne OHM+, sans ajouter le caractère +. Si N/A, retourne null.
- overhead doit contenir seulement l'emplacement de la ligne Overhead. Si N/A, retourne null.
- xMerch : si N/A, retourne null.
- onHand doit conserver le signe négatif s'il est visible et peut conserver l'unité, ex. "-9 ea".
- price doit contenir uniquement le prix visible, ex. "13.98".
- active vaut true seulement si l'état Active est clairement visible, false si Inactive est clairement visible, sinon null.
- isHomeDepotScreen vaut true seulement si l'image ressemble réellement à un écran Home Depot/Article Lookup contenant des données article; sinon false.
- visibleText doit inclure la description produit et les principaux champs utiles sous forme compacte.
- suggestedDepartment, departmentConfidence et departmentReason peuvent rester null/0 pendant cette lecture : une classification spécialisée sera faite ensuite.

Réponds strictement selon le schéma JSON demandé.`
          },
          { type: "input_image", image_url: image, detail: "high" }
        ]
      }]
    });

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

    const classification = await classifyDepartment(model, result, departments).catch(error => {
      console.warn("Classification département écran HD indisponible", error?.message || error);
      return { suggestedDepartment: null, departmentConfidence: 0, departmentReason: null };
    });
    result.suggestedDepartment = classification.suggestedDepartment;
    result.departmentConfidence = classification.departmentConfidence;
    result.departmentReason = classification.departmentReason;

    return json(response, 200, result);
  } catch (error) {
    console.error("Erreur interne analyse écran Home Depot", error);
    return json(response, 500, { error: error?.message || "Erreur pendant l’analyse de l’écran" });
  }
}