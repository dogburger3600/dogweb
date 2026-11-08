'use strict';

let headerNotificationTimer = null;
let headerOrdersChannel = null;
let headerNotificationsUserId = null;
let headerOrderUpdates = [];
let headerNotificationRequestId = 0;

const HEADER_ORDER_STATUS = Object.freeze({
  pendente:{ label:'Pedido recebido', description:'Recebemos seu pedido e ele aguarda o início do preparo.' },
  preparando:{ label:'Pedido em preparo', description:'Seu pedido já está sendo preparado.' },
  pronto:{ label:'Pedido pronto', description:'Seu pedido está pronto para entrega ou retirada.' },
  entregue:{ label:'Pedido entregue', description:'A entrega do seu pedido foi confirmada.' },
  cancelado:{ label:'Pedido cancelado', description:'O cancelamento do pedido foi registrado.' },
});

function escapeHeaderHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}

function headerOrderCode(orderId) {
  return `PED-${String(orderId).padStart(3, '0')}`;
}

function notificationReadKey() {
  return `dogburger:orders:last-read:${headerNotificationsUserId}`;
}

function notificationOccurredAt(update) {
  const value = Date.parse(update.occurred_at);
  return Number.isFinite(value) ? value : 0;
}

function renderHeaderOrderUpdates(errorMessage = '') {
  const list = document.getElementById('header-notification-list');
  const badge = document.getElementById('header-notification-badge');
  if (!list || !badge) return;

  if (errorMessage) {
    list.innerHTML = `<div class="header-notification-empty"><strong>Não foi possível atualizar</strong><span>${escapeHeaderHtml(errorMessage)}</span></div>`;
    return;
  }

  const lastRead = Number(localStorage.getItem(notificationReadKey()) || 0);
  const unreadCount = headerOrderUpdates.filter(update => notificationOccurredAt(update) > lastRead).length;
  badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
  badge.classList.toggle('hidden', unreadCount === 0);

  if (!headerOrderUpdates.length) {
    list.innerHTML = '<div class="header-notification-empty"><strong>Nenhuma atualização</strong><span>As novidades dos seus pedidos aparecerão aqui.</span></div>';
    return;
  }

  list.innerHTML = headerOrderUpdates.map(update => {
    const status = update.event_type === 'cancelled' ? 'cancelado' : update.status;
    const meta = HEADER_ORDER_STATUS[status] || HEADER_ORDER_STATUS.pendente;
    const isUnread = notificationOccurredAt(update) > lastRead;
    const detail = status === 'cancelado' && update.detail
      ? `${meta.description} Motivo: ${update.detail}`
      : meta.description;
    const time = new Date(update.occurred_at).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
    return `<a class="header-notification-item${isUnread ? ' is-unread' : ''}" href="perfil.html#meus-pedidos">
      <span class="header-notification-state is-${escapeHeaderHtml(status)}" aria-hidden="true"></span>
      <span class="header-notification-copy"><strong>${escapeHeaderHtml(meta.label)}</strong><span>${escapeHeaderHtml(headerOrderCode(update.order_id))} · ${escapeHeaderHtml(detail)}</span><time>${escapeHeaderHtml(time)}</time></span>
    </a>`;
  }).join('');
}

async function refreshHeaderOrderUpdates() {
  if (!headerNotificationsUserId) return;
  const requestId = ++headerNotificationRequestId;
  const { data, error } = await DB.rpc('get_my_order_updates');
  if (requestId !== headerNotificationRequestId || !headerNotificationsUserId) return;
  if (error) {
    renderHeaderOrderUpdates('Tente novamente em alguns instantes.');
    return;
  }
  headerOrderUpdates = Array.isArray(data) ? data : [];
  renderHeaderOrderUpdates();
}

function markHeaderOrderUpdatesRead() {
  if (!headerNotificationsUserId) return;
  localStorage.setItem(notificationReadKey(), String(Date.now()));
  renderHeaderOrderUpdates();
}

function closeHeaderNotifications() {
  const panel = document.getElementById('header-notification-panel');
  const button = document.getElementById('header-notification-button');
  if (!panel || !button) return;
  panel.classList.add('hidden');
  button.setAttribute('aria-expanded', 'false');
}

function toggleHeaderNotifications() {
  const panel = document.getElementById('header-notification-panel');
  const button = document.getElementById('header-notification-button');
  if (!panel || !button) return;
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !opening);
  button.setAttribute('aria-expanded', String(opening));
  if (opening) {
    markHeaderOrderUpdatesRead();
    refreshHeaderOrderUpdates();
  }
}

function stopHeaderOrderUpdates() {
  headerNotificationsUserId = null;
  headerOrderUpdates = [];
  headerNotificationRequestId++;
  if (headerNotificationTimer) clearInterval(headerNotificationTimer);
  headerNotificationTimer = null;
  if (headerOrdersChannel) DB.removeChannel(headerOrdersChannel);
  headerOrdersChannel = null;
  closeHeaderNotifications();
}

function startHeaderOrderUpdates(userId) {
  if (headerNotificationsUserId === userId && headerNotificationTimer) return;
  stopHeaderOrderUpdates();
  headerNotificationsUserId = userId;
  document.getElementById('header-notification-list').innerHTML = '<div class="header-notification-empty"><strong>Carregando atualizações</strong><span>Buscando seus pedidos...</span></div>';
  refreshHeaderOrderUpdates();
  headerNotificationTimer = setInterval(refreshHeaderOrderUpdates, 15000);
  headerOrdersChannel = DB.channel(`customer-orders-${userId}`)
    .on('postgres_changes', { event:'*', schema:'public', table:'orders', filter:`customer_id=eq.${userId}` }, refreshHeaderOrderUpdates)
    .subscribe();
}

async function updateHeaderAuth() {
  const guestActions = document.getElementById('guest-actions');
  const userActions = document.getElementById('user-actions');
  const { data: { user } } = await DB.auth.getUser();

  if (!user) {
    stopHeaderOrderUpdates();
    guestActions.classList.remove('hidden');
    userActions.classList.add('hidden');
    return;
  }

  const [{ data: profile }, capabilityResult] = await Promise.all([
    DB.from('profiles').select('name, role').eq('id', user.id).maybeSingle(),
    DB.rpc('has_capability', { p_capability:'view_dashboard' }),
  ]);
  const name = profile?.name || user.user_metadata?.name || user.email.split('@')[0];
  document.getElementById('header-user-name').textContent = name;
  document.getElementById('header-user-avatar').textContent = name.charAt(0).toUpperCase();
  guestActions.classList.add('hidden');
  userActions.classList.remove('hidden');
  const canViewDashboard = !capabilityResult.error && capabilityResult.data === true
    && ['owner', 'manager', 'attendant'].includes(profile?.role);
  document.getElementById('manager-shortcut').classList.toggle('hidden', !canViewDashboard);
  startHeaderOrderUpdates(user.id);
}

document.getElementById('header-notification-button').addEventListener('click', event => {
  event.stopPropagation();
  toggleHeaderNotifications();
});
document.getElementById('header-notification-panel').addEventListener('click', event => event.stopPropagation());
document.addEventListener('click', closeHeaderNotifications);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeHeaderNotifications(); });
window.addEventListener('focus', refreshHeaderOrderUpdates);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshHeaderOrderUpdates(); });

document.getElementById('header-logout').addEventListener('click', async () => {
  stopHeaderOrderUpdates();
  await DB.auth.signOut();
  await updateHeaderAuth();
});

updateHeaderAuth();
