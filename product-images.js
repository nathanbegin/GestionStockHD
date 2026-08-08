const productImageCache = new Map();
const pendingProductImages = new Map();

function productSkuFromCard(card) {
  const text = card.querySelector(".sku")?.textContent || "";
  const digits = text.replace(/\D/g, "");
  return /^(?:1000|1001)\d{6}$/.test(digits) ? digits : "";
}

async function getProductImage(sku) {
  if (productImageCache.has(sku)) return productImageCache.get(sku);
  if (pendingProductImages.has(sku)) return pendingProductImages.get(sku);

  const request = fetch(`/api/product-image?sku=${encodeURIComponent(sku)}`, {
    credentials: "same-origin",
    cache: "force-cache"
  })
    .then(async response => {
      if (!response.ok) return null;
      const data = await response.json();
      return data?.imageUrl ? data : null;
    })
    .catch(() => null)
    .then(data => {
      productImageCache.set(sku, data);
      pendingProductImages.delete(sku);
      return data;
    });

  pendingProductImages.set(sku, request);
  return request;
}

function productImageSlot(card, sku) {
  let slot = card.querySelector(".hd-product-image");
  if (slot) return slot;

  slot = document.createElement("a");
  slot.className = "hd-product-image";
  slot.dataset.sku = sku;
  slot.target = "_blank";
  slot.rel = "noopener noreferrer";
  slot.hidden = true;
  slot.setAttribute("aria-label", `Voir l’article ${sku} sur Home Depot`);

  const img = document.createElement("img");
  img.alt = "Image du produit";
  img.loading = "lazy";
  img.decoding = "async";
  slot.appendChild(img);

  const title = card.querySelector(".item-title, .section-head");
  if (title) title.insertAdjacentElement("afterend", slot);
  else card.prepend(slot);
  return slot;
}

async function hydrateProductImage(card) {
  if (!(card instanceof HTMLElement) || card.dataset.productImageHydrated === "1") return;
  const sku = productSkuFromCard(card);
  if (!sku) return;
  card.dataset.productImageHydrated = "1";

  const slot = productImageSlot(card, sku);
  const data = await getProductImage(sku);
  if (!data || !card.isConnected) return;

  const img = slot.querySelector("img");
  img.addEventListener("error", () => { slot.hidden = true; }, { once: true });
  img.src = data.imageUrl;
  slot.href = data.productUrl || `https://www.homedepot.ca/product/${sku}`;
  slot.hidden = false;
}

function hydrateVisibleProductImages(root = document) {
  root.querySelectorAll(".item-card, .tour-card").forEach(hydrateProductImage);
}

const productImageObserver = new MutationObserver(() => hydrateVisibleProductImages());
const productImageMain = document.querySelector("#appMain");
if (productImageMain) {
  productImageObserver.observe(productImageMain, { childList: true, subtree: true });
  hydrateVisibleProductImages(productImageMain);
}
