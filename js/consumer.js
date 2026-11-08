'use strict';

let products = [];
let addons = [];
let cart = [];
let checkoutSettings = null;
let activeCategory = 'todos';
let cartPreviousFocus = null;
let checkoutPreviousFocus = null;

const CUSTOMER_ICON_PATHS = Object.freeze({
  todos:'<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  lanches:'<path d="M5 11a7 7 0 0 1 14 0M3 11h18M4 11v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M7 16v2h10v-2"/>',
  pasteis:'<path d="M4 9h16a8 8 0 0 1-16 0Z"/><path d="M7 11h.01M10 13h.01M13 11h.01M16 13h.01"/>',
  combos:'<path d="M6 9h12l-1 11H7L6 9ZM8 9l1-5M12 9V4M16 9l-1-5"/>',
  sucos:'<path d="M7 7h10l-1 14H8L7 7ZM9 3h7l-3 4M8 12h8"/>',
  refrigerantes:'<path d="M8 4h8l1 17H7L8 4ZM9 8h6M10 4V2h4v2"/>',
  sobremesas:'<path d="M6 10h12l-2 10H8L6 10ZM8 10a4 4 0 0 1 8 0M12 6V3"/>',
  search:'<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  bag:'<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
});

function customerIcon(name, className = 'customer-icon') {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${CUSTOMER_ICON_PATHS[name] || CUSTOMER_ICON_PATHS.todos}</svg>`;
}

function getProduct(pid) {
  return products.find(p => p.id === pid);
}

function cartTotal() {
  return cart.reduce((sum, item) => sum + cartItemUnitPrice(item) * item.qty, 0);
}

function getAddon(addonId) {
  return addons.find(addon => addon.id === Number(addonId));
}

function selectedCartAddons(item) {
  return (item.selectedAddonIds || []).map(getAddon).filter(Boolean);
}

function cartItemUnitPrice(item) {
  return Number(item.product.price) + selectedCartAddons(item).reduce((sum, addon) => sum + addon.price, 0);
}

function cartCount() {
  return cart.reduce((s, i) => s + i.qty, 0);
}

function escapeCartHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}

function safeProductImageUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? escapeCartHtml(url.href) : '';
  } catch { return ''; }
}

function saveCart() {
  sessionStorage.setItem('dogburger_cart', JSON.stringify(cart.map(item => ({ pid:item.product.id, qty:item.qty, removedIngredients:item.removedIngredients || '', selectedAddonIds:item.selectedAddonIds || [] }))));
}

function restoreCart() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('dogburger_cart') || '[]');
    cart = saved.map(item => ({ product:getProduct(item.pid), qty:item.qty, removedIngredients:String(item.removedIngredients || '').slice(0,120), selectedAddonIds:[...new Set(Array.isArray(item.selectedAddonIds) ? item.selectedAddonIds.map(Number).filter(Number.isInteger) : [])].slice(0,10) })).filter(item => item.product && item.qty > 0);
    cart.forEach(item => {
      if (item.product.category !== 'lanches') {
        item.removedIngredients = '';
        item.selectedAddonIds = [];
      } else {
        item.selectedAddonIds = item.selectedAddonIds.filter(addonId => Boolean(getAddon(addonId)));
      }
    });
  } catch {
    cart = [];
    sessionStorage.removeItem('dogburger_cart');
  }
}

function renderCategoryTabs() {
  const el = document.getElementById('category-tabs');
  el.innerHTML = CATEGORIES.map(c =>
    `<button class="c-tab${activeCategory === c.key ? ' active' : ''}" type="button" aria-pressed="${activeCategory === c.key}" onclick="setCategory('${c.key}')">
      <span>${customerIcon(c.key)}</span><span>${escapeCartHtml(c.label)}</span>
    </button>`
  ).join('');
}

function setCategory(key) {
  activeCategory = key;
  renderCategoryTabs();
  renderProducts();
}

function renderProducts() {
  const el = document.getElementById('products-grid');
  const list = activeCategory === 'todos' ? products : products.filter(p => p.category === activeCategory);

  if (list.length === 0) {
    el.innerHTML = `<div class="catalog-empty">${customerIcon('search')}<strong>Nenhum item nesta categoria</strong><p>Escolha outra categoria para continuar.</p></div>`;
    return;
  }

  el.innerHTML = list.map(p => {
    const out = p.category === 'lanches' && Number(p.stock) <= 0;
    const cat = CAT_MAP[p.category] || { label:'Produto' };
    const imageUrl = safeProductImageUrl(p.img) || 'dogburger.png';
    return `
      <article class="product-card${out ? ' out-of-stock' : ''}">
        <div class="product-img-wrap">
          <img src="${imageUrl}" alt="${escapeCartHtml(p.name)}" loading="lazy" />
          <span class="product-cat-badge">${customerIcon(p.category)}<span>${escapeCartHtml(cat.label)}</span></span>
          ${out ? `<div class="out-label"><span>Esgotado</span></div>` : ''}
        </div>
        <div class="product-body">
          <p class="product-name">${escapeCartHtml(p.name)}</p>
          <p class="product-desc">${escapeCartHtml(p.desc)}</p>
          <div class="product-footer">
            <span class="product-price">R$ ${fmt(p.price)}</span>
            <button class="btn-add" type="button" ${out ? 'disabled' : ''} onclick="addToCart(${p.id})">${customerIcon('plus')}<span>Adicionar</span></button>
          </div>
        </div>
      </article>`;
  }).join('');
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  const count = cartCount();
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline-block' : 'none';
  document.querySelector('.btn-cart')?.setAttribute(
    'aria-label',
    count > 0 ? `Carrinho com ${count} ${count === 1 ? 'item' : 'itens'}` : 'Carrinho vazio'
  );
}

function addToCart(pid) {
  const product = getProduct(pid);
  if (!product) return;
  if (product.category === 'lanches' && Number(product.stock) <= 0) {
    showToast('Este produto está esgotado.');
    return;
  }
  const existing = cart.find(i => i.product.id === pid);
  if (existing) {
    if (product.category === 'lanches' && existing.qty >= Number(product.stock)) {
      showToast('Quantidade disponível atingida.');
      return;
    }
    existing.qty++;
  } else {
    cart.push({ product, qty: 1, removedIngredients: '', selectedAddonIds: [] });
  }
  updateCartBadge();
  renderCartItems();
  saveCart();
}

function updateQty(pid, delta) {
  const idx = cart.findIndex(i => i.product.id === pid);
  if (idx === -1) return;

  const nextQuantity = cart[idx].qty + delta;
  if (delta > 0 && cart[idx].product.category === 'lanches' && nextQuantity > Number(cart[idx].product.stock)) {
    showToast('Quantidade disponível atingida.');
    return;
  }
  cart[idx].qty = nextQuantity;
  if (cart[idx].qty <= 0) cart.splice(idx, 1);
  updateCartBadge();
  renderCartItems();
  saveCart();
}

function toggleIngredientRemoval(pid, ingredientIndex, checked) {
  const item = cart.find(cartItem => cartItem.product.id === pid);
  if (!item) return;
  const ingredient = item.product.ingredients?.[ingredientIndex];
  if (!ingredient || item.product.category !== 'lanches') return;
  const removed = new Set(String(item.removedIngredients || '').split(',').map(value => value.trim()).filter(Boolean));
  if (checked) removed.add(ingredient);
  else removed.delete(ingredient);
  item.removedIngredients = [...removed].join(', ').slice(0,120);
  saveCart();
}

function toggleCartAddon(pid, addonId, checked) {
  const item = cart.find(cartItem => cartItem.product.id === pid);
  const addon = getAddon(addonId);
  if (!item || !addon || item.product.category !== 'lanches') return;
  const selected = new Set(item.selectedAddonIds || []);
  if (checked) selected.add(addon.id);
  else selected.delete(addon.id);
  item.selectedAddonIds = [...selected].slice(0,10);
  saveCart();
  renderCartItems();
}

function renderCartItems() {
  const el = document.getElementById('cart-items-list');
  const footer = document.getElementById('cart-footer');
  const totalEl = document.getElementById('cart-total-display');

  if (cart.length === 0) {
    el.innerHTML = `<div class="cart-empty">
      <span class="cart-empty-icon">${customerIcon('bag')}</span>
      <strong>Seu carrinho está vazio</strong>
      <p>Adicione itens do cardápio para começar.</p>
    </div>`;
    footer.classList.add('hidden');
    return;
  }

  el.innerHTML = cart.map(i => {
    const isSnack = i.product.category === 'lanches';
    const ingredients = isSnack && Array.isArray(i.product.ingredients) ? i.product.ingredients : [];
    const removed = new Set(String(i.removedIngredients || '').split(',').map(value => value.trim()).filter(Boolean));
    const selectedAddonIds = new Set(i.selectedAddonIds || []);
    const ingredientsEditor = !isSnack ? '' : ingredients.length ? `
      <div class="cart-ingredients">
        <p><strong>Ingredientes:</strong> ${ingredients.map(escapeCartHtml).join(', ')}</p>
        <span>Toque nos ingredientes que deseja remover:</span>
        <div class="ingredient-removal-options">
          ${ingredients.map((ingredient, index) => `<label><input type="checkbox" ${removed.has(ingredient) ? 'checked' : ''} onchange="toggleIngredientRemoval(${i.product.id}, ${index}, this.checked)" /><span>${escapeCartHtml(ingredient)}</span></label>`).join('')}
        </div>
      </div>` : '<p class="cart-ingredients-empty">Ingredientes ainda não cadastrados para este lanche.</p>';
    const addonsEditor = !isSnack || !addons.length ? '' : `<div class="cart-addons">
      <div class="cart-addons-head"><div><strong>Quer incluir um adicional?</strong><span>O valor será aplicado a cada unidade do lanche.</span></div></div>
      <div class="cart-addon-options">
        ${addons.map(addon => `<label><input type="checkbox" ${selectedAddonIds.has(addon.id) ? 'checked' : ''} onchange="toggleCartAddon(${i.product.id}, ${addon.id}, this.checked)" /><span><b>${escapeCartHtml(addon.name)}</b><small>+ R$ ${fmt(addon.price)}</small></span></label>`).join('')}
      </div>
    </div>`;
    return `
    <div class="cart-item">
      <div class="cart-item-main">
        <img src="${safeProductImageUrl(i.product.img) || 'dogburger.png'}" alt="${escapeCartHtml(i.product.name)}" />
        <div class="cart-item-info">
          <p class="cart-item-name">${escapeCartHtml(i.product.name)}</p>
          <p class="cart-item-price">R$ ${fmt(cartItemUnitPrice(i) * i.qty)}</p>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn" type="button" aria-label="Remover uma unidade de ${escapeCartHtml(i.product.name)}" onclick="updateQty(${i.product.id}, -1)">${customerIcon('minus')}</button>
          <span class="qty-val">${i.qty}</span>
          <button class="qty-btn plus" type="button" aria-label="Adicionar uma unidade de ${escapeCartHtml(i.product.name)}" onclick="updateQty(${i.product.id}, 1)">${customerIcon('plus')}</button>
        </div>
      </div>
      ${ingredientsEditor}
      ${addonsEditor}
    </div>`;
  }).join('');

  totalEl.textContent = `R$ ${fmt(cartTotal())}`;
  footer.classList.remove('hidden');
}

function openCart() {
  renderCartItems();
  cartPreviousFocus = document.activeElement;
  document.getElementById('cart-overlay').classList.remove('hidden');
  document.getElementById('cart-drawer').classList.remove('hidden');
  document.querySelector('#cart-drawer .btn-close').focus();
}

function closeCart() {
  if (document.getElementById('cart-drawer').classList.contains('hidden')) return;
  document.getElementById('cart-overlay').classList.add('hidden');
  document.getElementById('cart-drawer').classList.add('hidden');
  if (cartPreviousFocus?.isConnected) cartPreviousFocus.focus();
  cartPreviousFocus = null;
}

function renderCheckoutSummary() {
  document.getElementById('checkout-order-summary').innerHTML = cart.map(item => {
    const itemAddons = selectedCartAddons(item);
    return `
    <div class="checkout-summary-item">
      <div><strong>${item.qty}× ${escapeCartHtml(item.product.name)}</strong>${item.removedIngredients ? `<small>Sem: ${escapeCartHtml(item.removedIngredients)}</small>` : ''}${itemAddons.length ? `<small>Adicionais: ${itemAddons.map(addon => `${escapeCartHtml(addon.name)} (+ R$ ${fmt(addon.price)})`).join(', ')}</small>` : ''}</div>
      <span>R$ ${fmt(cartItemUnitPrice(item) * item.qty)}</span>
    </div>`;
  }).join('');
}
function selectedFulfillmentMethod() { return document.querySelector('input[name="fulfillment-method"]:checked')?.value; }
function renderCheckoutSettings() {
  const method = selectedFulfillmentMethod(); if (!checkoutSettings || !method) return;
  const subtotal = cartTotal(); const fee = method === 'delivery' && subtotal < Number(checkoutSettings.free_delivery_from) ? Number(checkoutSettings.delivery_fee) : 0;
  const eta = method === 'delivery' ? `${checkoutSettings.delivery_eta_min}–${checkoutSettings.delivery_eta_max}` : `${checkoutSettings.pickup_eta_min}–${checkoutSettings.pickup_eta_max}`;
  document.getElementById('checkout-eta').textContent = `Previsão: ${eta} min`;
  document.getElementById('checkout-totals').innerHTML = `<div class="checkout-summary-item"><span>Subtotal</span><span>R$ ${fmt(subtotal)}</span></div><div class="checkout-summary-item"><span>Taxa</span><span>${fee ? `R$ ${fmt(fee)}` : 'Grátis'}</span></div><div class="checkout-summary-item"><strong>Total estimado</strong><strong>R$ ${fmt(subtotal + fee)}</strong></div>`;
  document.getElementById('checkout-address').classList.toggle('hidden', method !== 'delivery');
}

function updatePaymentOptions() {
  const method = document.querySelector('input[name="payment-method"]:checked')?.value;
  document.getElementById('cash-change-options').classList.toggle('hidden', method !== 'dinheiro');
  if (method !== 'dinheiro') {
    document.getElementById('needs-change').checked = false;
    document.getElementById('change-for').value = '';
    document.getElementById('change-value-group').classList.add('hidden');
  }
}

function updateChangeOptions() {
  const needsChange = document.getElementById('needs-change').checked;
  document.getElementById('change-value-group').classList.toggle('hidden', !needsChange);
  if (!needsChange) document.getElementById('change-for').value = '';
}

async function refreshCartAvailability() {
  const [latestProducts, latestAddons] = await Promise.all([Store.getProducts(), Store.getAddons()]);
  const latestById = new Map(latestProducts.map(product => [product.id, product]));
  const latestAddonIds = new Set(latestAddons.map(addon => addon.id));
  const problems = [];

  cart.forEach(item => {
    const latest = latestById.get(item.product.id);
    if (!latest) {
      problems.push(`${item.product.name}: produto indisponível`);
      return;
    }
    item.product = latest;
    const selectedAddonIds = item.selectedAddonIds || [];
    const availableAddonIds = selectedAddonIds.filter(addonId => latestAddonIds.has(addonId));
    if (availableAddonIds.length !== selectedAddonIds.length) {
      item.selectedAddonIds = availableAddonIds;
      problems.push(`${latest.name}: um adicional ficou indisponível e foi removido`);
    }
    if (latest.category === 'lanches' && item.qty > Number(latest.stock)) {
      problems.push(`${latest.name}: disponível ${Number(latest.stock) || 0}, solicitado ${item.qty}`);
    }
  });

  products = latestProducts;
  addons = latestAddons;
  saveCart();
  updateCartBadge();
  renderProducts();
  renderCartItems();

  if (problems.length) {
    throw new Error(`O cardápio ou o estoque mudou. ${problems.join('; ')}. Ajuste o carrinho para continuar.`);
  }
}

async function openCheckout() {
  const { data: { user } } = await DB.auth.getUser();
  if (!user) {
    saveCart();
    window.location.href = 'entrar.html?returnTo=index.html&checkout=1';
    return;
  }
  try {
    await refreshCartAvailability();
    checkoutSettings = await Store.getStoreSettings();
  } catch (error) {
    alert(`Não foi possível continuar. ${error.message || ''}`);
    return;
  }
  const count = cart.length;
  const total = cartTotal();
  document.getElementById('checkout-sub').textContent =
    `${count} ${count === 1 ? 'item' : 'itens'} · Total R$ ${fmt(total)}`;
  renderCheckoutSummary();
  document.getElementById('customer-name').value = '';
  document.getElementById('order-note').value = '';
  document.querySelectorAll('input[name="fulfillment-method"]').forEach(input => { input.disabled = input.value === 'delivery' ? !checkoutSettings.delivery_enabled : !checkoutSettings.pickup_enabled; });
  document.querySelector(`input[name="fulfillment-method"][value="${checkoutSettings.delivery_enabled ? 'delivery' : 'pickup'}"]`).checked = true;
  document.querySelectorAll('input[name="payment-method"]').forEach(input => { input.disabled = input.value === 'pix' ? !checkoutSettings.accepts_pix : input.value === 'dinheiro' ? !checkoutSettings.accepts_cash : !checkoutSettings.accepts_card; });
  document.querySelector(`input[name="payment-method"]:not(:disabled)`).checked = true;
  updatePaymentOptions();
  closeCart();
  checkoutPreviousFocus = document.activeElement;
  document.getElementById('checkout-overlay').classList.remove('hidden');
  document.getElementById('checkout-modal').classList.remove('hidden');
  document.getElementById('customer-name').focus();
  const addressBox = document.getElementById('checkout-address');
  addressBox.classList.add('hidden');
  const { data: profile } = await DB.from('profiles').select('name, street, address_number, address_complement, neighborhood').eq('id', user.id).maybeSingle();
  if (profile) {
    document.getElementById('customer-name').value = profile.name || '';
    const firstLine = [profile.street, profile.address_number].filter(Boolean).join(', ');
    document.getElementById('checkout-address-text').textContent = `${firstLine}${profile.address_complement ? ` · ${profile.address_complement}` : ''}${profile.neighborhood ? ` — ${profile.neighborhood}` : ''}`;
  }
  renderCheckoutSettings();
}

function closeCheckout() {
  if (document.getElementById('checkout-modal').classList.contains('hidden')) return;
  document.getElementById('checkout-overlay').classList.add('hidden');
  document.getElementById('checkout-modal').classList.add('hidden');
  if (checkoutPreviousFocus?.isConnected) checkoutPreviousFocus.focus();
  checkoutPreviousFocus = null;
}

async function placeOrder() {
  const name = document.getElementById('customer-name').value.trim();
  const note = document.getElementById('order-note').value.trim();
  const paymentMethod = document.querySelector('input[name="payment-method"]:checked')?.value;
  const fulfillmentMethod = selectedFulfillmentMethod();
  const needsChange = paymentMethod === 'dinheiro' && document.getElementById('needs-change').checked;
  const changeFor = needsChange ? Number(document.getElementById('change-for').value) : null;
  if (!name) {
    alert('Por favor, digite seu nome.');
    return;
  }
  if (!paymentMethod) {
    alert('Escolha a forma de pagamento.');
    return;
  }
  const button = document.getElementById('btn-place-order');
  button.disabled = true;
  button.innerHTML = `<span>Enviando pedido...</span>`;
  try {
    // Atualiza novamente imediatamente antes da RPC. A checagem definitiva
    // continua no banco, dentro da mesma transacao que desconta o estoque.
    await refreshCartAvailability();
    renderCheckoutSummary();
    renderCheckoutSettings();
    const fee = fulfillmentMethod === 'delivery' && cartTotal() < Number(checkoutSettings.free_delivery_from) ? Number(checkoutSettings.delivery_fee) : 0;
    if (needsChange && (!Number.isFinite(changeFor) || changeFor < cartTotal() + fee)) {
      throw new Error('Informe um valor para troco igual ou maior que o total do pedido.');
    }
    const order = await Store.placeOrder(name, note, cart, paymentMethod, changeFor, fulfillmentMethod);
    [products, addons] = await Promise.all([Store.getProducts(), Store.getAddons()]);
    cart = [];
    sessionStorage.removeItem('dogburger_cart');
    updateCartBadge();
    renderProducts();
    closeCheckout();
    showToast(`${order.order_code} confirmado · ${order.fulfillment_method === 'delivery' ? 'Entrega' : 'Retirada'} · Subtotal R$ ${fmt(order.subtotal)} · Taxa ${order.delivery_fee ? `R$ ${fmt(order.delivery_fee)}` : 'Grátis'} · Total R$ ${fmt(order.total)} · ${order.eta_min}–${order.eta_max} min`);
  } catch (error) {
    alert(`Não foi possível realizar o pedido. ${error.message || 'Tente novamente.'}`);
  } finally {
    button.disabled = false;
    button.innerHTML = `${customerIcon('check')}<span>Fazer pedido</span>`;
  }
}

function trapCustomerDialogFocus(event, element) {
  if (event.key !== 'Tab') return;
  const focusable = [...element.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(node => !node.classList.contains('hidden'));
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

document.addEventListener('keydown', event => {
  const checkout = document.getElementById('checkout-modal');
  const drawer = document.getElementById('cart-drawer');
  if (!checkout.classList.contains('hidden')) {
    if (event.key === 'Escape') { event.preventDefault(); closeCheckout(); }
    else trapCustomerDialogFocus(event, checkout);
  } else if (!drawer.classList.contains('hidden')) {
    if (event.key === 'Escape') { event.preventDefault(); closeCart(); }
    else trapCustomerDialogFocus(event, drawer);
  }
});

document.querySelectorAll('input[name="payment-method"]').forEach(input => input.addEventListener('change', updatePaymentOptions));
document.querySelectorAll('input[name="fulfillment-method"]').forEach(input => input.addEventListener('change', renderCheckoutSettings));
document.getElementById('needs-change').addEventListener('change', updateChangeOptions);

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

let homePopupPreviousFocus = null;
let homePopupDismissed = false;
let activeHomePopupSignature = '';
const HOME_POPUP_DISMISS_KEY = 'dogburger:home-popup:last-dismissed';

function homePopupSignature(popup) {
  const source = [popup.id || 1, popup.updated_at || '', popup.title || '', popup.message || '', popup.image_url || '', popup.button_text || '', popup.button_url || '', popup.starts_at || '', popup.ends_at || ''].join('|');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${popup.id || 1}:${(hash >>> 0).toString(36)}`;
}

