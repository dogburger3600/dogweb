'use strict';

let products = [];
let orders = [];
let expenses = [];

let currentView = 'dashboard';
let expandedOrders = new Set();
let ordersFilter = 'todos';
let reportDate = localDateKey(Date.now());
let popupPreviewImageSource = '';

// Estado efêmero da interface; as operações de pedido são confirmadas pelo backend.
const ORDERS_UI_STATE = {
  cancellationDraftId: null,
  feedback: '',
};

const REALTIME_UI_STATE = {
  connection: 'connecting',
  detail: '',
  soundEnabled: false,
  lastSyncAt: null,
};

// Estado visual; quantidades e histórico são sempre reconciliados com o backend.
const SNACK_STOCK_UI_STATE = {
  movements: [],
  filter: 'todos',
  category: 'todos',
  restockProductId: null,
  compositionProductId: null,
  compositionDraft: null,
  feedback: null,
  savingMinimums: new Set(),
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

function getProduct(pid) {
  return products.find(p => p.id === pid);
}

function orderTotal(order) {
  return order.items.reduce((s, i) => {
    const p = getProduct(i.pid);
    return s + (i.unitPrice ?? p?.price ?? 0) * i.qty;
  }, 0);
}

function orderItemChoiceSummary(item) {
  return (item.componentSelections || []).map(selection => `<small class="order-item-removal">${escapeManagerHtml(selection.group_name || 'Escolha')}: ${selection.quantity}× ${escapeManagerHtml(selection.product_name || `Produto ${selection.product_id}`)}</small>`).join('');
}

function activeOrders() {
  return orders.filter(o => !o.cancellation && (o.status === 'pendente' || o.status === 'preparando'));
}

function realtimeStatusMeta() {
  const states = {
    connecting:{ label:'Conectando', detail:'Iniciando atualização automática', icon:'🟡' },
    connected:{ label:'Atualização automática ativa', detail:'Dados reconciliados com o servidor', icon:'🟢' },
    reconnecting:{ label:'Reconectando', detail:'Mantendo os dados atuais enquanto a conexão retorna', icon:'🟠' },
    error:{ label:'Falha na atualização automática', detail:'A sincronização manual continua disponível', icon:'🔴' },
  };
  return states[REALTIME_UI_STATE.connection] || states.connecting;
}

function renderRealtimeReadiness(context) {
  const status = realtimeStatusMeta();
  const detail = REALTIME_UI_STATE.detail || status.detail;
  const lastSync = REALTIME_UI_STATE.lastSyncAt
    ? `Última sincronização ${new Date(REALTIME_UI_STATE.lastSyncAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`
    : 'Aguardando primeira sincronização';
  const wrapperClass = context === 'dashboard' ? 'dashboard-readiness' : 'orders-readiness';
  return `<div class="${wrapperClass} realtime-readiness is-${REALTIME_UI_STATE.connection}" data-realtime-panel>
    <div><span class="realtime-connection-dot" data-realtime-icon aria-hidden="true">${status.icon}</span><div><strong data-realtime-label>${status.label}</strong><small data-realtime-detail>${escapeManagerHtml(detail)}</small></div></div>
    <div class="realtime-controls"><button class="dashboard-sound-status${REALTIME_UI_STATE.soundEnabled ? ' is-enabled' : ''}" type="button" onclick="toggleRealtimeSound()" aria-pressed="${REALTIME_UI_STATE.soundEnabled}" data-realtime-sound><span aria-hidden="true">${REALTIME_UI_STATE.soundEnabled ? '🔔' : '🔕'}</span> ${REALTIME_UI_STATE.soundEnabled ? 'Som habilitado' : 'Habilitar som'}</button><span class="realtime-last-sync" data-realtime-sync>${lastSync}</span></div>
  </div>`;
}

function updateRealtimeUi(state) {
  Object.assign(REALTIME_UI_STATE, state);
  const status = realtimeStatusMeta();
  const detail = REALTIME_UI_STATE.detail || status.detail;
  document.querySelectorAll('[data-realtime-panel]').forEach(panel => {
    panel.classList.remove('is-connecting', 'is-connected', 'is-reconnecting', 'is-error');
    panel.classList.add(`is-${REALTIME_UI_STATE.connection}`);
    panel.querySelector('[data-realtime-icon]').textContent = status.icon;
    panel.querySelector('[data-realtime-label]').textContent = status.label;
    panel.querySelector('[data-realtime-detail]').textContent = detail;
    const soundButton = panel.querySelector('[data-realtime-sound]');
    soundButton.classList.toggle('is-enabled', REALTIME_UI_STATE.soundEnabled);
    soundButton.setAttribute('aria-pressed', String(REALTIME_UI_STATE.soundEnabled));
    soundButton.innerHTML = `<span aria-hidden="true">${REALTIME_UI_STATE.soundEnabled ? '🔔' : '🔕'}</span> ${REALTIME_UI_STATE.soundEnabled ? 'Som habilitado' : 'Habilitar som'}`;
    panel.querySelector('[data-realtime-sync]').textContent = REALTIME_UI_STATE.lastSyncAt
      ? `Última sincronização ${new Date(REALTIME_UI_STATE.lastSyncAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`
      : 'Aguardando primeira sincronização';
  });
  const onlineDot = document.querySelector('.m-online-dot');
  if (onlineDot) onlineDot.dataset.connection = REALTIME_UI_STATE.connection;
}

async function toggleRealtimeSound() {
  await window.ManagerRealtime?.toggleSound();
}

async function reconcileRealtimeOrders() {
  [orders, products] = await Promise.all([Store.getOrders(), Store.getAllProducts()]);
  if (currentView === 'estoque-lanches') SNACK_STOCK_UI_STATE.movements = await Store.getStockMovements();
  updateActiveOrdersBadge();
  if (currentView === 'dashboard') document.getElementById('m-content').innerHTML = renderDashboard();
  if (currentView === 'pedidos') document.getElementById('m-content').innerHTML = renderPedidos();
  if (currentView === 'estoque-lanches') document.getElementById('m-content').innerHTML = renderSnackStock();
  updateRealtimeUi(REALTIME_UI_STATE);
  return orders.map(order => order.databaseId);
}

function startManagerRealtime() {
  window.ManagerRealtime?.start({
    client:DB,
    initialOrderIds:orders.map(order => order.databaseId),
    onReconcile:reconcileRealtimeOrders,
    onState:updateRealtimeUi,
  });
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
    if (view === 'estoque-lanches') SNACK_STOCK_UI_STATE.movements = await Store.getStockMovements();
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
      <div class="card-header popup-editor-head"><div><span class="card-title">Pop-up inicial</span><p class="popup-editor-sub">Organize promoções e comunicados exibidos na página inicial.</p></div><label class="popup-active-switch"><input type="checkbox" id="popup-active" /><span></span><strong>Ativo</strong></label></div>
      <div class="popup-active-note"><span aria-hidden="true">📣</span><div><strong id="popup-active-label">Pop-up desativado</strong><small>A ativação só terá efeito após salvar pelo fluxo existente.</small></div></div>
      <section class="popup-form-section"><div class="popup-form-section-head"><span aria-hidden="true">✏️</span><div><strong>Conteúdo</strong><small>Título e mensagem principal</small></div></div><div class="form-group"><label class="form-label" for="popup-title">Título *</label><input class="form-input" id="popup-title" maxlength="80" required /></div><div class="form-group"><label class="form-label" for="popup-message">Mensagem *</label><textarea class="form-textarea" id="popup-message" rows="4" maxlength="400" required></textarea><small class="popup-character-count" id="popup-message-count">0/400</small></div></section>
      <section class="popup-form-section"><div class="popup-form-section-head"><span aria-hidden="true">🖼️</span><div><strong>Imagem</strong><small>Opcional · formato horizontal recomendado</small></div></div><div class="form-group"><input class="hidden" id="popup-image-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /><input id="popup-image-url" type="hidden" /><div class="popup-image-upload" id="popup-image-upload"><img class="hidden" id="popup-image-preview" alt="Prévia da imagem do pop-up" /><div id="popup-image-prompt"><span>🖼️</span><strong>Importar imagem</strong><small>JPG, PNG, WEBP ou GIF · até 5 MB</small></div><button class="btn-upload-image" id="choose-popup-image" type="button">Escolher imagem</button></div></div></section>
      <section class="popup-form-section"><div class="popup-form-section-head"><span aria-hidden="true">🔗</span><div><strong>Botão de ação</strong><small>CTA opcional; preencha texto e destino juntos</small></div></div><div class="signup-grid"><div class="form-group"><label class="form-label" for="popup-button-text">Texto do botão</label><input class="form-input" id="popup-button-text" maxlength="40" placeholder="Ver cardápio" /></div><div class="form-group"><label class="form-label" for="popup-button-url">Destino do botão</label><input class="form-input" id="popup-button-url" placeholder="index.html ou https://..." /></div></div></section>
      <section class="popup-form-section"><div class="popup-form-section-head"><span aria-hidden="true">🗓️</span><div><strong>Período de exibição</strong><small>Datas vazias mantêm a exibição contínua</small></div></div><div class="signup-grid"><div class="form-group"><label class="form-label" for="popup-starts-at">Início</label><input class="form-input" id="popup-starts-at" type="datetime-local" /></div><div class="form-group"><label class="form-label" for="popup-ends-at">Fim</label><input class="form-input" id="popup-ends-at" type="datetime-local" /></div></div><div class="popup-schedule-status" id="popup-schedule-status">Exibição contínua, sem período definido.</div></section>
      <p class="form-error" id="popup-editor-error"></p><button class="btn-primary popup-save-button" id="popup-save-button" type="submit" data-capability="managePopup" data-capability-mode="disable">Salvar pop-up</button>
    </form>
    <aside class="popup-editor-side"><div class="popup-preview-panel"><div class="popup-preview-toolbar"><span>Preview</span><strong id="popup-preview-state">Desativado</strong></div><div class="popup-preview-window"><div class="popup-preview-image-wrap hidden" id="popup-live-image-wrap"><img id="popup-live-image" alt="" /></div><div class="popup-preview-content"><span>Dog Burger</span><h2 id="popup-live-title">Título do pop-up</h2><p id="popup-live-message">Sua mensagem aparecerá aqui.</p><span class="popup-preview-button hidden" id="popup-live-button">Ver cardápio</span></div></div></div><div class="card popup-help-card"><span class="popup-help-icon">💡</span><h2>Como funciona</h2><p>Quando estiver ativo e dentro do período escolhido, o pop-up aparecerá uma vez por sessão para cada visitante.</p><ul><li>Deixe as datas vazias para exibição contínua.</li><li>Preencha texto e destino para mostrar o CTA.</li><li>Uma nova edição volta a aparecer para os visitantes.</li></ul></div></aside>
  </div>`;
}

function popupLocalDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0,16);
}

function updatePopupPreview(source) {
  popupPreviewImageSource = source || '';
  const preview = document.getElementById('popup-image-preview');
  const prompt = document.getElementById('popup-image-prompt');
  if (source) { preview.src = source; preview.classList.remove('hidden'); prompt.classList.add('hidden'); }
  else { preview.removeAttribute('src'); preview.classList.add('hidden'); prompt.classList.remove('hidden'); }
  updatePopupLivePreview(source);
}

function updatePopupLivePreview(imageSource) {
  const title = document.getElementById('popup-title').value.trim();
  const message = document.getElementById('popup-message').value.trim();
  const buttonText = document.getElementById('popup-button-text').value.trim();
  const buttonUrl = document.getElementById('popup-button-url').value.trim();
  const active = document.getElementById('popup-active').checked;
  document.getElementById('popup-live-title').textContent = title || 'Título do pop-up';
  document.getElementById('popup-live-message').textContent = message || 'Sua mensagem aparecerá aqui.';
  document.getElementById('popup-message-count').textContent = `${document.getElementById('popup-message').value.length}/400`;
  document.getElementById('popup-active-label').textContent = active ? 'Pop-up ativo ao salvar' : 'Pop-up desativado';
  document.getElementById('popup-preview-state').textContent = active ? 'Ativo' : 'Desativado';
  const previewButton = document.getElementById('popup-live-button');
  previewButton.textContent = buttonText || 'Ver cardápio';
  previewButton.classList.toggle('hidden', !(buttonText && buttonUrl));
  const currentSource = imageSource === undefined ? popupPreviewImageSource : imageSource;
  const imageWrap = document.getElementById('popup-live-image-wrap');
  if (currentSource) { document.getElementById('popup-live-image').src = currentSource; imageWrap.classList.remove('hidden'); }
  else imageWrap.classList.add('hidden');
  updatePopupScheduleStatus();
}

function updatePopupScheduleStatus() {
  const startsValue = document.getElementById('popup-starts-at').value;
  const endsValue = document.getElementById('popup-ends-at').value;
  const status = document.getElementById('popup-schedule-status');
  status.classList.remove('is-error');
  if (!startsValue && !endsValue) { status.textContent = 'Exibição contínua, sem período definido.'; return; }
  if (startsValue && endsValue && new Date(endsValue) <= new Date(startsValue)) { status.textContent = 'O fim deve ser posterior ao início.'; status.classList.add('is-error'); return; }
  if (startsValue && endsValue) { status.textContent = 'Período completo configurado.'; return; }
  status.textContent = startsValue ? 'Sem data final: permanece ativo após o início.' : 'Sem data inicial: válido até a data final.';
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
    updatePopupLivePreview();
  } catch (error) { errorElement.textContent = `Não foi possível carregar. ${error.message}`; }

  document.getElementById('choose-popup-image').addEventListener('click', () => document.getElementById('popup-image-file').click());
  document.getElementById('popup-image-upload').addEventListener('click', event => { if (!event.target.closest('button')) document.getElementById('popup-image-file').click(); });
  document.getElementById('popup-image-file').addEventListener('change', event => { const file = event.target.files[0]; if (file) updatePopupPreview(URL.createObjectURL(file)); });
  ['popup-title','popup-message','popup-button-text','popup-button-url','popup-starts-at','popup-ends-at'].forEach(id => document.getElementById(id).addEventListener('input', () => updatePopupLivePreview()));
  document.getElementById('popup-active').addEventListener('change', () => updatePopupLivePreview());
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
  const buttonText = document.getElementById('popup-button-text').value.trim();
  if ((buttonText && !buttonUrl) || (!buttonText && buttonUrl)) { errorElement.textContent = 'Preencha o texto e o destino do botão juntos.'; return; }
  if (buttonUrl && !/^(https?:\/\/|[a-z0-9_.-]+\.html(?:[?#].*)?$)/i.test(buttonUrl)) { errorElement.textContent = 'Informe um endereço HTTPS ou uma página do site.'; return; }
  button.disabled = true; button.textContent = 'Salvando...';
  try {
    let imageUrl = document.getElementById('popup-image-url').value;
    if (file) imageUrl = await Store.uploadProductImage(file);
    await Store.savePopup({ title:document.getElementById('popup-title').value.trim(), message:document.getElementById('popup-message').value.trim(), imageUrl, buttonText, buttonUrl, active:document.getElementById('popup-active').checked, startsAt:startsValue ? new Date(startsValue).toISOString() : null, endsAt:endsValue ? new Date(endsValue).toISOString() : null });
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
  const newOrders = orders.filter(o => !o.cancellation && o.status === 'pendente');
  const delivered = orders.filter(o => !o.cancellation && o.status === 'entregue').length;
  const ready = orders.filter(o => !o.cancellation && o.status === 'pronto').length;
  const soldOutSnacks = products.filter(product => product.category === 'lanches' && Number(product.stock) <= 0);

  return `<section class="dashboard-page" aria-label="Visão operacional">
    ${renderRealtimeReadiness('dashboard')}

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
  const sm = o.cancellation ? { label:'Cancelado', color:'#B91C1C', bg:'#FEE2E2' } : STATUS_META[o.status];
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
  const statuses = ['todos','pendente','preparando','pronto','entregue','cancelado'];
  const filtered = ordersFilter === 'todos'
    ? orders
    : ordersFilter === 'cancelado'
      ? orders.filter(order => order.cancellation)
      : orders.filter(order => order.status === ordersFilter && !order.cancellation);

  const tabs = statuses.map(s => {
    const count = s === 'todos'
      ? orders.length
      : s === 'cancelado'
        ? orders.filter(order => order.cancellation).length
        : orders.filter(o => o.status === s && !o.cancellation).length;
    const label = s === 'todos' ? 'Todos' : s === 'cancelado' ? 'Cancelados' : STATUS_META[s].label;
    return `<button class="filter-tab${ordersFilter === s ? ' active' : ''}" onclick="setPedidosFilter('${s}')">${label} (${count})</button>`;
  }).join('');

  const cards = filtered.length === 0
    ? renderOrdersEmptyState()
    : filtered.map(o => orderCard(o)).join('');

  return `<section class="orders-page" aria-label="Gestão de pedidos">
    ${renderRealtimeReadiness('orders')}
    ${ORDERS_UI_STATE.feedback ? `<div class="orders-feedback" role="status">✅ ${escapeManagerHtml(ORDERS_UI_STATE.feedback)}</div>` : ''}
    <div class="filter-tabs orders-filter-tabs">${tabs}</div>
    <div class="orders-list">${cards}</div>
    ${renderCancellationModal()}
  </section>`;
}

function renderOrdersEmptyState() {
  const filterLabel = ordersFilter === 'todos'
    ? 'pedidos'
    : ordersFilter === 'cancelado'
      ? 'pedidos cancelados'
      : `pedidos ${STATUS_META[ordersFilter]?.label.toLowerCase() || ''}`;
  return `<div class="orders-empty-state"><span aria-hidden="true">📋</span><strong>Nenhum resultado</strong><p>Não há ${filterLabel} para exibir neste filtro.</p></div>`;
}

function setPedidosFilter(s) {
  ordersFilter = s;
  document.getElementById('m-content').innerHTML = renderPedidos();
}

function orderCard(o) {
  const cancellation = o.cancellation;
  const sm = cancellation ? { label:'Cancelado', color:'#B91C1C', bg:'#FEE2E2' } : STATUS_META[o.status];
  const next = NEXT_STATUS[o.status];
  const expanded = expandedOrders.has(o.id);
  const total = orderTotal(o);

  return `<article class="order-card${cancellation ? ' is-demo-cancelled' : ''}" id="order-card-${o.id}">
    <div class="order-card-head" onclick="toggleOrder('${o.id}')" role="button" tabindex="0" aria-expanded="${expanded}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleOrder('${o.id}')} ">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <span class="order-id">${o.id}</span>
          <span class="status-badge" style="background:${sm.bg};color:${sm.color}">${sm.label}</span>
          ${cancellation ? '<span class="orders-demo-badge">registrado</span>' : ''}
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
            <span class="order-item-name">${i.qty}× ${p.name}${orderItemChoiceSummary(i)}${i.removedIngredients ? `<small class="order-item-removal">Sem: ${escapeManagerHtml(i.removedIngredients)}</small>` : ''}</span>
            <span class="order-item-price">R$ ${fmt(i.unitPrice * i.qty)}</span>
          </div>` : '';
        }).join('')}
      </div>
      ${o.address ? `<div class="order-address">📍 ${formatOrderAddress(o.address)}</div>` : ''}
      <div class="order-payment">💳 Pagamento na entrega: ${orderPaymentLabel(o)}</div>
      ${o.note ? `<div class="order-note">📝 ${escapeManagerHtml(o.note)}</div>` : ''}
      ${renderOrderTimeline(o)}
      <div class="order-actions no-print">
        ${next && !cancellation ? `<button class="btn-advance" data-capability="advanceOrders" data-capability-mode="disable" onclick="advanceOrder('${o.id}','${next}')">Avançar → ${STATUS_META[next].label}</button>` : ''}
        <button class="order-action-button" type="button" onclick="printKitchenTicket('${o.id}')">🖨️ Imprimir comanda</button>
        ${o.status !== 'entregue' && !cancellation ? `<button class="order-action-button is-danger" type="button" onclick="openOrderCancellation('${o.id}')">Cancelar pedido</button>` : ''}
      </div>
      <div class="kitchen-ticket-footer"><strong>Comanda de cozinha · ${o.id}</strong><span>Emitida pelo navegador</span></div>
    </div>` : ''}
  </article>`;
}

