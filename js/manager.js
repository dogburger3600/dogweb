'use strict';

let products = [];
let orders = [];
let expenses = [];

let currentView = 'dashboard';
let expandedOrders = new Set();
let editingStock = null;
let stockFilterCat = 'todos';
let ordersFilter = 'todos';
let reportDate = localDateKey(Date.now());

// Estado demonstrativo exclusivo do frontend. Não altera pedidos nem persiste no Supabase.
const ORDERS_FRONTEND_DEMO = {
  cancellations: new Map(),
  cancellationDraftId: null,
  feedback: '',
};

// Mock local de unidades de lanches prontos. Não representa ingredientes e não possui persistência.
const SNACK_STOCK_FRONTEND_DEMO = {
  quantities: new Map(),
  minimums: new Map(),
  history: [],
  filter: 'todos',
  restockProductId: null,
  feedback: null,
};

// Configuração demonstrativa mantida somente na memória desta sessão.
const STORE_SETTINGS_FRONTEND_DEMO = {
  values: {
    openTime: '18:00', closeTime: '23:30', pauseEnabled: false, pauseStart: '20:30', pauseEnd: '21:00',
    whatsapp: '+55 (88) 99623-9679', instagram: '@dogburgertaua', location: 'Dog Burguer, Tauá/CE',
    latitude: '-6.0074487', longitude: '-40.2952674', deliveryEnabled: true, pickupEnabled: true,
    pix: true, cash: true, card: true, deliveryEtaMin: 30, deliveryEtaMax: 50, pickupEtaMin: 20, pickupEtaMax: 35,
    deliveryFee: 5, freeDeliveryFrom: 15,
  },
  dirty: false,
  saving: false,
  feedback: null,
};

// Controle visual dos filtros de relatórios. Não altera consultas nem critérios financeiros.
const REPORTS_FRONTEND_DEMO = {
  period: 'day',
  customStart: reportDate,
  customEnd: reportDate,
  error: '',
};

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  pedidos: 'Pedidos',
  relatorios: 'Relatórios',
  'estoque-lanches': 'Estoque de Lanches',
  popup: 'Pop-up Inicial',
  configuracoes: 'Configurações da Loja',
};

// Mock exclusivamente visual. Será substituído pelas integrações de Realtime e áudio em Tasks futuras.
const DASHBOARD_FRONTEND_MOCK = Object.freeze({
  updateMode: 'manual',
  soundAlert: 'planned',
});

function getProduct(pid) {
  return products.find(p => p.id === pid);
}

function orderTotal(order) {
  return order.items.reduce((s, i) => {
    const p = getProduct(i.pid);
    return s + (i.unitPrice ?? p?.price ?? 0) * i.qty;
  }, 0);
}

function activeOrders() {
  return orders.filter(o => o.status === 'pendente' || o.status === 'preparando');
}

async function setView(view) {
  if (!VIEW_TITLES[view]) view = 'dashboard';
  currentView = view;
  document.getElementById('view-title').textContent = VIEW_TITLES[view];
  Object.keys(VIEW_TITLES).forEach(v => {
    const btn = document.getElementById(`nav-${v}`);
    if (btn) btn.classList.toggle('active', v === view);
  });
  const pageUrl = new URL(window.location.href);
  if (view === 'dashboard') pageUrl.searchParams.delete('view');
  else pageUrl.searchParams.set('view', view);
  window.history.replaceState({}, '', pageUrl);
  updateActiveOrdersBadge();

  if (view === 'configuracoes') {
    document.getElementById('m-content').innerHTML = renderStoreSettings();
    return;
  }

  const content = document.getElementById('m-content');
  if (view === 'dashboard') content.innerHTML = renderDashboardState('loading');
  if (view === 'estoque-lanches') content.innerHTML = renderSnackStockState('loading');
  if (view === 'relatorios') content.innerHTML = renderReportsState('loading');

  // Recarregar dados mais recentes da store
  try {
    [products, orders] = await Promise.all([Store.getAllProducts(), Store.getOrders()]);
  } catch (error) {
    content.innerHTML = view === 'dashboard'
      ? renderDashboardState('error', error.message)
      : view === 'estoque-lanches'
        ? renderSnackStockState('error', error.message)
        : view === 'relatorios'
          ? renderReportsState('error', error.message)
          : `<div class="card" style="color:var(--red)">Não foi possível carregar os dados. ${error.message}</div>`;
    return;
  }

  if (view === 'dashboard')  content.innerHTML = renderDashboard();
  if (view === 'pedidos')    content.innerHTML = renderPedidos();
  if (view === 'relatorios') content.innerHTML = renderRelatorios();
  if (view === 'estoque-lanches') content.innerHTML = renderSnackStock();
  if (view === 'popup') {
    content.innerHTML = renderPopupEditor();
    await initPopupEditor();
  }
}

function orderPaymentLabel(order) {
  const method = PAYMENT_LABELS[order.paymentMethod] || 'Não informado';
  return order.paymentMethod === 'dinheiro' && order.changeFor !== null
    ? `${method} · troco para R$ ${fmt(order.changeFor)}`
    : method;
}

function renderPopupEditor() {
  return `<div class="popup-editor-layout">
    <form class="card popup-editor-form" id="popup-editor-form">
      <div class="card-header"><div><span class="card-title">Conteúdo do pop-up</span><p class="popup-editor-sub">Configure promoções ou avisos exibidos na página inicial.</p></div><label class="popup-active-switch"><input type="checkbox" id="popup-active" /><span></span> Ativo</label></div>
      <div class="form-group"><label class="form-label" for="popup-title">Título *</label><input class="form-input" id="popup-title" maxlength="80" required /></div>
      <div class="form-group"><label class="form-label" for="popup-message">Mensagem *</label><textarea class="form-textarea" id="popup-message" rows="4" maxlength="400" required></textarea></div>
      <div class="form-group"><label class="form-label">Imagem opcional</label><input class="hidden" id="popup-image-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /><input id="popup-image-url" type="hidden" /><div class="popup-image-upload" id="popup-image-upload"><img class="hidden" id="popup-image-preview" alt="Prévia do pop-up" /><div id="popup-image-prompt"><span>🖼️</span><strong>Importar imagem</strong><small>JPG, PNG, WEBP ou GIF · até 5 MB</small></div><button class="btn-upload-image" id="choose-popup-image" type="button">Escolher imagem</button></div></div>
      <div class="signup-grid"><div class="form-group"><label class="form-label" for="popup-button-text">Texto do botão</label><input class="form-input" id="popup-button-text" maxlength="40" placeholder="Ver cardápio" /></div><div class="form-group"><label class="form-label" for="popup-button-url">Destino do botão</label><input class="form-input" id="popup-button-url" placeholder="index.html ou https://..." /></div></div>
      <div class="signup-grid"><div class="form-group"><label class="form-label" for="popup-starts-at">Início da exibição</label><input class="form-input" id="popup-starts-at" type="datetime-local" /></div><div class="form-group"><label class="form-label" for="popup-ends-at">Fim da exibição</label><input class="form-input" id="popup-ends-at" type="datetime-local" /></div></div>
      <p class="form-error" id="popup-editor-error"></p><button class="btn-primary popup-save-button" id="popup-save-button" type="submit">Salvar pop-up</button>
    </form>
    <div class="card popup-help-card"><span class="popup-help-icon">💡</span><h2>Como funciona</h2><p>Quando estiver ativo e dentro do período escolhido, o pop-up aparecerá uma vez por sessão para cada visitante.</p><ul><li>Deixe as datas vazias para exibição contínua.</li><li>Desative quando não quiser mostrar nada.</li><li>Uma nova edição volta a aparecer para os visitantes.</li></ul></div>
  </div>`;
}

function popupLocalDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0,16);
}

function updatePopupPreview(source) {
  const preview = document.getElementById('popup-image-preview');
  const prompt = document.getElementById('popup-image-prompt');
  if (source) { preview.src = source; preview.classList.remove('hidden'); prompt.classList.add('hidden'); }
  else { preview.removeAttribute('src'); preview.classList.add('hidden'); prompt.classList.remove('hidden'); }
}

async function initPopupEditor() {
  const errorElement = document.getElementById('popup-editor-error');
  try {
    const popup = await Store.getPopupSettings();
    if (popup) {
      document.getElementById('popup-title').value = popup.title || '';
      document.getElementById('popup-message').value = popup.message || '';
      document.getElementById('popup-image-url').value = popup.image_url || '';
      document.getElementById('popup-button-text').value = popup.button_text || '';
      document.getElementById('popup-button-url').value = popup.button_url || '';
      document.getElementById('popup-starts-at').value = popupLocalDate(popup.starts_at);
      document.getElementById('popup-ends-at').value = popupLocalDate(popup.ends_at);
      document.getElementById('popup-active').checked = popup.active;
      updatePopupPreview(popup.image_url || '');
    }
  } catch (error) { errorElement.textContent = `Não foi possível carregar. ${error.message}`; }

  document.getElementById('choose-popup-image').addEventListener('click', () => document.getElementById('popup-image-file').click());
  document.getElementById('popup-image-upload').addEventListener('click', event => { if (!event.target.closest('button')) document.getElementById('popup-image-file').click(); });
  document.getElementById('popup-image-file').addEventListener('change', event => { const file = event.target.files[0]; if (file) updatePopupPreview(URL.createObjectURL(file)); });
  document.getElementById('popup-editor-form').addEventListener('submit', savePopupEditor);
}

