/**
 * URL CSV: Archivo → Compartir → Publicar en la web → CSV (respaldo si no usás API).
 */
const SHEETS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyR0WiucQqqDKvrc1q5TPQdpXQYE0M9ZrHO7kKDdqYnSzX1XNcaDQCRBUTU9dUQlfwjPFvUZfrmops/pub?output=csv";

/**
 * ID del documento (…/spreadsheets/d/ESTE_ID/edit). Necesario para /export y para la API.
 */
const SHEETS_DOC_EXPORT_ID = "1HD4rA_WoEoA-BbunlTrzDdtNkKaN5ygFzY5s4ZL3Be0";

/** GID de la pestaña (en la URL: gid=...). La primera suele ser 0. Solo para CSV /export. */
const SHEETS_EXPORT_GID = "0";

/**
 * Clave de API (Google Cloud → Credenciales). Dejala "" para solo CSV.
 * No subas la clave a repos públicos. La hoja: “Cualquiera con el enlace” → Lector.
 */
const SHEETS_API_KEY = "AIzaSyBFZ9sYGuKbQkBMAr-V9yqo4ZpEWu5FKmk";

/**
 * Si la API falla y esto es true, se intenta CSV (a menudo cacheado y deso).
 * Con false (recomendado): con clave configurada solo se usa la API y ves el error real.
 */
const SHEETS_ALLOW_CSV_FALLBACK_ON_API_ERROR = false;

/**
 * Rango a leer con la API v4. Primera pestaña: "A1:Z2000". Otra pestaña: "'Nombre pestaña'!A1:Z2000".
 */
const SHEETS_API_RANGE = "A1:Z2000";

/** Hora de la última carga exitosa (se muestra en la meta). */
let catalogLoadedAt = null;

/**
 * URL del Web App (…/exec): definila en pedidos-url.js (recomendado) o acá como respaldo.
 */
const ORDERS_WEBAPP_URL_INLINE = "";

function getOrdersWebAppUrl() {
  try {
    const fromFile =
      typeof window !== "undefined" && window.CATALOGO_ORDERS_WEBAPP_URL != null
        ? String(window.CATALOGO_ORDERS_WEBAPP_URL).trim()
        : "";
    if (fromFile) return fromFile;
  } catch {
    /* ignorar */
  }
  return (ORDERS_WEBAPP_URL_INLINE || "").trim();
}

function getCallMeBotWhatsappConfig() {
  try {
    const cfg =
      typeof window !== "undefined" && window.CATALOGO_CALLMEBOT_WHATSAPP
        ? window.CATALOGO_CALLMEBOT_WHATSAPP
        : null;
    const phone = String(cfg?.phone || "").replace(/\D/g, "");
    const apikey = String(cfg?.apikey || "").trim();
    if (phone && apikey) return { phone, apikey };
  } catch {
    /* ignorar */
  }
  return null;
}

async function sendCallMeBotWhatsapp(text) {
  const cfg = getCallMeBotWhatsappConfig();
  if (!cfg) {
    throw new Error(
      "Falta configurar CallMeBot. Revisa pedidos-url.js y completa phone y apikey en CATALOGO_CALLMEBOT_WHATSAPP.",
    );
  }

  const url = new URL("https://api.callmebot.com/whatsapp.php");
  url.searchParams.set("phone", cfg.phone);
  url.searchParams.set("text", text);
  url.searchParams.set("apikey", cfg.apikey);

  await fetch(url.toString(), {
    method: "GET",
    mode: "no-cors",
    cache: "no-store",
  });
}

/**
 * Envío compatible con Web Apps de Google Apps Script (CORS / redirecciones).
 * Primero application/x-www-form-urlencoded (evita preflight); si falla la red, reintenta con text/plain.
 */
