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

function saveCart() {
  sessionStorage.setItem('dogburger_cart', JSON.stringify(cart.map(item => ({ pid:item.product.id, qty:item.qty }))));
}

function restoreCart() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('dogburger_cart') || '[]');
    cart = saved.map(item => ({ product:getProduct(item.pid), qty:item.qty })).filter(item => item.product && item.qty > 0);
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
    const out = false;
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
            <button class="btn-add" ${out ? 'disabled' : ''} onclick="addToCart(${p.id})">+ Adicionar</button>
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

function addToCart(pid) {
  const product = getProduct(pid);
  if (!product) return;
  const existing = cart.find(i => i.product.id === pid);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ product, qty: 1 });
  }
  updateCartBadge();
  renderCartItems();
  saveCart();
}

function updateQty(pid, delta) {
  const idx = cart.findIndex(i => i.product.id === pid);
  if (idx === -1) return;
  
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) cart.splice(idx, 1);
  updateCartBadge();
  renderCartItems();
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

  el.innerHTML = cart.map(i => `
    <div class="cart-item">
      <img src="${i.product.img}" alt="${i.product.name}" />
      <div class="cart-item-info">
        <p class="cart-item-name">${i.product.name}</p>
        <p class="cart-item-price">R$ ${fmt(i.product.price * i.qty)}</p>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="updateQty(${i.product.id}, -1)">−</button>
        <span class="qty-val">${i.qty}</span>
        <button class="qty-btn plus" onclick="updateQty(${i.product.id}, 1)">+</button>
      </div>
    </div>`).join('');

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
  document.getElementById('customer-name').value = '';
  document.getElementById('order-note').value = '';
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
  if (!name) {
    alert('Por favor, digite seu nome.');
    return;
  }

  const button = document.getElementById('btn-place-order');
  button.disabled = true;
  button.textContent = 'Enviando pedido...';
  try {
    const id = await Store.placeOrder(name, note, cart);
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

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

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
}

initConsumer();