function renderOrderTimeline(order) {
  const events = [{ label:'Pedido recebido', detail:new Date(order.createdAt).toLocaleString('pt-BR') }];
  order.history.forEach(item => events.push({ label:STATUS_META[item.to_status]?.label || item.to_status, detail:new Date(item.created_at).toLocaleString('pt-BR') }));
  if (order.cancellation) events.push({ label:'Pedido cancelado', detail:`${order.cancellation.reason} · ${new Date(order.cancellation.created_at).toLocaleString('pt-BR')}`, cancelled:true });
  return `<section class="order-timeline" aria-label="Histórico visual do pedido">
    <h4>Histórico</h4>
    ${events.map(event => `<div class="order-timeline-event${event.cancelled ? ' is-cancelled' : ''}"><span aria-hidden="true"></span><div><strong>${escapeManagerHtml(event.label)}</strong><small>${escapeManagerHtml(event.detail)}</small></div></div>`).join('')}
  </section>`;
}

function renderCancellationModal() {
  if (!ORDERS_UI_STATE.cancellationDraftId) return '';
  const order = orders.find(item => item.id === ORDERS_UI_STATE.cancellationDraftId);
  if (!order) return '';
  return `<div class="modal-overlay orders-cancel-overlay" onclick="closeOrderCancellation()"></div>
    <section class="modal orders-cancel-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-order-title">
      <span class="orders-demo-badge">operação definitiva</span>
      <h2 class="modal-title" id="cancel-order-title">Cancelar ${order.id}</h2>
      <p class="modal-sub">O cancelamento e sua justificativa serão registrados no histórico do pedido.</p>
      <form onsubmit="submitOrderCancellation(event)">
        <div class="form-group"><label class="form-label" for="cancel-order-reason">Justificativa *</label><textarea class="form-textarea" id="cancel-order-reason" rows="4" minlength="3" maxlength="500" required placeholder="Informe o motivo do cancelamento"></textarea></div>
        <p class="form-error" id="cancel-order-error"></p>
        <div class="modal-actions"><button class="btn-secondary" type="button" onclick="closeOrderCancellation()">Voltar</button><button class="btn-primary" type="submit">Confirmar cancelamento</button></div>
      </form>
    </section>`;
}