async function fetchGasOrderWebApp(url, payload) {
  const bodyJson = JSON.stringify(payload);
  const common = {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "follow",
  };

  /* Primero JSON en cuerpo text/plain (Apps Script suele leerlo con JSON.parse(postData.contents)).
   * Respaldo: x-www-form-urlencoded con campo "payload" (ver parsePostJson_ en PedidosWebApp.gs). */
  let res;
  try {
    res = await fetch(url, {
      ...common,
      body: bodyJson,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (firstErr) {
    try {
      const form = new URLSearchParams();
      form.set("payload", bodyJson);
      res = await fetch(url, {
        ...common,
        body: form.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {
      const origin =
        typeof window !== "undefined" && window.location ? window.location.origin : "";
      const hint =
        "No se pudo conectar con Google (failed to fetch).\n\n" +
        "• Comprobá Internet, VPN o extensiones (bloqueadores).\n" +
        "• En Apps Script: Desplegar → Nueva implementación → Aplicación web → Acceso: Cualquier persona. Copiá la URL que termina en /exec.\n" +
        "• Volvé a pegar esa URL en pedidos-url.js y guardá.\n" +
        (origin.startsWith("http://127.0.0.1") || origin.startsWith("http://localhost")
          ? "• Servidor local " + origin + " está bien; el Web App debe ser https://script.google.com/…\n"
          : "");
      throw new Error(hint);
    }
  }

  const raw = await res.text();
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("<!") || trimmed.toLowerCase().startsWith("<html")) {
    throw new Error(
      "Google devolvió una página HTML (suele ser permisos o sesión). Revisá que el Web App esté como “Cualquier persona” y que la URL sea la de Desplegar (/exec), no la del editor.",
    );
  }

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* ignorar */
  }
  if (!data || typeof data !== "object") {
    throw new Error(
      res.ok
        ? "El servidor no devolvió JSON válido. Revisá el código y volvé a desplegar PedidosWebApp.gs."
        : `Error del servidor (HTTP ${res.status}).`,
    );
  }
  if (!data.ok) {
    throw new Error(data.error || "No se pudo registrar el pedido.");
  }
  return data;
}

/**
 * Opcional: misma cadena que la propiedad del script SUBMIT_SECRET en Google Apps Script.
 * Recomendado en producción para evitar abusos del endpoint público.
 */
const ORDERS_SUBMIT_SECRET = "";

/** WhatsApp del negocio para wa.me (solo dígitos, sin +). Ej. +56 9 71677366 → 56971677366 */
const ORDERS_WHATSAPP_WA_ME = "56971677366";

/** Líneas de solicitud: sku → { nombre, sku, cantidad }. */
const requestLines = new Map();

const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

function parseCSV(text) {
  const rows = [];
  let i = 0;
  let row = [];
  let field = "";
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const rawHeaders = rows[0].map((h) => h.trim());
  const headers = rawHeaders.map((h, idx) => {
    if (h) return h;
    return `_col${idx}`;
  });

  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((key, j) => {
      obj[key] = (cells[j] ?? "").trim();
    });
    return obj;
  });
}

function normalizeProduct(row) {
  const sku = row.SKU ?? row.sku ?? "";
  const nombre = row.Producto ?? row.producto ?? "";
  const categoria = row.Categoría ?? row["Categoría"] ?? row.Categoria ?? "";
  const descripcion = row.Descripción ?? row["Descripción"] ?? row.Descripcion ?? "";
  const precioRaw = row.Precio ?? row.precio ?? "0";
  const stockRaw = row["Stock"] ?? row["Stock "] ?? row.Stock ?? "0";
  const imagen = row.Imagen ?? row.imagen ?? "";

  const precio = Number(String(precioRaw).replace(/\s/g, "").replace(",", ".")) || 0;
  const stock = parseInt(String(stockRaw).replace(/\D/g, ""), 10);
  const stockNum = Number.isFinite(stock) ? stock : 0;

  return {
    sku,
    nombre,
    categoria,
    descripcion,
    precio,
    stock: stockNum,
    imagen: imagen.startsWith("http") ? imagen : "",
  };
}

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  return node;
}

function priceText(p) {
  if (p.precio <= 0) return "Consultar";
  return money.format(p.precio);
}

function stockText(p) {
  if (p.stock <= 0) return "Sin unidades";
  return String(p.stock);
}

function renderTechPanel(p) {
  const panel = el("div", "tech-panel");
  const row1 = el("div", "tech-panel__row");
  row1.appendChild(el("span", "tech-panel__cell", { text: `Precio: ${priceText(p)}` }));
  row1.appendChild(el("span", "tech-panel__cell", { text: `Stock: ${stockText(p)}` }));
  panel.appendChild(row1);
  const row2 = el("div", "tech-panel__row tech-panel__row--wide");
  row2.appendChild(
    el("span", "tech-panel__desc", { text: p.descripcion ? p.descripcion : "—" }),
  );
  panel.appendChild(row2);
  return panel;
}

function clampRequestQty(n) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x) || x < 1) return 1;
  if (x > 9999) return 9999;
  return x;
}

function productKey(p) {
  const sku = p.sku || "";
  return sku || `__${p.nombre || ""}`;
}

function groupProductsByCategory(products) {
  const map = new Map();
  products.forEach((p) => {
    const c = (p.categoria || "").trim() || "Sin categoría";
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(p);
  });
  map.forEach((arr) => {
    arr.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
  });
  return map;
}

function collectOpenRequestCategories() {
  const out = new Set();
  document.querySelectorAll("#request-category-picker details.request-cat[open]").forEach((d) => {
    const c = d.getAttribute("data-category");
    if (c != null) out.add(c);
  });
  return out;
}

function applyRequestLineFromPicker(key, sku, nombre, value) {
  const raw = Math.floor(Number(value));
  if (!Number.isFinite(raw) || raw < 1) {
    requestLines.delete(key);
  } else {
    requestLines.set(key, {
      sku: sku || "—",
      nombre: nombre || "Sin nombre",
      cantidad: clampRequestQty(raw),
    });
  }
  updateRequestFab();
  if (isRequestDrawerOpen()) renderRequestLines();
}

function syncPickerInputsFromRequestLines() {
  document.querySelectorAll("#request-category-picker .request-picker-row[data-request-key]").forEach((row) => {
    const key = row.getAttribute("data-request-key");
    if (!key) return;
    const inp = row.querySelector("input.qty-input-pick");
    if (!inp) return;
    const qty = requestLines.get(key)?.cantidad ?? 0;
    const display = qty < 1 ? "0" : String(qty);
    if (inp.value !== display) inp.value = display;
  });
}

