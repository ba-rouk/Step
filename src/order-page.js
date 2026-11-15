import "./cart-page.css";
import { apiFetch } from "./api.js";
import { readOrderConfirmation, readOrderMessage, saveOrderSession } from "./order-session.js";

const route = window.location.pathname.replace(/\/+$/, "") || "/";
const params = new URLSearchParams(window.location.search);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = value => new Intl.NumberFormat("en-RW",{style:"currency",currency:"RWF",maximumFractionDigits:0}).format(Number(value));
let selectedProduct = null;
let quantity = 1;
let sending = false;

async function request(url, options = {}) {
  const response = await fetch(url,{credentials:"same-origin",...options});
  const data = await response.json().catch(()=>({}));
  return {response,data};
}

function imageFor(product) {
  const first = Array.isArray(product?.images) ? product.images[0] : null;
  const value = (typeof first === "string" ? first : first?.url) ||
    (Array.isArray(product?.image_urls) ? product.image_urls[0] : "") || product?.image_url || "";
  try {
    const url = new URL(String(value),window.location.origin);
    return ["https:","http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function formatProductPrice(product) {
  return product?.price == null || product.price === ""
    ? "Price to be confirmed"
    : money(product.price) + " per " + (product.price_unit_label || product.price_unit || "unit");
}

function renderProduct() {
  const host = document.querySelector("#order-product-summary");
  const submit = document.querySelector("#product-order-submit");
  if (!host) return;
  if (!selectedProduct) {
    host.innerHTML = '<div class="cart-empty"><strong>Choose a menu item to order.</strong><p>Open the item you want from the Vitanova menu to see its details and price here.</p><a class="button button-dark" href="/categories">Browse the menu</a></div>';
    if (submit) submit.disabled = true;
    return;
  }
  const image = imageFor(selectedProduct);
  const price = selectedProduct.price == null || selectedProduct.price === "" ? null : Number(selectedProduct.price);
  const line = price == null ? "Quote required" : money(price * quantity);
  const unitPrice = formatProductPrice(selectedProduct);
  host.innerHTML = '<p class="eyebrow">THE ITEM YOU SELECTED</p><article class="cart-selected-item order-selected-item"><div class="cart-selected-image">' +
    (image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(selectedProduct.name) + '">' : '<div class="product-image-placeholder">VITANOVA</div>') +
    '</div><div class="cart-selected-copy"><span class="cart-selected-category">' + escapeHtml(selectedProduct.category_name || selectedProduct.category?.name || "Menu") + '</span>' +
    '<h2>' + escapeHtml(selectedProduct.name) + '</h2>' +
    (selectedProduct.description ? '<p class="cart-summary-description">' + escapeHtml(selectedProduct.description) + '</p>' : '') +
    '<div class="cart-unit-price"><span>Unit price</span><strong>' + escapeHtml(unitPrice) + '</strong></div>' +
    '<div class="cart-item-footer"><div class="order-quantity"><button type="button" data-order-quantity="decrease" aria-label="Decrease quantity" ' + (quantity <= 1 ? "disabled" : "") + '>−</button><output id="order-quantity-value">' + quantity + '</output><button type="button" data-order-quantity="increase" aria-label="Increase quantity" ' + (quantity >= 20 ? "disabled" : "") + '>+</button></div>' +
    '<div class="cart-line-total"><span>Calculated price</span><strong id="order-line-total">' + line + '</strong></div></div></div></article>' +
    '<p class="order-price-note">Calculated from the current menu price. Vitanova confirms final availability and pricing before accepting the order.</p>';
  if (submit) submit.disabled = false;
}

function embeddedProduct(reference) {
  const node = document.querySelector("#step-order-product-data");
  if (!node) return null;
  try {
    const data = JSON.parse(node.textContent || "{}");
    const product = data.product;
    if (product && (String(product.slug || "") === reference || String(product.id || "") === reference)) return product;
  } catch (error) {
    console.warn("Embedded order product could not be read:",error);
  }
  return null;
}

async function loadProduct(reference) {
  if (!reference) return null;
  const {response,data} = await request("/api/catalog/product?reference=" + encodeURIComponent(reference));
  if (!response.ok) throw new Error(data.error || "The selected product could not be loaded.");
  return data.product || null;
}

function updateDeliveryField() {
  const select = document.querySelector("#order-fulfillment");
  const label = document.querySelector("#order-location-label");
  const input = document.querySelector("#order-delivery-location");
  const value = select?.value;
  const required = value === "delivery" || value === "event";
  if (label) label.hidden = !required;
  if (input) input.required = required;
}

async function prefillSignedInCustomer(form) {
  try {
    const {response,data} = await request("/api/profile");
    if (!response.ok) return;
    const name = data.profile?.full_name || data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || "";
    const phone = data.profile?.phone || data.user?.phone || "";
    const email = data.user?.email || "";
    if (name && form.elements.customer_name) form.elements.customer_name.value = name;
    if (phone && form.elements.customer_phone) form.elements.customer_phone.value = phone;
    if (email && form.elements.customer_email) {
      form.elements.customer_email.value = email;
      form.elements.customer_email.readOnly = true;
      form.elements.customer_email.setAttribute("aria-readonly","true");
    }
  } catch (error) {
    console.warn("Customer details could not be prefilled:",error.message);
  }
}

function confirmationMessage(order,product,orderFields) {
  return [
    "Hello Vitanova, I would like to place an order.",
    "Order: " + (order?.order_number || "New order"),
    "Name: " + orderFields.customer_name,
    "Email: " + orderFields.customer_email,
    "Phone: " + orderFields.customer_phone,
    "Item: " + product.name + " × " + quantity,
    "Calculated price: " + (product.price == null ? "To be confirmed" : money(Number(product.price) * quantity)),
    "Fulfilment: " + orderFields.fulfillment,
    orderFields.requested_date ? "Preferred date: " + orderFields.requested_date : "",
    orderFields.requested_time ? "Preferred time: " + orderFields.requested_time : "",
    orderFields.delivery_location ? "Location: " + orderFields.delivery_location : "",
    orderFields.order_description ? "Order details: " + orderFields.order_description : "",
    orderFields.notes ? "Notes: " + orderFields.notes : ""
  ].filter(Boolean).join("\n");
}

async function startOrder() {
  document.body.classList.add("route-order");
  const form = document.querySelector("#product-order-form");
  const status = document.querySelector("#product-order-error");
  const submit = document.querySelector("#product-order-submit");
  if (!form) return;
  const reference = params.get("product") || "";
  selectedProduct = embeddedProduct(reference);
  renderProduct();

  if (!selectedProduct && reference) {
    try {
      selectedProduct = await loadProduct(reference);
      if (!selectedProduct) throw new Error("This menu item is no longer available. Please return to the menu.");
    } catch (error) {
      if (status) status.textContent = error.message || "The selected menu item could not be loaded.";
    }
    renderProduct();
  }

  const date = form.elements.requested_date;
  if (date) date.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,10);
  await prefillSignedInCustomer(form);
  updateDeliveryField();
  form.elements.fulfillment?.addEventListener("change",updateDeliveryField);

  document.querySelector("#order-product-summary")?.addEventListener("click",event=>{
    const button = event.target.closest("[data-order-quantity]");
    if (!button || !selectedProduct) return;
    if (button.dataset.orderQuantity === "increase") quantity = Math.min(20,quantity+1);
    if (button.dataset.orderQuantity === "decrease") quantity = Math.max(1,quantity-1);
    renderProduct();
  });

  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if (sending) return;
    if (status) status.textContent = "";
    if (!selectedProduct) {
      if (status) status.textContent = "Choose an available menu item before sending your order.";
      return;
    }
    if (!form.reportValidity()) return;
    const fields = new FormData(form);
    const orderFields = {
      customer_name:String(fields.get("customer_name")||"").trim(),
      customer_phone:String(fields.get("customer_phone")||"").trim(),
      customer_email:String(fields.get("customer_email")||"").trim(),
      fulfillment:String(fields.get("fulfillment")||"pickup"),
      requested_date:String(fields.get("requested_date")||"")||null,
      requested_time:String(fields.get("requested_time")||"")||null,
      delivery_location:String(fields.get("delivery_location")||"").trim(),
      order_description:String(fields.get("order_description")||"").trim(),
      notes:String(fields.get("notes")||"").trim(),
      website:String(fields.get("website")||"")
    };
    sending = true;
    if (submit) { submit.disabled = true; submit.textContent = "Sending order…"; }
    try {
      const response = await apiFetch("/api/orders",{
        method:"POST",
        body:{
          ...orderFields,
          items:[{product_id:selectedProduct.id,slug:selectedProduct.slug,quantity}],
          product_slug:selectedProduct.slug,
          quantity,
          cart_source:"quick"
        }
      });
      const data = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(data.error || "We could not save your order. Please check the details and try again.");
      const resultOrder = data.order || {};
      const estimated = resultOrder.estimated_total == null
        ? (selectedProduct.price == null ? null : Number(selectedProduct.price) * quantity)
        : Number(resultOrder.estimated_total);
      const message = confirmationMessage(resultOrder,selectedProduct,orderFields);
      saveOrderSession({
        order_number:resultOrder.order_number || "",
        estimated_total:estimated,
        items:[{name:selectedProduct.name,quantity,line_total:selectedProduct.price == null ? null : Number(selectedProduct.price)*quantity}]
      }, message);
      window.location.assign("/order/confirmation?order=" + encodeURIComponent(resultOrder.order_number || ""));
    } catch (error) {
      if (status) status.textContent = error.message || "Connection problem. Please try again.";
    } finally {
      sending = false;
      if (submit) { submit.disabled = !selectedProduct; submit.textContent = "Send order"; }
    }
  });
}

