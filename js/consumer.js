'use strict';

let products = [];
let cart = [];
let activeCategory = 'todos';

function getProduct(pid) {
  return products.find(p => p.id === pid);
}

function cartTotal() {
  return cart.reduce((s, i) => s + i.product.price * i.qty, 0);
}

function cartCount() {
  return cart.reduce((s, i) => s + i.qty, 0);
}

function escapeCartHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}

function saveCart() {
  sessionStorage.setItem('dogburger_cart', JSON.stringify(cart.map(item => ({ pid:item.product.id, qty:item.qty, removedIngredients:item.removedIngredients || '', componentSelections:item.componentSelections || [] }))));
}

function restoreCart() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('dogburger_cart') || '[]');
    cart = saved.map(item => ({ product:getProduct(item.pid), qty:item.qty, removedIngredients:String(item.removedIngredients || '').slice(0,120), componentSelections:Array.isArray(item.componentSelections) ? item.componentSelections : [] })).filter(item => item.product && item.qty > 0);
    cart.forEach(item => { if (item.product.category !== 'lanches') item.removedIngredients = ''; });
  } catch {
    cart = [];
    sessionStorage.removeItem('dogburger_cart');
  }
}

function renderCategoryTabs() {
  const el = document.getElementById('category-tabs');
  el.innerHTML = CATEGORIES.map(c =>
    `<button class="c-tab${activeCategory === c.key ? ' active' : ''}" onclick="setCategory('${c.key}')">
      <span>${c.emoji}</span> ${c.label}
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
    el.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:4rem 2rem;color:var(--stone-light)">
      <div style="font-size:3rem;margin-bottom:12px">🔍</div>
      <p style="font-weight:600">Nenhum item nesta categoria.</p>
    </div>`;
    return;
  }

  el.innerHTML = list.map(p => {
    const out = productAvailableUnits(p) <= 0;
    const cat = CAT_MAP[p.category];
    return `
      <div class="product-card${out ? ' out-of-stock' : ''}">
        <div class="product-img-wrap">
          <img src="${p.img}" alt="${p.name}" loading="lazy" />
          <span class="product-cat-badge">${cat.emoji} ${cat.label}</span>
          ${out ? `<div class="out-label"><span>Esgotado</span></div>` : ''}
        </div>
        <div class="product-body">
          <p class="product-name">${p.name}</p>
          <p class="product-desc">${p.desc}</p>
          <div class="product-footer">
            <span class="product-price">R$ ${fmt(p.price)}</span>
            <button class="btn-add" ${out ? 'disabled' : ''} onclick="prepareAddToCart(${p.id})">+ Adicionar</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  const count = cartCount();
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline-block' : 'none';
}

function simpleAvailableUnits(product) {
  if (!product || !product.active) return 0;
  return product.inventoryTracked ? Math.max(0, Number(product.stock) || 0) : Number.POSITIVE_INFINITY;
}

function productAvailableUnits(product) {
  if (!product?.active || product.sellable === false) return 0;
  if (!product.isComposite) return simpleAvailableUnits(product);
  const capacities = [];
  product.fixedComponents.forEach(component => capacities.push(Math.floor(simpleAvailableUnits(component.product) / component.quantity)));
  product.choiceGroups.forEach(group => capacities.push(Math.floor(group.options.reduce((sum, option) => sum + Math.floor(simpleAvailableUnits(option.product) / option.componentQuantity), 0) / group.requiredQuantity)));
  return capacities.length ? Math.max(0, Math.min(...capacities)) : 0;
}

function selectionKey(selections) {
  return JSON.stringify((selections || []).map(item => ({ groupId:Number(item.groupId), productId:Number(item.productId), quantity:Number(item.quantity) })).sort((a,b) => a.groupId - b.groupId || a.productId - b.productId));
}

function prepareAddToCart(pid) {
  const product = getProduct(pid);
  if (!product || productAvailableUnits(product) <= 0) return showToast('⛔ Produto esgotado.');
  if (product.isComposite && product.choiceGroups.length) return openComponentChoice(product);
  addToCart(pid, []);
}

function addToCart(pid, componentSelections = []) {
  const product = getProduct(pid);
  if (!product) return;
  if (productAvailableUnits(product) <= 0) {
    showToast('⛔ Produto esgotado.');
    return;
  }
  const existing = cart.find(i => i.product.id === pid && selectionKey(i.componentSelections) === selectionKey(componentSelections));
  if (existing) {
    if (existing.qty >= productAvailableUnits(product)) {
      showToast('⚠️ Quantidade disponível atingida.');
      return;
    }
    existing.qty++;
    existing.componentSelections = existing.componentSelections.map(selection => ({ ...selection, quantity:selection.quantity + (componentSelections.find(item => item.groupId === selection.groupId && item.productId === selection.productId)?.quantity || 0) }));
  } else {
    cart.push({ product, qty:1, removedIngredients:'', componentSelections });
  }
  updateCartBadge();
  renderCartItems();
  saveCart();
}

function updateQty(index, delta) {
  const idx = Number(index);
  if (idx === -1) return;
  
  const nextQuantity = cart[idx].qty + delta;
  if (delta > 0 && nextQuantity > productAvailableUnits(cart[idx].product)) {
    showToast('⚠️ Quantidade disponível atingida.');
    return;
  }
  if (cart[idx].product.isComposite && cart[idx].componentSelections.length) {
    cart[idx].componentSelections = cart[idx].componentSelections.map(selection => ({ ...selection, quantity:selection.quantity * nextQuantity / cart[idx].qty }));
  }
  cart[idx].qty = nextQuantity;
  if (cart[idx].qty <= 0) cart.splice(idx, 1);
  updateCartBadge();
  renderCartItems();
  saveCart();
}

function closeComponentChoice() {
  document.getElementById('component-choice-modal')?.remove();
}

function openComponentChoice(product) {
  const shell = document.createElement('div');
  shell.id = 'component-choice-modal';
  shell.className = 'component-choice-shell';
  shell.innerHTML = `<div class="modal-overlay" onclick="closeComponentChoice()"></div><section class="modal component-choice-modal" role="dialog" aria-modal="true" aria-labelledby="component-choice-title"><h2 class="modal-title" id="component-choice-title">Personalize ${escapeCartHtml(product.name)}</h2><p class="modal-sub">Escolha as opções obrigatórias para uma unidade.</p><form onsubmit="submitComponentChoice(event, ${product.id})">${product.choiceGroups.map(group => `<fieldset class="component-choice-group"><legend>${escapeCartHtml(group.name)} <small>Escolha ${group.requiredQuantity}</small></legend>${group.options.map(option => { const available = Math.floor(simpleAvailableUnits(option.product) / option.componentQuantity); return `<label class="component-choice-option${available <= 0 ? ' is-disabled' : ''}"><span>${escapeCartHtml(option.product?.name || `Produto ${option.productId}`)}<small>${available <= 0 ? 'Esgotado' : `${available} disponível`}</small></span><input type="number" min="0" max="${Math.min(group.requiredQuantity, available)}" step="1" value="0" data-group-id="${group.id}" data-product-id="${option.productId}" ${available <= 0 ? 'disabled' : ''} /></label>`; }).join('')}</fieldset>`).join('')}<p class="form-error" id="component-choice-error"></p><div class="modal-actions"><button class="btn-secondary" type="button" onclick="closeComponentChoice()">Cancelar</button><button class="btn-primary" type="submit">Adicionar ao carrinho</button></div></form></section>`;
  document.body.appendChild(shell);
}

function submitComponentChoice(event, productId) {
  event.preventDefault();
  const product = getProduct(productId);
  const selections = [...event.currentTarget.querySelectorAll('input[data-group-id]')].map(input => ({ groupId:Number(input.dataset.groupId), productId:Number(input.dataset.productId), quantity:Number(input.value) })).filter(item => item.quantity > 0);
  if (!product.choiceGroups.every(group => selections.filter(item => item.groupId === group.id).reduce((sum, item) => sum + item.quantity, 0) === group.requiredQuantity)) {
    document.getElementById('component-choice-error').textContent = 'Complete todas as escolhas obrigatórias.';
    return;
  }
  closeComponentChoice();
  addToCart(productId, selections);
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

function renderCartItems() {
  const el = document.getElementById('cart-items-list');
  const footer = document.getElementById('cart-footer');
  const totalEl = document.getElementById('cart-total-display');

  if (cart.length === 0) {
    el.innerHTML = `<div class="cart-empty">
      <div class="emoji">🛒</div>
      <p>Seu carrinho está vazio</p>
      <small>Adicione itens do cardápio</small>
    </div>`;
    footer.classList.add('hidden');
    return;
  }

  el.innerHTML = cart.map((i, cartIndex) => {
    const isSnack = i.product.category === 'lanches';
    const ingredients = isSnack && Array.isArray(i.product.ingredients) ? i.product.ingredients : [];
    const removed = new Set(String(i.removedIngredients || '').split(',').map(value => value.trim()).filter(Boolean));
    const ingredientsEditor = !isSnack ? '' : ingredients.length ? `
      <div class="cart-ingredients">
        <p><strong>Ingredientes:</strong> ${ingredients.map(escapeCartHtml).join(', ')}</p>
        <span>Toque nos ingredientes que deseja remover:</span>
        <div class="ingredient-removal-options">
          ${ingredients.map((ingredient, index) => `<label><input type="checkbox" ${removed.has(ingredient) ? 'checked' : ''} onchange="toggleIngredientRemoval(${i.product.id}, ${index}, this.checked)" /><span>${escapeCartHtml(ingredient)}</span></label>`).join('')}
        </div>
      </div>` : '<p class="cart-ingredients-empty">Ingredientes ainda não cadastrados para este lanche.</p>';
    return `
    <div class="cart-item">
      <div class="cart-item-main">
        <img src="${i.product.img}" alt="${escapeCartHtml(i.product.name)}" />
        <div class="cart-item-info">
          <p class="cart-item-name">${escapeCartHtml(i.product.name)}</p>
          <p class="cart-item-price">R$ ${fmt(i.product.price * i.qty)}</p>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="updateQty(${cartIndex}, -1)">−</button>
          <span class="qty-val">${i.qty}</span>
          <button class="qty-btn plus" onclick="updateQty(${cartIndex}, 1)">+</button>
        </div>
      </div>
      ${i.componentSelections?.length ? `<div class="cart-component-selections">${i.componentSelections.map(selection => { const group = i.product.choiceGroups.find(value => value.id === selection.groupId); const option = group?.options.find(value => value.productId === selection.productId); return `<small>${escapeCartHtml(group?.name || 'Escolha')}: ${selection.quantity}× ${escapeCartHtml(option?.product?.name || `Produto ${selection.productId}`)}</small>`; }).join('')}</div>` : ''}
      ${ingredientsEditor}
    </div>`;
  }).join('');

  totalEl.textContent = `R$ ${fmt(cartTotal())}`;
  footer.classList.remove('hidden');
}

function openCart() {
  renderCartItems();
  document.getElementById('cart-overlay').classList.remove('hidden');
  document.getElementById('cart-drawer').classList.remove('hidden');
}

function closeCart() {
  document.getElementById('cart-overlay').classList.add('hidden');
  document.getElementById('cart-drawer').classList.add('hidden');
}

function renderCheckoutSummary() {
  document.getElementById('checkout-order-summary').innerHTML = cart.map(item => `
    <div class="checkout-summary-item">
      <div><strong>${item.qty}× ${escapeCartHtml(item.product.name)}</strong>${item.componentSelections?.map(selection => { const group = item.product.choiceGroups.find(value => value.id === selection.groupId); const option = group?.options.find(value => value.productId === selection.productId); return `<small>${escapeCartHtml(group?.name || 'Escolha')}: ${selection.quantity}× ${escapeCartHtml(option?.product?.name || `Produto ${selection.productId}`)}</small>`; }).join('') || ''}${item.removedIngredients ? `<small>Sem: ${escapeCartHtml(item.removedIngredients)}</small>` : ''}</div>
      <span>R$ ${fmt(item.product.price * item.qty)}</span>
    </div>`).join('');
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

async function openCheckout() {
  const { data: { user } } = await DB.auth.getUser();
  if (!user) {
    saveCart();
    window.location.href = 'entrar.html?returnTo=index.html&checkout=1';
    return;
  }
  const count = cart.length;
  const total = cartTotal();
  document.getElementById('checkout-sub').textContent =
    `${count} ${count === 1 ? 'item' : 'itens'} · Total R$ ${fmt(total)}`;
  renderCheckoutSummary();
  document.getElementById('customer-name').value = '';
  document.getElementById('order-note').value = '';
  document.querySelector('input[name="payment-method"][value="pix"]').checked = true;
  updatePaymentOptions();
  closeCart();
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
    addressBox.classList.remove('hidden');
  }
}

function closeCheckout() {
  document.getElementById('checkout-overlay').classList.add('hidden');
  document.getElementById('checkout-modal').classList.add('hidden');
}

async function placeOrder() {
  const name = document.getElementById('customer-name').value.trim();
  const note = document.getElementById('order-note').value.trim();
  const paymentMethod = document.querySelector('input[name="payment-method"]:checked')?.value;
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
  if (needsChange && (!Number.isFinite(changeFor) || changeFor < cartTotal())) {
    alert('Informe um valor para troco igual ou maior que o total do pedido.');
    return;
  }

  const button = document.getElementById('btn-place-order');
  button.disabled = true;
  button.textContent = 'Enviando pedido...';
  try {
    const id = await Store.placeOrder(name, note, cart, paymentMethod, changeFor);
    products = await Store.getProducts();
    cart = [];
    sessionStorage.removeItem('dogburger_cart');
    updateCartBadge();
    renderProducts();
    closeCheckout();
    showToast(`✅ Pedido ${id} realizado com sucesso!`);
  } catch (error) {
    alert(`Não foi possível realizar o pedido. ${error.message || 'Tente novamente.'}`);
  } finally {
    button.disabled = false;
    button.textContent = '✅ Fazer Pedido';
  }
}

document.querySelectorAll('input[name="payment-method"]').forEach(input => input.addEventListener('change', updatePaymentOptions));
document.getElementById('needs-change').addEventListener('change', updateChangeOptions);

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

let currentPopupVersion = '';

function closeHomePopup() {
  document.getElementById('home-popup-overlay').classList.add('hidden');
  document.getElementById('home-popup').classList.add('hidden');
  if (currentPopupVersion) sessionStorage.setItem('dogburger_popup_seen', currentPopupVersion);
}

function safePopupUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

async function loadHomePopup() {
  try {
    const isTuesdayPromoTest = new URLSearchParams(window.location.search).get('popup-test') === 'terca';
    const popup = isTuesdayPromoTest
      ? {
          id: 'test-terca-triplo',
          title: 'Terça do Triplo',
          message: 'Na terça, o Duplo vira Triplo! Só às terças-feiras.',
          image_url: 'promo-terca-triplo-v2.png',
          button_text: 'Ver cardápio',
          button_url: 'index.html',
          active: true,
          updated_at: 'test-terca-triplo-v2'
        }
      : await Store.getActivePopup();
    if (!popup || !popup.active || !popup.title || !popup.message) return;
    currentPopupVersion = popup.updated_at || String(popup.id);
    if (!isTuesdayPromoTest && sessionStorage.getItem('dogburger_popup_seen') === currentPopupVersion) return;
    document.getElementById('home-popup-title').textContent = popup.title;
    document.getElementById('home-popup-message').textContent = popup.message;

    const image = document.getElementById('home-popup-image');
    if (popup.image_url) {
      image.src = popup.image_url;
      image.alt = popup.title;
      image.classList.remove('hidden');
    } else image.classList.add('hidden');

    const action = document.getElementById('home-popup-action');
    const actionUrl = safePopupUrl(popup.button_url);
    if (popup.button_text && actionUrl) {
      action.textContent = popup.button_text;
      action.href = actionUrl;
      action.classList.remove('hidden');
    } else action.classList.add('hidden');

    document.getElementById('home-popup-overlay').classList.remove('hidden');
    document.getElementById('home-popup').classList.remove('hidden');
    document.getElementById('home-popup-close').focus();
  } catch {
    // Mantém o cardápio disponível se o pop-up ainda não estiver configurado.
  }
}

document.getElementById('home-popup-close').addEventListener('click', closeHomePopup);
document.getElementById('home-popup-overlay').addEventListener('click', closeHomePopup);

async function initConsumer() {
  renderCategoryTabs();
  updateCartBadge();
  document.getElementById('products-grid').innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--stone)">Carregando cardápio...</p>';
  try {
    products = await Store.getProducts();
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
    document.getElementById('products-grid').innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--red)">Não foi possível carregar o cardápio. ${error.message}</p>`;
  }
  await loadHomePopup();
}

initConsumer();