function renderRequestPickerRow(p) {
  const key = productKey(p);
  const qty = requestLines.get(key)?.cantidad ?? 0;
  const row = el("div", "request-picker-row");
  row.setAttribute("data-request-key", key);
  row.setAttribute("data-sku", p.sku || "");
  row.setAttribute("data-nombre", p.nombre || "");

  const info = el("div", "request-picker-row__info");
  info.appendChild(el("span", "request-picker-row__name", { text: p.nombre || "Sin nombre" }));
  const metaBits = [];
  if (p.sku) metaBits.push(`SKU ${p.sku}`);
  metaBits.push(priceText(p));
  info.appendChild(el("span", "request-picker-row__meta", { text: metaBits.join(" · ") }));

  const controls = el("div", "request-picker-row__controls");
  const qWrap = el("div", "product-actions__qty product-actions__qty--picker");
  const minus = el("button", "btn-qty picker-qty-min", { type: "button", text: "−", "aria-label": "Menos" });
  const input = el("input", "qty-input qty-input-pick", {
    type: "number",
    min: "0",
    max: "9999",
    value: String(qty < 1 ? 0 : qty),
    "aria-label": `Cantidad en solicitud: ${p.nombre || p.sku || "producto"}`,
  });
  const plus = el("button", "btn-qty picker-qty-plus", { type: "button", text: "+", "aria-label": "Más" });
  qWrap.appendChild(minus);
  qWrap.appendChild(input);
  qWrap.appendChild(plus);
  controls.appendChild(qWrap);
  row.appendChild(info);
  row.appendChild(controls);
  return row;
}

function renderRequestCategoryPicker() {
  const mount = document.getElementById("request-category-picker");
  if (!mount) return;
  const wasOpen = collectOpenRequestCategories();
  mount.replaceChildren();

  if (!allProducts.length) {
    mount.appendChild(
      el("p", "request-empty", {
        text: "Cuando el catálogo cargue, acá verás las categorías para armar tu solicitud.",
      }),
    );
    return;
  }

  const grouped = groupProductsByCategory(allProducts);
  const categories = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b, "es"));

  categories.forEach((cat) => {
    const list = grouped.get(cat) || [];
    const details = el("details", "request-cat");
    details.setAttribute("data-category", cat);
    if (wasOpen.has(cat)) details.open = true;

    const sum = el("summary", "request-cat__summary");
    sum.appendChild(el("span", "request-cat__title", { text: cat }));
    sum.appendChild(el("span", "request-cat__count", { text: String(list.length) }));

    const body = el("div", "request-cat__body");
    list.forEach((prod) => body.appendChild(renderRequestPickerRow(prod)));
    details.appendChild(sum);
    details.appendChild(body);
    mount.appendChild(details);
  });
}

function bindRequestCategoryPicker() {
  const mount = document.getElementById("request-category-picker");
  if (!mount || mount.dataset.bound === "1") return;
  mount.dataset.bound = "1";

  mount.addEventListener("click", (e) => {
    const minus = e.target.closest(".picker-qty-min");
    const plus = e.target.closest(".picker-qty-plus");
    if (!minus && !plus) return;
    const row = e.target.closest("[data-request-key]");
    if (!row) return;
    const key = row.getAttribute("data-request-key");
    const sku = row.getAttribute("data-sku") || "";
    const nombre = row.getAttribute("data-nombre") || "";
    const inp = row.querySelector("input.qty-input-pick");
    if (!key || !inp) return;
    let v = Math.floor(Number(inp.value));
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (minus) v = Math.max(0, v - 1);
    if (plus) v = Math.min(9999, v + 1);
    inp.value = String(v);
    applyRequestLineFromPicker(key, sku, nombre, v);
  });

  mount.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.classList.contains("qty-input-pick")) return;
    const row = t.closest("[data-request-key]");
    if (!row) return;
    const key = row.getAttribute("data-request-key");
    const sku = row.getAttribute("data-sku") || "";
    const nombre = row.getAttribute("data-nombre") || "";
    if (!key) return;
    const raw = t.value.trim() === "" ? 0 : Math.floor(Number(t.value));
    const v = !Number.isFinite(raw) || raw < 0 ? 0 : Math.min(9999, raw);
    t.value = String(v);
    applyRequestLineFromPicker(key, sku, nombre, v);
  });
}

function requestLineCount() {
  let n = 0;
  requestLines.forEach((line) => {
    n += line.cantidad;
  });
  return n;
}

function updateRequestLineKey(key, cantidad) {
  const line = requestLines.get(key);
  if (!line) return;
  const raw = Math.floor(Number(cantidad));
  if (!Number.isFinite(raw) || raw < 1) {
    requestLines.delete(key);
  } else {
    requestLines.set(key, { ...line, cantidad: clampRequestQty(raw) });
  }
  updateRequestFab();
  if (isRequestDrawerOpen()) renderRequestLines();
}

function updateRequestFab() {
  const badge = document.getElementById("request-fab-count");
  const fab = document.getElementById("request-fab");
  if (!badge || !fab) return;
  const n = requestLineCount();
  const kinds = requestLines.size;
  if (kinds === 0) {
    badge.textContent = "0";
    badge.hidden = true;
    fab.classList.remove("request-fab--has-items");
  } else {
    badge.hidden = false;
    badge.textContent = String(n);
    fab.classList.add("request-fab--has-items");
  }
}

function isRequestDrawerOpen() {
  const drawer = document.getElementById("request-drawer");
  return drawer && !drawer.hidden;
}