function wasHomePopupDismissed(signature) {
  try { return localStorage.getItem(HOME_POPUP_DISMISS_KEY) === signature; }
  catch { return false; }
}

function rememberHomePopupDismissal() {
  if (!activeHomePopupSignature) return;
  try { localStorage.setItem(HOME_POPUP_DISMISS_KEY, activeHomePopupSignature); }
  catch { /* O fechamento continua válido durante a navegação atual. */ }
}

function closeHomePopup() {
  const popup = document.getElementById('home-popup');
  if (popup.classList.contains('hidden')) return;
  document.getElementById('home-popup-overlay').classList.add('hidden');
  popup.classList.add('hidden');
  homePopupDismissed = true;
  rememberHomePopupDismissal();
  if (homePopupPreviousFocus?.isConnected) homePopupPreviousFocus.focus();
  homePopupPreviousFocus = null;
}

function handleHomePopupKeydown(event) {
  const popup = document.getElementById('home-popup');
  if (popup.classList.contains('hidden')) return;
  if (event.key === 'Escape') { event.preventDefault(); closeHomePopup(); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...popup.querySelectorAll('button:not([disabled]), a[href]:not(.hidden)')];
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function safePopupUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

async function loadHomePopup() {
  if (homePopupDismissed) return;
  try {
    const popup = await Store.getActivePopup();
    if (!popup || !popup.active || !popup.title || !popup.message) return;
    const signature = homePopupSignature(popup);
    if (wasHomePopupDismissed(signature)) return;
    activeHomePopupSignature = signature;
    document.getElementById('home-popup-title').textContent = popup.title;
    document.getElementById('home-popup-message').textContent = popup.message;

    const image = document.getElementById('home-popup-image');
    const media = document.getElementById('home-popup-media');
    const imageUrl = safePopupUrl(popup.image_url);
    if (imageUrl) {
      image.src = imageUrl;
      image.alt = popup.title;
      image.classList.remove('hidden');
      media.classList.remove('hidden');
    } else {
      image.removeAttribute('src');
      image.classList.add('hidden');
      media.classList.add('hidden');
    }

    const action = document.getElementById('home-popup-action');
    const actionUrl = safePopupUrl(popup.button_url);
    if (popup.button_text && actionUrl) {
      action.textContent = popup.button_text;
      action.href = actionUrl;
      action.classList.remove('hidden');
    } else action.classList.add('hidden');

    homePopupPreviousFocus = document.activeElement;
    document.getElementById('home-popup-overlay').classList.remove('hidden');
    document.getElementById('home-popup').classList.remove('hidden');
    document.getElementById('home-popup-close').focus();
  } catch {
    // Mantém o cardápio disponível se o pop-up ainda não estiver configurado.
  }
}

document.getElementById('home-popup-close').addEventListener('click', closeHomePopup);
document.getElementById('home-popup-overlay').addEventListener('click', closeHomePopup);
document.getElementById('home-popup-action').addEventListener('click', () => {
  homePopupDismissed = true;
  rememberHomePopupDismissal();
});
document.addEventListener('keydown', handleHomePopupKeydown);

async function initConsumer() {
  renderCategoryTabs();
  updateCartBadge();
  document.getElementById('products-grid').innerHTML = `<div class="catalog-loading" role="status"><span></span><strong>Carregando cardápio</strong><p>Buscando os produtos disponíveis.</p></div>`;
  try {
    [products, addons] = await Promise.all([Store.getProducts(), Store.getAddons()]);
    restoreCart();
    renderProducts();
    updateCartBadge();
    renderCartItems();
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === '1' && cart.length > 0) {
      window.history.replaceState({}, '', 'index.html');
      await openCheckout();
    }
  } catch (error) {
    const grid = document.getElementById('products-grid');
    grid.replaceChildren();
    const message = document.createElement('p');
    message.className = 'catalog-error';
    message.textContent = `Não foi possível carregar o cardápio. ${error.message || ''}`;
    grid.appendChild(message);
  }
  await loadHomePopup();
}

initConsumer();