function openOrderCancellation(id) {
  ORDERS_UI_STATE.cancellationDraftId = id;
  document.getElementById('m-content').innerHTML = renderPedidos();
  setTimeout(() => document.getElementById('cancel-order-reason')?.focus(), 0);
}

function closeOrderCancellation() {
  ORDERS_UI_STATE.cancellationDraftId = null;
  document.getElementById('m-content').innerHTML = renderPedidos();
}

async function submitOrderCancellation(event) {
  event.preventDefault();
  const reason = document.getElementById('cancel-order-reason').value.trim();
  if (reason.length < 3) {
    document.getElementById('cancel-order-error').textContent = 'A justificativa deve ter pelo menos 3 caracteres.';
    return;
  }
  const id = ORDERS_UI_STATE.cancellationDraftId;
  const order = orders.find(item => item.id === id);
  const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await Store.cancelOrder(order.databaseId, reason);
    [orders, products] = await Promise.all([Store.getOrders(), Store.getAllProducts()]);
    ORDERS_UI_STATE.cancellationDraftId = null;
    ORDERS_UI_STATE.feedback = `${id} cancelado com justificativa registrada.`;
    expandedOrders.add(id);
    updateActiveOrdersBadge();
    document.getElementById('m-content').innerHTML = renderPedidos();
  } catch (error) {
    document.getElementById('cancel-order-error').textContent = `Não foi possível cancelar. ${error.message}`;
    button.disabled = false;
  }
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