let requestFeedbackTimer = 0;
function flashRequestFeedback(msg, durationMs = 3200) {
  const node = document.getElementById("request-feedback");
  if (!node) return;
  node.textContent = msg || "";
  if (requestFeedbackTimer) clearTimeout(requestFeedbackTimer);
  requestFeedbackTimer = setTimeout(() => {
    node.textContent = "";
    requestFeedbackTimer = 0;
  }, durationMs);
}

function readRequestContact() {
  const name = (document.getElementById("request-name")?.value || "").trim();
  const contact = (document.getElementById("request-contact-line")?.value || "").trim();
  const deliveryAddress = (document.getElementById("request-delivery-address")?.value || "").trim();
  const notes = (document.getElementById("request-notes")?.value || "").trim();
  return { name, contact, deliveryAddress, notes };
}

function buildRequestPlainText() {
  const { name, contact, deliveryAddress, notes } = readRequestContact();
  const lines = [];
  lines.push("Solicitud de productos — GMEXPRESS");
  lines.push(`Fecha: ${new Date().toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}`);
  if (name) lines.push(`Solicitante: ${name}`);
  if (contact) lines.push(`Contacto: ${contact}`);
  if (deliveryAddress) lines.push(`Dirección de entrega: ${deliveryAddress}`);
  if (notes) lines.push(`Comentarios: ${notes}`);
  lines.push("");
  lines.push("Detalle:");
  if (requestLines.size === 0) lines.push("(sin ítems)");
  else {
    const sorted = Array.from(requestLines.entries()).sort((a, b) =>
      (a[1].nombre || "").localeCompare(b[1].nombre || "", "es"),
    );
    sorted.forEach(([, line]) => {
      lines.push(`- ${line.nombre} · SKU ${line.sku} · cantidad: ${line.cantidad}`);
    });
  }
  return lines.join("\n");
}

function validateRequestContact() {
  const { name, contact, deliveryAddress } = readRequestContact();
  if (!name) return "Ingresá nombre o empresa.";
  if (!contact) return "Ingresá un correo o teléfono de contacto.";
  if (!deliveryAddress) return "Ingresá la dirección de entrega.";
  return "";
}

function findProductByRequestKey(key) {
  return allProducts.find((p) => productKey(p) === key) || null;
}

function validateRequestStock() {
  for (const [key, line] of requestLines) {
    const p = findProductByRequestKey(key);
    if (!p) {
      return `No se encontró el producto «${line.nombre || "—"}» en el catálogo actual.`;
    }
    const st = Number(p.stock) || 0;
    if (line.cantidad > st) {
      return `Stock insuficiente para «${line.nombre}» (disponible: ${st}, pedido: ${line.cantidad}).`;
    }
  }
  return "";
}

function buildOrderSubmitPayload() {
  const { name, contact, deliveryAddress, notes } = readRequestContact();
  const items = Array.from(requestLines.values()).map((line) => ({
    sku: line.sku,
    nombre: line.nombre,
    cantidad: line.cantidad,
  }));
  return {
    secret: ORDERS_SUBMIT_SECRET || "",
    name,
    contact,
    deliveryAddress,
    notes,
    items,
  };
}

function applyLocalStockAfterOrder() {
  for (const [key, line] of requestLines) {
    const p = findProductByRequestKey(key);
    if (!p) continue;
    const next = (Number(p.stock) || 0) - line.cantidad;
    p.stock = Math.max(0, next);
  }
}

function clearRequestFormAndLines() {
  requestLines.clear();
  const ids = ["request-name", "request-contact-line", "request-delivery-address", "request-notes"];
  ids.forEach((id) => {
    const node = document.getElementById(id);
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) node.value = "";
  });
}

function buildWhatsAppPrefillText() {
  const body = buildRequestPlainText();
  const max = 3500;
  if (body.length <= max) return body;
  return `${body.slice(0, max - 40)}\n...(texto recortado por largo)`;
}

function showSuccessModal() {
  const modal = document.getElementById("success-modal");
  if (!modal) return;
  modal.hidden = false;
}

function closeSuccessModal() {
  const modal = document.getElementById("success-modal");
  if (!modal) return;
  modal.hidden = true;
}

function wireSuccessModal() {
  const modal = document.getElementById("success-modal");
  const closeBtn = document.getElementById("success-modal-close");
  
  if (!modal || !closeBtn) return;
  
  closeBtn.addEventListener("click", () => closeSuccessModal());
  
  // Cerrar al hacer clic afuera del contenido
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeSuccessModal();
  });
}

function getProductPrice(key) {
  const p = findProductByRequestKey(key);
  return p ? p.precio : 0;
}

function calculateRequestTotal() {
  let total = 0;
  requestLines.forEach((line, key) => {
    const precio = getProductPrice(key);
    total += precio * line.cantidad;
  });
  return total;
}

