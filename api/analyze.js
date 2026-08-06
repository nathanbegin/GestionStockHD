import { getAuthContext, json, sendError } from "../lib/auth.js";

const MAX_DATA_URL_LENGTH = 4_000_000;
const MAX_DEPARTMENTS = 60;
const MAX_DEPARTMENT_NAME_LENGTH = 80;
const DEPARTMENT_CODE_DEFINITIONS = [
  { codes: ["21", "22"], names: ["Matériaux / Lumber", "Matériaux", "Lumber"] },
  { codes: ["23"], names: ["Couvre-plancher"] },
  { codes: ["24"], names: ["Peinture"] },
  { codes: ["25"], names: ["Quincaillerie"] },
  { codes: ["26"], names: ["Plomberie"] },
  { codes: ["27"], names: ["Électricité"] },
  { codes: ["28"], names: ["Saisonnier", "Jardinage"] },
  { codes: ["29"], names: ["Cuisine et salle de bain"] },
  { codes: ["30"], names: ["Menuiserie"] },
  { codes: ["31"], names: ["Services spéciaux"] },
  { codes: ["70"], names: ["Électroménagers"] },
  { codes: ["78"], names: ["Location d'outils"] }
];
const RECOGNIZED_DEPARTMENT_CODES = DEPARTMENT_CODE_DEFINITIONS.flatMap(entry => entry.codes);

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sku: { type: ["string", "null"] },
    barcode: { type: ["string", "null"] },
    productName: { type: ["string", "null"] },
    visibleText: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    detectedDepartmentCode: { type: ["string", "null"] },
    suggestedDepartment: { type: ["string", "null"] },
    departmentConfidence: { type: "number", minimum: 0, maximum: 1 },
    departmentReason: { type: ["string", "null"] }
  },
  required: [
    "sku",
    "barcode",
    "productName",
    "visibleText",
    "summary",
    "confidence",
    "detectedDepartmentCode",
    "suggestedDepartment",
    "departmentConfidence",
    "departmentReason"
  ]
};

function normalizeComparable(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-CA");
}

function requestedDepartments(body) {
  const names = [];
  const seen = new Set();

  for (const raw of Array.isArray(body?.departments) ? body.departments : []) {
    const name = String(raw || "").trim().replace(/\s+/g, " ").slice(0, MAX_DEPARTMENT_NAME_LENGTH);
    const key = normalizeComparable(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= MAX_DEPARTMENTS) break;
  }

  return names;
}

function configuredDepartmentForCode(code, departments) {
  const definition = DEPARTMENT_CODE_DEFINITIONS.find(entry => entry.codes.includes(code));
  if (!definition) return null;
  const accepted = new Set(definition.names.map(normalizeComparable));
  return departments.find(name => accepted.has(normalizeComparable(name))) || null;
}

function departmentCodeMap(departments) {
  const map = {};
  for (const definition of DEPARTMENT_CODE_DEFINITIONS) {
    const configured = definition.codes
      .map(code => ({ code, department: configuredDepartmentForCode(code, departments) }))
      .find(entry => entry.department);
    if (!configured) continue;
    for (const code of definition.codes) map[`R${code}`] = configured.department;
  }
  return map;
}

function extractDepartmentCode(...values) {
  const alternatives = RECOGNIZED_DEPARTMENT_CODES.join("|");
  const matcher = new RegExp(`(?:^|[^A-Z0-9])R\\s*[-:]?\\s*0*(${alternatives})(?!\\d)`, "i");
  for (const value of values) {
    const match = String(value || "").match(matcher);
    if (match) return String(Number(match[1]));
  }
  return "";
}

function normalizeDepartmentResult(result, departments) {
  const detectedCode = extractDepartmentCode(
    result?.detectedDepartmentCode,
    result?.visibleText,
    result?.summary,
    result?.productName
  );

  if (detectedCode) {
    const exactDepartment = configuredDepartmentForCode(detectedCode, departments);
    result.detectedDepartmentCode = `R${detectedCode}`;
    result.suggestedDepartment = exactDepartment;
    result.departmentConfidence = exactDepartment ? 0.99 : 0;
    result.departmentReason = exactDepartment
      ? `Le code R${detectedCode} visible sur l’étiquette correspond au département ${exactDepartment}.`
      : null;
    return result;
  }

  result.detectedDepartmentCode = null;
  const suggested = normalizeComparable(result?.suggestedDepartment);
  const exact = suggested
    ? departments.find(name => normalizeComparable(name) === suggested) || null
    : null;
  const confidence = Number(result?.departmentConfidence);

  result.suggestedDepartment = exact;
  result.departmentConfidence = exact && Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : 0;
  result.departmentReason = exact
    ? String(result?.departmentReason || "").trim().replace(/\s+/g, " ").slice(0, 240) || null
    : null;

  return result;
}

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
  try { await getAuthContext(request); } catch (error) { return sendError(response, error); }
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

  const departments = requestedDepartments(request.body);
  const codeMap = departmentCodeMap(departments);
  const departmentInstruction = departments.length
    ? `RÈGLE DE PRIORITÉ ABSOLUE : inspecte d’abord toute l’étiquette pour trouver un code de département au format R##, R0##, R ##, R-## ou R:##. Les correspondances disponibles sont ${JSON.stringify(codeMap)}. Si un code reconnu est visible, retourne-le dans detectedDepartmentCode et choisis obligatoirement le département correspondant, même si le titre, la description ou le type de produit semblent indiquer autre chose. Dans ce cas, le code R## est la source de vérité et departmentConfidence doit être 0.99. Utilise le titre, la description, la marque et le type de produit uniquement lorsqu’aucun code R## reconnu n’est visible; dans ce cas detectedDepartmentCode doit être null. Choisis uniquement et exactement parmi les libellés de cette liste JSON : ${JSON.stringify(departments)}. Si aucun code n’est visible et qu’aucune suggestion par description n’est raisonnablement fiable, retourne suggestedDepartment à null, departmentConfidence à 0 et departmentReason à null. Sinon, donne une courte justification factuelle en français.`
    : "Cherche tout de même un code R## visible et retourne-le dans detectedDepartmentCode, mais aucun département n’est fourni : retourne suggestedDepartment à null, departmentConfidence à 0 et departmentReason à null.";

  const model = process.env.OPENAI_VISION_MODEL || "gpt-5-nano";

  try {
    const requestBody = {
      model,
      store: false,
      max_output_tokens: 1400,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Analyse cette étiquette de magasin. Commence par rechercher attentivement un code de département R## dans toutes les zones de l’image, même s’il est petit ou séparé par des espaces. Le numéro d’article interne contient exactement 10 chiffres, commence par 1000 ou 1001, et peut être imprimé comme 1001-123456, 1001123456 ou 1001 123 456. Extrais ce numéro dans le champ sku et retourne-le au format 1001 123 456. Ne confonds pas le SKU avec le prix ou un autre code-barres. Extrais uniquement les informations réellement visibles. N’invente rien. Si un champ est illisible, retourne null. ${departmentInstruction} Réponds selon le schéma JSON demandé.`
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
      normalizeDepartmentResult(result, departments);
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