/* ── ESTOQUE GERAL E COMPOSICOES ── */
function snackStockProducts() {
  return products;
}

function normalizedStockNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function snackStockStatus(product) {
  const quantity = managerAvailableUnits(product);
  const minimum = normalizedStockNumber(product.minStock);
  if (quantity === 0) return { key:'zero', label:'Esgotado', icon:'⛔' };
  if (quantity <= minimum) return { key:'baixo', label:'Baixo', icon:'⚠️' };
  return { key:'normal', label:'Normal', icon:'✅' };
}

function managerSimpleAvailableUnits(product) {
  if (!product || !product.active) return 0;
  return product.inventoryTracked ? normalizedStockNumber(product.stock) : Number.POSITIVE_INFINITY;
}

function managerAvailableUnits(product) {
  if (!product.isComposite) return product.inventoryTracked ? normalizedStockNumber(product.stock) : Number.POSITIVE_INFINITY;
  const capacities = [];
  product.fixedComponents.forEach(component => capacities.push(Math.floor(managerSimpleAvailableUnits(component.product) / component.quantity)));
  product.choiceGroups.forEach(group => capacities.push(Math.floor(group.options.reduce((sum, option) => sum + Math.floor(managerSimpleAvailableUnits(option.product) / option.componentQuantity), 0) / group.requiredQuantity)));
  return capacities.length ? Math.max(0, Math.min(...capacities)) : 0;
}