function renderRequestLines() {
  const wrap = document.getElementById("request-lines-wrap");
  if (!wrap) return;
  wrap.replaceChildren();

  if (requestLines.size === 0) {
    wrap.appendChild(
      el("p", "request-empty", {
        text: "Tus productos seleccionados aparecerán aca.",
      }),
    );
    syncPickerInputsFromRequestLines();
    return;
  }

  const table = el("div", "request-table", { role: "table", "aria-label": "Productos en la solicitud" });
  const head = el("div", "request-table__row request-table__row--head");
  head.appendChild(el("span", "request-table__cell", { text: "Producto" }));
  head.appendChild(el("span", "request-table__cell request-table__cell--qty", { text: "Cantidad" }));
  head.appendChild(el("span", "request-table__cell request-table__cell--price", { text: "Precio" }));
  head.appendChild(el("span", "request-table__cell request-table__cell--subtotal", { text: "Subtotal" }));
  table.appendChild(head);

  const sorted = Array.from(requestLines.entries()).sort((a, b) =>
    (a[1].nombre || "").localeCompare(b[1].nombre || "", "es"),
  );

  let totalPrice = 0;
  sorted.forEach(([key, line]) => {
    const precio = getProductPrice(key);
    const subtotal = precio * line.cantidad;
    totalPrice += subtotal;

    const row = el("div", "request-table__row");
    row.appendChild(el("span", "request-table__cell request-table__cell--name", { text: line.nombre }));

    const qtyCell = el("div", "request-table__cell request-table__cell--qty");
    const qWrap = el("div", "product-actions__qty product-actions__qty--table");
    const minus = el("button", "btn-qty", { type: "button", text: "−", "aria-label": "Reducir cantidad" });
    const input = el("input", "qty-input", {
      type: "number",
      min: "1",
      max: "9999",
      value: String(line.cantidad),
      "aria-label": `Cantidad de ${line.nombre}`,
    });
    const plus = el("button", "btn-qty", { type: "button", text: "+", "aria-label": "Aumentar cantidad" });
    qWrap.appendChild(minus);
    qWrap.appendChild(input);
    qWrap.appendChild(plus);
    qtyCell.appendChild(qWrap);

    const bump = (delta) => {
      updateRequestLineKey(key, Number(input.value) + delta);
    };
    minus.addEventListener("click", () => bump(-1));
    plus.addEventListener("click", () => bump(1));
    input.addEventListener("change", () => {
      updateRequestLineKey(key, Number(input.value));
    });

    row.appendChild(qtyCell);
    row.appendChild(el("span", "request-table__cell request-table__cell--price", { text: priceText({ precio }) }));
    row.appendChild(el("span", "request-table__cell request-table__cell--subtotal", { text: money.format(subtotal) }));

    table.appendChild(row);
  });

  // Agregar fila de total
  const totalRow = el("div", "request-table__row request-table__row--total");
  totalRow.appendChild(el("span", "request-table__cell", { text: "" }));
  totalRow.appendChild(el("span", "request-table__cell", { text: "" }));
  totalRow.appendChild(el("span", "request-table__cell request-table__cell--total-label", { text: "TOTAL:" }));
  totalRow.appendChild(el("span", "request-table__cell request-table__cell--total-price", { text: money.format(totalPrice) }));
  table.appendChild(totalRow);

  wrap.appendChild(table);
  syncPickerInputsFromRequestLines();
}

function openRequestDrawer() {
  const drawer = document.getElementById("request-drawer");
  const fab = document.getElementById("request-fab");
  const panel = drawer?.querySelector(".request-drawer__panel");
  if (!drawer || !fab) return;
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  fab.setAttribute("aria-expanded", "true");
  document.body.classList.add("request-drawer-open");
  renderRequestCategoryPicker();
  renderRequestLines();
  requestAnimationFrame(() => {
    panel?.focus();
  });
}

function closeRequestDrawer() {
  const drawer = document.getElementById("request-drawer");
  const fab = document.getElementById("request-fab");
  if (!drawer || !fab) return;
  drawer.hidden = true;
  drawer.setAttribute("aria-hidden", "true");
  fab.setAttribute("aria-expanded", "false");
  document.body.classList.remove("request-drawer-open");
  fab.focus();
}

function wireRequestDrawer() {
  bindRequestCategoryPicker();
  const fab = document.getElementById("request-fab");
  const backdrop = document.getElementById("request-drawer-backdrop");
  const closeBtn = document.getElementById("request-drawer-close");
  const submitBtn = document.getElementById("request-btn-submit");

  fab?.addEventListener("click", () => {
    if (!isRequestDrawerOpen()) openRequestDrawer();
  });
  backdrop?.addEventListener("click", () => closeRequestDrawer());
  closeBtn?.addEventListener("click", () => closeRequestDrawer());

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isRequestDrawerOpen()) {
      ev.preventDefault();
      closeRequestDrawer();
    }
  });

  submitBtn?.addEventListener("click", () => {
    void handleRequestSubmit(submitBtn);
  });

  updateRequestFab();
}

