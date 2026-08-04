const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;

function pdfText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[^\x20-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function escapePdfText(value) {
  return pdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function wrap(value, maxChars = 86) {
  const words = pdfText(value).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) line = candidate;
    else {
      if (line) lines.push(line);
      if (word.length <= maxChars) line = word;
      else {
        for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
        line = "";
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}
function statusLabel(value) {
  return ({ a_remplir: "À remplir", recupere: "Récupéré", rempli: "Rempli", introuvable: "Introuvable" })[value] || pdfText(value);
}
function employeeName(snapshot, id) {
  return snapshot.employees?.find(x => x.id === id)?.name || "";
}
function departmentName(snapshot, id) {
  return snapshot.departments?.find(x => x.id === id)?.name || "Sans département";
}
function uniqueSortedNames(values) {
  return [...new Set(values.map(value => pdfText(value)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
}
function assignmentNames(snapshot, pickup, item) {
  const itemNames = uniqueSortedNames((item.assignedEmployeeIds || []).map(id => employeeName(snapshot, id)));
  if (itemNames.length) return itemNames;
  return uniqueSortedNames((pickup.assignedEmployeeIds || []).map(id => employeeName(snapshot, id)));
}
function groupedItems(snapshot, pickup, items) {
  const assignments = new Map();

  for (const item of items) {
    const names = assignmentNames(snapshot, pickup, item);
    const assignmentLabel = names.join(", ") || "Non attribué";
    const assignmentKey = names.length ? names.join("\u0001") : "\uffff-non-attribue";
    if (!assignments.has(assignmentKey)) assignments.set(assignmentKey, { label: assignmentLabel, departments: new Map() });

    const assignment = assignments.get(assignmentKey);
    const deptLabel = departmentName(snapshot, item.departmentId);
    const deptKey = deptLabel === "Sans département" ? "\uffff-sans-departement" : deptLabel;
    if (!assignment.departments.has(deptKey)) assignment.departments.set(deptKey, { label: deptLabel, items: [] });
    assignment.departments.get(deptKey).items.push(item);
  }

  return [...assignments.entries()]
    .sort(([aKey, a], [bKey, b]) => {
      if (aKey.startsWith("\uffff")) return 1;
      if (bKey.startsWith("\uffff")) return -1;
      return a.label.localeCompare(b.label, "fr", { sensitivity: "base" });
    })
    .map(([, assignment]) => ({
      ...assignment,
      departments: [...assignment.departments.entries()]
        .sort(([aKey, a], [bKey, b]) => {
          if (aKey.startsWith("\uffff")) return 1;
          if (bKey.startsWith("\uffff")) return -1;
          return a.label.localeCompare(b.label, "fr", { sensitivity: "base" });
        })
        .map(([, department]) => ({
          ...department,
          items: department.items.sort((a, b) => {
            const locationCompare = pdfText(a.stockLocation).localeCompare(pdfText(b.stockLocation), "fr", { sensitivity: "base" });
            if (locationCompare) return locationCompare;
            const nameCompare = pdfText(a.name).localeCompare(pdfText(b.name), "fr", { sensitivity: "base" });
            if (nameCompare) return nameCompare;
            return pdfText(a.sku).localeCompare(pdfText(b.sku), "fr", { sensitivity: "base" });
          })
        }))
    }));
}
function textCommand(text, x, y, size = 10, bold = false, brand = false) {
  const color = brand ? "0.976 0.388 0.008" : "0.15 0.12 0.10";
  return `${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`;
}
function buildPageContent(lines, pageNumber, pageCount) {
  const commands = [
    "0.976 0.388 0.008 rg 0 821.89 595.28 20 re f",
    ...lines.map(line => textCommand(line.text, line.x, line.y, line.size, line.bold, line.brand)),
    textCommand(`Page ${pageNumber} / ${pageCount}`, 500, 20, 8, false, true)
  ];
  return commands.join("\n");
}
function assemblePdf(pageContents) {
  const objects = [];
  const add = content => { objects.push(content); return objects.length; };
  const catalogId = add("");
  const pagesId = add("");
  const fontRegularId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBoldId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds = [];

  for (const content of pageContents) {
    const contentBuffer = Buffer.from(content, "latin1");
    const contentId = add(`<< /Length ${contentBuffer.length} >>\nstream\n${content}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let output = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(output, "binary"));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "binary");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "binary");
}

export function createPickupReport(snapshot, pickup, profile, generatedAt = new Date()) {
  const items = (pickup.itemIds || []).map(id => (snapshot.items || []).find(x => x.id === id)).filter(Boolean);
  const assigned = (pickup.assignedEmployeeIds || []).map(id => employeeName(snapshot, id)).filter(Boolean).join(", ") || "Non attribué";
  const groups = groupedItems(snapshot, pickup, items);
  const pages = [[]];
  let pageIndex = 0;
  let y = PAGE_HEIGHT - MARGIN;
  let itemNumber = 0;
  const current = () => pages[pageIndex];
  const addLine = (text, { size = 10, bold = false, brand = false, indent = 0, gap = 14 } = {}) => {
    current().push({ text: pdfText(text), x: MARGIN + indent, y, size, bold, brand });
    y -= gap;
  };
  const newPage = () => {
    pageIndex += 1;
    pages.push([]);
    y = PAGE_HEIGHT - MARGIN;
    addLine(snapshot.settings?.storeName || "Remplissage magasin", { size: 14, bold: true, brand: true, gap: 20 });
    addLine(`Rapport de ramassage - ${pickup.name}`, { size: 11, bold: true, brand: true, gap: 18 });
  };
  const ensureLines = count => {
    if (y - count * 13 < MARGIN + 22) {
      newPage();
      return true;
    }
    return false;
  };
  const addGroupHeadings = (assignmentLabel, departmentLabel) => {
    addLine(`Attribution : ${assignmentLabel}`, { size: 12, bold: true, brand: true, gap: 18 });
    addLine(`Département : ${departmentLabel}`, { size: 10.5, bold: true, indent: 8, gap: 16 });
  };

  addLine(snapshot.settings?.storeName || "Remplissage magasin", { size: 18, bold: true, brand: true, gap: 24 });
  addLine(`Rapport de ramassage - ${pickup.name}`, { size: 15, bold: true, brand: true, gap: 22 });
  for (const line of [
    `Lieu / point de départ : ${pickup.pickupLocation || "Non précisé"}`,
    `Employés de la liste : ${assigned}`,
    `Généré par : ${profile.full_name || profile.fullName || "Utilisateur"} (${profile.role || "employee"})`,
    `Date : ${new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" }).format(generatedAt)}`,
    `Nombre d'articles : ${items.length}`
  ]) {
    for (const wrapped of wrap(line, 88)) addLine(wrapped, { size: 10, gap: 14 });
  }
  y -= 8;

  for (const assignment of groups) {
    ensureLines(3);
    addLine(`Attribution : ${assignment.label}`, { size: 13, bold: true, brand: true, gap: 20 });

    for (const department of assignment.departments) {
      ensureLines(3);
      addLine(`Département : ${department.label}`, { size: 11, bold: true, indent: 8, gap: 17 });

      for (const item of department.items) {
        itemNumber += 1;
        const effectiveAssignment = assignmentNames(snapshot, pickup, item).join(", ") || "Non attribué";
        const detailLines = [
          `${itemNumber}. ${item.sku || "Sans SKU"} - ${item.name || "Article sans description"}`,
          `Quantité : ${item.quantity || 1} | Statut : ${statusLabel(item.status)}${item.requiresForklift ? " | Lift requis" : ""}`,
          `Lieu du ramassage : ${item.stockLocation || "Non précisé"}`,
          `Destination tablette : ${item.salesLocation || "Non précisé"}`,
          `Assigné à : ${effectiveAssignment}`,
          item.note ? `Note : ${item.note}` : ""
        ].filter(Boolean).flatMap((line, idx) => wrap(line, idx === 0 ? 74 : 84).map(text => ({ text, bold: idx === 0 })));

        if (ensureLines(detailLines.length + 4)) addGroupHeadings(assignment.label, department.label);
        for (const line of detailLines) {
          addLine(line.text, {
            size: line.bold ? 10.5 : 9.25,
            bold: line.bold,
            brand: line.bold,
            indent: 16,
            gap: line.bold ? 15 : 12
          });
        }
        y -= 7;
      }
      y -= 4;
    }
    y -= 6;
  }

  const contents = pages.map((lines, index) => buildPageContent(lines, index + 1, pages.length));
  return assemblePdf(contents);
}