function renderSnackStockState(state, detail = '') {
  if (state === 'loading') {
    return `<section class="snack-stock-state" aria-live="polite" aria-busy="true"><div class="dashboard-state-spinner" aria-hidden="true"></div><strong>Carregando produtos...</strong><span>Consultando o estoque transacional.</span></section>`;
  }
  return `<section class="snack-stock-state is-error" role="alert"><span aria-hidden="true">⚠️</span><strong>Não foi possível carregar os produtos</strong><p>${escapeManagerHtml(detail || 'Tente novamente em instantes.')}</p><button type="button" onclick="setView('estoque-lanches')">Tentar novamente</button></section>`;
}

function renderSnackStock() {
  const snacks = snackStockProducts();
  const categoryProducts = SNACK_STOCK_UI_STATE.category === 'todos' ? snacks : snacks.filter(product => product.category === SNACK_STOCK_UI_STATE.category);
  const counts = { normal:0, baixo:0, zero:0 };
  categoryProducts.forEach(product => { counts[snackStockStatus(product).key]++; });
  const filtered = SNACK_STOCK_UI_STATE.filter === 'todos'
    ? categoryProducts
    : categoryProducts.filter(product => snackStockStatus(product).key === SNACK_STOCK_UI_STATE.filter);
  const categories = [...new Set(snacks.map(product => product.category))].sort();
  const filters = [
    { key:'todos', label:'Todos', count:categoryProducts.length },
    { key:'normal', label:'Normal', count:counts.normal },
    { key:'baixo', label:'Baixo', count:counts.baixo },
    { key:'zero', label:'Esgotado', count:counts.zero },
  ];

  return `<section class="snack-stock-page" aria-label="Estoque geral de produtos">
    <div class="snack-stock-intro">
      <div><span aria-hidden="true">📦</span><div><strong>Produtos e unidades operacionais</strong><p>Estoque real de produtos; não inclui ingredientes e não possui reserva no carrinho.</p></div></div>
      <span>Servidor · fonte de verdade</span>
    </div>
    ${SNACK_STOCK_UI_STATE.feedback ? `<div class="snack-stock-feedback is-${SNACK_STOCK_UI_STATE.feedback.type}" role="status">${escapeManagerHtml(SNACK_STOCK_UI_STATE.feedback.message)}</div>` : ''}
    <div class="snack-stock-kpis">
      ${kpiCard('Produtos cadastrados', String(snacks.length), '📦', '#F97316', 'categorias reais do cardápio')}
      ${kpiCard('Estoque normal', String(counts.normal), '✅', '#16A34A', 'acima do mínimo')}
      ${kpiCard('Estoque baixo', String(counts.baixo), '⚠️', '#D97706', 'no mínimo ou abaixo')}
      ${kpiCard('Esgotados', String(counts.zero), '⛔', '#DC2626', 'quantidade real igual a zero')}
    </div>
    <div class="stock-filter-row"><label>Categoria<select class="form-select" onchange="setStockCategory(this.value)"><option value="todos">Todas</option>${categories.map(category => `<option value="${escapeManagerHtml(category)}"${SNACK_STOCK_UI_STATE.category === category ? ' selected' : ''}>${escapeManagerHtml(CAT_MAP[category]?.label || category)}</option>`).join('')}</select></label><div class="filter-tabs snack-stock-filters">${filters.map(filter => `<button class="filter-tab${SNACK_STOCK_UI_STATE.filter === filter.key ? ' active' : ''}" type="button" onclick="setSnackStockFilter('${filter.key}')">${filter.label} (${filter.count})</button>`).join('')}</div></div>
    ${filtered.length ? `<div class="snack-stock-grid">${filtered.map(renderSnackStockCard).join('')}</div>` : `<div class="snack-stock-empty"><span aria-hidden="true">📦</span><strong>Nenhum produto neste estado</strong><p>Escolha outro filtro para continuar.</p></div>`}
    ${renderSnackStockHistory()}
    ${renderSnackRestockModal()}
    ${renderCompositionModal()}
  </section>`;
}

function renderSnackStockCard(product) {
  const quantity = managerAvailableUnits(product);
  const minimum = normalizedStockNumber(product.minStock);
  const status = snackStockStatus(product);
  return `<article class="snack-stock-card is-${status.key}">
    <div class="snack-stock-card-head"><div class="snack-stock-product-icon" aria-hidden="true">${product.isComposite ? '🧩' : '📦'}</div><div><h3>${escapeManagerHtml(product.name)}</h3><span class="snack-stock-status">${status.icon} ${status.label}${product.isComposite ? ' · Produto composto' : product.inventoryTracked ? '' : ' · Sem controle'}</span></div></div>
    <div class="snack-stock-quantity"><strong>${Number.isFinite(quantity) ? quantity : '∞'}</strong><span>${product.isComposite ? 'capacidade derivada' : product.inventoryTracked ? 'unidades' : 'não controlado'}</span></div>
    ${product.isComposite ? renderCompositionSummary(product) : product.inventoryTracked ? `<label class="snack-stock-minimum">Estoque mínimo<input type="number" min="0" max="999" step="1" value="${minimum}" onchange="updateSnackStockMinimum(${product.id}, this.value)" /></label><button class="btn-primary snack-stock-restock" type="button" onclick="openSnackRestock(${product.id})">+ Reposição manual</button>` : `<button class="btn-secondary snack-stock-restock" type="button" onclick="enableProductInventory(${product.id})">Ativar controle de estoque</button>`}
    <button class="order-action-button" type="button" onclick="toggleProductSellable(${product.id})">${product.sellable === false ? 'Tornar vendável' : 'Marcar como item interno'}</button>
    <button class="order-action-button" type="button" onclick="openCompositionEditor(${product.id})">${product.isComposite ? 'Editar composição' : 'Transformar em composto'}</button>
  </article>`;
}