async function handleRequestSubmit(submitBtn) {
  if (!(submitBtn instanceof HTMLButtonElement)) return;

  if (requestLines.size === 0) {
    flashRequestFeedback("Agregá al menos un producto a la solicitud.");
    return;
  }
  const errContact = validateRequestContact();
  if (errContact) {
    flashRequestFeedback(errContact);
    return;
  }
  const errStock = validateRequestStock();
  if (errStock) {
    flashRequestFeedback(errStock);
    return;
  }

  const url = getOrdersWebAppUrl();
  if (!url) {
    flashRequestFeedback(
      "Falta la URL del Web App de pedidos.\n\n" +
        "1) Abri pedidos-url.js en esta carpeta y pega la URL .../exec entre comillas (variable CATALOGO_ORDERS_WEBAPP_URL).\n" +
        "2) Esa URL sale de Google Sheets > Extensiones > Apps Script > Desplegar > Aplicacion web.\n" +
        "3) Alternativa: pega la misma URL en Script.js en ORDERS_WEBAPP_URL_INLINE.",
      12000,
    );
    return;
  }

  const payload = buildOrderSubmitPayload();
  const prevLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando…";

  try {
    const whatsappPrefill = buildWhatsAppPrefillText();
    await fetchGasOrderWebApp(url, payload);
    await sendCallMeBotWhatsapp(whatsappPrefill);
    applyLocalStockAfterOrder();
    clearRequestFormAndLines();
    updateRequestFab();
    renderGrid();
    renderRequestCategoryPicker();
    renderRequestLines();

    showSuccessModal();
    closeRequestDrawer();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    flashRequestFeedback(msg, msg.length > 160 ? 14000 : 3200);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = prevLabel;
  }
}

function renderBadgeStack(p, compact) {
  const stack = el("div", compact ? "badge-stack badge-stack--compact" : "badge-stack");
  if (p.categoria) {
    stack.appendChild(el("span", "pill pill--brand", { text: p.categoria }));
  }
  stack.appendChild(el("span", "pill pill--product", { text: p.nombre || "Sin nombre" }));
  stack.appendChild(
    el("span", "pill pill--code", { text: `Código SKU: ${p.sku || "—"}` }),
  );
  return stack;
}

function renderProductMedia(p) {
  const media = el("div", "product-visual");
  if (p.imagen) {
    const img = el("img", "", {
      src: p.imagen,
      alt: p.nombre || "Producto",
      loading: "lazy",
    });
    img.addEventListener("error", () => {
      media.replaceChildren();
      media.classList.add("product-visual--ph");
      media.appendChild(
        el("span", "product-visual__ph-icon", { "aria-hidden": "true", text: "◆" }),
      );
    });
    media.appendChild(img);
  } else {
    media.classList.add("product-visual--ph");
    media.appendChild(
      el("span", "product-visual__ph-icon", { "aria-hidden": "true", text: "◆" }),
    );
  }
  return media;
}

function renderHeroProduct(p) {
  const wrap = el("div", "hero-fs");
  wrap.appendChild(renderProductMedia(p));
  const aside = el("div", "hero-fs__aside");
  aside.appendChild(renderBadgeStack(p, false));
  aside.appendChild(renderTechPanel(p));
  wrap.appendChild(aside);
  return wrap;
}

function renderGridProduct(p) {
  const card = el("article", "card-fs");
  card.appendChild(renderProductMedia(p));
  const aside = el("div", "card-fs__aside");
  aside.appendChild(renderBadgeStack(p, true));
  aside.appendChild(renderTechPanel(p));
  card.appendChild(aside);
  return card;
}

let allProducts = [];
let activeCategory = "todas";
let searchQuery = "";
let currentPage = 1;
const PRODUCTS_PER_PAGE = 8;