function renderConfirmation() {
  document.body.classList.add("route-confirmation");
  const data = readOrderConfirmation();
  const number = document.querySelector("#confirmed-order-number");
  if (number) number.textContent = params.get("order") || data.order_number || "";
  const details = document.querySelector("#confirmation-details");
  if (details) details.textContent = "Your order request has been saved. Vitanova will contact you to confirm the details and final pricing.";
  const summary = document.querySelector("#confirmation-order-summary");
  if (summary) {
    const rows = Array.isArray(data.items) ? data.items : [];
    summary.innerHTML = rows.map(item =>
      '<div class="confirmation-order-item"><span>' + escapeHtml(item.name) + ' × ' + Math.max(1,Number(item.quantity||1)) + '</span><strong>' +
      (item.line_total == null ? "Price to be confirmed" : money(item.line_total)) + '</strong></div>'
    ).join("") + (data.estimated_total == null ? "" : '<div class="confirmation-order-total"><span>Estimated total</span><strong>' + money(data.estimated_total) + '</strong></div>');
  }
  const whatsapp = document.querySelector("#confirmation-whatsapp");
  const message = readOrderMessage();
  if (whatsapp && message) {
    whatsapp.href = "https://wa.me/250793607387?text=" + encodeURIComponent(message);
    whatsapp.hidden = false;
  }
}

if (route === "/order") void startOrder();
if (route === "/order/confirmation") renderConfirmation();
