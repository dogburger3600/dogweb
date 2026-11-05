'use strict';

let currentProfile = null;

const PROFILE_ICON_PATHS = Object.freeze({
  pin:'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  payment:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
  note:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
});

function profileIcon(name) {
  return `<svg class="customer-icon" viewBox="0 0 24 24" aria-hidden="true">${PROFILE_ICON_PATHS[name] || PROFILE_ICON_PATHS.receipt}</svg>`;
}

function formatPhone(phone) {
  return window.PhoneBR.formatMobileDisplay(phone);
}

function formatAddress(profile) {
  const firstLine = [profile.street, profile.address_number].filter(Boolean).join(', ');
  const complement = profile.address_complement ? ` · ${profile.address_complement}` : '';
  const neighborhood = profile.neighborhood ? ` — ${profile.neighborhood}` : '';
  return `${firstLine}${complement}${neighborhood}` || 'Não informado';
}

function escapeProfileHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function formatOrderAddress(address) {
  if (!address) return 'Endereço não registrado';
  const firstLine = [address.street, address.number].filter(Boolean).join(', ');
  return `${firstLine}${address.complement ? ` · ${address.complement}` : ''}${address.neighborhood ? ` — ${address.neighborhood}` : ''}`;
}

async function loadOrderHistory() {
  const list = document.getElementById('profile-orders-list');
  let { data: orders, error } = await DB.from('orders')
    .select('id, status, note, created_at, delivery_address, payment_method, change_for, fulfillment_method, subtotal, delivery_fee, total, eta_min, eta_max, order_items(product_id, product_name, quantity, unit_price, removed_ingredients)')
    .order('created_at', { ascending:false });

  if (error?.code === '42703') {
    const fallback = await DB.from('orders')
      .select('id, status, note, created_at, delivery_address, order_items(product_id, product_name, quantity, unit_price)')
      .order('created_at', { ascending:false });
    orders = fallback.data;
    error = fallback.error;
  }

  if (error?.code === '42703') {
    const fallback = await DB.from('orders')
      .select('id, status, note, created_at, delivery_address, order_items(product_id, quantity, unit_price)')
      .order('created_at', { ascending:false });
    orders = fallback.data;
    error = fallback.error;
  }

  if (error) {
    list.innerHTML = `<div class="profile-orders-empty">${profileIcon('receipt')}<strong>Não foi possível carregar seu histórico</strong><p>Tente novamente em alguns instantes.</p></div>`;
    return;
  }

  document.getElementById('profile-orders-count').textContent = `${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}`;
  if (!orders.length) {
    list.innerHTML = `<div class="profile-orders-empty">${profileIcon('receipt')}<strong>Você ainda não fez nenhum pedido</strong><p>Seus próximos pedidos aparecerão aqui.</p></div>`;
    return;
  }

  const statusMeta = {
    pendente:{ label:'Pendente', color:'#D97706', bg:'#FEF3C7' }, preparando:{ label:'Preparando', color:'#2563EB', bg:'#DBEAFE' },
    pronto:{ label:'Pronto', color:'#16A34A', bg:'#DCFCE7' }, entregue:{ label:'Entregue', color:'#78716C', bg:'#F5F5F4' },
  };
  const paymentLabels = { pix:'Pix', credito:'Crédito', debito:'Débito', dinheiro:'Dinheiro' };

  list.innerHTML = orders.map(order => {
    const legacyTotal = order.order_items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
    const subtotal = order.subtotal == null ? null : Number(order.subtotal);
    const deliveryFee = order.delivery_fee == null ? null : Number(order.delivery_fee);
    const authoritativeTotal = order.total == null ? null : Number(order.total);
    const total = Number.isFinite(authoritativeTotal) ? authoritativeTotal : legacyTotal;
    const hasB05Snapshot = ['delivery', 'pickup'].includes(order.fulfillment_method)
      && [subtotal, deliveryFee, authoritativeTotal].every(Number.isFinite);
    const deliveryFeeLabel = hasB05Snapshot
      ? order.fulfillment_method === 'pickup' || deliveryFee === 0
        ? 'Grátis'
        : `R$ ${deliveryFee.toLocaleString('pt-BR', {minimumFractionDigits:2})}`
      : '';
    const financialSummary = hasB05Snapshot ? `<dl class="history-order-financial">
      <div><dt>Subtotal</dt><dd>R$ ${subtotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}</dd></div>
      <div><dt>Taxa de entrega</dt><dd>${deliveryFeeLabel}</dd></div>
      <div class="history-order-financial-total"><dt>Total</dt><dd>R$ ${authoritativeTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}</dd></div>
    </dl>` : '';
    const address = order.fulfillment_method === 'pickup'
      ? 'Retirada no local'
      : formatOrderAddress(order.delivery_address);
    const status = statusMeta[order.status] || statusMeta.pendente;
    const date = new Date(order.created_at).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
    const items = order.order_items.map(item => `<div class="history-item">
      <span class="history-item-qty">${item.quantity}×</span>
      <div><span class="history-item-name">${escapeProfileHtml(item.product_name || `Produto #${item.product_id}`)}</span><small class="history-item-unit">R$ ${Number(item.unit_price).toLocaleString('pt-BR', {minimumFractionDigits:2})} cada</small>${item.removed_ingredients ? `<small class="history-item-removal">Sem: ${escapeProfileHtml(item.removed_ingredients)}</small>` : ''}</div>
      <span class="history-item-price">R$ ${(Number(item.unit_price) * item.quantity).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
    </div>`).join('');
    return `<article class="history-order">
      <div class="history-order-summary">
        <div class="history-order-main"><span class="history-order-number">PED-${String(order.id).padStart(3,'0')}</span><time class="history-order-date">${date}</time></div>
        <span class="status-badge" style="background:${status.bg};color:${status.color}">${status.label}</span>
        <strong class="history-order-total">R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong>
      </div>
      <div class="history-order-body">${items}${financialSummary}<div class="history-order-details">
        <div class="history-detail"><span>${profileIcon('pin')}</span><span>${escapeProfileHtml(address)}</span></div>
        ${order.payment_method ? `<div class="history-detail"><span>${profileIcon('payment')}</span><span>Pagamento na entrega: ${paymentLabels[order.payment_method] || order.payment_method}${order.payment_method === 'dinheiro' && order.change_for !== null ? ` · troco para R$ ${Number(order.change_for).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : ''}</span></div>` : ''}
        ${order.note ? `<div class="history-detail"><span>${profileIcon('note')}</span><span>${escapeProfileHtml(order.note)}</span></div>` : ''}
      </div></div>
    </article>`;
  }).join('');
}

async function loadProfile() {
  const { data: { user }, error: userError } = await DB.auth.getUser();
  if (userError || !user) {
    window.location.replace('entrar.html');
    return;
  }

  let { data: profile, error } = await DB.from('profiles')
    .select('name, phone, email, points, created_at, street, address_number, address_complement, neighborhood')
    .eq('id', user.id)
    .single();

  if (error?.code === '42703') {
    const fallback = await DB.from('profiles')
      .select('name, phone, email, created_at')
      .eq('id', user.id)
      .single();
    profile = fallback.data ? { ...fallback.data, points: 0 } : null;
    error = fallback.error;
  }

  document.getElementById('profile-loading').classList.add('hidden');
  if (error || !profile) {
    document.getElementById('profile-error').classList.remove('hidden');
    return;
  }

  const name = profile.name || user.user_metadata?.name || 'Cliente';
  currentProfile = { ...profile, email:profile.email || user.email };
  const createdAt = new Date(profile.created_at).toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
  document.getElementById('profile-avatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent = name;
  document.getElementById('profile-full-name').textContent = name;
  document.getElementById('profile-email').textContent = profile.email || user.email;
  document.getElementById('profile-phone').textContent = formatPhone(profile.phone);
  document.getElementById('profile-address').textContent = formatAddress(profile);
  document.getElementById('profile-points').textContent = profile.points ?? 0;
  document.getElementById('profile-member').textContent = `Cliente desde ${createdAt}`;
  document.getElementById('profile-content').classList.remove('hidden');
  await loadOrderHistory();
}

function showProfileToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

function openProfileEdit() {
  if (!currentProfile) return;
  document.getElementById('profile-edit-name').value = currentProfile.name || '';
  document.getElementById('profile-edit-email').value = currentProfile.email || '';
  document.getElementById('profile-edit-phone').value = formatPhone(currentProfile.phone);
  document.getElementById('profile-edit-street').value = currentProfile.street || '';
  document.getElementById('profile-edit-address-number').value = currentProfile.address_number || '';
  document.getElementById('profile-edit-address-complement').value = currentProfile.address_complement || '';
  document.getElementById('profile-edit-neighborhood').value = currentProfile.neighborhood || '';
  document.getElementById('profile-edit-password').value = '';
  document.getElementById('profile-edit-confirm').value = '';
  document.getElementById('profile-edit-error').textContent = '';
  document.getElementById('profile-info-view').classList.add('hidden');
  document.getElementById('profile-edit-form').classList.remove('hidden');
  document.getElementById('profile-edit-button').classList.add('hidden');
  document.getElementById('profile-edit-name').focus();
}

function closeProfileEdit() {
  document.getElementById('profile-info-view').classList.remove('hidden');
  document.getElementById('profile-edit-form').classList.add('hidden');
  document.getElementById('profile-edit-button').classList.remove('hidden');
}

document.getElementById('profile-edit-phone').addEventListener('input', event => {
  event.target.value = window.PhoneBR.formatMobileInput(event.target.value);
});

document.getElementById('profile-edit-button').addEventListener('click', openProfileEdit);
document.getElementById('profile-edit-cancel').addEventListener('click', closeProfileEdit);
document.getElementById('profile-edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = document.getElementById('profile-edit-name').value.trim().replace(/\s+/g, ' ');
  const phone = window.PhoneBR.normalizeMobile(document.getElementById('profile-edit-phone').value);
  const password = document.getElementById('profile-edit-password').value;
  const confirmation = document.getElementById('profile-edit-confirm').value;
  const address = {
    street:document.getElementById('profile-edit-street').value.trim(),
    address_number:document.getElementById('profile-edit-address-number').value.trim(),
    address_complement:document.getElementById('profile-edit-address-complement').value.trim(),
    neighborhood:document.getElementById('profile-edit-neighborhood').value.trim(),
  };
  const errorElement = document.getElementById('profile-edit-error');
  const phoneField = document.getElementById('profile-edit-phone');
  const button = document.getElementById('profile-edit-save');
  errorElement.textContent = '';
  phoneField.setAttribute('aria-invalid', 'false');

  if (name.length < 3 || !name.includes(' ')) {
    errorElement.textContent = 'Informe seu nome e sobrenome.';
    return;
  }
  if (!phone) {
    errorElement.textContent = 'Informe um número de telefone válido com DDD.';
    phoneField.setAttribute('aria-invalid', 'true');
    return;
  }
  if (password && password.length < 6) {
    errorElement.textContent = 'A nova senha deve ter pelo menos 6 caracteres.';
    return;
  }
  if (password !== confirmation) {
    errorElement.textContent = 'A confirmação da nova senha não coincide.';
    return;
  }
  if (!address.street || !address.address_number || !address.neighborhood) {
    errorElement.textContent = 'Preencha todos os campos obrigatórios do endereço.';
    return;
  }

  button.disabled = true;
  button.textContent = 'Salvando...';
  try {
    const { data: { user } } = await DB.auth.getUser();
    const { error: profileError } = await DB.from('profiles').update({ name, phone, ...address }).eq('id', user.id);
    if (profileError) throw profileError;

    const authChanges = { data:{ name, phone } };
    if (password) authChanges.password = password;
    const { error: authError } = await DB.auth.updateUser(authChanges);
    if (authError) throw authError;

    currentProfile = { ...currentProfile, name, phone, ...address };
    document.getElementById('profile-name').textContent = name;
    document.getElementById('profile-full-name').textContent = name;
    document.getElementById('profile-phone').textContent = formatPhone(phone);
    document.getElementById('profile-address').textContent = formatAddress(currentProfile);
    document.getElementById('profile-avatar').textContent = name.charAt(0).toUpperCase();
    closeProfileEdit();
    showProfileToast('Perfil atualizado com sucesso.');
  } catch (error) {
    if (error.code === '23505') phoneField.setAttribute('aria-invalid', 'true');
    errorElement.textContent = error.code === '23505'
      ? 'Não foi possível utilizar este telefone. Confira os dados ou procure o atendimento.'
      : 'Não foi possível salvar as alterações. Tente novamente em alguns instantes.';
  } finally {
    button.disabled = false;
    button.textContent = 'Salvar alterações';
  }
});

document.getElementById('profile-logout').addEventListener('click', async () => {
  await DB.auth.signOut();
  window.location.replace('index.html');
});

loadProfile();