function getCategories(products) {
  const set = new Set();
  products.forEach((p) => {
    if (p.categoria) set.add(p.categoria);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

function filteredProducts() {
  const q = searchQuery.trim().toLowerCase();
  return allProducts.filter((p) => {
    if (activeCategory !== "todas" && p.categoria !== activeCategory) return false;
    if (!q) return true;
    const blob = [p.sku, p.nombre, p.categoria, p.descripcion].join(" ").toLowerCase();
    return blob.includes(q);
  });
}

function renderFilters(categories) {
  const wrap = document.getElementById("category-filters");
  wrap.replaceChildren();

  const mkChip = (label, value) => {
    const btn = el("button", "filter-chip", { type: "button", text: label });
    if (value === activeCategory) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      activeCategory = value;
      currentPage = 1;
      wrap.querySelectorAll(".filter-chip").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderGrid();
    });
    return btn;
  };

  wrap.appendChild(mkChip("Todas", "todas"));
  categories.forEach((c) => wrap.appendChild(mkChip(c, c)));
}

function updateHeaderCategory() {
  const node = document.getElementById("header-category");
  if (!node) return;
  node.textContent =
    activeCategory === "todas" ? "Todas las categorías" : activeCategory;
}

function renderPagination(totalPages) {
  const paginationEl = document.getElementById("pagination");
  if (!paginationEl) return;
  paginationEl.replaceChildren();

  if (totalPages <= 1) return;

  const nav = el("nav", "pagination-nav", { "aria-label": "Paginación" });
  
  // Botón anterior
  if (currentPage > 1) {
    const prevBtn = el("button", "pagination-btn pagination-btn--prev", { type: "button", text: "← Anterior" });
    prevBtn.addEventListener("click", () => {
      currentPage--;
      renderGrid();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    nav.appendChild(prevBtn);
  }

  // Números de página
  const pagesWrap = el("div", "pagination-numbers");
  for (let i = 1; i <= totalPages; i++) {
    const pageBtn = el("button", currentPage === i ? "pagination-btn pagination-btn--number is-active" : "pagination-btn pagination-btn--number", {
      type: "button",
      text: String(i),
    });
    pageBtn.addEventListener("click", () => {
      currentPage = i;
      renderGrid();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    pagesWrap.appendChild(pageBtn);
  }
  nav.appendChild(pagesWrap);

  // Botón siguiente
  if (currentPage < totalPages) {
    const nextBtn = el("button", "pagination-btn pagination-btn--next", { type: "button", text: "Siguiente →" });
    nextBtn.addEventListener("click", () => {
      currentPage++;
      renderGrid();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    nav.appendChild(nextBtn);
  }

  paginationEl.appendChild(nav);
}

function renderGrid() {
  const heroEl = document.getElementById("hero-feature");
  const grid = document.getElementById("product-grid");
  const meta = document.getElementById("meta-line");
  const foot = document.getElementById("catalog-page-foot");
  const badgeNum = document.getElementById("page-badge-num");
  const list = filteredProducts();

  updateHeaderCategory();
  heroEl.replaceChildren();
  grid.replaceChildren();

  if (!list.length) {
    heroEl.hidden = true;
    grid.appendChild(
      el("p", "catalog-empty", {
        text: "No hay productos con los filtros actuales. Probá otra categoría o limpiá la búsqueda.",
      }),
    );
    meta.hidden = false;
    const timeNoteEmpty = "";
    meta.textContent = `0 productos · ${allProducts.length} en catálogo${timeNoteEmpty}`;
    if (foot) foot.hidden = false;
    if (badgeNum) badgeNum.textContent = "00";
    document.getElementById("pagination").replaceChildren();
    return;
  }

  heroEl.hidden = true;

  // Calcular paginación
  const totalPages = Math.ceil(list.length / PRODUCTS_PER_PAGE);
  if (currentPage > totalPages) currentPage = totalPages;
  
  const startIdx = (currentPage - 1) * PRODUCTS_PER_PAGE;
  const endIdx = startIdx + PRODUCTS_PER_PAGE;
  const pageProducts = list.slice(startIdx, endIdx);

  for (let i = 0; i < pageProducts.length; i++) {
    grid.appendChild(renderGridProduct(pageProducts[i]));
  }

  meta.hidden = false;
  const timeNote = "";
  meta.textContent = `${list.length} producto${list.length === 1 ? "" : "s"} · ${allProducts.length} en total${timeNote}`;
  if (foot) foot.hidden = false;
  if (badgeNum) {
    const n = Math.min(99, Math.max(1, list.length));
    badgeNum.textContent = String(n).padStart(2, "0");
  }

  // Renderizar paginación
  renderPagination(totalPages);
}

function showLoading(show) {
  document.getElementById("state-loading").hidden = !show;
  if (show) {
    const body = document.getElementById("catalog-body");
    if (body) body.hidden = true;
    const foot = document.getElementById("catalog-page-foot");
    if (foot) foot.hidden = true;
  }
}

function showError(message) {
  showLoading(false);
  document.getElementById("state-error").hidden = false;
  document.getElementById("error-detail").textContent = message || "Error desconocido.";
  const body = document.getElementById("catalog-body");
  if (body) body.hidden = true;
  const foot = document.getElementById("catalog-page-foot");
  if (foot) foot.hidden = true;
  document.getElementById("meta-line").hidden = true;
}

function showCatalog() {
  showLoading(false);
  document.getElementById("state-error").hidden = true;
  const body = document.getElementById("catalog-body");
  if (body) body.hidden = false;
  const foot = document.getElementById("catalog-page-foot");
  if (foot) foot.hidden = false;
}

function applyProductsFromRows(rows) {
  const objects = rowsToObjects(rows);
  allProducts = objects.map(normalizeProduct).filter((p) => p.sku || p.nombre);

  if (!allProducts.length) {
    throw new Error("La hoja no tiene filas de productos reconocibles.");
  }

  // Ordenar productos por categoría y luego por nombre alfabéticamente
  allProducts.sort((a, b) => {
    const catA = (a.categoria || "Sin categoría").toLowerCase();
    const catB = (b.categoria || "Sin categoría").toLowerCase();
    const catCmp = catA.localeCompare(catB, "es");
    if (catCmp !== 0) return catCmp;
    return (a.nombre || "").localeCompare(b.nombre || "", "es");
  });

  renderFilters(getCategories(allProducts));
  renderGrid();
  if (isRequestDrawerOpen()) {
    renderRequestCategoryPicker();
    renderRequestLines();
  }
}

function applyProductsFromCsvText(text) {
  applyProductsFromRows(parseCSV(text));
}

function buildPublishedCsvUrl() {
  const u = new URL(SHEETS_CSV_URL);
  u.searchParams.set("_cb", String(Date.now()));
  return u.toString();
}

function buildExportCsvUrl() {
  const id = SHEETS_DOC_EXPORT_ID.trim();
  const gid = (SHEETS_EXPORT_GID || "0").trim() || "0";
  const u = new URL(`https://docs.google.com/spreadsheets/d/${id}/export`);
  u.searchParams.set("format", "csv");
  u.searchParams.set("gid", gid);
  u.searchParams.set("_cb", String(Date.now()));
  return u.toString();
}

function responseLooksLikeHtml(text) {
  const head = text.slice(0, 800).trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

async function fetchOneCsv(url) {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    mode: "cors",
    headers: {
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const text = await res.text();
  if (responseLooksLikeHtml(text)) {
    throw new Error(
      "Google devolvió HTML en vez del CSV (permisos). Si usás ID de documento, la hoja debe estar en “Cualquiera con el enlace puede ver”.",
    );
  }
  return text;
}

async function fetchCsvFromSheets() {
  if (SHEETS_DOC_EXPORT_ID.trim()) {
    try {
      return await fetchOneCsv(buildExportCsvUrl());
    } catch {
      return await fetchOneCsv(buildPublishedCsvUrl());
    }
  }
  return await fetchOneCsv(buildPublishedCsvUrl());
}

/**
 * Valores vía Sheets API v4 (lectura alineada con el documento). Requiere SHEETS_API_KEY + ID y hoja compartida.
 * @see https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/get
 */
async function fetchRowsFromSheetsApi() {
  const spreadsheetId = SHEETS_DOC_EXPORT_ID.trim();
  const key = SHEETS_API_KEY.trim();
  if (!spreadsheetId || !key) {
    throw new Error("Falta SHEETS_API_KEY o SHEETS_DOC_EXPORT_ID.");
  }
  const range = (SHEETS_API_RANGE || "A1:Z2000").trim();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const url = new URL(base);
  url.searchParams.set("key", key);
  /* Respuesta parcial: menos caché intermedio y payload más chico */
  url.searchParams.set("fields", "values");

  const res = await fetch(url.toString(), {
    cache: "no-store",
    credentials: "omit",
    mode: "cors",
    headers: {
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const apiMsg = data.error && data.error.message ? data.error.message : res.statusText;
    throw new Error(`Sheets API: ${apiMsg}`);
  }
  if (!data.values || !Array.isArray(data.values) || data.values.length === 0) {
    throw new Error(
      'La API devolvió celdas vacías. Revisá SHEETS_API_RANGE (ej. primera hoja: "A1:Z2000" o "\'Mi pestaña\'!A1:Z2000").',
    );
  }
  return data.values.map((row) => (Array.isArray(row) ? row : []).map((c) => String(c ?? "").trim()));
}

/** Filas: con clave de API → solo API (sin caer en CSV viejo). Sin clave → CSV. */
async function fetchCatalogRows() {
  if (SHEETS_API_KEY.trim() && SHEETS_DOC_EXPORT_ID.trim()) {
    try {
      return await fetchRowsFromSheetsApi();
    } catch (e) {
      if (SHEETS_ALLOW_CSV_FALLBACK_ON_API_ERROR) {
        const text = await fetchCsvFromSheets();
        return parseCSV(text);
      }
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(
        `${reason} — No se usó el CSV para no mostrar datos cacheados. Revisá la clave, restricciones HTTP (referente) y SHEETS_API_RANGE, o activá SHEETS_ALLOW_CSV_FALLBACK_ON_API_ERROR si querés el respaldo CSV.`,
      );
    }
  }
  const text = await fetchCsvFromSheets();
  return parseCSV(text);
}

/** Evita que dos cargas en paralelo (p. ej. doble clic) dejen el catálogo con datos viejos. */
let catalogLoadGen = 0;

async function loadCatalog() {
  const gen = ++catalogLoadGen;
  showLoading(true);
  document.getElementById("state-error").hidden = true;
  const catalogBody = document.getElementById("catalog-body");
  if (catalogBody) catalogBody.hidden = true;
  const pageFoot = document.getElementById("catalog-page-foot");
  if (pageFoot) pageFoot.hidden = true;
  document.getElementById("meta-line").hidden = true;

  try {
    const rows = await fetchCatalogRows();
    if (gen !== catalogLoadGen) return;
    catalogLoadedAt = new Date();
    applyProductsFromRows(rows);
    if (gen !== catalogLoadGen) return;
    showCatalog();
  } catch (e) {
    if (gen !== catalogLoadGen) return;
    const msg = e instanceof Error ? e.message : String(e);
    showError(msg);
  }
}

document.getElementById("search").addEventListener("input", (ev) => {
  searchQuery = ev.target.value;
  currentPage = 1;
  renderGrid();
});

document.getElementById("btn-retry-fetch").addEventListener("click", () => {
  loadCatalog();
});

const refreshBtn = document.getElementById("btn-refresh-catalog");
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    loadCatalog();
  });
}

document.getElementById("csv-file").addEventListener("change", async (ev) => {
  const input = ev.target;
  const file = input.files && input.files[0];
  if (!file) return;

  showLoading(true);
  document.getElementById("state-error").hidden = true;

  try {
    const text = await file.text();
    catalogLoadedAt = new Date();
    applyProductsFromCsvText(text);
    showCatalog();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showError(msg);
  } finally {
    input.value = "";
  }
});

(function initFileProtocolBanner() {
  if (window.location.protocol !== "file:") return;
  const banner = document.getElementById("protocol-banner");
  const closeBtn = document.getElementById("protocol-banner-close");
  if (!banner || !closeBtn) return;
  try {
    if (sessionStorage.getItem("catalogo-file-banner-dismissed") === "1") return;
  } catch {
    /* sessionStorage no disponible */
  }
  banner.hidden = false;
  closeBtn.addEventListener("click", () => {
    banner.hidden = true;
    try {
      sessionStorage.setItem("catalogo-file-banner-dismissed", "1");
    } catch {
      /* ignorar */
    }
  });
})();

loadCatalog();
wireRequestDrawer();
wireSuccessModal();