function renderCompositionSummary(product) {
  const fixed = product.fixedComponents.map(item => `${escapeManagerHtml(item.product?.name || `Produto ${item.productId}`)} × ${item.quantity}`).join(', ') || 'Nenhum componente fixo';
  const groups = product.choiceGroups.map(group => `${escapeManagerHtml(group.name)}: ${group.options.map(option => escapeManagerHtml(option.product?.name || `Produto ${option.productId}`)).join(', ')}`).join(' · ') || 'Nenhum grupo';
  return `<div class="composition-summary"><small><strong>Fixos:</strong> ${fixed}</small><small><strong>Escolhas:</strong> ${groups}</small></div>`;
}

async function enableProductInventory(productId) {
  try {
    await Store.setProductInventorySettings(productId, true, getProduct(productId)?.sellable !== false);
    products = await Store.getAllProducts();
    SNACK_STOCK_UI_STATE.feedback = { type:'success', message:'Controle de estoque ativado.' };
  } catch (error) { SNACK_STOCK_UI_STATE.feedback = { type:'error', message:error.message }; }
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

async function toggleProductSellable(productId) {
  const product = getProduct(productId);
  try {
    await Store.setProductInventorySettings(productId, product.inventoryTracked, product.sellable === false);
    products = await Store.getAllProducts();
  } catch (error) { SNACK_STOCK_UI_STATE.feedback = { type:'error', message:error.message }; }
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function setSnackStockFilter(filter) {
  if (!['todos','normal','baixo','zero'].includes(filter)) return;
  SNACK_STOCK_UI_STATE.filter = filter;
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function setStockCategory(category) {
  SNACK_STOCK_UI_STATE.category = category;
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

async function updateSnackStockMinimum(productId, value) {
  const minimum = Number(value);
  if (!Number.isInteger(minimum) || minimum < 0 || minimum > 999) {
    SNACK_STOCK_UI_STATE.feedback = { type:'error', message:'O estoque mínimo deve ser um número inteiro entre 0 e 999.' };
  } else {
    SNACK_STOCK_UI_STATE.savingMinimums.add(productId);
    try {
      await Store.setProductMinStock(productId, minimum);
      products = await Store.getAllProducts();
      SNACK_STOCK_UI_STATE.feedback = { type:'success', message:'Estoque mínimo atualizado no servidor.' };
    } catch (error) {
      SNACK_STOCK_UI_STATE.feedback = { type:'error', message:`Não foi possível atualizar o estoque mínimo. ${error.message}` };
    } finally {
      SNACK_STOCK_UI_STATE.savingMinimums.delete(productId);
    }
  }
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function renderSnackRestockModal() {
  if (SNACK_STOCK_UI_STATE.restockProductId === null) return '';
  const product = snackStockProducts().find(item => item.id === SNACK_STOCK_UI_STATE.restockProductId);
  if (!product) return '';
  return `<div class="modal-overlay snack-restock-overlay" onclick="closeSnackRestock()"></div>
    <section class="modal snack-restock-modal" role="dialog" aria-modal="true" aria-labelledby="snack-restock-title">
      <span class="orders-demo-badge">reposição auditada</span>
      <h2 class="modal-title" id="snack-restock-title">Repor ${escapeManagerHtml(product.name)}</h2>
      <p class="modal-sub">A quantidade será somada de forma transacional e registrada no histórico.</p>
      <form onsubmit="submitSnackRestock(event)">
        <div class="form-group"><label class="form-label" for="snack-restock-amount">Quantidade a adicionar *</label><input class="form-input" id="snack-restock-amount" type="number" min="1" max="999" step="1" inputmode="numeric" required /></div>
        <p class="form-error" id="snack-restock-error"></p>
        <div class="modal-actions"><button class="btn-secondary" type="button" onclick="closeSnackRestock()">Cancelar</button><button class="btn-primary" type="submit">Adicionar unidades</button></div>
      </form>
    </section>`;
}

function openSnackRestock(productId) {
  SNACK_STOCK_UI_STATE.restockProductId = productId;
  document.getElementById('m-content').innerHTML = renderSnackStock();
  setTimeout(() => document.getElementById('snack-restock-amount')?.focus(), 0);
}

function closeSnackRestock() {
  SNACK_STOCK_UI_STATE.restockProductId = null;
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

async function submitSnackRestock(event) {
  event.preventDefault();
  const amount = Number(document.getElementById('snack-restock-amount').value);
  const errorElement = document.getElementById('snack-restock-error');
  if (!Number.isInteger(amount) || amount < 1 || amount > 999) {
    errorElement.textContent = 'Informe uma quantidade inteira entre 1 e 999.';
    return;
  }
  const productId = SNACK_STOCK_UI_STATE.restockProductId;
  const product = snackStockProducts().find(item => item.id === productId);
  const current = normalizedStockNumber(product?.stock);
  if (!product || current + amount > 9999) {
    errorElement.textContent = 'A quantidade total não pode ultrapassar 9.999 unidades.';
    return;
  }
  const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await Store.restockProduct(productId, amount, crypto.randomUUID());
    [products, SNACK_STOCK_UI_STATE.movements] = await Promise.all([Store.getAllProducts(), Store.getStockMovements()]);
    SNACK_STOCK_UI_STATE.restockProductId = null;
    SNACK_STOCK_UI_STATE.feedback = { type:'success', message:`${amount} unidades adicionadas a ${product.name}.` };
  } catch (error) {
    errorElement.textContent = `Não foi possível repor o estoque. ${error.message}`;
    button.disabled = false;
    return;
  }
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function renderSnackStockHistory() {
  const entries = SNACK_STOCK_UI_STATE.movements.slice(0, 10);
  return `<section class="card snack-stock-history"><div class="card-header"><div><span class="card-title">Histórico de movimentações</span><p>Auditoria persistida pelo backend.</p></div></div>${entries.length ? entries.map(entry => { const product = getProduct(entry.product_id); const delta = Number(entry.quantity_delta); return `<div class="snack-stock-history-row"><span>${delta > 0 ? '+' : ''}${delta}</span><div><strong>${escapeManagerHtml(product?.name || `Produto ${entry.product_id}`)}</strong><small>${escapeManagerHtml(stockMovementLabel(entry.reason))} · saldo ${entry.resulting_stock} · ${new Date(entry.created_at).toLocaleString('pt-BR')}</small></div></div>`; }).join('') : '<div class="snack-stock-history-empty">Nenhuma movimentação registrada.</div>'}</section>`;
}

function stockMovementLabel(reason) {
  return ({ manual_restock:'Reposição manual', order_debit:'Baixa por pedido', order_restore:'Restauração por cancelamento', manual_adjustment:'Ajuste manual' })[reason] || reason;
}

function openCompositionEditor(productId) {
  const product = getProduct(productId);
  if (!product) return;
  SNACK_STOCK_UI_STATE.compositionProductId = productId;
  SNACK_STOCK_UI_STATE.compositionDraft = {
    fixedComponents:product.fixedComponents.map(item => ({ productId:item.productId, quantity:item.quantity })),
    choiceGroups:product.choiceGroups.map(group => ({ name:group.name, requiredQuantity:group.requiredQuantity, options:group.options.map(option => ({ productId:option.productId, componentQuantity:option.componentQuantity })) })),
  };
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function closeCompositionEditor() {
  SNACK_STOCK_UI_STATE.compositionProductId = null;
  SNACK_STOCK_UI_STATE.compositionDraft = null;
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function compositionCandidates() {
  return products.filter(item => item.id !== SNACK_STOCK_UI_STATE.compositionProductId && !item.isComposite && item.inventoryTracked);
}

function compositionProductOptions(selectedId = '') {
  return `<option value="">Selecione um produto</option>${compositionCandidates().map(item => `<option value="${item.id}"${Number(selectedId) === item.id ? ' selected' : ''}>${escapeManagerHtml(item.name)}${item.sellable === false ? ' · item interno' : ''}${item.active ? '' : ' · inativo'}</option>`).join('')}`;
}

function rerenderCompositionEditor() { document.getElementById('m-content').innerHTML = renderSnackStock(); }
function addFixedComponent() { SNACK_STOCK_UI_STATE.compositionDraft.fixedComponents.push({ productId:'', quantity:1 }); rerenderCompositionEditor(); }
function removeFixedComponent(index) { SNACK_STOCK_UI_STATE.compositionDraft.fixedComponents.splice(index, 1); rerenderCompositionEditor(); }
function updateFixedComponent(index, field, value) { SNACK_STOCK_UI_STATE.compositionDraft.fixedComponents[index][field] = Number(value); }
function addChoiceGroup() { SNACK_STOCK_UI_STATE.compositionDraft.choiceGroups.push({ name:'', requiredQuantity:1, options:[] }); rerenderCompositionEditor(); }
function removeChoiceGroup(index) { SNACK_STOCK_UI_STATE.compositionDraft.choiceGroups.splice(index, 1); rerenderCompositionEditor(); }
function updateChoiceGroup(index, field, value) { SNACK_STOCK_UI_STATE.compositionDraft.choiceGroups[index][field] = field === 'requiredQuantity' ? Number(value) : value; }
function addChoiceOption(groupIndex) { SNACK_STOCK_UI_STATE.compositionDraft.choiceGroups[groupIndex].options.push({ productId:'', componentQuantity:1 }); rerenderCompositionEditor(); }
function removeChoiceOption(groupIndex, optionIndex) { SNACK_STOCK_UI_STATE.compositionDraft.choiceGroups[groupIndex].options.splice(optionIndex, 1); rerenderCompositionEditor(); }
function updateChoiceOption(groupIndex, optionIndex, field, value) { SNACK_STOCK_UI_STATE.compositionDraft.choiceGroups[groupIndex].options[optionIndex][field] = Number(value); }

function renderCompositionModal() {
  if (SNACK_STOCK_UI_STATE.compositionProductId === null) return '';
  const product = getProduct(SNACK_STOCK_UI_STATE.compositionProductId);
  const draft = SNACK_STOCK_UI_STATE.compositionDraft;
  if (!product || !draft) return '';
  const fixedRows = draft.fixedComponents.map((item, index) => `<div class="composition-editor-row"><label>Produto<select class="form-select" onchange="updateFixedComponent(${index}, 'productId', this.value)">${compositionProductOptions(item.productId)}</select></label><label>Quantidade<input class="form-input" type="number" min="1" max="999" value="${item.quantity}" onchange="updateFixedComponent(${index}, 'quantity', this.value)" /></label><button class="composition-remove" type="button" onclick="removeFixedComponent(${index})">Remover</button></div>`).join('');
  const groups = draft.choiceGroups.map((group, groupIndex) => `<fieldset class="composition-group"><legend>Grupo ${groupIndex + 1}</legend><div class="composition-group-fields"><label>Nome<input class="form-input" maxlength="80" value="${escapeManagerHtml(group.name)}" oninput="updateChoiceGroup(${groupIndex}, 'name', this.value)" /></label><label>Quantidade obrigatória<input class="form-input" type="number" min="1" max="999" value="${group.requiredQuantity}" onchange="updateChoiceGroup(${groupIndex}, 'requiredQuantity', this.value)" /></label><button class="composition-remove" type="button" onclick="removeChoiceGroup(${groupIndex})">Remover grupo</button></div><div class="composition-options"><strong>Opções</strong>${group.options.map((option, optionIndex) => `<div class="composition-editor-row"><label>Produto<select class="form-select" onchange="updateChoiceOption(${groupIndex}, ${optionIndex}, 'productId', this.value)">${compositionProductOptions(option.productId)}</select></label><label>Unidades debitadas<input class="form-input" type="number" min="1" max="999" value="${option.componentQuantity}" onchange="updateChoiceOption(${groupIndex}, ${optionIndex}, 'componentQuantity', this.value)" /></label><button class="composition-remove" type="button" onclick="removeChoiceOption(${groupIndex}, ${optionIndex})">Remover</button></div>`).join('') || '<p class="composition-empty">Nenhuma opção adicionada.</p>'}<button class="btn-secondary composition-add" type="button" onclick="addChoiceOption(${groupIndex})">+ Adicionar opção</button></div></fieldset>`).join('');
  return `<div class="modal-overlay snack-restock-overlay" onclick="closeCompositionEditor()"></div><section class="modal composition-editor-modal" role="dialog" aria-modal="true"><h2 class="modal-title">Composição de ${escapeManagerHtml(product.name)}</h2><p class="modal-sub">Selecione produtos reais com estoque controlado. Itens internos também podem ser componentes.</p><form onsubmit="submitComposition(event)"><section class="composition-editor-section"><div class="composition-editor-heading"><div><strong>Componentes fixos</strong><small>Unidades sempre debitadas.</small></div><button class="btn-secondary" type="button" onclick="addFixedComponent()">+ Adicionar componente</button></div>${fixedRows || '<p class="composition-empty">Nenhum componente fixo.</p>'}</section><section class="composition-editor-section"><div class="composition-editor-heading"><div><strong>Grupos de escolha</strong><small>Opções selecionadas pelo cliente.</small></div><button class="btn-secondary" type="button" onclick="addChoiceGroup()">+ Adicionar grupo</button></div>${groups || '<p class="composition-empty">Nenhum grupo.</p>'}</section><p class="form-error" id="composition-error"></p><div class="modal-actions"><button class="btn-secondary" type="button" onclick="closeCompositionEditor()">Cancelar</button><button class="btn-primary" type="submit">Salvar composição</button></div></form></section>`;
}

async function submitComposition(event) {
  event.preventDefault();
  const draft = SNACK_STOCK_UI_STATE.compositionDraft;
  const errorElement = document.getElementById('composition-error');
  if (!draft || (!draft.fixedComponents.length && !draft.choiceGroups.length)) return void (errorElement.textContent = 'Adicione ao menos um componente ou grupo.');
  const fixedIds = draft.fixedComponents.map(item => item.productId);
  if (draft.fixedComponents.some(item => !item.productId || !Number.isInteger(item.quantity) || item.quantity < 1) || new Set(fixedIds).size !== fixedIds.length) return void (errorElement.textContent = 'Revise produtos, quantidades e duplicidades dos componentes.');
  if (draft.choiceGroups.some(group => group.name.trim().length < 2 || !Number.isInteger(group.requiredQuantity) || group.requiredQuantity < 1 || !group.options.length || group.options.some(option => !option.productId || !Number.isInteger(option.componentQuantity) || option.componentQuantity < 1) || new Set(group.options.map(option => option.productId)).size !== group.options.length)) return void (errorElement.textContent = 'Revise nomes, quantidades, opções e duplicidades dos grupos.');
  const button = event.submitter;
  button.disabled = true;
  try {
    await Store.saveProductComposition(SNACK_STOCK_UI_STATE.compositionProductId, draft.fixedComponents.map(item => ({ product_id:item.productId, quantity:item.quantity })), draft.choiceGroups.map(group => ({ name:group.name.trim(), required_quantity:group.requiredQuantity, options:group.options.map(option => ({ product_id:option.productId, component_quantity:option.componentQuantity })) })));
    products = await Store.getAllProducts();
    SNACK_STOCK_UI_STATE.compositionProductId = null;
    SNACK_STOCK_UI_STATE.compositionDraft = null;
    SNACK_STOCK_UI_STATE.feedback = { type:'success', message:'Composição atualizada no servidor.' };
    rerenderCompositionEditor();
  } catch (error) { errorElement.textContent = `Não foi possível salvar. ${error.message}`; button.disabled = false; }
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
          <section class="card store-settings-section is-sensitive" data-future-capability="manageSensitiveRules"><div class="store-settings-section-head"><div><span aria-hidden="true">🔐</span><div><strong>Regras comerciais sensíveis</strong><small>Taxas e condições de entrega</small></div></div><span class="store-settings-owner-badge">edição futura: owner</span></div><div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-delivery-fee">Taxa padrão (R$) *</label><input class="form-input" id="setting-delivery-fee" type="number" min="0" max="999" step="0.01" value="${value.deliveryFee.toFixed(2)}" /><small class="form-error" id="setting-delivery-fee-error"></small></div><div class="form-group"><label class="form-label" for="setting-free-delivery">Grátis a partir de (R$) *</label><input class="form-input" id="setting-free-delivery" type="number" min="0" max="9999" step="0.01" value="${value.freeDeliveryFrom.toFixed(2)}" /><small class="form-error" id="setting-free-delivery-error"></small></div></div><p class="store-settings-rule-summary">Referência atual: R$ 5,00 abaixo de R$ 15,00 · retirada grátis.</p></section>
        </div>
      </div>
      <div class="store-settings-actions"><div><strong id="store-settings-state">${STORE_SETTINGS_FRONTEND_DEMO.dirty ? 'Alterações locais não salvas' : 'Nenhuma alteração pendente'}</strong><small>Salvar não envia dados ao Supabase nesta etapa.</small></div><button class="btn-secondary" id="store-settings-cancel" type="button" onclick="cancelStoreSettings()"${saving ? ' disabled' : ''}>Cancelar alterações</button><button class="btn-primary" id="store-settings-save" type="submit" data-capability="manageSettings" data-capability-mode="disable"${saving ? ' disabled' : ''}>${saving ? 'Salvando demonstração…' : 'Salvar demonstração'}</button></div>
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
    try {
      const result = await Store.updateOrderStatus(o.databaseId, nextStatus);
      orders = await Store.getOrders();
      expandedOrders.add(id);
      nextStatus = result.status;
    } catch (error) {
      alert(`Não foi possível atualizar o pedido. ${error.message}`);
      return;
    }
  }
  ORDERS_UI_STATE.feedback = `${id} avançou para ${STATUS_META[nextStatus].label}.`;
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
      return `<span><strong>${item.qty}×</strong> ${escapeManagerHtml(product?.name || `Produto #${item.pid}`)} <small>R$ ${fmt(item.unitPrice * item.qty)}</small>${orderItemChoiceSummary(item)}${item.removedIngredients ? `<em>Sem: ${escapeManagerHtml(item.removedIngredients)}</em>` : ''}</span>`;
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
    window.UICapabilities?.init('manager');
    const requestedView = new URLSearchParams(window.location.search).get('view');
    await setView(VIEW_TITLES[requestedView] ? requestedView : 'dashboard');
    startManagerRealtime();
  } else {
    document.getElementById('page-manager').classList.add('hidden');
    window.location.replace('entrar.html');
  }
}

async function signOutManager() {
  await window.ManagerRealtime?.stop();
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