async function savePopupEditor(event) {
  event.preventDefault();
  const file = document.getElementById('popup-image-file').files[0];
  const startsValue = document.getElementById('popup-starts-at').value;
  const endsValue = document.getElementById('popup-ends-at').value;
  const errorElement = document.getElementById('popup-editor-error');
  const button = document.getElementById('popup-save-button');
  errorElement.textContent = '';
  if (file && (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)) { errorElement.textContent = 'Escolha uma imagem válida de até 5 MB.'; return; }
  if (startsValue && endsValue && new Date(endsValue) <= new Date(startsValue)) { errorElement.textContent = 'A data final deve ser posterior à inicial.'; return; }
  const buttonUrl = document.getElementById('popup-button-url').value.trim();
  if (buttonUrl && !/^(https?:\/\/|[a-z0-9_.-]+\.html(?:[?#].*)?$)/i.test(buttonUrl)) { errorElement.textContent = 'Informe um endereço HTTPS ou uma página do site.'; return; }
  button.disabled = true; button.textContent = 'Salvando...';
  try {
    let imageUrl = document.getElementById('popup-image-url').value;
    if (file) imageUrl = await Store.uploadProductImage(file);
    await Store.savePopup({ title:document.getElementById('popup-title').value.trim(), message:document.getElementById('popup-message').value.trim(), imageUrl, buttonText:document.getElementById('popup-button-text').value.trim(), buttonUrl, active:document.getElementById('popup-active').checked, startsAt:startsValue ? new Date(startsValue).toISOString() : null, endsAt:endsValue ? new Date(endsValue).toISOString() : null });
    document.getElementById('popup-image-url').value = imageUrl;
    alert('Pop-up salvo com sucesso.');
  } catch (error) { errorElement.textContent = `Não foi possível salvar. ${error.message}`; }
  finally { button.disabled = false; button.textContent = 'Salvar pop-up'; }
}

function updateActiveOrdersBadge() {
  const badge = document.getElementById('active-orders-badge');
  const count = activeOrders().length;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

/* ── DASHBOARD ── */
function renderDashboardState(state, detail = '') {
  if (state === 'loading') {
    return `<section class="dashboard-state" aria-live="polite" aria-busy="true">
      <div class="dashboard-state-spinner" aria-hidden="true"></div>
      <strong>Carregando visão operacional...</strong>
      <span>Buscando os indicadores e pedidos mais recentes.</span>
    </section>`;
  }
  return `<section class="dashboard-state dashboard-state-error" role="alert">
    <span class="dashboard-state-icon" aria-hidden="true">⚠️</span>
    <strong>Não foi possível carregar o Dashboard</strong>
    <span>${escapeManagerHtml(detail || 'Tente novamente em instantes.')}</span>
    <button type="button" onclick="setView('dashboard')">Tentar novamente</button>
  </section>`;
}

function renderDashboardEmpty(icon, title, description) {
  return `<div class="dashboard-empty">
    <span aria-hidden="true">${icon}</span>
    <strong>${title}</strong>
    <p>${description}</p>
  </div>`;
}

function renderDashboard() {
  const now = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === now);
  const active = activeOrders();
  const newOrders = orders.filter(o => o.status === 'pendente');
  const delivered = orders.filter(o => o.status === 'entregue').length;
  const ready = orders.filter(o => o.status === 'pronto').length;
  const soldOutSnacks = products.filter(product => product.category === 'lanches' && Number(product.stock) <= 0);

  return `<section class="dashboard-page" aria-label="Visão operacional">
    <div class="dashboard-readiness" aria-label="Recursos preparados para integração futura">
      <div>
        <span class="dashboard-live-dot" aria-hidden="true"></span>
        <div><strong>Atualização manual</strong><small>Tempo real preparado para integração futura</small></div>
      </div>
      <button class="dashboard-sound-status" type="button" disabled title="O alerta sonoro será habilitado em uma Task futura">
        <span aria-hidden="true">🔕</span> Alerta sonoro em preparação
      </button>
      <span class="dashboard-mock-label">Mock frontend · ${DASHBOARD_FRONTEND_MOCK.updateMode} · ${DASHBOARD_FRONTEND_MOCK.soundAlert}</span>
    </div>

    <div class="kpi-grid dashboard-kpis">
      ${kpiCard('Pedidos Hoje', String(todayOrders.length), '📋', '#F97316', 'recebidos hoje')}
      ${kpiCard('Pedidos Ativos', String(active.length), '👨‍🍳', '#2563EB', 'pendentes ou preparando')}
      ${kpiCard('Prontos', String(ready), '✅', '#16A34A', 'aguardando entrega')}
      ${kpiCard('Entregues', String(delivered), '🛵', '#7C3AED', 'total de pedidos')}
    </div>

    <div class="dashboard-operations-grid">
      <article class="card dashboard-operation-card">
        <div class="card-header dashboard-card-header">
          <div><span class="card-title">Novos pedidos</span><p>Aguardando início do preparo</p></div>
          <span class="dashboard-count-badge">${newOrders.length}</span>
        </div>
        ${newOrders.length
          ? `<div class="dashboard-order-list">${newOrders.slice(0,4).map(o => dashOrderRow(o)).join('')}</div><button class="dashboard-text-button" type="button" onclick="setView('pedidos')">Ver todos os pedidos →</button>`
          : renderDashboardEmpty('✨', 'Fila em dia', 'Nenhum pedido novo aguardando atendimento.')}
      </article>

      <article class="card dashboard-operation-card">
        <div class="card-header dashboard-card-header">
          <div><span class="card-title">Disponibilidade de lanches</span><p>Indicador visual, sem bloqueio automático</p></div>
          <span class="dashboard-count-badge ${soldOutSnacks.length ? 'is-alert' : 'is-ok'}">${soldOutSnacks.length}</span>
        </div>
        ${soldOutSnacks.length
          ? `<div class="dashboard-stock-alert"><span aria-hidden="true">⚠️</span><div><strong>${soldOutSnacks.length} ${soldOutSnacks.length === 1 ? 'lanche sinalizado' : 'lanches sinalizados'} como esgotado</strong><p>${soldOutSnacks.slice(0,3).map(product => escapeManagerHtml(product.name)).join(', ')}${soldOutSnacks.length > 3 ? ` e mais ${soldOutSnacks.length - 3}` : ''}</p></div></div><button class="dashboard-text-button" type="button" onclick="setView('estoque-lanches')">Abrir área preparada →</button>`
          : renderDashboardEmpty('🍔', 'Nenhum alerta visual', 'Não há lanches com quantidade zero nos dados atuais.')}
      </article>
    </div>

    <div class="dashboard-feed-grid">
      <article class="card">
        <div class="card-header dashboard-card-header"><div><span class="card-title">Pedidos ativos</span><p>Pendentes ou em preparo</p></div><span class="dashboard-count-badge">${active.length}</span></div>
        ${active.length
          ? active.slice(0,5).map(o => dashOrderRow(o)).join('')
          : renderDashboardEmpty('👨‍🍳', 'Nenhum pedido ativo', 'Os próximos pedidos aparecerão nesta área.')}
      </article>

      <article class="card">
        <div class="card-header dashboard-card-header"><div><span class="card-title">Últimos pedidos</span><p>Movimentação mais recente</p></div></div>
        ${orders.length
          ? orders.slice(0,5).map(o => dashOrderRow(o)).join('')
          : renderDashboardEmpty('📋', 'Nenhum pedido registrado', 'O histórico recente aparecerá quando houver pedidos.')}
      </article>
    </div>
  </section>`;
}

function dashOrderRow(o) {
  const sm = STATUS_META[o.status];
  return `<div class="dash-order-row">
    <div>
      <span class="dash-order-id">${o.id}</span>
      <span style="margin-left:8px;font-size:0.8rem;color:var(--stone)">${o.customerName}</span>
    </div>
    <div class="dash-order-meta">
      <span class="dash-order-time">${timeSince(o.createdAt)}</span>
      <span class="status-badge" style="background:${sm.bg};color:${sm.color}">${sm.label}</span>
    </div>
  </div>`;
}

/* ── PEDIDOS ── */
function renderPedidos() {
  const statuses = ['todos','pendente','preparando','pronto','entregue','cancelado-demo'];
  const filtered = ordersFilter === 'todos'
    ? orders
    : ordersFilter === 'cancelado-demo'
      ? orders.filter(order => ORDERS_FRONTEND_DEMO.cancellations.has(order.id))
      : orders.filter(order => order.status === ordersFilter && !ORDERS_FRONTEND_DEMO.cancellations.has(order.id));

  const tabs = statuses.map(s => {
    const count = s === 'todos'
      ? orders.length
      : s === 'cancelado-demo'
        ? ORDERS_FRONTEND_DEMO.cancellations.size
        : orders.filter(o => o.status === s && !ORDERS_FRONTEND_DEMO.cancellations.has(o.id)).length;
    const label = s === 'todos' ? 'Todos' : s === 'cancelado-demo' ? 'Cancelados (local)' : STATUS_META[s].label;
    return `<button class="filter-tab${ordersFilter === s ? ' active' : ''}" onclick="setPedidosFilter('${s}')">${label} (${count})</button>`;
  }).join('');

  const cards = filtered.length === 0
    ? renderOrdersEmptyState()
    : filtered.map(o => orderCard(o)).join('');

  return `<section class="orders-page" aria-label="Gestão de pedidos">
    <div class="orders-readiness">
      <div><span class="orders-readiness-dot" aria-hidden="true"></span><div><strong>Atualização manual</strong><small>Realtime e alerta sonoro serão integrados futuramente</small></div></div>
      <span>Frontend preparado</span>
    </div>
    ${ORDERS_FRONTEND_DEMO.feedback ? `<div class="orders-feedback" role="status">✅ ${escapeManagerHtml(ORDERS_FRONTEND_DEMO.feedback)}</div>` : ''}
    <div class="filter-tabs orders-filter-tabs">${tabs}</div>
    <div class="orders-list">${cards}</div>
    ${renderCancellationModal()}
  </section>`;
}

function renderOrdersEmptyState() {
  const filterLabel = ordersFilter === 'todos'
    ? 'pedidos'
    : ordersFilter === 'cancelado-demo'
      ? 'cancelamentos demonstrativos'
      : `pedidos ${STATUS_META[ordersFilter]?.label.toLowerCase() || ''}`;
  return `<div class="orders-empty-state"><span aria-hidden="true">📋</span><strong>Nenhum resultado</strong><p>Não há ${filterLabel} para exibir neste filtro.</p></div>`;
}

function setPedidosFilter(s) {
  ordersFilter = s;
  document.getElementById('m-content').innerHTML = renderPedidos();
}

function orderCard(o) {
  const demoCancellation = ORDERS_FRONTEND_DEMO.cancellations.get(o.id);
  const sm = demoCancellation ? { label:'Cancelado', color:'#B91C1C', bg:'#FEE2E2' } : STATUS_META[o.status];
  const next = NEXT_STATUS[o.status];
  const expanded = expandedOrders.has(o.id);
  const total = orderTotal(o);

  return `<article class="order-card${demoCancellation ? ' is-demo-cancelled' : ''}" id="order-card-${o.id}">
    <div class="order-card-head" onclick="toggleOrder('${o.id}')" role="button" tabindex="0" aria-expanded="${expanded}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleOrder('${o.id}')} ">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <span class="order-id">${o.id}</span>
          <span class="status-badge" style="background:${sm.bg};color:${sm.color}">${sm.label}</span>
          ${demoCancellation ? '<span class="orders-demo-badge">simulação local</span>' : ''}
        </div>
        <p class="order-meta">${escapeManagerHtml(o.customerName)} · ${o.items.length} ${o.items.length===1?'item':'itens'} · <span style="font-family:var(--font-mono)">${timeSince(o.createdAt)}</span></p>
      </div>
      <span class="order-total">R$ ${fmt(total)}</span>
      <span class="chevron">${expanded ? '▲' : '▼'}</span>
    </div>
    ${expanded ? `
    <div class="order-body">
      <div class="order-items-list">
        ${o.items.map(i => {
          const p = getProduct(i.pid);
          return p ? `<div class="order-item-row">
            <span class="order-item-name">${i.qty}× ${p.name}${i.removedIngredients ? `<small class="order-item-removal">Sem: ${escapeManagerHtml(i.removedIngredients)}</small>` : ''}</span>
            <span class="order-item-price">R$ ${fmt(i.unitPrice * i.qty)}</span>
          </div>` : '';
        }).join('')}
      </div>
      ${o.address ? `<div class="order-address">📍 ${formatOrderAddress(o.address)}</div>` : ''}
      <div class="order-payment">💳 Pagamento na entrega: ${orderPaymentLabel(o)}</div>
      ${o.note ? `<div class="order-note">📝 ${escapeManagerHtml(o.note)}</div>` : ''}
      ${renderOrderTimeline(o, demoCancellation)}
      <div class="order-actions no-print">
        ${next && !demoCancellation ? `<button class="btn-advance" onclick="advanceOrder('${o.id}','${next}')">Avançar → ${STATUS_META[next].label}</button>` : ''}
        <button class="order-action-button" type="button" onclick="printKitchenTicket('${o.id}')">🖨️ Imprimir comanda</button>
        ${o.status !== 'entregue' && !demoCancellation ? `<button class="order-action-button is-danger" type="button" onclick="openDemoCancellation('${o.id}')">Cancelar pedido</button>` : ''}
      </div>
      <div class="kitchen-ticket-footer"><strong>Comanda de cozinha · ${o.id}</strong><span>Emitida pelo navegador</span></div>
    </div>` : ''}
  </article>`;
}

function renderOrderTimeline(order, demoCancellation) {
  const stages = ['pendente','preparando','pronto','entregue'];
  const currentIndex = stages.indexOf(order.status);
  const events = [{ label:'Pedido recebido', detail:new Date(order.createdAt).toLocaleString('pt-BR') }];
  stages.slice(1, currentIndex + 1).forEach(status => events.push({ label:STATUS_META[status].label, detail:'Estado registrado no pedido' }));
  if (demoCancellation) events.push({ label:'Cancelamento demonstrativo', detail:`${demoCancellation.reason} · ${new Date(demoCancellation.at).toLocaleString('pt-BR')}`, cancelled:true });
  return `<section class="order-timeline" aria-label="Histórico visual do pedido">
    <h4>Histórico</h4>
    ${events.map(event => `<div class="order-timeline-event${event.cancelled ? ' is-cancelled' : ''}"><span aria-hidden="true"></span><div><strong>${escapeManagerHtml(event.label)}</strong><small>${escapeManagerHtml(event.detail)}</small></div></div>`).join('')}
  </section>`;
}

function renderCancellationModal() {
  if (!ORDERS_FRONTEND_DEMO.cancellationDraftId) return '';
  const order = orders.find(item => item.id === ORDERS_FRONTEND_DEMO.cancellationDraftId);
  if (!order) return '';
  return `<div class="modal-overlay orders-cancel-overlay" onclick="closeDemoCancellation()"></div>
    <section class="modal orders-cancel-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-order-title">
      <span class="orders-demo-badge">demonstração frontend</span>
      <h2 class="modal-title" id="cancel-order-title">Cancelar ${order.id}</h2>
      <p class="modal-sub">Esta ação é somente visual e não modifica o pedido real.</p>
      <form onsubmit="submitDemoCancellation(event)">
        <div class="form-group"><label class="form-label" for="cancel-order-reason">Justificativa *</label><textarea class="form-textarea" id="cancel-order-reason" rows="4" maxlength="240" required placeholder="Informe o motivo do cancelamento"></textarea></div>
        <p class="form-error" id="cancel-order-error"></p>
        <div class="modal-actions"><button class="btn-secondary" type="button" onclick="closeDemoCancellation()">Voltar</button><button class="btn-primary" type="submit">Confirmar simulação</button></div>
      </form>
    </section>`;
}

function openDemoCancellation(id) {
  ORDERS_FRONTEND_DEMO.cancellationDraftId = id;
  document.getElementById('m-content').innerHTML = renderPedidos();
  setTimeout(() => document.getElementById('cancel-order-reason')?.focus(), 0);
}

function closeDemoCancellation() {
  ORDERS_FRONTEND_DEMO.cancellationDraftId = null;
  document.getElementById('m-content').innerHTML = renderPedidos();
}

function submitDemoCancellation(event) {
  event.preventDefault();
  const reason = document.getElementById('cancel-order-reason').value.trim();
  if (!reason) {
    document.getElementById('cancel-order-error').textContent = 'A justificativa é obrigatória.';
    return;
  }
  const id = ORDERS_FRONTEND_DEMO.cancellationDraftId;
  ORDERS_FRONTEND_DEMO.cancellations.set(id, { reason, at:Date.now() });
  ORDERS_FRONTEND_DEMO.cancellationDraftId = null;
  ORDERS_FRONTEND_DEMO.feedback = `${id} marcado como cancelado apenas nesta visualização.`;
  expandedOrders.add(id);
  document.getElementById('m-content').innerHTML = renderPedidos();
}

function printKitchenTicket(id) {
  const card = document.getElementById(`order-card-${id}`);
  if (!card) return;
  card.classList.add('print-target');
  document.body.classList.add('printing-order-ticket');
  window.print();
  setTimeout(() => {
    card.classList.remove('print-target');
    document.body.classList.remove('printing-order-ticket');
  }, 0);
}

/* ── ESTOQUE DE LANCHES PRONTOS (FRONTEND) ── */
function snackStockProducts() {
  return products.filter(product => product.category === 'lanches');
}

function normalizedStockNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function initializeSnackStockDemo() {
  snackStockProducts().forEach(product => {
    if (!SNACK_STOCK_FRONTEND_DEMO.quantities.has(product.id)) {
      SNACK_STOCK_FRONTEND_DEMO.quantities.set(product.id, normalizedStockNumber(product.stock));
    }
    if (!SNACK_STOCK_FRONTEND_DEMO.minimums.has(product.id)) {
      SNACK_STOCK_FRONTEND_DEMO.minimums.set(product.id, normalizedStockNumber(product.minStock, 5));
    }
  });
}

function snackStockStatus(product) {
  const quantity = SNACK_STOCK_FRONTEND_DEMO.quantities.get(product.id) ?? 0;
  const minimum = SNACK_STOCK_FRONTEND_DEMO.minimums.get(product.id) ?? 0;
  if (quantity === 0) return { key:'zero', label:'Esgotado', icon:'⛔' };
  if (quantity <= minimum) return { key:'baixo', label:'Baixo', icon:'⚠️' };
  return { key:'normal', label:'Normal', icon:'✅' };
}

function renderSnackStockState(state, detail = '') {
  if (state === 'loading') {
    return `<section class="snack-stock-state" aria-live="polite" aria-busy="true"><div class="dashboard-state-spinner" aria-hidden="true"></div><strong>Carregando lanches...</strong><span>Preparando o controle local de unidades prontas.</span></section>`;
  }
  return `<section class="snack-stock-state is-error" role="alert"><span aria-hidden="true">⚠️</span><strong>Não foi possível carregar os lanches</strong><p>${escapeManagerHtml(detail || 'Tente novamente em instantes.')}</p><button type="button" onclick="setView('estoque-lanches')">Tentar novamente</button></section>`;
}

function renderSnackStock() {
  initializeSnackStockDemo();
  const snacks = snackStockProducts();
  const counts = { normal:0, baixo:0, zero:0 };
  snacks.forEach(product => { counts[snackStockStatus(product).key]++; });
  const filtered = SNACK_STOCK_FRONTEND_DEMO.filter === 'todos'
    ? snacks
    : snacks.filter(product => snackStockStatus(product).key === SNACK_STOCK_FRONTEND_DEMO.filter);
  const filters = [
    { key:'todos', label:'Todos', count:snacks.length },
    { key:'normal', label:'Normal', count:counts.normal },
    { key:'baixo', label:'Baixo', count:counts.baixo },
    { key:'zero', label:'Esgotado', count:counts.zero },
  ];

  return `<section class="snack-stock-page" aria-label="Estoque local de lanches prontos">
    <div class="snack-stock-intro">
      <div><span aria-hidden="true">📦</span><div><strong>Unidades de lanches prontos</strong><p>Não inclui ingredientes, não realiza abatimento e não possui reset diário.</p></div></div>
      <span>Mock local · sem persistência</span>
    </div>
    ${SNACK_STOCK_FRONTEND_DEMO.feedback ? `<div class="snack-stock-feedback is-${SNACK_STOCK_FRONTEND_DEMO.feedback.type}" role="status">${escapeManagerHtml(SNACK_STOCK_FRONTEND_DEMO.feedback.message)}</div>` : ''}
    <div class="snack-stock-kpis">
      ${kpiCard('Lanches cadastrados', String(snacks.length), '🍔', '#F97316', 'somente categoria lanches')}
      ${kpiCard('Estoque normal', String(counts.normal), '✅', '#16A34A', 'acima do mínimo local')}
      ${kpiCard('Estoque baixo', String(counts.baixo), '⚠️', '#D97706', 'no mínimo ou abaixo')}
      ${kpiCard('Esgotados', String(counts.zero), '⛔', '#DC2626', 'quantidade local igual a zero')}
    </div>
    <div class="filter-tabs snack-stock-filters">${filters.map(filter => `<button class="filter-tab${SNACK_STOCK_FRONTEND_DEMO.filter === filter.key ? ' active' : ''}" type="button" onclick="setSnackStockFilter('${filter.key}')">${filter.label} (${filter.count})</button>`).join('')}</div>
    ${filtered.length ? `<div class="snack-stock-grid">${filtered.map(renderSnackStockCard).join('')}</div>` : `<div class="snack-stock-empty"><span aria-hidden="true">🍔</span><strong>Nenhum lanche neste estado</strong><p>Escolha outro filtro para continuar.</p></div>`}
    ${renderSnackStockHistory()}
    ${renderSnackRestockModal()}
  </section>`;
}

function renderSnackStockCard(product) {
  const quantity = SNACK_STOCK_FRONTEND_DEMO.quantities.get(product.id) ?? 0;
  const minimum = SNACK_STOCK_FRONTEND_DEMO.minimums.get(product.id) ?? 0;
  const status = snackStockStatus(product);
  return `<article class="snack-stock-card is-${status.key}">
    <div class="snack-stock-card-head"><div class="snack-stock-product-icon" aria-hidden="true">🍔</div><div><h3>${escapeManagerHtml(product.name)}</h3><span class="snack-stock-status">${status.icon} ${status.label}</span></div></div>
    <div class="snack-stock-quantity"><strong>${quantity}</strong><span>unidades prontas</span></div>
    <label class="snack-stock-minimum">Estoque mínimo local<input type="number" min="0" max="999" step="1" value="${minimum}" aria-label="Estoque mínimo de ${escapeManagerHtml(product.name)}" onchange="updateSnackStockMinimum(${JSON.stringify(product.id)}, this.value)" /></label>
    <button class="btn-primary snack-stock-restock" type="button" onclick="openSnackRestock(${JSON.stringify(product.id)})">+ Reposição manual</button>
  </article>`;
}

function setSnackStockFilter(filter) {
  if (!['todos','normal','baixo','zero'].includes(filter)) return;
  SNACK_STOCK_FRONTEND_DEMO.filter = filter;
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function updateSnackStockMinimum(productId, value) {
  const minimum = Number(value);
  if (!Number.isInteger(minimum) || minimum < 0 || minimum > 999) {
    SNACK_STOCK_FRONTEND_DEMO.feedback = { type:'error', message:'O estoque mínimo deve ser um número inteiro entre 0 e 999.' };
  } else {
    SNACK_STOCK_FRONTEND_DEMO.minimums.set(productId, minimum);
    SNACK_STOCK_FRONTEND_DEMO.feedback = { type:'success', message:'Estoque mínimo ajustado somente nesta sessão.' };
  }
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function renderSnackRestockModal() {
  if (SNACK_STOCK_FRONTEND_DEMO.restockProductId === null) return '';
  const product = snackStockProducts().find(item => item.id === SNACK_STOCK_FRONTEND_DEMO.restockProductId);
  if (!product) return '';
  return `<div class="modal-overlay snack-restock-overlay" onclick="closeSnackRestock()"></div>
    <section class="modal snack-restock-modal" role="dialog" aria-modal="true" aria-labelledby="snack-restock-title">
      <span class="orders-demo-badge">reposição local</span>
      <h2 class="modal-title" id="snack-restock-title">Repor ${escapeManagerHtml(product.name)}</h2>
      <p class="modal-sub">A quantidade será somada apenas nesta sessão e não será enviada ao Supabase.</p>
      <form onsubmit="submitSnackRestock(event)">
        <div class="form-group"><label class="form-label" for="snack-restock-amount">Quantidade a adicionar *</label><input class="form-input" id="snack-restock-amount" type="number" min="1" max="999" step="1" inputmode="numeric" required /></div>
        <p class="form-error" id="snack-restock-error"></p>
        <div class="modal-actions"><button class="btn-secondary" type="button" onclick="closeSnackRestock()">Cancelar</button><button class="btn-primary" type="submit">Adicionar unidades</button></div>
      </form>
    </section>`;
}

function openSnackRestock(productId) {
  SNACK_STOCK_FRONTEND_DEMO.restockProductId = productId;
  document.getElementById('m-content').innerHTML = renderSnackStock();
  setTimeout(() => document.getElementById('snack-restock-amount')?.focus(), 0);
}

function closeSnackRestock() {
  SNACK_STOCK_FRONTEND_DEMO.restockProductId = null;
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function submitSnackRestock(event) {
  event.preventDefault();
  const amount = Number(document.getElementById('snack-restock-amount').value);
  const errorElement = document.getElementById('snack-restock-error');
  if (!Number.isInteger(amount) || amount < 1 || amount > 999) {
    errorElement.textContent = 'Informe uma quantidade inteira entre 1 e 999.';
    return;
  }
  const productId = SNACK_STOCK_FRONTEND_DEMO.restockProductId;
  const product = snackStockProducts().find(item => item.id === productId);
  const current = SNACK_STOCK_FRONTEND_DEMO.quantities.get(productId) ?? 0;
  if (!product || current + amount > 9999) {
    errorElement.textContent = 'A quantidade total não pode ultrapassar 9.999 unidades.';
    return;
  }
  SNACK_STOCK_FRONTEND_DEMO.quantities.set(productId, current + amount);
  SNACK_STOCK_FRONTEND_DEMO.history.unshift({ productName:product.name, amount, at:Date.now() });
  SNACK_STOCK_FRONTEND_DEMO.restockProductId = null;
  SNACK_STOCK_FRONTEND_DEMO.feedback = { type:'success', message:`${amount} unidades adicionadas a ${product.name} somente nesta sessão.` };
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function renderSnackStockHistory() {
  const entries = SNACK_STOCK_FRONTEND_DEMO.history.slice(0, 5);
  return `<section class="card snack-stock-history"><div class="card-header"><div><span class="card-title">Histórico visual da sessão</span><p>Preparado para integração futura, sem persistência.</p></div></div>${entries.length ? entries.map(entry => `<div class="snack-stock-history-row"><span>+${entry.amount}</span><div><strong>${escapeManagerHtml(entry.productName)}</strong><small>${new Date(entry.at).toLocaleString('pt-BR')}</small></div></div>`).join('') : '<div class="snack-stock-history-empty">Nenhuma reposição local realizada nesta sessão.</div>'}</section>`;
}

/* ── CONFIGURAÇÕES DA LOJA (FRONTEND) ── */
function checkedSetting(value) {
  return value ? ' checked' : '';
}

function storeSettingsSection(icon, title, subtitle, content) {
  return `<section class="card store-settings-section"><div class="store-settings-section-head"><div><span aria-hidden="true">${icon}</span><div><strong>${title}</strong><small>${subtitle}</small></div></div></div>${content}</section>`;
}

function renderStoreSettings() {
  const value = STORE_SETTINGS_FRONTEND_DEMO.values;
  const feedback = STORE_SETTINGS_FRONTEND_DEMO.feedback;
  const saving = STORE_SETTINGS_FRONTEND_DEMO.saving;
  return `<section class="store-settings-page">
    <div class="store-settings-readiness"><div><span aria-hidden="true">⚙️</span><div><strong>Parâmetros operacionais e comerciais</strong><p>Prévia administrativa local, ainda sem persistência ou efeito na loja.</p></div></div><span>Configuração local · demonstração</span></div>
    ${feedback ? `<div class="store-settings-feedback is-${feedback.type}" role="status">${escapeManagerHtml(feedback.message)}</div>` : ''}
    <form id="store-settings-form" onsubmit="submitStoreSettings(event)" oninput="markStoreSettingsDirty()" novalidate>
      <div class="store-settings-layout">
        <div class="store-settings-column">
          ${storeSettingsSection('🕐', 'Funcionamento', 'Horários e pausas operacionais', `
            <div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-open-time">Abertura *</label><input class="form-input" id="setting-open-time" type="time" value="${value.openTime}" required /><small class="form-error" id="setting-open-time-error"></small></div><div class="form-group"><label class="form-label" for="setting-close-time">Fechamento *</label><input class="form-input" id="setting-close-time" type="time" value="${value.closeTime}" required /><small class="form-error" id="setting-close-time-error"></small></div></div>
            <label class="store-settings-check"><input id="setting-pause-enabled" type="checkbox"${checkedSetting(value.pauseEnabled)} onchange="toggleStorePauseFields()" /> Programar pausa de atendimento</label>
            <div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-pause-start">Início da pausa</label><input class="form-input" id="setting-pause-start" type="time" value="${value.pauseStart}"${value.pauseEnabled ? '' : ' disabled'} /><small class="form-error" id="setting-pause-start-error"></small></div><div class="form-group"><label class="form-label" for="setting-pause-end">Fim da pausa</label><input class="form-input" id="setting-pause-end" type="time" value="${value.pauseEnd}"${value.pauseEnabled ? '' : ' disabled'} /><small class="form-error" id="setting-pause-end-error"></small></div></div>`) }
          ${storeSettingsSection('📞', 'Informações comerciais', 'Canais exibidos ao cliente', `
            <div class="form-group"><label class="form-label" for="setting-whatsapp">WhatsApp *</label><input class="form-input" id="setting-whatsapp" value="${escapeManagerHtml(value.whatsapp)}" maxlength="24" required /><small class="form-error" id="setting-whatsapp-error"></small></div>
            <div class="form-group"><label class="form-label" for="setting-instagram">Instagram *</label><input class="form-input" id="setting-instagram" value="${escapeManagerHtml(value.instagram)}" maxlength="31" required /><small class="form-error" id="setting-instagram-error"></small></div>
            <div class="form-group"><label class="form-label" for="setting-location">Localização *</label><input class="form-input" id="setting-location" value="${escapeManagerHtml(value.location)}" maxlength="120" required /><small class="form-error" id="setting-location-error"></small></div>
            <div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-latitude">Latitude *</label><input class="form-input" id="setting-latitude" inputmode="decimal" value="${value.latitude}" required /><small class="form-error" id="setting-latitude-error"></small></div><div class="form-group"><label class="form-label" for="setting-longitude">Longitude *</label><input class="form-input" id="setting-longitude" inputmode="decimal" value="${value.longitude}" required /><small class="form-error" id="setting-longitude-error"></small></div></div>`) }
        </div>
        <div class="store-settings-column">
          ${storeSettingsSection('🛵', 'Atendimento e estimativas', 'Modalidades e tempo previsto', `
            <div class="store-settings-options"><label class="store-settings-option"><input id="setting-delivery-enabled" type="checkbox"${checkedSetting(value.deliveryEnabled)} /><span><strong>Entrega</strong><small>Disponibilizar pedidos para entrega</small></span></label><label class="store-settings-option"><input id="setting-pickup-enabled" type="checkbox"${checkedSetting(value.pickupEnabled)} /><span><strong>Retirada gratuita</strong><small>Disponibilizar retirada no local</small></span></label></div><small class="form-error" id="setting-service-error"></small>
            <div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-delivery-eta-min">Entrega mínima (min) *</label><input class="form-input" id="setting-delivery-eta-min" type="number" min="1" max="240" step="1" value="${value.deliveryEtaMin}" /><small class="form-error" id="setting-delivery-eta-min-error"></small></div><div class="form-group"><label class="form-label" for="setting-delivery-eta-max">Entrega máxima (min) *</label><input class="form-input" id="setting-delivery-eta-max" type="number" min="1" max="240" step="1" value="${value.deliveryEtaMax}" /><small class="form-error" id="setting-delivery-eta-max-error"></small></div></div>
            <div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-pickup-eta-min">Retirada mínima (min) *</label><input class="form-input" id="setting-pickup-eta-min" type="number" min="1" max="240" step="1" value="${value.pickupEtaMin}" /><small class="form-error" id="setting-pickup-eta-min-error"></small></div><div class="form-group"><label class="form-label" for="setting-pickup-eta-max">Retirada máxima (min) *</label><input class="form-input" id="setting-pickup-eta-max" type="number" min="1" max="240" step="1" value="${value.pickupEtaMax}" /><small class="form-error" id="setting-pickup-eta-max-error"></small></div></div>`) }
          ${storeSettingsSection('💳', 'Pagamentos aceitos', 'Selecione pelo menos uma opção', `<div class="store-settings-options is-inline"><label class="store-settings-option"><input id="setting-pix" type="checkbox"${checkedSetting(value.pix)} /><span><strong>Pix</strong></span></label><label class="store-settings-option"><input id="setting-cash" type="checkbox"${checkedSetting(value.cash)} /><span><strong>Dinheiro</strong></span></label><label class="store-settings-option"><input id="setting-card" type="checkbox"${checkedSetting(value.card)} /><span><strong>Cartão</strong></span></label></div><small class="form-error" id="setting-payment-error"></small>`) }
          <section class="card store-settings-section is-sensitive"><div class="store-settings-section-head"><div><span aria-hidden="true">🔐</span><div><strong>Regras comerciais sensíveis</strong><small>Taxas e condições de entrega</small></div></div><span class="store-settings-owner-badge">edição futura: owner</span></div><div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-delivery-fee">Taxa padrão (R$) *</label><input class="form-input" id="setting-delivery-fee" type="number" min="0" max="999" step="0.01" value="${value.deliveryFee.toFixed(2)}" /><small class="form-error" id="setting-delivery-fee-error"></small></div><div class="form-group"><label class="form-label" for="setting-free-delivery">Grátis a partir de (R$) *</label><input class="form-input" id="setting-free-delivery" type="number" min="0" max="9999" step="0.01" value="${value.freeDeliveryFrom.toFixed(2)}" /><small class="form-error" id="setting-free-delivery-error"></small></div></div><p class="store-settings-rule-summary">Referência atual: R$ 5,00 abaixo de R$ 15,00 · retirada grátis.</p></section>
        </div>
      </div>
      <div class="store-settings-actions"><div><strong id="store-settings-state">${STORE_SETTINGS_FRONTEND_DEMO.dirty ? 'Alterações locais não salvas' : 'Nenhuma alteração pendente'}</strong><small>Salvar não envia dados ao Supabase nesta etapa.</small></div><button class="btn-secondary" id="store-settings-cancel" type="button" onclick="cancelStoreSettings()"${saving ? ' disabled' : ''}>Cancelar alterações</button><button class="btn-primary" id="store-settings-save" type="submit"${saving ? ' disabled' : ''}>${saving ? 'Salvando demonstração…' : 'Salvar demonstração'}</button></div>
    </form>
  </section>`;
}

function markStoreSettingsDirty() {
  STORE_SETTINGS_FRONTEND_DEMO.dirty = true;
  STORE_SETTINGS_FRONTEND_DEMO.feedback = null;
  const state = document.getElementById('store-settings-state');
  if (state) state.textContent = 'Alterações locais não salvas';
}

function toggleStorePauseFields() {
  const enabled = document.getElementById('setting-pause-enabled').checked;
  document.getElementById('setting-pause-start').disabled = !enabled;
  document.getElementById('setting-pause-end').disabled = !enabled;
}

function settingValue(id) {
  return document.getElementById(id).value.trim();
}

function numberSettingValue(id) {
  const value = settingValue(id);
  return value === '' ? Number.NaN : Number(value);
}

function clearStoreSettingErrors() {
  document.querySelectorAll('#store-settings-form .input-error').forEach(element => element.classList.remove('input-error'));
  document.querySelectorAll('#store-settings-form .form-error').forEach(element => { element.textContent = ''; });
}

function storeSettingError(id, message) {
  const input = document.getElementById(id);
  input?.classList.add('input-error');
  const error = document.getElementById(`${id}-error`);
  if (error) error.textContent = message;
  return false;
}

function readStoreSettingsForm() {
  return {
    openTime:settingValue('setting-open-time'), closeTime:settingValue('setting-close-time'), pauseEnabled:document.getElementById('setting-pause-enabled').checked,
    pauseStart:settingValue('setting-pause-start'), pauseEnd:settingValue('setting-pause-end'), whatsapp:settingValue('setting-whatsapp'), instagram:settingValue('setting-instagram'),
    location:settingValue('setting-location'), latitude:settingValue('setting-latitude'), longitude:settingValue('setting-longitude'), deliveryEnabled:document.getElementById('setting-delivery-enabled').checked,
    pickupEnabled:document.getElementById('setting-pickup-enabled').checked, pix:document.getElementById('setting-pix').checked, cash:document.getElementById('setting-cash').checked,
    card:document.getElementById('setting-card').checked, deliveryEtaMin:numberSettingValue('setting-delivery-eta-min'), deliveryEtaMax:numberSettingValue('setting-delivery-eta-max'),
    pickupEtaMin:numberSettingValue('setting-pickup-eta-min'), pickupEtaMax:numberSettingValue('setting-pickup-eta-max'), deliveryFee:numberSettingValue('setting-delivery-fee'),
    freeDeliveryFrom:numberSettingValue('setting-free-delivery'),
  };
}

function validateStoreSettings(value) {
  let valid = true;
  if (!/^\d{2}:\d{2}$/.test(value.openTime)) valid = storeSettingError('setting-open-time', 'Informe o horário de abertura.');
  if (!/^\d{2}:\d{2}$/.test(value.closeTime) || value.closeTime === value.openTime) valid = storeSettingError('setting-close-time', 'Informe um fechamento diferente da abertura.');
  if (value.pauseEnabled && (!value.pauseStart || !value.pauseEnd || value.pauseStart === value.pauseEnd)) valid = storeSettingError('setting-pause-end', 'Informe o início e o fim da pausa.');
  if (value.whatsapp.replace(/\D/g, '').length < 12) valid = storeSettingError('setting-whatsapp', 'Informe um WhatsApp com DDI e DDD.');
  if (!/^@[a-zA-Z0-9._]{1,30}$/.test(value.instagram)) valid = storeSettingError('setting-instagram', 'Use o formato @usuario.');
  if (value.location.length < 3) valid = storeSettingError('setting-location', 'Informe a localização comercial.');
  const latitude = Number(value.latitude); const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) valid = storeSettingError('setting-latitude', 'Latitude deve estar entre -90 e 90.');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) valid = storeSettingError('setting-longitude', 'Longitude deve estar entre -180 e 180.');
  if (!value.deliveryEnabled && !value.pickupEnabled) { document.getElementById('setting-service-error').textContent = 'Selecione entrega ou retirada.'; valid = false; }
  if (!value.pix && !value.cash && !value.card) { document.getElementById('setting-payment-error').textContent = 'Selecione pelo menos uma forma de pagamento.'; valid = false; }
  [['delivery',value.deliveryEtaMin,value.deliveryEtaMax],['pickup',value.pickupEtaMin,value.pickupEtaMax]].forEach(([type,min,max]) => {
    if (!Number.isInteger(min) || min < 1 || min > 240) valid = storeSettingError(`setting-${type}-eta-min`, 'Use um inteiro entre 1 e 240.');
    if (!Number.isInteger(max) || max < min || max > 240) valid = storeSettingError(`setting-${type}-eta-max`, 'Deve ser maior ou igual ao mínimo.');
  });
  if (!Number.isFinite(value.deliveryFee) || value.deliveryFee < 0 || value.deliveryFee > 999) valid = storeSettingError('setting-delivery-fee', 'Informe um valor entre 0 e 999.');
  if (!Number.isFinite(value.freeDeliveryFrom) || value.freeDeliveryFrom < 0 || value.freeDeliveryFrom > 9999) valid = storeSettingError('setting-free-delivery', 'Informe um valor entre 0 e 9.999.');
  return valid;
}

function submitStoreSettings(event) {
  event.preventDefault();
  clearStoreSettingErrors();
  const values = readStoreSettingsForm();
  if (!validateStoreSettings(values)) return;
  STORE_SETTINGS_FRONTEND_DEMO.saving = true;
  document.getElementById('m-content').innerHTML = renderStoreSettings();
  setTimeout(() => {
    STORE_SETTINGS_FRONTEND_DEMO.values = values;
    STORE_SETTINGS_FRONTEND_DEMO.saving = false;
    STORE_SETTINGS_FRONTEND_DEMO.dirty = false;
    STORE_SETTINGS_FRONTEND_DEMO.feedback = { type:'success', message:'Configurações salvas somente nesta sessão demonstrativa.' };
    document.getElementById('m-content').innerHTML = renderStoreSettings();
  }, 350);
}

function cancelStoreSettings() {
  STORE_SETTINGS_FRONTEND_DEMO.dirty = false;
  STORE_SETTINGS_FRONTEND_DEMO.feedback = { type:'neutral', message:'Alterações descartadas; os últimos valores locais foram restaurados.' };
  document.getElementById('m-content').innerHTML = renderStoreSettings();
}

function toggleOrder(id) {
  if (expandedOrders.has(id)) expandedOrders.delete(id);
  else expandedOrders.add(id);
  document.getElementById('m-content').innerHTML = renderPedidos();
}

async function advanceOrder(id, nextStatus) {
  const o = orders.find(o => o.id === id);
  if (o) {
    o.status = nextStatus;
    expandedOrders.add(id);
    try {
      await Store.updateOrderStatus(o.databaseId, nextStatus);
    } catch (error) {
      alert(`Não foi possível atualizar o pedido. ${error.message}`);
      return;
    }
  }
  ORDERS_FRONTEND_DEMO.feedback = `${id} avançou para ${STATUS_META[nextStatus].label}.`;
  updateActiveOrdersBadge();
  document.getElementById('m-content').innerHTML = renderPedidos();
}

/* ── RELATÓRIOS ── */
function localDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeManagerHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}

function setReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  reportDate = value;
  REPORTS_FRONTEND_DEMO.period = 'day';
  REPORTS_FRONTEND_DEMO.error = '';
  document.getElementById('m-content').innerHTML = renderRelatorios();
}

function shiftReportDate(days) {
  const date = new Date(`${reportDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  setReportDate(localDateKey(date));
}

function showTodayReport() {
  setReportDate(localDateKey(Date.now()));
}

function setReportPeriod(period) {
  if (!['day','seven','thirty','custom'].includes(period)) return;
  REPORTS_FRONTEND_DEMO.period = period;
  REPORTS_FRONTEND_DEMO.error = '';
  if (period !== 'custom') reportDate = localDateKey(Date.now());
  document.getElementById('m-content').innerHTML = renderRelatorios();
}

function applyCustomReportRange() {
  const start = document.getElementById('report-custom-start').value;
  const end = document.getElementById('report-custom-end').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    REPORTS_FRONTEND_DEMO.error = 'Informe um período personalizado válido, com a data inicial anterior ou igual à final.';
    document.getElementById('report-range-error').textContent = REPORTS_FRONTEND_DEMO.error;
    return;
  }
  REPORTS_FRONTEND_DEMO.customStart = start;
  REPORTS_FRONTEND_DEMO.customEnd = end;
  REPORTS_FRONTEND_DEMO.error = '';
  document.getElementById('m-content').innerHTML = renderRelatorios();
}

function reportPeriodRange() {
  if (REPORTS_FRONTEND_DEMO.period === 'custom') {
    return { start:REPORTS_FRONTEND_DEMO.customStart, end:REPORTS_FRONTEND_DEMO.customEnd };
  }
  const end = REPORTS_FRONTEND_DEMO.period === 'day' ? reportDate : localDateKey(Date.now());
  const startDate = new Date(`${end}T12:00:00`);
  if (REPORTS_FRONTEND_DEMO.period === 'seven') startDate.setDate(startDate.getDate() - 6);
  if (REPORTS_FRONTEND_DEMO.period === 'thirty') startDate.setDate(startDate.getDate() - 29);
  return { start:localDateKey(startDate), end };
}

function reportPeriodLabel(range) {
  const format = value => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
  if (range.start === range.end) return new Date(`${range.start}T12:00:00`).toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  return `${format(range.start)} — ${format(range.end)}`;
}

function renderReportsState(state, detail = '') {
  if (state === 'loading') return `<section class="reports-state" aria-live="polite" aria-busy="true"><div class="dashboard-state-spinner" aria-hidden="true"></div><strong>Carregando relatórios...</strong><span>Organizando os dados financeiros disponíveis.</span></section>`;
  return `<section class="reports-state is-error" role="alert"><span aria-hidden="true">⚠️</span><strong>Não foi possível carregar os relatórios</strong><p>${escapeManagerHtml(detail || 'Tente novamente em instantes.')}</p><button type="button" onclick="setView('relatorios')">Tentar novamente</button></section>`;
}

function renderRelatorios() {
  const range = reportPeriodRange();
  const selectedOrders = orders.filter(order => {
    const date = localDateKey(order.createdAt);
    return date >= range.start && date <= range.end;
  });
  const selectedExpenses = expenses.filter(expense => {
    const date = localDateKey(expense.date);
    return date >= range.start && date <= range.end;
  });
  const attendedOrders = selectedOrders.filter(order => order.status === 'entregue');
  const periodRevenue = selectedOrders.reduce((total, order) => total + orderTotal(order), 0);
  const periodCost = selectedOrders.reduce((total, order) => total + order.items.reduce((subtotal, item) => {
    const product = getProduct(item.pid);
    return subtotal + (item.unitCost ?? product?.cost ?? 0) * item.qty;
  }, 0), 0);
  const periodExpenses = selectedExpenses.reduce((total, expense) => total + expense.amount, 0);
  const periodResult = periodRevenue - periodCost - periodExpenses;
  const averageTicket = selectedOrders.length ? periodRevenue / selectedOrders.length : 0;

  const rows = selectedOrders.map(order => {
    const status = STATUS_META[order.status] || { label:order.status, color:'#57534E', bg:'#F5F5F4' };
    const customer = order.customer || {};
    const items = order.items.map(item => {
      const product = getProduct(item.pid);
      return `<span><strong>${item.qty}×</strong> ${escapeManagerHtml(product?.name || `Produto #${item.pid}`)} <small>R$ ${fmt(item.unitPrice * item.qty)}</small>${item.removedIngredients ? `<em>Sem: ${escapeManagerHtml(item.removedIngredients)}</em>` : ''}</span>`;
    }).join('');
    const address = order.address ? formatOrderAddress(order.address) : 'Não informado';
    return `<tr>
      <td><strong class="report-order-id">${order.id}</strong><small>${new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}</small></td>
      <td><strong>${escapeManagerHtml(order.customerName)}</strong><small>${escapeManagerHtml(customer.phone || 'Telefone não informado')}</small><small>${escapeManagerHtml(customer.email || 'E-mail não informado')}</small></td>
      <td><div class="report-products-list">${items || '<span>Nenhum item</span>'}</div></td>
      <td><span class="report-address">${address}</span>${order.note ? `<small class="report-note">Observação: ${escapeManagerHtml(order.note)}</small>` : ''}</td>
      <td><span class="report-payment">${escapeManagerHtml(orderPaymentLabel(order))}</span></td>
      <td><strong class="report-value">R$ ${fmt(orderTotal(order))}</strong></td>
      <td><span class="status-badge" style="background:${status.bg};color:${status.color}">${escapeManagerHtml(status.label)}</span></td>
    </tr>`;
  }).join('');

  return `<section class="reports-page">
    <div class="report-readiness"><div><span aria-hidden="true">📊</span><div><strong>Visão financeira em preparação</strong><p>Os indicadores preservam os dados atuais; critérios definitivos serão consolidados no backend.</p></div></div><span>sem alteração de consultas</span></div>
    <div class="card report-filter-card">
      <div class="report-filter-head"><div><span class="report-calendar-label">Período do relatório</span><h2>${escapeManagerHtml(reportPeriodLabel(range))}</h2></div><div class="report-period-tabs">
        <button type="button" class="${REPORTS_FRONTEND_DEMO.period === 'day' ? 'active' : ''}" onclick="setReportPeriod('day')">Dia</button>
        <button type="button" class="${REPORTS_FRONTEND_DEMO.period === 'seven' ? 'active' : ''}" onclick="setReportPeriod('seven')">7 dias</button>
        <button type="button" class="${REPORTS_FRONTEND_DEMO.period === 'thirty' ? 'active' : ''}" onclick="setReportPeriod('thirty')">30 dias</button>
        <button type="button" class="${REPORTS_FRONTEND_DEMO.period === 'custom' ? 'active' : ''}" onclick="setReportPeriod('custom')">Personalizado</button>
      </div></div>
      ${REPORTS_FRONTEND_DEMO.period === 'day' ? `<div class="report-calendar-controls"><button type="button" title="Dia anterior" aria-label="Dia anterior" onclick="shiftReportDate(-1)">←</button><input id="report-date" type="date" value="${reportDate}" aria-label="Selecionar dia do relatório" onchange="setReportDate(this.value)" /><button type="button" title="Próximo dia" aria-label="Próximo dia" onclick="shiftReportDate(1)">→</button><button class="report-today-button" type="button" onclick="showTodayReport()">Hoje</button></div>` : ''}
      ${REPORTS_FRONTEND_DEMO.period === 'custom' ? `<div class="report-custom-range"><label>Data inicial<input id="report-custom-start" type="date" value="${REPORTS_FRONTEND_DEMO.customStart}" /></label><span aria-hidden="true">→</span><label>Data final<input id="report-custom-end" type="date" value="${REPORTS_FRONTEND_DEMO.customEnd}" /></label><button class="btn-primary" type="button" onclick="applyCustomReportRange()">Aplicar período</button></div><p class="form-error" id="report-range-error">${escapeManagerHtml(REPORTS_FRONTEND_DEMO.error)}</p>` : ''}
    </div>

    <div class="report-backend-note"><span aria-hidden="true">🛡️</span><div><strong>Preparado para conciliação futura</strong><p>Cancelamentos ou vendas não realizadas continuam incluídos conforme o comportamento atual. A exclusão dependerá de critérios consolidados no backend.</p></div></div>

    <div class="kpi-grid report-kpis">
      ${kpiCard('Vendas no período', `R$ ${fmt(periodRevenue)}`, '💵', '#16A34A', `${selectedOrders.length} pedidos registrados`)}
      ${kpiCard('Custos dos produtos', `R$ ${fmt(periodCost)}`, '🧾', '#D97706', 'estimativa com dados atuais')}
      ${kpiCard('Despesas no período', `R$ ${fmt(periodExpenses)}`, '📤', '#DC2626', `${selectedExpenses.length} registros disponíveis`)}
      ${kpiCard('Resultado estimado', `R$ ${fmt(periodResult)}`, '📈', periodResult >= 0 ? '#2563EB' : '#DC2626', 'vendas − custos − despesas')}
      ${kpiCard('Pedidos atendidos', String(attendedOrders.length), '✅', '#7C3AED', 'pedidos entregues')}
      ${kpiCard('Ticket médio', `R$ ${fmt(averageTicket)}`, '🧮', '#D97706', 'média dos pedidos registrados')}
    </div>

    <div class="card report-orders-card">
      <div>
        <div class="card-header report-orders-header"><div><span class="card-title">Pedidos do período</span><p>${selectedOrders.length} ${selectedOrders.length === 1 ? 'pedido encontrado' : 'pedidos encontrados'}</p></div></div>
        ${selectedOrders.length ? `<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th>Entrega</th><th>Pagamento</th><th>Valor</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="report-empty"><span>📅</span><strong>Nenhum pedido neste período</strong><p>Escolha outro filtro ou período personalizado para consultar.</p></div>'}
      </div>
    </div>
  </section>`;
}

/* ── ESTOQUE ── */
function renderEstoque() {
  const catTabs = [{ key:'todos', label:'Todos' }, ...Object.entries(CAT_MAP).map(([k,v]) => ({ key:k, label:v.label }))];
  const filtered = stockFilterCat === 'todos' ? products : products.filter(p => p.category === stockFilterCat);

  const tabs = catTabs.map(c =>
    `<button class="filter-tab${stockFilterCat === c.key ? ' active' : ''}" onclick="setStockFilter('${c.key}')">${c.label}</button>`
  ).join('');

  const rows = filtered.map((p) => {
    const isOut = p.stock === 0;
    const isLow = p.stock <= p.minStock;
    const statusColor = isOut ? '#DC2626' : isLow ? '#D97706' : '#16A34A';
    const statusBg = isOut ? '#FEE2E2' : isLow ? '#FEF3C7' : '#DCFCE7';
    const statusLabel = isOut ? 'Esgotado' : isLow ? 'Baixo' : 'OK';
    const cat = CAT_MAP[p.category];

    return `<tr>
      <td>
        <div class="tbl-product">
          <img class="tbl-img" src="${p.img}" alt="${p.name}" loading="lazy" />
          <span class="tbl-name">${p.name}</span>
        </div>
      </td>
      <td style="color:var(--stone);font-weight:600">${cat.emoji} ${cat.label}</td>
      <td style="font-family:var(--font-mono);color:var(--green);font-weight:600">R$ ${fmt(p.price)}</td>
      <td style="font-family:var(--font-mono);color:var(--stone)">R$ ${fmt(p.cost)}</td>
      <td>
        ${editingStock === p.id
          ? `<input class="stock-input" id="stock-input-${p.id}" type="number" value="${p.stock}" min="0" onblur="saveStock(${p.id})" onkeydown="if(event.key==='Enter')saveStock(${p.id})" />`
          : `<span style="font-family:var(--font-mono);font-weight:700;color:${isOut?'#DC2626':isLow?'#D97706':'var(--dark)'}">${p.stock} un.</span>`
        }
      </td>
      <td style="font-family:var(--font-mono);color:var(--stone-light)">${p.minStock} un.</td>
      <td><span class="status-badge" style="background:${statusBg};color:${statusColor}">${statusLabel}</span></td>
      <td><button class="btn-edit" onclick="startEditStock(${p.id})">Editar</button></td>
    </tr>`;
  }).join('');

  return `
    <div class="filter-tabs">${tabs}</div>
    <div class="stock-table" style="overflow-x:auto">
      <table class="tbl">
        <thead>
          <tr>
            <th>Produto</th><th>Categoria</th><th>Preço</th><th>Custo</th>
            <th>Estoque</th><th>Mínimo</th><th>Status</th><th>Ação</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function setStockFilter(cat) {
  stockFilterCat = cat;
  editingStock = null;
  document.getElementById('m-content').innerHTML = renderEstoque();
}

function startEditStock(pid) {
  editingStock = pid;
  document.getElementById('m-content').innerHTML = renderEstoque();
  const input = document.getElementById(`stock-input-${pid}`);
  if (input) { input.focus(); input.select(); }
}

async function saveStock(pid) {
  const input = document.getElementById(`stock-input-${pid}`);
  if (input) {
    const val = parseInt(input.value, 10);
    if (!isNaN(val) && val >= 0) {
      const p = getProduct(pid);
      if (p) {
        p.stock = val;
        try {
          await Store.updateProductStock(pid, val);
        } catch (error) {
          alert(`Não foi possível atualizar o estoque. ${error.message}`);
        }
      }
    }
  }
  editingStock = null;
  document.getElementById('m-content').innerHTML = renderEstoque();
}

/* ── FINANCEIRO ── */
function renderFinanceiro() {
  const totalRev = orders.reduce((s, o) => s + orderTotal(o), 0);
  const totalCost = orders.reduce((s, o) =>
    s + o.items.reduce((ss, i) => { const p = getProduct(i.pid); return ss + (i.unitCost ?? p?.cost ?? 0) * i.qty; }, 0), 0);
  const totalExp = expenses.reduce((s, e) => s + e.amount, 0);
  const grossProfit = totalRev - totalCost;
  const netProfit = grossProfit - totalExp;
  const margin = totalRev > 0 ? (netProfit / totalRev) * 100 : 0;

  const byCategory = {};
  expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount; });

  const prodMap = {};
  orders.forEach(o => o.items.forEach(i => {
    const p = getProduct(i.pid);
    if (!p) return;
    if (!prodMap[i.pid]) prodMap[i.pid] = { name: p.name, rev: 0, qty: 0 };
    prodMap[i.pid].rev += p.price * i.qty;
    prodMap[i.pid].qty += i.qty;
  }));
  const topProds = Object.values(prodMap).sort((a, b) => b.rev - a.rev).slice(0, 5);
  const maxRev = topProds[0]?.rev || 1;

  const catBars = Object.entries(byCategory).map(([cat, val]) => {
    const pct = totalExp > 0 ? (val / totalExp) * 100 : 0;
    return `<div>
      <div class="bar-row-label">
        <span class="bar-row-name">${EXPENSE_LABELS[cat]}</span>
        <span class="bar-row-val">R$ ${fmt(val)} · ${pct.toFixed(0)}%</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  const prodBars = topProds.map(p => `<div>
    <div class="bar-row-label">
      <span class="bar-row-name" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span>
      <span class="bar-row-val">R$ ${fmt(p.rev)}</span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:${(p.rev/maxRev*100)}%"></div></div>
  </div>`).join('');

  const expRows = expenses.slice(0, 10).map(e => `
    <div class="expense-row">
      <div>
        <p class="exp-name">${e.description}</p>
        <p class="exp-meta">${EXPENSE_LABELS[e.category]} · ${new Date(e.date).toLocaleDateString('pt-BR')}</p>
      </div>
      <span class="exp-amount">− R$ ${fmt(e.amount)}</span>
    </div>`).join('');

  return `
    <div class="kpi-grid" style="margin-bottom:20px">
      ${kpiCard('Receita Total', `R$ ${fmt(totalRev)}`, '💵', '#16A34A', `${orders.length} pedidos`)}
      ${kpiCard('Custo dos Produtos', `R$ ${fmt(totalCost)}`, '🧾', '#D97706', 'CMV acumulado')}
      ${kpiCard('Lucro Bruto', `R$ ${fmt(grossProfit)}`, '📈', '#2563EB', `Margem: ${((grossProfit/(totalRev||1))*100).toFixed(1)}%`)}
      ${kpiCard('Despesas Fixas', `R$ ${fmt(totalExp)}`, '📤', '#DC2626', 'total registrado')}
      ${kpiCard('Lucro Líquido', `R$ ${fmt(netProfit)}`, '🏆', netProfit >= 0 ? '#7C3AED' : '#DC2626', `${margin.toFixed(1)}% de margem`)}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><span class="card-title">Despesas por Categoria</span></div>
        <div class="bar-wrap">${catBars || '<p style="color:var(--stone-light);font-size:0.875rem">Nenhuma despesa registrada.</p>'}</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Produtos Mais Vendidos</span></div>
        <div class="bar-wrap">${prodBars || '<p style="color:var(--stone-light);font-size:0.875rem">Sem dados de vendas.</p>'}</div>
      </div>
    </div>

    <div class="card" style="margin-top:20px">
      <div class="card-header">
        <span class="card-title">Registro de Despesas</span>
        <button class="btn-new-expense" onclick="openExpenseModal()">+ Nova Despesa</button>
      </div>
      ${expRows || '<p style="color:var(--stone-light);font-size:0.875rem">Nenhuma despesa registrada.</p>'}
    </div>`;
}

function kpiCard(label, value, icon, color, sub) {
  return `<div class="kpi-card">
    <div class="kpi-top">
      <span class="kpi-label">${label}</span>
      <span class="kpi-icon">${icon}</span>
    </div>
    <p class="kpi-value" style="color:${color}">${value}</p>
    <p class="kpi-sub">${sub}</p>
  </div>`;
}

/* ── MODAL DE DESPESAS ── */
function openExpenseModal() {
  document.getElementById('exp-desc').value = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-category').value = 'insumos';
  document.getElementById('expense-overlay').classList.remove('hidden');
  document.getElementById('expense-modal').classList.remove('hidden');
  document.getElementById('exp-desc').focus();
}

function closeExpenseModal() {
  document.getElementById('expense-overlay').classList.add('hidden');
  document.getElementById('expense-modal').classList.add('hidden');
}

async function submitExpense() {
  const desc = document.getElementById('exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('exp-amount').value);
  const category = document.getElementById('exp-category').value;
  if (!desc || isNaN(amount) || amount <= 0) return;

  try {
    await Store.addExpense({ description: desc, amount, category });
    expenses = await Store.getExpenses();
    closeExpenseModal();
    document.getElementById('m-content').innerHTML = renderFinanceiro();
  } catch (error) {
    alert(`Não foi possível registrar a despesa. ${error.message}`);
  }
}

function formatOrderAddress(address) {
  const clean = value => String(value || '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
  const firstLine = [address.street, address.number].filter(Boolean).map(clean).join(', ');
  const neighborhood = address.neighborhood ? ` — ${clean(address.neighborhood)}` : '';
  const complement = address.complement ? ` · ${clean(address.complement)}` : '';
  return `${firstLine}${complement}${neighborhood}`;
}

async function verifyManager() {
  const { data: { user } } = await DB.auth.getUser();
  if (!user) return false;
  const { data, error } = await DB.from('profiles').select('role').eq('id', user.id).single();
  return !error && data?.role === 'manager';
}

async function initManager() {
  if (await verifyManager()) {
    const { data: { user } } = await DB.auth.getUser();
    const { data: profile } = await DB.from('profiles').select('name').eq('id', user.id).maybeSingle();
    document.querySelector('.m-online-label').textContent = profile?.name || user.email;
    document.getElementById('manager-login').classList.add('hidden');
    document.getElementById('page-manager').classList.remove('hidden');
    const requestedView = new URLSearchParams(window.location.search).get('view');
    await setView(VIEW_TITLES[requestedView] ? requestedView : 'dashboard');
  } else {
    document.getElementById('page-manager').classList.add('hidden');
    window.location.replace('entrar.html');
  }
}

async function signOutManager() {
  await DB.auth.signOut();
  window.location.reload();
}

document.getElementById('manager-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorElement = document.getElementById('manager-login-error');
  const button = event.currentTarget.querySelector('button');
  errorElement.textContent = '';
  button.disabled = true;
  const { error } = await DB.auth.signInWithPassword({
    email: document.getElementById('manager-email').value.trim(),
    password: document.getElementById('manager-password').value,
  });
  if (error || !(await verifyManager())) {
    await DB.auth.signOut();
    errorElement.textContent = error ? 'E-mail ou senha inválidos.' : 'Esta conta não possui acesso de gestor.';
    button.disabled = false;
    return;
  }
  await initManager();
});

initManager();
