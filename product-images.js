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

  const request = fetch(`/api/health?sku=${encodeURIComponent(sku)}`, {
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

function ensureProductImageModal() {
  let modal = document.querySelector("#productImageModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "productImageModal";
  modal.className = "product-image-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="product-image-dialog" role="dialog" aria-modal="true" aria-labelledby="productImageTitle">
      <button class="product-image-close" type="button" aria-label="Fermer l’image">×</button>
      <div class="product-image-dialog-body">
        <p class="product-image-kicker">IMAGE DU PRODUIT</p>
        <h2 id="productImageTitle"></h2>
        <p class="product-image-sku"></p>
        <div class="product-image-stage">
          <div class="product-image-loading">Chargement de l’image…</div>
          <img alt="" hidden>
        </div>
        <p class="product-image-error" hidden>Image du produit non disponible.</p>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("product-image-modal-open");
  };
  modal.querySelector(".product-image-close").addEventListener("click", close);
  modal.addEventListener("click", event => {
    if (event.target === modal) close();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.hidden) close();
  });

  return modal;
}

async function openProductImage(card) {
  const sku = productSkuFromCard(card);
  if (!sku) return;

  const modal = ensureProductImageModal();
  const title = card.querySelector(".item-title h3, .section-head h2")?.textContent?.trim() || "Article";
  const img = modal.querySelector("img");
  const loading = modal.querySelector(".product-image-loading");
  const error = modal.querySelector(".product-image-error");

  modal.dataset.sku = sku;
  modal.querySelector("#productImageTitle").textContent = title;
  modal.querySelector(".product-image-sku").textContent = card.querySelector(".sku")?.textContent?.trim() || sku;
  img.hidden = true;
  img.removeAttribute("src");
  img.alt = `Image du produit ${title}`;
  loading.hidden = false;
  error.hidden = true;
  modal.hidden = false;
  document.body.classList.add("product-image-modal-open");
  modal.querySelector(".product-image-close").focus();

  const data = await getProductImage(sku);
  if (modal.hidden || modal.dataset.sku !== sku) return;
  loading.hidden = true;

  if (!data?.imageUrl) {
    error.hidden = false;
    return;
  }

  img.onerror = () => {
    img.hidden = true;
    error.hidden = false;
  };
  img.onload = () => {
    if (!modal.hidden) img.hidden = false;
  };
  img.src = data.imageUrl;
}

function productImageTriggers(card) {
  return [
    card.querySelector(".sku"),
    card.querySelector(".item-title h3, .section-head h2")
  ].filter(Boolean);
}

function prepareProductImageTriggers(root = document) {
  root.querySelectorAll(".item-card, .tour-card").forEach(card => {
    if (!productSkuFromCard(card)) return;
    productImageTriggers(card).forEach(trigger => {
      trigger.classList.add("product-image-trigger");
      trigger.setAttribute("role", "button");
      trigger.setAttribute("tabindex", "0");
      trigger.setAttribute("aria-label", `Afficher l’image du produit ${trigger.textContent.trim()}`);
    });
  });
}

const productImageMain = document.querySelector("#appMain");
if (productImageMain) {
  productImageMain.addEventListener("click", event => {
    const trigger = event.target.closest(".product-image-trigger");
    const card = trigger?.closest(".item-card, .tour-card");
    if (card) openProductImage(card);
  });

  productImageMain.addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key)) return;
    const trigger = event.target.closest(".product-image-trigger");
    const card = trigger?.closest(".item-card, .tour-card");
    if (!card) return;
    event.preventDefault();
    openProductImage(card);
  });

  const productImageObserver = new MutationObserver(() => prepareProductImageTriggers(productImageMain));
  productImageObserver.observe(productImageMain, { childList: true, subtree: true });
  prepareProductImageTriggers(productImageMain);
}
