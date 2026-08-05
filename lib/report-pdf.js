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
function uniqueLocations(values) {
  const locations = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = pdfText(raw);
    const key = value.toLocaleLowerCase("fr-CA");
    if (!value || seen.has(key)) continue;
    seen.add(key);
    locations.push(value);
  }
  return locations;
}
function gesTags(item) {
  return [
    ...uniqueLocations(item.gesPlusLocations).map(value => ({ kind: "plus", text: `GES+ : ${value}` })),
    ...uniqueLocations(item.gesPalletLocations).map(value => ({ kind: "pallet", text: `GES palettes : ${value}` }))
  ];
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
function textCommand(text, x, y, size = 10, bold = false, brand = false, customColor = "") {
  const color = customColor || (brand ? "0.976 0.388 0.008" : "0.15 0.12 0.10");
  return `${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`;
}
function roundedRectanglePath(x, y, width, height, radius = 5) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const c = r * 0.5522847498;
  const right = x + width;
  const top = y + height;
  return [
    `${(x + r).toFixed(2)} ${y.toFixed(2)} m`,
    `${(right - r).toFixed(2)} ${y.toFixed(2)} l`,
    `${(right - r + c).toFixed(2)} ${y.toFixed(2)} ${right.toFixed(2)} ${(y + r - c).toFixed(2)} ${right.toFixed(2)} ${(y + r).toFixed(2)} c`,
    `${right.toFixed(2)} ${(top - r).toFixed(2)} l`,
    `${right.toFixed(2)} ${(top - r + c).toFixed(2)} ${(right - r + c).toFixed(2)} ${top.toFixed(2)} ${(right - r).toFixed(2)} ${top.toFixed(2)} c`,
    `${(x + r).toFixed(2)} ${top.toFixed(2)} l`,
    `${(x + r - c).toFixed(2)} ${top.toFixed(2)} ${x.toFixed(2)} ${(top - r + c).toFixed(2)} ${x.toFixed(2)} ${(top - r).toFixed(2)} c`,
    `${x.toFixed(2)} ${(y + r).toFixed(2)} l`,
    `${x.toFixed(2)} ${(y + r - c).toFixed(2)} ${(x + r - c).toFixed(2)} ${y.toFixed(2)} ${(x + r).toFixed(2)} ${y.toFixed(2)} c`,
    "h"
  ].join(" ");
}
function tagCommand(tag) {
  const fill = tag.kind === "plus" ? "1 0.94 0.88" : "0.93 0.96 0.91";
  const stroke = tag.kind === "plus" ? "0.976 0.388 0.008" : "0.31 0.49 0.31";
  const bottom = tag.y - tag.height;
  const commands = [
    `q ${fill} rg ${stroke} RG 0.80 w ${roundedRectanglePath(tag.x, bottom, tag.width, tag.height, 5)} B Q`
  ];
  tag.lines.forEach((line, index) => {
    commands.push(textCommand(line, tag.x + 8, tag.y - 12 - index * 9, 8.1, true, false, "0.25 0.18 0.14"));
  });
  return commands.join("\n");
}
function prepareTagRows(tags, maxWidth) {
  const prepared = tags.map(tag => {
    const maxChars = Math.max(18, Math.floor((maxWidth - 16) / 4.45));
    const lines = wrap(tag.text, maxChars);
    const widest = Math.max(...lines.map(line => line.length), 1);
    return {
      ...tag,
      lines,
      width: Math.min(maxWidth, Math.max(82, widest * 4.45 + 16)),
      height: 18 + Math.max(0, lines.length - 1) * 9
    };
  });

  const rows = [];
  let current = [];
  let usedWidth = 0;
  let rowHeight = 0;
  for (const tag of prepared) {
    const required = current.length ? tag.width + 6 : tag.width;
    if (current.length && usedWidth + required > maxWidth) {
      rows.push({ tags: current, height: rowHeight });
      current = [];
      usedWidth = 0;
      rowHeight = 0;
    }
    const offsetX = current.length ? usedWidth + 6 : 0;
    current.push({ ...tag, offsetX });
    usedWidth = offsetX + tag.width;
    rowHeight = Math.max(rowHeight, tag.height);
  }
  if (current.length) rows.push({ tags: current, height: rowHeight });
  return rows;
}
function buildPageContent(lines, pageNumber, pageCount) {
  const commands = [
    "0.976 0.388 0.008 rg 0 821.89 595.28 20 re f",
    ...lines.map(line => line.type === "tag"
      ? tagCommand(line)
      : textCommand(line.text, line.x, line.y, line.size, line.bold, line.brand)),
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
    current().push({ type: "text", text: pdfText(text), x: MARGIN + indent, y, size, bold, brand });
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
  const addGesTagRows = (rows, item, assignmentLabel, departmentLabel) => {
    if (!rows.length) return;
    addLine("Emplacements GES :", { size: 9.25, bold: true, indent: 16, gap: 15 });
    let continued = false;
    for (const row of rows) {
      if (y - row.height < MARGIN + 22) {
        newPage();
        addGroupHeadings(assignmentLabel, departmentLabel);
        addLine(`${itemNumber}. ${item.sku || "Sans SKU"} - ${item.name || "Article sans description"} (suite)`, {
          size: 10.5,
          bold: true,
          brand: true,
          indent: 16,
          gap: 15
        });
        addLine("Emplacements GES (suite) :", { size: 9.25, bold: true, indent: 16, gap: 15 });
        continued = true;
      }
      for (const tag of row.tags) {
        current().push({
          type: "tag",
          kind: tag.kind,
          lines: tag.lines,
          x: MARGIN + 16 + tag.offsetX,
          y,
          width: tag.width,
          height: tag.height
        });
      }
      y -= row.height + 6;
    }
    if (continued) y -= 1;
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
        const tagRows = prepareTagRows(gesTags(item), PAGE_WIDTH - MARGIN * 2 - 32);
        const tagHeight = tagRows.reduce((total, row) => total + row.height + 6, 0) + (tagRows.length ? 15 : 0);
        const estimatedLines = detailLines.length + 4 + Math.ceil(tagHeight / 13);

        if (ensureLines(estimatedLines)) addGroupHeadings(assignment.label, department.label);
        for (const line of detailLines) {
          addLine(line.text, {
            size: line.bold ? 10.5 : 9.25,
            bold: line.bold,
            brand: line.bold,
            indent: 16,
            gap: line.bold ? 15 : 12
          });
        }
        addGesTagRows(tagRows, item, assignment.label, department.label);
        y -= 7;
      }
      y -= 4;
    }
    y -= 6;
  }

  const contents = pages.map((lines, index) => buildPageContent(lines, index + 1, pages.length));
  return assemblePdf(contents);
}
