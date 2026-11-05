'use strict';

let products = [];
let orders = [];
let expenses = [];

let currentView = 'dashboard';
let expandedOrders = new Set();
let editingStock = null;
let stockFilterCat = 'todos';
let ordersFilter = 'todos';
let reportDate = fortalezaDateKey();
let popupPreviewImageSource = '';
let currentManagerRole = null;

// Estado efêmero da tela. O ciclo de vida e os cancelamentos são persistidos pelas RPCs B02.
const ORDERS_UI_STATE = {
  cancellationDraftId: null,
  feedback: '',
};

// Estado visual; quantidades e histórico são reconciliados com o backend.
const SNACK_STOCK_UI_STATE = {
  movements: [],
  filter: 'todos',
  restockProductId: null,
  deleteProductId: null,
  deletingProductId: null,
  feedback: null,
  savingMinimums: new Set(),
};

// Estado reconciliado com a configuração persistida no servidor.
const storeSettingsState = {
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

function mapStoreSettings(settings) { return { openTime:settings.open_time, closeTime:settings.close_time, pauseEnabled:settings.pause_enabled, pauseStart:settings.pause_start || '', pauseEnd:settings.pause_end || '', whatsapp:settings.whatsapp, instagram:settings.instagram, location:settings.location_name, latitude:String(settings.latitude), longitude:String(settings.longitude), deliveryEnabled:settings.delivery_enabled, pickupEnabled:settings.pickup_enabled, pix:settings.accepts_pix, cash:settings.accepts_cash, card:settings.accepts_card, deliveryEtaMin:settings.delivery_eta_min, deliveryEtaMax:settings.delivery_eta_max, pickupEtaMin:settings.pickup_eta_min, pickupEtaMax:settings.pickup_eta_max, deliveryFee:Number(settings.delivery_fee), freeDeliveryFrom:Number(settings.free_delivery_from) }; }
function storeSettingsPayload(value) { return { open_time:value.openTime, close_time:value.closeTime, pause_enabled:value.pauseEnabled, pause_start:value.pauseStart || null, pause_end:value.pauseEnd || null, whatsapp:value.whatsapp, instagram:value.instagram, location_name:value.location, latitude:value.latitude, longitude:value.longitude, delivery_enabled:value.deliveryEnabled, pickup_enabled:value.pickupEnabled, accepts_pix:value.pix, accepts_cash:value.cash, accepts_card:value.card, delivery_eta_min:value.deliveryEtaMin, delivery_eta_max:value.deliveryEtaMax, pickup_eta_min:value.pickupEtaMin, pickup_eta_max:value.pickupEtaMax, delivery_fee:value.deliveryFee, free_delivery_from:value.freeDeliveryFrom }; }

// Controle visual dos filtros de relatórios. Não altera consultas nem critérios financeiros.
const REPORTS_UI_STATE = {
  period: 'day',
  customStart: reportDate,
  customEnd: reportDate,
  error: '',
  report: null,
  requestId: 0,
};

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  pedidos: 'Pedidos',
  relatorios: 'Relatórios',
  'estoque-lanches': 'Estoque de Lanches',
  popup: 'Pop-up Inicial',
  configuracoes: 'Configurações da Loja',
};

const VIEW_DESCRIPTIONS = {
  dashboard: 'Visão geral da operação em tempo real',
  pedidos: 'Acompanhe e atualize o fluxo de atendimento',
  relatorios: 'Consulte desempenho e resultados financeiros',
  'estoque-lanches': 'Controle a disponibilidade dos produtos prontos',
  popup: 'Gerencie a comunicação exibida aos clientes',
  configuracoes: 'Ajuste horários, entrega e dados da loja',
};

function managerIcon(name, className = 'manager-icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

const REALTIME_UI_STATE = { connection:'connecting', detail:'', soundEnabled:false, soundReady:false, soundDetail:'', lastSyncAt:null };

function getProduct(pid) {
  return products.find(p => p.id === pid);
}

function orderTotal(order) {
  return Number.isFinite(order.total) ? order.total : order.items.reduce((s, i) => {
    const p = getProduct(i.pid);
    return s + (i.unitPrice ?? p?.price ?? 0) * i.qty;
  }, 0);
}

function renderOrderFinancialSummary(order) {
  const hasB05Snapshot = ['delivery', 'pickup'].includes(order.fulfillmentMethod)
    && [order.subtotal, order.deliveryFee, order.total].every(Number.isFinite);
  if (!hasB05Snapshot) return '';
  const deliveryFee = order.fulfillmentMethod === 'pickup' || order.deliveryFee === 0
    ? 'Grátis'
    : `R$ ${fmt(order.deliveryFee)}`;
  return `<dl class="order-financial-summary">
    <div><dt>Subtotal</dt><dd>R$ ${fmt(order.subtotal)}</dd></div>
    <div><dt>Taxa de entrega</dt><dd>${deliveryFee}</dd></div>
    <div class="order-financial-total"><dt>Total</dt><dd>R$ ${fmt(order.total)}</dd></div>
  </dl>`;
}

function activeOrders() {
  return orders.filter(o => !o.cancellation && (o.status === 'pendente' || o.status === 'preparando'));
}

function realtimeStatusMeta() {
  return {
    connecting:{ label:'Conectando', detail:'Iniciando atualização automática', icon:'🟡' },
    connected:{ label:'Atualização automática ativa', detail:'Dados reconciliados com o servidor', icon:'🟢' },
    reconnecting:{ label:'Reconectando', detail:'Mantendo os dados atuais enquanto a conexão retorna', icon:'🟠' },
    error:{ label:'Atualização automática indisponível', detail:'A sincronização manual continua disponível', icon:'🔴' },
  }[REALTIME_UI_STATE.connection] || { label:'Conectando', detail:'Iniciando atualização automática', icon:'🟡' };
}

function realtimeSoundLabel() {
  if (!REALTIME_UI_STATE.soundEnabled) return 'Habilitar som';
  return REALTIME_UI_STATE.soundReady ? 'Som habilitado' : 'Som aguardando interação';
}

function renderRealtimeReadiness(context) {
  const status = realtimeStatusMeta();
  const lastSync = REALTIME_UI_STATE.lastSyncAt ? `Última sincronização ${new Date(REALTIME_UI_STATE.lastSyncAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}` : 'Aguardando primeira sincronização';
  const wrapperClass = context === 'dashboard' ? 'dashboard-readiness' : 'orders-readiness';
  const soundLabel = realtimeSoundLabel();
  const statusVisual = managerIcon('activity', 'manager-icon realtime-status-icon');
  const soundVisual = managerIcon(REALTIME_UI_STATE.soundEnabled ? 'volume' : 'volume-off');
  return `<div class="${wrapperClass} realtime-readiness is-${REALTIME_UI_STATE.connection}" data-realtime-panel><div><span class="realtime-connection-dot" data-realtime-icon aria-hidden="true">${statusVisual}</span><div><strong data-realtime-label>${status.label}</strong><small data-realtime-detail>${escapeManagerHtml(REALTIME_UI_STATE.detail || status.detail)}</small></div></div><div class="realtime-controls"><button class="dashboard-sound-status${REALTIME_UI_STATE.soundEnabled ? ' is-enabled' : ''}" type="button" onclick="toggleRealtimeSound()" aria-pressed="${REALTIME_UI_STATE.soundEnabled}" data-realtime-sound title="${escapeManagerHtml(REALTIME_UI_STATE.soundDetail)}">${soundVisual}<span>${soundLabel}</span></button><span class="realtime-last-sync" data-realtime-sync>${lastSync}</span></div></div>`;
}

function updateRealtimeUi(state) {
  Object.assign(REALTIME_UI_STATE, state);
  const status = realtimeStatusMeta();
  const lastSync = REALTIME_UI_STATE.lastSyncAt ? `Última sincronização ${new Date(REALTIME_UI_STATE.lastSyncAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}` : 'Aguardando primeira sincronização';
  document.querySelectorAll('[data-realtime-panel]').forEach(panel => {
    panel.classList.remove('is-connecting', 'is-connected', 'is-reconnecting', 'is-error');
    panel.classList.add(`is-${REALTIME_UI_STATE.connection}`);
    const icon = panel.querySelector('[data-realtime-icon]');
    icon.innerHTML = managerIcon('activity', 'manager-icon realtime-status-icon');
    panel.querySelector('[data-realtime-label]').textContent = status.label;
    panel.querySelector('[data-realtime-detail]').textContent = REALTIME_UI_STATE.detail || status.detail;
    const button = panel.querySelector('[data-realtime-sound]');
    button.classList.toggle('is-enabled', REALTIME_UI_STATE.soundEnabled);
    button.setAttribute('aria-pressed', String(REALTIME_UI_STATE.soundEnabled));
    const soundLabel = realtimeSoundLabel();
    button.title = REALTIME_UI_STATE.soundDetail || '';
    button.innerHTML = `${managerIcon(REALTIME_UI_STATE.soundEnabled ? 'volume' : 'volume-off')}<span>${soundLabel}</span>`;
    panel.querySelector('[data-realtime-sync]').textContent = lastSync;
  });
  const dot = document.querySelector('.m-online-dot');
  if (dot) dot.dataset.connection = REALTIME_UI_STATE.connection;
}
async function toggleRealtimeSound() { await window.ManagerRealtime?.toggleSound(); }
async function fetchRealtimeOrders() {
  return Store.getOrders();
}
function applyRealtimeOrders(freshOrders) {
  orders = freshOrders;
  updateActiveOrdersBadge();
  if (currentView === 'dashboard') document.getElementById('m-content').innerHTML = renderDashboard();
  if (currentView === 'pedidos') document.getElementById('m-content').innerHTML = renderPedidos();
}
function startManagerRealtime() { window.ManagerRealtime?.start({ client:DB, initialOrderIds:orders.map(order => order.databaseId), fetchOrders:fetchRealtimeOrders, applyOrders:applyRealtimeOrders, onState:updateRealtimeUi }); }

async function setView(view) {
  if (!VIEW_TITLES[view]) view = 'dashboard';
  const requiredCapability = window.UICapabilities?.ROUTE_CAPABILITIES?.[view];
  if (requiredCapability && !window.UICapabilities.can(currentManagerRole, requiredCapability)) view = 'dashboard';
  currentView = view;
  document.getElementById('view-title').textContent = VIEW_TITLES[view];
  document.getElementById('view-description').textContent = VIEW_DESCRIPTIONS[view];
  Object.keys(VIEW_TITLES).forEach(v => {
    const btn = document.getElementById(`nav-${v}`);
    if (btn) {
      btn.classList.toggle('active', v === view);
      if (v === view) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  });
  const pageUrl = new URL(window.location.href);
  if (view === 'dashboard') pageUrl.searchParams.delete('view');
  else pageUrl.searchParams.set('view', view);
  window.history.replaceState({}, '', pageUrl);
  updateActiveOrdersBadge();

  if (view === 'configuracoes') {
    document.getElementById('m-content').innerHTML = renderStoreSettingsState('loading');
    try { storeSettingsState.values = mapStoreSettings(await Store.getStoreSettings()); storeSettingsState.feedback = null; document.getElementById('m-content').innerHTML = renderStoreSettings(); }
    catch (error) { document.getElementById('m-content').innerHTML = renderStoreSettingsState('error', error.message); }
    return;
  }

  if (view === 'relatorios') {
    await loadManagerReport();
    return;
  }

  const content = document.getElementById('m-content');
  if (view === 'dashboard') content.innerHTML = renderDashboardState('loading');
  if (view === 'pedidos') content.innerHTML = renderOrdersState('loading');
  if (view === 'estoque-lanches') content.innerHTML = renderSnackStockState('loading');

  // Recarregar dados mais recentes da store
  try {
    [products, orders] = await Promise.all([loadProductsForCurrentRole(), Store.getOrders()]);
    if (view === 'estoque-lanches') SNACK_STOCK_UI_STATE.movements = await Store.getStockMovements();
  } catch (error) {
    content.innerHTML = view === 'dashboard'
      ? renderDashboardState('error', error.message)
      : view === 'pedidos'
        ? renderOrdersState('error', error.message)
        : view === 'estoque-lanches'
        ? renderSnackStockState('error', error.message)
        : `<div class="card" style="color:var(--red)">Não foi possível carregar os dados. ${escapeManagerHtml(error.message || '')}</div>`;
    return;
  }

  if (view === 'dashboard')  content.innerHTML = renderDashboard();
  if (view === 'pedidos')    content.innerHTML = renderPedidos();
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
  return `<section class="popup-editor-page">
    <header class="popup-editor-context"><div><span aria-hidden="true">${managerIcon('megaphone')}</span><div><strong>Campanha de entrada</strong><p>Configure a comunicação exibida ao cliente quando ele acessa o cardápio.</p></div></div></header>
    <div class="popup-editor-layout">
      <form class="card popup-editor-form" id="popup-editor-form" aria-busy="true">
        <div class="popup-editor-head"><div><span class="popup-editor-eyebrow">Publicação</span><h2>Conteúdo promocional</h2><p class="popup-editor-sub">Edite a campanha e acompanhe o resultado no preview.</p></div><label class="popup-active-switch"><input type="checkbox" id="popup-active" /><span class="popup-switch-track" aria-hidden="true"></span><span><strong>Exibir pop-up</strong><small>Publicar após salvar</small></span></label></div>
        <div class="popup-active-note"><span aria-hidden="true">${managerIcon('megaphone')}</span><div><strong id="popup-active-label">Pop-up desativado</strong><small>A ativação só terá efeito após salvar pelo fluxo existente.</small></div></div>
        <section class="popup-form-section"><div class="popup-form-section-head"><span aria-hidden="true">${managerIcon('note')}</span><div><strong>Mensagem da campanha</strong><small>Título e texto principal apresentados ao cliente</small></div></div><div class="form-group"><label class="form-label" for="popup-title">Título *</label><input class="form-input" id="popup-title" maxlength="80" required aria-describedby="popup-title-help" /><small class="popup-field-help" id="popup-title-help">Até 80 caracteres.</small></div><div class="form-group"><div class="popup-label-row"><label class="form-label" for="popup-message">Mensagem *</label><small class="popup-character-count" id="popup-message-count">0/400</small></div><textarea class="form-textarea" id="popup-message" rows="4" maxlength="400" required aria-describedby="popup-message-count"></textarea></div></section>
        <section class="popup-form-section"><div class="popup-form-section-head"><span aria-hidden="true">${managerIcon('image')}</span><div><strong>Imagem promocional</strong><small>Opcional · preserve textos e elementos importantes da arte</small></div></div><div class="form-group"><input class="hidden" id="popup-image-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /><input id="popup-image-url" type="hidden" /><div class="popup-image-upload" id="popup-image-upload"><img class="hidden" id="popup-image-preview" alt="Prévia da imagem promocional" /><div id="popup-image-prompt"><span aria-hidden="true">${managerIcon('image')}</span><strong>Nenhuma imagem selecionada</strong><small>JPG, PNG, WEBP ou GIF · até 5 MB</small></div><button class="btn-upload-image" id="choose-popup-image" type="button">${managerIcon('upload')}<span>Escolher imagem</span></button></div></div></section>
        <section class="popup-form-section"><div class="popup-form-section-head"><span aria-hidden="true">${managerIcon('link')}</span><div><strong>Botão de ação</strong><small>Opcional · texto e destino devem ser preenchidos juntos</small></div></div><div class="popup-field-grid"><div class="form-group"><label class="form-label" for="popup-button-text">Texto do botão</label><input class="form-input" id="popup-button-text" maxlength="40" placeholder="Ver cardápio" /></div><div class="form-group"><label class="form-label" for="popup-button-url">Destino do botão</label><input class="form-input" id="popup-button-url" placeholder="index.html ou https://..." /></div></div></section>
        <section class="popup-form-section"><div class="popup-form-section-head"><span aria-hidden="true">${managerIcon('calendar')}</span><div><strong>Período de exibição</strong><small>Datas vazias mantêm a campanha em exibição contínua</small></div></div><div class="popup-field-grid"><div class="form-group"><label class="form-label" for="popup-starts-at">Início</label><input class="form-input popup-date-input" id="popup-starts-at" type="datetime-local" /></div><div class="form-group"><label class="form-label" for="popup-ends-at">Fim</label><input class="form-input popup-date-input" id="popup-ends-at" type="datetime-local" /></div></div><div class="popup-schedule-status" id="popup-schedule-status" role="status">${managerIcon('info')}<span>Exibição contínua, sem período definido.</span></div></section>
        <div class="popup-editor-actions"><p class="form-error" id="popup-editor-error" role="alert" aria-live="polite"></p><button class="btn-primary popup-save-button" id="popup-save-button" type="submit" data-capability="managePopup" data-capability-mode="disable">${managerIcon('check')}<span>Salvar pop-up</span></button></div>
      </form>
      <aside class="popup-editor-side"><div class="popup-preview-panel"><div class="popup-preview-toolbar"><div><span aria-hidden="true">${managerIcon('eye')}</span><span>Pré-visualização do cliente</span></div><strong id="popup-preview-state">Desativado</strong></div><div class="popup-preview-stage"><div class="popup-preview-window campaign-popup-surface"><div class="popup-preview-image-wrap campaign-popup-media hidden" id="popup-live-image-wrap"><img id="popup-live-image" alt="" /></div><div class="popup-preview-content campaign-popup-content"><span>Dog Burger</span><h2 id="popup-live-title">Título do pop-up</h2><p id="popup-live-message">Sua mensagem aparecerá aqui.</p><span class="popup-preview-button campaign-popup-action hidden" id="popup-live-button">Ver cardápio</span></div></div></div></div><div class="card popup-help-card"><div class="popup-help-heading"><span aria-hidden="true">${managerIcon('info')}</span><div><h2>Como funciona</h2><p>Regras atuais de apresentação</p></div></div><ul><li>${managerIcon('check')}<span>Aparece a cada novo carregamento da página quando estiver ativo e dentro do período escolhido.</span></li><li>${managerIcon('check')}<span>Ao fechar, permanece oculto durante a navegação atual.</span></li><li>${managerIcon('check')}<span>Datas vazias mantêm a exibição contínua.</span></li></ul></div></aside>
    </div>
  </section>`;
}

function popupLocalDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0,16);
}

function updatePopupPreview(source, allowLocalObjectUrl = false) {
  popupPreviewImageSource = safeManagerImageUrl(source, allowLocalObjectUrl);
  const preview = document.getElementById('popup-image-preview');
  const prompt = document.getElementById('popup-image-prompt');
  if (popupPreviewImageSource) { preview.src = popupPreviewImageSource; preview.classList.remove('hidden'); prompt.classList.add('hidden'); }
  else { preview.removeAttribute('src'); preview.classList.add('hidden'); prompt.classList.remove('hidden'); }
  updatePopupLivePreview();
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
  document.querySelector('.popup-active-note')?.classList.toggle('is-active', active);
  const previewState = document.getElementById('popup-preview-state');
  previewState.textContent = active ? 'Ativo' : 'Desativado';
  previewState.classList.toggle('is-active', active);
  const previewButton = document.getElementById('popup-live-button');
  previewButton.textContent = buttonText || 'Ver cardápio';
  previewButton.classList.toggle('hidden', !(buttonText && buttonUrl));
  const currentSource = imageSource === undefined ? popupPreviewImageSource : imageSource;
  const imageWrap = document.getElementById('popup-live-image-wrap');
  if (currentSource) { const liveImage = document.getElementById('popup-live-image'); liveImage.src = currentSource; liveImage.alt = title ? `Imagem da campanha ${title}` : 'Imagem da campanha'; imageWrap.classList.remove('hidden'); }
  else imageWrap.classList.add('hidden');
  updatePopupScheduleStatus();
}

function updatePopupScheduleStatus() {
  const startsValue = document.getElementById('popup-starts-at').value;
  const endsValue = document.getElementById('popup-ends-at').value;
  const status = document.getElementById('popup-schedule-status');
  status.classList.remove('is-error');
  if (!startsValue && !endsValue) { status.innerHTML = `${managerIcon('info')}<span>Exibição contínua, sem período definido.</span>`; return; }
  if (startsValue && endsValue && new Date(endsValue) <= new Date(startsValue)) { status.innerHTML = `${managerIcon('alert')}<span>O fim deve ser posterior ao início.</span>`; status.classList.add('is-error'); return; }
  if (startsValue && endsValue) { status.innerHTML = `${managerIcon('check')}<span>Período completo configurado.</span>`; return; }
  status.innerHTML = `${managerIcon('info')}<span>${startsValue ? 'Sem data final: permanece ativo após o início.' : 'Sem data inicial: válido até a data final.'}</span>`;
}

async function initPopupEditor() {
  const errorElement = document.getElementById('popup-editor-error');
  try {
    const popup = await Store.getPopupSettings();
    if (popup) {
      const imageUrl = safeManagerImageUrl(popup.image_url);
      document.getElementById('popup-title').value = popup.title || '';
      document.getElementById('popup-message').value = popup.message || '';
      document.getElementById('popup-image-url').value = imageUrl;
      document.getElementById('popup-button-text').value = popup.button_text || '';
      document.getElementById('popup-button-url').value = popup.button_url || '';
      document.getElementById('popup-starts-at').value = popupLocalDate(popup.starts_at);
      document.getElementById('popup-ends-at').value = popupLocalDate(popup.ends_at);
      document.getElementById('popup-active').checked = popup.active === true;
      updatePopupPreview(imageUrl);
    }
    updatePopupLivePreview();
  } catch (error) { errorElement.textContent = `Não foi possível carregar. ${error.message}`; }
  finally { document.getElementById('popup-editor-form').setAttribute('aria-busy', 'false'); }

  document.getElementById('choose-popup-image').addEventListener('click', () => document.getElementById('popup-image-file').click());
  document.getElementById('popup-image-upload').addEventListener('click', event => { if (!event.target.closest('button')) document.getElementById('popup-image-file').click(); });
  document.getElementById('popup-image-file').addEventListener('change', event => { const file = event.target.files[0]; if (file) updatePopupPreview(URL.createObjectURL(file), true); });
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
  button.disabled = true; button.innerHTML = `${managerIcon('history')}<span>Salvando...</span>`;
  try {
    let imageUrl = document.getElementById('popup-image-url').value;
    if (file) imageUrl = await Store.uploadProductImage(file);
    const savedPopup = await Store.savePopup({ title:document.getElementById('popup-title').value.trim(), message:document.getElementById('popup-message').value.trim(), imageUrl, buttonText, buttonUrl, active:document.getElementById('popup-active').checked, startsAt:startsValue ? new Date(startsValue).toISOString() : null, endsAt:endsValue ? new Date(endsValue).toISOString() : null });
    document.getElementById('popup-image-url').value = savedPopup.image_url || '';
    document.getElementById('popup-active').checked = savedPopup.active === true;
    updatePopupPreview(savedPopup.image_url || '');
    alert('Pop-up salvo com sucesso.');
  } catch (error) { errorElement.textContent = `Não foi possível salvar. ${error.message}`; }
  finally { button.disabled = false; button.innerHTML = `${managerIcon('check')}<span>Salvar pop-up</span>`; }
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
    <span class="dashboard-state-icon" aria-hidden="true">${managerIcon('alert')}</span>
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
      ${kpiCard('Pedidos Hoje', String(todayOrders.length), managerIcon('calendar'), '#EA580C', 'recebidos hoje')}
      ${kpiCard('Pedidos Ativos', String(active.length), managerIcon('activity'), '#1D4ED8', 'pendentes ou preparando')}
      ${kpiCard('Prontos', String(ready), managerIcon('check'), '#15803D', 'aguardando entrega')}
      ${kpiCard('Entregues', String(delivered), managerIcon('delivery'), '#57534E', 'total de pedidos')}
    </div>

    <div class="dashboard-operations-grid">
      <article class="card dashboard-operation-card">
        <div class="card-header dashboard-card-header">
          <div><span class="card-title">Novos pedidos</span><p>Aguardando início do preparo</p></div>
          <span class="dashboard-count-badge">${newOrders.length}</span>
        </div>
        ${newOrders.length
          ? `<div class="dashboard-order-list">${newOrders.slice(0,4).map(o => dashOrderRow(o)).join('')}</div><button class="dashboard-text-button" type="button" onclick="setView('pedidos')">Ver todos os pedidos${managerIcon('chevron')}</button>`
          : renderDashboardEmpty(managerIcon('spark'), 'Fila em dia', 'Nenhum pedido novo aguardando atendimento.')}
      </article>

      <article class="card dashboard-operation-card">
        <div class="card-header dashboard-card-header">
          <div><span class="card-title">Disponibilidade de lanches</span><p>Indicador visual, sem bloqueio automático</p></div>
          <span class="dashboard-count-badge ${soldOutSnacks.length ? 'is-alert' : 'is-ok'}">${soldOutSnacks.length}</span>
        </div>
        ${soldOutSnacks.length
          ? `<div class="dashboard-stock-alert"><span aria-hidden="true">${managerIcon('alert')}</span><div><strong>${soldOutSnacks.length} ${soldOutSnacks.length === 1 ? 'lanche sinalizado' : 'lanches sinalizados'} como esgotado</strong><p>${soldOutSnacks.slice(0,3).map(product => escapeManagerHtml(product.name)).join(', ')}${soldOutSnacks.length > 3 ? ` e mais ${soldOutSnacks.length - 3}` : ''}</p></div></div><button class="dashboard-text-button" type="button" data-capability="manageStock" onclick="setView('estoque-lanches')">Abrir área preparada${managerIcon('chevron')}</button>`
          : renderDashboardEmpty(managerIcon('menu'), 'Nenhum alerta visual', 'Não há lanches com quantidade zero nos dados atuais.')}
      </article>
    </div>

    <div class="dashboard-feed-grid">
      <article class="card">
        <div class="card-header dashboard-card-header"><div><span class="card-title">Pedidos ativos</span><p>Pendentes ou em preparo</p></div><span class="dashboard-count-badge">${active.length}</span></div>
        ${active.length
          ? active.slice(0,5).map(o => dashOrderRow(o)).join('')
          : renderDashboardEmpty(managerIcon('activity'), 'Nenhum pedido ativo', 'Os próximos pedidos aparecerão nesta área.')}
      </article>

      <article class="card">
        <div class="card-header dashboard-card-header"><div><span class="card-title">Últimos pedidos</span><p>Movimentação mais recente</p></div></div>
        ${orders.length
          ? orders.slice(0,5).map(o => dashOrderRow(o)).join('')
          : renderDashboardEmpty(managerIcon('orders'), 'Nenhum pedido registrado', 'O histórico recente aparecerá quando houver pedidos.')}
      </article>
    </div>
  </section>`;
}

function dashOrderRow(o) {
  const sm = STATUS_META[o.status];
  return `<div class="dash-order-row">
    <div>
      <span class="dash-order-id">${o.id}</span>
      <span class="dash-order-customer">${escapeManagerHtml(o.customerName)}</span>
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
    return `<button class="filter-tab${ordersFilter === s ? ' active' : ''}" type="button" aria-pressed="${ordersFilter === s}" onclick="setPedidosFilter('${s}')"><span>${label}</span><strong>${count}</strong></button>`;
  }).join('');

  const cards = filtered.length === 0
    ? renderOrdersEmptyState()
    : filtered.map(o => orderCard(o)).join('');

  return `<section class="orders-page" aria-label="Gestão de pedidos">
    ${renderRealtimeReadiness('orders')}
    ${ORDERS_UI_STATE.feedback ? `<div class="orders-feedback" role="status"><span aria-hidden="true">${managerIcon('check')}</span>${escapeManagerHtml(ORDERS_UI_STATE.feedback)}</div>` : ''}
    <div class="orders-toolbar"><div><strong>Fila de atendimento</strong><span>${filtered.length} ${filtered.length === 1 ? 'pedido no filtro atual' : 'pedidos no filtro atual'}</span></div><div class="filter-tabs orders-filter-tabs" aria-label="Filtrar pedidos">${tabs}</div></div>
    <div class="orders-list">${cards}</div>
    ${renderCancellationModal()}
  </section>`;
}

function renderOrdersState(state, detail = '') {
  if (state === 'loading') return `<section class="orders-state" aria-live="polite" aria-busy="true"><div class="dashboard-state-spinner" aria-hidden="true"></div><strong>Carregando pedidos...</strong><span>Sincronizando a fila operacional.</span></section>`;
  return `<section class="orders-state is-error" role="alert"><span class="orders-state-icon" aria-hidden="true">${managerIcon('alert')}</span><strong>Não foi possível carregar os pedidos</strong><span>${escapeManagerHtml(detail || 'Tente novamente em instantes.')}</span><button type="button" onclick="setView('pedidos')">Tentar novamente</button></section>`;
}

function renderOrdersEmptyState() {
  const filterLabel = ordersFilter === 'todos'
    ? 'pedidos'
    : ordersFilter === 'cancelado'
      ? 'pedidos cancelados'
      : `pedidos ${STATUS_META[ordersFilter]?.label.toLowerCase() || ''}`;
  return `<div class="orders-empty-state"><span aria-hidden="true">${managerIcon('inbox')}</span><strong>Nenhum resultado</strong><p>Não há ${filterLabel} para exibir neste filtro.</p></div>`;
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
      <div class="order-card-summary">
        <div class="order-card-identity">
          <span class="order-id">${o.id}</span>
          <span class="status-badge" style="background:${sm.bg};color:${sm.color}">${sm.label}</span>
          ${cancellation ? '<span class="orders-demo-badge">registrado</span>' : ''}
        </div>
        <p class="order-meta"><strong>${escapeManagerHtml(o.customerName)}</strong><span>${o.items.length} ${o.items.length===1?'item':'itens'}</span><time>${timeSince(o.createdAt)}</time></p>
      </div>
      <span class="order-total">R$ ${fmt(total)}</span>
      <span class="chevron${expanded ? ' is-expanded' : ''}" aria-hidden="true">${managerIcon('chevron')}</span>
    </div>
    ${expanded ? `
    <div class="order-body" id="order-body-${o.id}">
      <div class="order-items-list">
        ${o.items.map(i => {
          const p = getProduct(i.pid);
          const productName = p?.name || i.productName || 'Produto indisponível';
          return `<div class="order-item-row">
            <span class="order-item-name">${i.qty}× ${escapeManagerHtml(productName)}${i.removedIngredients ? `<small class="order-item-removal">Sem: ${escapeManagerHtml(i.removedIngredients)}</small>` : ''}</span>
            <span class="order-item-price">R$ ${fmt(i.unitPrice * i.qty)}</span>
          </div>`;
        }).join('')}
      </div>
      ${renderOrderFinancialSummary(o)}
      <div class="order-service-details">
        ${o.address ? `<div class="order-detail order-address"><span aria-hidden="true">${managerIcon('pin')}</span><div><strong>Endereço</strong><p>${formatOrderAddress(o.address)}</p></div></div>` : ''}
        <div class="order-detail order-payment"><span aria-hidden="true">${managerIcon('payment')}</span><div><strong>Pagamento na entrega</strong><p>${orderPaymentLabel(o)}</p></div></div>
        ${o.note ? `<div class="order-detail order-note"><span aria-hidden="true">${managerIcon('note')}</span><div><strong>Observação</strong><p>${escapeManagerHtml(o.note)}</p></div></div>` : ''}
      </div>
      ${renderOrderTimeline(o)}
      <div class="order-actions no-print">
        ${next && !cancellation ? `<button class="btn-advance" data-capability="advanceOrders" data-capability-mode="disable" onclick="advanceOrder('${o.id}','${next}')"><span>Avançar para ${STATUS_META[next].label}</span>${managerIcon('arrow-right')}</button>` : ''}
        <button class="order-action-button" type="button" onclick="printKitchenTicket('${o.id}')">${managerIcon('print')}<span>Imprimir comanda</span></button>
        ${o.status !== 'entregue' && !cancellation ? `<button class="order-action-button is-danger" type="button" data-capability="cancelOrders" onclick="openOrderCancellation('${o.id}')">${managerIcon('close')}<span>Cancelar pedido</span></button>` : ''}
      </div>
      <div class="kitchen-ticket-footer"><strong>Comanda de cozinha · ${o.id}</strong><span>Emitida pelo navegador</span></div>
    </div>` : ''}
  </article>`;
}

function renderOrderTimeline(order) {
  const events = [{ label:'Pedido recebido', detail:new Date(order.createdAt).toLocaleString('pt-BR') }];
  order.history.forEach(item => events.push({ label:STATUS_META[item.to_status]?.label || item.to_status, detail:new Date(item.created_at).toLocaleString('pt-BR') }));
  if (order.cancellation) events.push({
    label:'Pedido cancelado',
    detail:order.cancellation.reason && order.cancellation.created_at
      ? `${order.cancellation.reason} · ${new Date(order.cancellation.created_at).toLocaleString('pt-BR')}`
      : 'Cancelamento registrado',
    cancelled:true,
  });
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
      <p class="modal-sub">O cancelamento e sua justificativa serão registrados no pedido.</p>
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
    [orders, products] = await Promise.all([Store.getOrders(), loadProductsForCurrentRole()]);
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

/* ── ESTOQUE DE LANCHES PRONTOS (FRONTEND) ── */
function snackStockProducts() {
  return products.filter(product => product.category === 'lanches' && product.active !== false);
}

function normalizedStockNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function snackStockStatus(product) {
  const quantity = normalizedStockNumber(product.stock);
  const minimum = normalizedStockNumber(product.minStock);
  if (quantity === 0) return { key:'zero', label:'Esgotado', icon:'close' };
  if (quantity <= minimum) return { key:'baixo', label:'Baixo', icon:'alert' };
  return { key:'normal', label:'Normal', icon:'check' };
}

function renderSnackStockState(state, detail = '') {
  if (state === 'loading') {
    return `<section class="snack-stock-state" aria-live="polite" aria-busy="true"><div class="dashboard-state-spinner" aria-hidden="true"></div><strong>Carregando lanches...</strong><span>Consultando o estoque transacional.</span></section>`;
  }
  return `<section class="snack-stock-state is-error" role="alert"><span class="snack-stock-state-icon" aria-hidden="true">${managerIcon('alert')}</span><strong>Não foi possível carregar os lanches</strong><p>${escapeManagerHtml(detail || 'Tente novamente em instantes.')}</p><button type="button" onclick="setView('estoque-lanches')">Tentar novamente</button></section>`;
}

function renderSnackStock() {
  const snacks = snackStockProducts();
  const counts = { normal:0, baixo:0, zero:0 };
  snacks.forEach(product => { counts[snackStockStatus(product).key]++; });
  const filtered = SNACK_STOCK_UI_STATE.filter === 'todos'
    ? snacks
    : snacks.filter(product => snackStockStatus(product).key === SNACK_STOCK_UI_STATE.filter);
  const filters = [
    { key:'todos', label:'Todos', count:snacks.length },
    { key:'normal', label:'Normal', count:counts.normal },
    { key:'baixo', label:'Baixo', count:counts.baixo },
    { key:'zero', label:'Esgotado', count:counts.zero },
  ];

  return `<section class="snack-stock-page" aria-label="Estoque transacional de lanches prontos">
    <div class="snack-stock-intro">
      <div><span aria-hidden="true">${managerIcon('stock')}</span><div><strong>Unidades de lanches prontos</strong><p>Estoque real, debitado na confirmação do pedido. Não inclui ingredientes nem possui reset diário.</p></div></div>
    </div>
    ${SNACK_STOCK_UI_STATE.feedback ? `<div class="snack-stock-feedback is-${SNACK_STOCK_UI_STATE.feedback.type}" role="status"><span aria-hidden="true">${managerIcon(SNACK_STOCK_UI_STATE.feedback.type === 'success' ? 'check' : 'alert')}</span><strong>${escapeManagerHtml(SNACK_STOCK_UI_STATE.feedback.message)}</strong></div>` : ''}
    <div class="snack-stock-kpis">
      ${kpiCard('Lanches cadastrados', String(snacks.length), managerIcon('menu'), '#EA580C', 'somente categoria lanches', 'is-brand')}
      ${kpiCard('Estoque normal', String(counts.normal), managerIcon('check'), '#15803D', 'acima do mínimo')}
      ${kpiCard('Estoque baixo', String(counts.baixo), managerIcon('alert'), '#B45309', 'no mínimo ou abaixo')}
      ${kpiCard('Esgotados', String(counts.zero), managerIcon('close'), '#B91C1C', 'quantidade real igual a zero')}
    </div>
    <div class="snack-stock-toolbar"><div><strong>Disponibilidade</strong><span>${filtered.length} ${filtered.length === 1 ? 'lanche no filtro atual' : 'lanches no filtro atual'}</span></div><div class="filter-tabs snack-stock-filters" aria-label="Filtrar por disponibilidade">${filters.map(filter => `<button class="filter-tab${SNACK_STOCK_UI_STATE.filter === filter.key ? ' active' : ''}" type="button" aria-pressed="${SNACK_STOCK_UI_STATE.filter === filter.key}" onclick="setSnackStockFilter('${filter.key}')"><span>${filter.label}</span><strong>${filter.count}</strong></button>`).join('')}</div></div>
    ${filtered.length ? `<div class="snack-stock-grid">${filtered.map(renderSnackStockCard).join('')}</div>` : `<div class="snack-stock-empty"><span aria-hidden="true">${managerIcon('inbox')}</span><strong>Nenhum lanche neste estado</strong><p>Escolha outro filtro para continuar.</p></div>`}
    ${renderSnackStockHistory()}
    ${renderSnackRestockModal()}
    ${renderSnackProductDeleteModal()}
  </section>`;
}

function renderSnackStockCard(product) {
  const quantity = normalizedStockNumber(product.stock);
  const minimum = normalizedStockNumber(product.minStock);
  const status = snackStockStatus(product);
  const deleting = SNACK_STOCK_UI_STATE.deletingProductId !== null;
  return `<article class="snack-stock-card is-${status.key}">
    <div class="snack-stock-card-head"><div class="snack-stock-product-icon" aria-hidden="true">${managerIcon('menu')}</div><div class="snack-stock-product-summary"><h3>${escapeManagerHtml(product.name)}</h3><span class="snack-stock-status">${managerIcon(status.icon)}<span>${status.label}</span></span></div><button class="snack-stock-delete" type="button" data-capability="manageMenu" data-delete-product-id="${escapeManagerHtml(String(product.id))}" aria-label="Excluir ${escapeManagerHtml(product.name)}" title="Excluir produto" onclick="openSnackProductDelete(${JSON.stringify(product.id)})"${deleting ? ' disabled' : ''}>${managerIcon('trash')}<span class="sr-only">Excluir produto</span></button></div>
    <div class="snack-stock-quantity"><span>Quantidade disponível</span><strong>${quantity}</strong><small>unidades prontas</small></div>
    <label class="snack-stock-minimum"><span><strong>Estoque mínimo</strong><small>Alerta a partir deste valor</small></span><input type="number" min="0" max="999" step="1" value="${minimum}" aria-label="Estoque mínimo de ${escapeManagerHtml(product.name)}" aria-busy="${SNACK_STOCK_UI_STATE.savingMinimums.has(product.id)}" onchange="updateSnackStockMinimum(${JSON.stringify(product.id)}, this.value)" ${SNACK_STOCK_UI_STATE.savingMinimums.has(product.id) ? 'disabled' : ''} /></label>
    <button class="btn-primary snack-stock-restock" type="button" data-capability="manageStock" data-capability-mode="disable" onclick="openSnackRestock(${JSON.stringify(product.id)})">${managerIcon('plus')}<span>Reposição manual</span></button>
  </article>`;
}

function setSnackStockFilter(filter) {
  if (!['todos','normal','baixo','zero'].includes(filter)) return;
  SNACK_STOCK_UI_STATE.filter = filter;
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

async function updateSnackStockMinimum(productId, value) {
  const minimum = Number(value);
  if (!Number.isInteger(minimum) || minimum < 0 || minimum > 999) {
    SNACK_STOCK_UI_STATE.feedback = { type:'error', message:'O estoque mínimo deve ser um número inteiro entre 0 e 999.' };
  } else {
    SNACK_STOCK_UI_STATE.savingMinimums.add(productId);
    try {
      await Store.setSnackMinStock(productId, minimum);
      products = await loadProductsForCurrentRole();
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
      <span class="orders-demo-badge">${managerIcon('history')}<span>Reposição auditada</span></span>
      <h2 class="modal-title" id="snack-restock-title">Repor ${escapeManagerHtml(product.name)}</h2>
      <p class="modal-sub">A quantidade será somada de forma transacional e registrada no histórico.</p>
      <form onsubmit="submitSnackRestock(event)">
        <div class="form-group"><label class="form-label" for="snack-restock-amount">Quantidade a adicionar *</label><input class="form-input" id="snack-restock-amount" type="number" min="1" max="999" step="1" inputmode="numeric" required /></div>
        <p class="form-error" id="snack-restock-error"></p>
        <div class="modal-actions"><button class="btn-secondary" type="button" onclick="closeSnackRestock()">Cancelar</button><button class="btn-primary" type="submit">${managerIcon('plus')}<span>Adicionar unidades</span></button></div>
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

function canDeleteSnackProducts() {
  return window.UICapabilities?.can(currentManagerRole, 'manageMenu') === true;
}

function renderSnackProductDeleteModal() {
  if (SNACK_STOCK_UI_STATE.deleteProductId === null) return '';
  const product = snackStockProducts().find(item => item.id === SNACK_STOCK_UI_STATE.deleteProductId);
  if (!product) return '';
  const deleting = SNACK_STOCK_UI_STATE.deletingProductId === product.id;
  return `<div class="modal-overlay snack-product-delete-overlay" onclick="closeSnackProductDelete()"></div>
    <section class="modal snack-product-delete-modal" role="dialog" aria-modal="true" aria-labelledby="snack-product-delete-title" aria-describedby="snack-product-delete-description" aria-busy="${deleting}">
      <span class="snack-product-delete-icon" aria-hidden="true">${managerIcon('trash')}</span>
      <h2 class="modal-title" id="snack-product-delete-title">Excluir produto?</h2>
      <p class="modal-sub" id="snack-product-delete-description">Tem certeza de que deseja excluir o produto <strong>${escapeManagerHtml(product.name)}</strong>? Esta ação poderá ser irreversível.</p>
      <p class="snack-product-delete-note">O produto será desativado e deixará de aparecer no estoque operacional e no cardápio público. Pedidos e movimentações históricas serão preservados.</p>
      <p class="form-error" id="snack-product-delete-error" role="alert"></p>
      <form onsubmit="submitSnackProductDelete(event)">
        <div class="modal-actions"><button class="btn-secondary" id="snack-product-delete-cancel" type="button" onclick="closeSnackProductDelete()"${deleting ? ' disabled' : ''}>Cancelar</button><button class="snack-product-delete-confirm${deleting ? ' is-loading' : ''}" type="submit" data-capability="manageMenu" data-capability-mode="disable"${deleting ? ' disabled' : ''}>${managerIcon(deleting ? 'activity' : 'trash')}<span>${deleting ? 'Excluindo…' : 'Excluir produto'}</span></button></div>
      </form>
    </section>`;
}

function openSnackProductDelete(productId) {
  if (!canDeleteSnackProducts()) {
    SNACK_STOCK_UI_STATE.feedback = { type:'error', message:'Seu perfil não tem permissão para excluir produtos do cardápio.' };
    document.getElementById('m-content').innerHTML = renderSnackStock();
    return;
  }
  const product = snackStockProducts().find(item => item.id === productId);
  if (!product) return;
  SNACK_STOCK_UI_STATE.deleteProductId = productId;
  SNACK_STOCK_UI_STATE.feedback = null;
  document.getElementById('m-content').innerHTML = renderSnackStock();
  setTimeout(() => document.getElementById('snack-product-delete-cancel')?.focus(), 0);
}

function closeSnackProductDelete() {
  if (SNACK_STOCK_UI_STATE.deletingProductId !== null) return;
  const productId = SNACK_STOCK_UI_STATE.deleteProductId;
  SNACK_STOCK_UI_STATE.deleteProductId = null;
  document.getElementById('m-content').innerHTML = renderSnackStock();
  setTimeout(() => document.querySelector(`[data-delete-product-id="${CSS.escape(String(productId))}"]`)?.focus(), 0);
}

async function submitSnackProductDelete(event) {
  event.preventDefault();
  if (SNACK_STOCK_UI_STATE.deletingProductId !== null) return;
  const productId = SNACK_STOCK_UI_STATE.deleteProductId;
  const product = snackStockProducts().find(item => item.id === productId);
  const errorElement = document.getElementById('snack-product-delete-error');
  if (!canDeleteSnackProducts()) {
    errorElement.textContent = 'Seu perfil não tem permissão para excluir produtos do cardápio.';
    return;
  }
  if (!product) {
    errorElement.textContent = 'O produto não está mais disponível. Atualize a listagem e tente novamente.';
    return;
  }

  SNACK_STOCK_UI_STATE.deletingProductId = productId;
  document.getElementById('m-content').innerHTML = renderSnackStock();
  try {
    await Store.setProductActive(productId, false);
    const localProduct = products.find(item => item.id === productId);
    if (localProduct) localProduct.active = false;
    const [productsResult, movementsResult] = await Promise.allSettled([loadProductsForCurrentRole(), Store.getStockMovements()]);
    if (productsResult.status === 'fulfilled') products = productsResult.value;
    if (movementsResult.status === 'fulfilled') SNACK_STOCK_UI_STATE.movements = movementsResult.value;
    const refreshIncomplete = productsResult.status === 'rejected' || movementsResult.status === 'rejected';
    SNACK_STOCK_UI_STATE.deleteProductId = null;
    SNACK_STOCK_UI_STATE.feedback = { type:'success', message:refreshIncomplete
      ? `${product.name} foi excluído e o servidor confirmou a alteração. Recarregue a página para reconciliar todos os dados.`
      : `${product.name} foi excluído do estoque e do cardápio público. O histórico foi preservado.` };
  } catch (error) {
    SNACK_STOCK_UI_STATE.feedback = null;
    setTimeout(() => {
      const currentError = document.getElementById('snack-product-delete-error');
      if (currentError) currentError.textContent = `Não foi possível excluir o produto. ${error.message}`;
    }, 0);
  } finally {
    SNACK_STOCK_UI_STATE.deletingProductId = null;
    document.getElementById('m-content').innerHTML = renderSnackStock();
  }
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
  button.innerHTML = `${managerIcon('activity')}<span>Adicionando...</span>`;
  try {
    await Store.restockSnackProduct(productId, amount, crypto.randomUUID());
    [products, SNACK_STOCK_UI_STATE.movements] = await Promise.all([loadProductsForCurrentRole(), Store.getStockMovements()]);
    SNACK_STOCK_UI_STATE.restockProductId = null;
    SNACK_STOCK_UI_STATE.feedback = { type:'success', message:`${amount} unidades adicionadas a ${product.name}.` };
  } catch (error) {
    errorElement.textContent = `Não foi possível repor o estoque. ${error.message}`;
    button.disabled = false;
    button.innerHTML = `${managerIcon('plus')}<span>Adicionar unidades</span>`;
    return;
  }
  document.getElementById('m-content').innerHTML = renderSnackStock();
}

function renderSnackStockHistory() {
  const entries = SNACK_STOCK_UI_STATE.movements.slice(0, 10);
  return `<section class="card snack-stock-history"><div class="card-header"><div><span class="card-title">Histórico de movimentações</span><p>Últimos registros persistidos pelo backend</p></div><span class="snack-stock-history-count">${entries.length}</span></div>${entries.length ? `<div class="snack-stock-history-list">${entries.map(entry => { const product = getProduct(entry.product_id); const delta = Number(entry.quantity_delta); const movementClass = delta > 0 ? 'is-positive' : 'is-negative'; return `<div class="snack-stock-history-row ${movementClass}"><span class="snack-stock-history-icon" aria-hidden="true">${managerIcon(delta > 0 ? 'plus' : 'minus')}</span><div class="snack-stock-history-main"><strong>${escapeManagerHtml(product?.name || `Produto ${entry.product_id}`)}</strong><small>${escapeManagerHtml(stockMovementLabel(entry.reason))}</small></div><span class="snack-stock-history-delta">${delta > 0 ? '+' : ''}${delta}</span><div class="snack-stock-history-meta"><strong>Saldo ${entry.resulting_stock}</strong><time>${new Date(entry.created_at).toLocaleString('pt-BR')}</time></div></div>`; }).join('')}</div>` : `<div class="snack-stock-history-empty"><span aria-hidden="true">${managerIcon('history')}</span><strong>Nenhuma movimentação registrada</strong><p>As próximas alterações de estoque aparecerão aqui.</p></div>`}</section>`;
}

function stockMovementLabel(reason) {
  return ({ manual_restock:'Reposição manual', order_debit:'Baixa por pedido', order_restore:'Restauração por cancelamento', manual_adjustment:'Ajuste manual' })[reason] || reason;
}

/* ── CONFIGURAÇÕES DA LOJA (FRONTEND) ── */
function checkedSetting(value) {
  return value ? ' checked' : '';
}

function storeSettingsSection(icon, title, subtitle, content, className = '') {
  return `<section class="card store-settings-section ${className}"><div class="store-settings-section-head"><div><span aria-hidden="true">${managerIcon(icon)}</span><div><strong>${title}</strong><small>${subtitle}</small></div></div></div>${content}</section>`;
}

function renderStoreSettingsState(state, detail = '') {
  const isError = state === 'error';
  return `<section class="store-settings-state ${isError ? 'is-error' : 'is-loading'}" role="${isError ? 'alert' : 'status'}" aria-live="polite">
    <span class="store-settings-state-icon" aria-hidden="true">${managerIcon(isError ? 'alert' : 'settings')}</span>
    <strong>${isError ? 'Não foi possível carregar as configurações' : 'Carregando configurações'}</strong>
    <p>${isError ? escapeManagerHtml(detail || 'Tente novamente para recuperar os dados da loja.') : 'Buscando os parâmetros operacionais persistidos no servidor.'}</p>
    ${isError ? `<button class="btn-secondary" type="button" onclick="setView('configuracoes')">${managerIcon('history')}<span>Tentar novamente</span></button>` : '<span class="store-settings-loading-bar" aria-hidden="true"></span>'}
  </section>`;
}

function renderStoreSettings() {
  const value = storeSettingsState.values;
  const feedback = storeSettingsState.feedback;
  const saving = storeSettingsState.saving;
  return `<section class="store-settings-page">
    <div class="store-settings-readiness"><div><span aria-hidden="true">${managerIcon('settings')}</span><div><strong>Central de configuração operacional</strong><p>Horários, canais e regras que orientam o atendimento da loja.</p></div></div></div>
    ${feedback ? `<div class="store-settings-feedback is-${feedback.type}" role="status" aria-live="polite"><span aria-hidden="true">${managerIcon(feedback.type === 'success' ? 'check' : feedback.type === 'error' ? 'alert' : 'info')}</span><span>${escapeManagerHtml(feedback.message)}</span></div>` : ''}
    <form id="store-settings-form" onsubmit="submitStoreSettings(event)" oninput="markStoreSettingsDirty()" novalidate>
      <div class="store-settings-layout">
        <div class="store-settings-column">
          ${storeSettingsSection('calendar', 'Funcionamento', 'Horários e pausa programada', `
            <div class="store-settings-subsection"><div class="store-settings-subsection-title"><strong>Expediente</strong><span>Horário local da loja</span></div><div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-open-time">Abertura *</label><input class="form-input" id="setting-open-time" type="time" value="${value.openTime}" required aria-describedby="setting-open-time-error" /><small class="form-error" id="setting-open-time-error" role="alert"></small></div><div class="form-group"><label class="form-label" for="setting-close-time">Fechamento *</label><input class="form-input" id="setting-close-time" type="time" value="${value.closeTime}" required aria-describedby="setting-close-time-error" /><small class="form-error" id="setting-close-time-error" role="alert"></small></div></div></div>
            <div class="store-settings-pause"><label class="store-settings-switch"><input id="setting-pause-enabled" type="checkbox"${checkedSetting(value.pauseEnabled)} onchange="toggleStorePauseFields()" /><span class="store-settings-switch-track" aria-hidden="true"></span><span><strong>Programar pausa</strong><small>Interrompe temporariamente o atendimento no intervalo definido.</small></span></label><div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-pause-start">Início da pausa</label><input class="form-input" id="setting-pause-start" type="time" value="${value.pauseStart}"${value.pauseEnabled ? '' : ' disabled'} aria-describedby="setting-pause-start-error" /><small class="form-error" id="setting-pause-start-error" role="alert"></small></div><div class="form-group"><label class="form-label" for="setting-pause-end">Fim da pausa</label><input class="form-input" id="setting-pause-end" type="time" value="${value.pauseEnd}"${value.pauseEnabled ? '' : ' disabled'} aria-describedby="setting-pause-end-error" /><small class="form-error" id="setting-pause-end-error" role="alert"></small></div></div></div>`) }
          ${storeSettingsSection('pin', 'Informações comerciais', 'Canais e localização exibidos ao cliente', `
            <div class="store-settings-grid">
            <div class="form-group"><label class="form-label" for="setting-whatsapp">WhatsApp *</label><input class="form-input" id="setting-whatsapp" value="${escapeManagerHtml(value.whatsapp)}" maxlength="24" required /><small class="form-error" id="setting-whatsapp-error"></small></div>
            <div class="form-group"><label class="form-label" for="setting-instagram">Instagram *</label><input class="form-input" id="setting-instagram" value="${escapeManagerHtml(value.instagram)}" maxlength="31" required /><small class="form-error" id="setting-instagram-error"></small></div>
            </div>
            <div class="form-group"><label class="form-label" for="setting-location">Localização *</label><input class="form-input" id="setting-location" value="${escapeManagerHtml(value.location)}" maxlength="120" required /><small class="form-error" id="setting-location-error"></small></div>
            <div class="store-settings-coordinate-note"><span aria-hidden="true">${managerIcon('info')}</span><span>Coordenadas usadas para identificar a localização comercial.</span></div><div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-latitude">Latitude *</label><input class="form-input store-settings-mono" id="setting-latitude" inputmode="decimal" value="${value.latitude}" required /><small class="form-error" id="setting-latitude-error"></small></div><div class="form-group"><label class="form-label" for="setting-longitude">Longitude *</label><input class="form-input store-settings-mono" id="setting-longitude" inputmode="decimal" value="${value.longitude}" required /><small class="form-error" id="setting-longitude-error"></small></div></div>`) }
        </div>
        <div class="store-settings-column">
          ${storeSettingsSection('delivery', 'Atendimento e estimativas', 'Modalidades disponíveis e tempo previsto', `
            <div class="store-settings-options"><label class="store-settings-option"><input id="setting-delivery-enabled" type="checkbox"${checkedSetting(value.deliveryEnabled)} aria-describedby="setting-service-error" /><span class="store-settings-option-mark" aria-hidden="true">${managerIcon('check')}</span><span><strong>Delivery</strong><small>Disponibilizar pedidos para entrega</small></span></label><label class="store-settings-option"><input id="setting-pickup-enabled" type="checkbox"${checkedSetting(value.pickupEnabled)} aria-describedby="setting-service-error" /><span class="store-settings-option-mark" aria-hidden="true">${managerIcon('check')}</span><span><strong>Retirada presencial</strong><small>Disponibilizar retirada no local</small></span></label></div><small class="form-error" id="setting-service-error" role="alert"></small>
            <div class="store-settings-estimate"><div class="store-settings-subsection-title"><strong>Estimativa de delivery</strong><span>Intervalo em minutos</span></div><div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-delivery-eta-min">Tempo mínimo *</label><input class="form-input store-settings-mono" id="setting-delivery-eta-min" type="number" min="1" max="240" step="1" value="${value.deliveryEtaMin}" /><small class="form-error" id="setting-delivery-eta-min-error"></small></div><div class="form-group"><label class="form-label" for="setting-delivery-eta-max">Tempo máximo *</label><input class="form-input store-settings-mono" id="setting-delivery-eta-max" type="number" min="1" max="240" step="1" value="${value.deliveryEtaMax}" /><small class="form-error" id="setting-delivery-eta-max-error"></small></div></div></div>
            <div class="store-settings-estimate"><div class="store-settings-subsection-title"><strong>Estimativa de retirada</strong><span>Intervalo em minutos</span></div><div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-pickup-eta-min">Tempo mínimo *</label><input class="form-input store-settings-mono" id="setting-pickup-eta-min" type="number" min="1" max="240" step="1" value="${value.pickupEtaMin}" /><small class="form-error" id="setting-pickup-eta-min-error"></small></div><div class="form-group"><label class="form-label" for="setting-pickup-eta-max">Tempo máximo *</label><input class="form-input store-settings-mono" id="setting-pickup-eta-max" type="number" min="1" max="240" step="1" value="${value.pickupEtaMax}" /><small class="form-error" id="setting-pickup-eta-max-error"></small></div></div></div>`) }
          ${storeSettingsSection('payment', 'Pagamentos aceitos', 'Selecione pelo menos uma opção', `<div class="store-settings-options is-inline"><label class="store-settings-option"><input id="setting-pix" type="checkbox"${checkedSetting(value.pix)} aria-describedby="setting-payment-error" /><span class="store-settings-option-mark" aria-hidden="true">${managerIcon('check')}</span><span><strong>Pix</strong></span></label><label class="store-settings-option"><input id="setting-cash" type="checkbox"${checkedSetting(value.cash)} aria-describedby="setting-payment-error" /><span class="store-settings-option-mark" aria-hidden="true">${managerIcon('check')}</span><span><strong>Dinheiro</strong></span></label><label class="store-settings-option"><input id="setting-card" type="checkbox"${checkedSetting(value.card)} aria-describedby="setting-payment-error" /><span class="store-settings-option-mark" aria-hidden="true">${managerIcon('check')}</span><span><strong>Cartão</strong></span></label></div><small class="form-error" id="setting-payment-error" role="alert"></small>`) }
          <section class="card store-settings-section is-sensitive" data-future-capability="manageSensitiveRules"><div class="store-settings-section-head"><div><span aria-hidden="true">${managerIcon('currency')}</span><div><strong>Regras comerciais sensíveis</strong><small>Taxas e condições de entrega</small></div></div></div><div class="store-settings-grid"><div class="form-group"><label class="form-label" for="setting-delivery-fee">Taxa padrão (R$) *</label><input class="form-input store-settings-mono" id="setting-delivery-fee" type="number" min="0" max="999" step="0.01" value="${value.deliveryFee.toFixed(2)}" /><small class="form-error" id="setting-delivery-fee-error"></small></div><div class="form-group"><label class="form-label" for="setting-free-delivery">Grátis a partir de (R$) *</label><input class="form-input store-settings-mono" id="setting-free-delivery" type="number" min="0" max="9999" step="0.01" value="${value.freeDeliveryFrom.toFixed(2)}" /><small class="form-error" id="setting-free-delivery-error"></small></div></div><p class="store-settings-rule-summary"><span aria-hidden="true">${managerIcon('info')}</span><span>Taxa atual de R$ ${fmt(value.deliveryFee)}; entrega gratuita a partir de R$ ${fmt(value.freeDeliveryFrom)}. Retirada permanece gratuita.</span></p></section>
        </div>
      </div>
      <div class="store-settings-actions"><div><span class="store-settings-actions-status${storeSettingsState.dirty ? ' is-dirty' : ''}" aria-hidden="true">${managerIcon(storeSettingsState.dirty ? 'alert' : 'check')}</span><span><strong id="store-settings-state">${storeSettingsState.dirty ? 'Alterações não salvas' : 'Tudo atualizado'}</strong><small>As configurações são validadas e salvas no servidor.</small></span></div><button class="btn-secondary" id="store-settings-cancel" type="button" onclick="cancelStoreSettings()"${saving ? ' disabled' : ''}>${managerIcon('close')}<span>Descartar</span></button><button class="btn-primary" id="store-settings-save" type="submit" data-capability="manageSettings" data-capability-mode="disable"${saving ? ' disabled' : ''}>${managerIcon(saving ? 'history' : 'check')}<span>${saving ? 'Salvando…' : 'Salvar configurações'}</span></button></div>
    </form>
  </section>`;
}

function markStoreSettingsDirty() {
  storeSettingsState.dirty = true;
  storeSettingsState.feedback = null;
  const state = document.getElementById('store-settings-state');
  if (state) state.textContent = 'Alterações locais não salvas';
  const status = document.querySelector('.store-settings-actions-status');
  if (status) { status.classList.add('is-dirty'); status.innerHTML = managerIcon('alert'); }
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
  document.querySelectorAll('#store-settings-form .input-error').forEach(element => { element.classList.remove('input-error'); element.removeAttribute('aria-invalid'); });
  document.querySelectorAll('#store-settings-form .form-error').forEach(element => { element.textContent = ''; });
}

function storeSettingError(id, message) {
  const input = document.getElementById(id);
  input?.classList.add('input-error');
  input?.setAttribute('aria-invalid', 'true');
  input?.setAttribute('aria-describedby', `${id}-error`);
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

async function submitStoreSettings(event) {
  event.preventDefault();
  clearStoreSettingErrors();
  const values = readStoreSettingsForm();
  if (!validateStoreSettings(values)) return;
  if (storeSettingsState.saving) return;
  storeSettingsState.saving = true;
  document.getElementById('m-content').innerHTML = renderStoreSettings();
  try {
    storeSettingsState.values = mapStoreSettings(await Store.updateStoreSettings(storeSettingsPayload(values)));
    storeSettingsState.saving = false;
    storeSettingsState.dirty = false;
    storeSettingsState.feedback = { type:'success', message:'Configurações salvas no servidor.' };
    document.getElementById('m-content').innerHTML = renderStoreSettings();
  } catch (error) { storeSettingsState.saving = false; storeSettingsState.feedback = { type:'error', message:error.message || 'Não foi possível salvar as configurações.' }; document.getElementById('m-content').innerHTML = renderStoreSettings(); }
}

function cancelStoreSettings() {
  storeSettingsState.dirty = false;
  storeSettingsState.feedback = { type:'neutral', message:'Alterações descartadas; os últimos valores do servidor foram restaurados.' };
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
function escapeManagerHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}

function safeManagerImageUrl(value, allowLocalObjectUrl = false) {
  if (!value) return '';
  try {
    const url = new URL(String(value || ''), window.location.href);
    return ['http:', 'https:'].includes(url.protocol) || (allowLocalObjectUrl && url.protocol === 'blob:') ? url.href : '';
  } catch { return ''; }
}

function reportPeriodLabel(range) {
  const format = value => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
  if (range.start === range.end) return new Date(`${range.start}T12:00:00`).toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  return `${format(range.start)} — ${format(range.end)}`;
}

// B06: os cálculos financeiros são recebidos da RPC; o navegador controla apenas período e apresentação.
function fortalezaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Fortaleza', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftCivilDate(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function setReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  reportDate = value;
  REPORTS_UI_STATE.period = 'day';
  REPORTS_UI_STATE.error = '';
  await loadManagerReport();
}

function shiftReportDate(days) { setReportDate(shiftCivilDate(reportDate, days)); }
function showTodayReport() { setReportDate(fortalezaDateKey()); }

async function setReportPeriod(period) {
  if (!['day','seven','thirty','custom'].includes(period)) return;
  REPORTS_UI_STATE.period = period;
  REPORTS_UI_STATE.error = '';
  if (period !== 'custom') reportDate = fortalezaDateKey();
  if (period === 'custom') document.getElementById('m-content').innerHTML = renderRelatorios();
  else await loadManagerReport();
}

async function applyCustomReportRange() {
  const start = document.getElementById('report-custom-start').value;
  const end = document.getElementById('report-custom-end').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    REPORTS_UI_STATE.error = 'Informe um período personalizado válido, com a data inicial anterior ou igual à final.';
    document.getElementById('report-range-error').textContent = REPORTS_UI_STATE.error;
    return;
  }
  REPORTS_UI_STATE.customStart = start;
  REPORTS_UI_STATE.customEnd = end;
  REPORTS_UI_STATE.error = '';
  await loadManagerReport();
}

function reportPeriodRange() {
  if (REPORTS_UI_STATE.period === 'custom') return { start:REPORTS_UI_STATE.customStart, end:REPORTS_UI_STATE.customEnd };
  const end = REPORTS_UI_STATE.period === 'day' ? reportDate : fortalezaDateKey();
  const offset = REPORTS_UI_STATE.period === 'seven' ? -6 : REPORTS_UI_STATE.period === 'thirty' ? -29 : 0;
  return { start:shiftCivilDate(end, offset), end };
}

function renderReportsState(state, detail = '') {
  if (state === 'loading') return `<section class="reports-state" aria-live="polite" aria-busy="true"><div class="dashboard-state-spinner" aria-hidden="true"></div><strong>Carregando relatórios...</strong><span>Consultando os indicadores financeiros consolidados.</span></section>`;
  return `<section class="reports-state is-error" role="alert"><span class="reports-state-icon" aria-hidden="true">${managerIcon('alert')}</span><strong>Não foi possível carregar os relatórios</strong><p>${escapeManagerHtml(detail || 'Tente novamente em instantes.')}</p><button type="button" onclick="setView('relatorios')">Tentar novamente</button></section>`;
}

function reportMetricCard(label, value, icon, detail, tone = 'neutral', featured = false) {
  const iconClass = ['currency', 'outgoing'].includes(icon) ? ' is-brand' : '';
  return `<article class="report-metric-card is-${tone}${featured ? ' is-featured' : ''}">
    <div class="report-metric-head"><span>${label}</span><span class="${iconClass.trim()}" aria-hidden="true">${managerIcon(icon)}</span></div>
    <strong>${value}</strong><p>${detail}</p>
  </article>`;
}

async function loadManagerReport() {
  const content = document.getElementById('m-content');
  const range = reportPeriodRange();
  const requestId = ++REPORTS_UI_STATE.requestId;
  content.innerHTML = renderReportsState('loading');
  try {
    const report = await Store.getManagerReport(range.start, range.end);
    if (requestId !== REPORTS_UI_STATE.requestId || currentView !== 'relatorios') return;
    REPORTS_UI_STATE.report = report;
    content.innerHTML = renderRelatorios();
  } catch (error) {
    if (requestId !== REPORTS_UI_STATE.requestId || currentView !== 'relatorios') return;
    REPORTS_UI_STATE.report = null;
    content.innerHTML = renderReportsState('error', error.message);
  }
}

function renderRelatorios() {
  const range = reportPeriodRange();
  const report = REPORTS_UI_STATE.report;
  if (!report) return renderReportsState('loading');
  const summary = report.summary;
  const coverage = report.coverage;
  const selectedOrders = report.orders;
  const rows = selectedOrders.map(order => {
    const items = order.items.map(item => `<span><strong>${item.quantity}×</strong> ${escapeManagerHtml(item.product_name || 'Produto')} <small>R$ ${fmt(item.line_total)}</small>${item.removed_ingredients ? `<em>Sem: ${escapeManagerHtml(item.removed_ingredients)}</em>` : ''}</span>`).join('');
    return `<tr>
      <td data-label="Pedido"><strong class="report-order-id">PED-${String(order.id).padStart(3, '0')}</strong><small>${escapeManagerHtml(order.recognized_at_label)}</small></td>
      <td data-label="Cliente"><strong>${escapeManagerHtml(order.customer_name)}</strong></td>
      <td data-label="Itens"><div class="report-products-list">${items || '<span>Nenhum item</span>'}</div></td>
      <td data-label="Atendimento"><span class="report-address">${order.fulfillment_method === 'pickup' ? 'Retirada' : order.fulfillment_method === 'delivery' ? 'Entrega' : 'Histórico'}</span></td>
      <td data-label="Pagamento"><span class="report-payment">${escapeManagerHtml(PAYMENT_LABELS[order.payment_method] || 'Não informado')}</span></td>
      <td data-label="Valor"><strong class="report-value">R$ ${fmt(order.revenue)}</strong></td>
      <td data-label="Status"><span class="status-badge report-delivered-badge">Entregue</span></td>
    </tr>`;
  }).join('');
  const incomplete = Number(coverage.orders_without_complete_b05_snapshot) > 0 || Number(coverage.items_without_unit_cost) > 0 || Number(coverage.orders_using_created_at_fallback) > 0;

  return `<section class="reports-page">
    <div class="report-readiness"><div><span aria-hidden="true">${managerIcon('reports')}</span><div><strong>Indicadores financeiros consolidados</strong><p>Somente vendas entregues e não canceladas, reconhecidas no horário oficial de Fortaleza.</p></div></div></div>
    <div class="card report-filter-card">
      <div class="report-filter-head"><div><span class="report-calendar-label">Período do relatório</span><h2>${escapeManagerHtml(reportPeriodLabel(range))}</h2></div><div class="report-period-tabs">
        <button type="button" class="${REPORTS_UI_STATE.period === 'day' ? 'active' : ''}" aria-pressed="${REPORTS_UI_STATE.period === 'day'}" onclick="setReportPeriod('day')">Dia</button>
        <button type="button" class="${REPORTS_UI_STATE.period === 'seven' ? 'active' : ''}" aria-pressed="${REPORTS_UI_STATE.period === 'seven'}" onclick="setReportPeriod('seven')">7 dias</button>
        <button type="button" class="${REPORTS_UI_STATE.period === 'thirty' ? 'active' : ''}" aria-pressed="${REPORTS_UI_STATE.period === 'thirty'}" onclick="setReportPeriod('thirty')">30 dias</button>
        <button type="button" class="${REPORTS_UI_STATE.period === 'custom' ? 'active' : ''}" aria-pressed="${REPORTS_UI_STATE.period === 'custom'}" onclick="setReportPeriod('custom')">Personalizado</button>
      </div></div>
      ${REPORTS_UI_STATE.period === 'day' ? `<div class="report-calendar-controls"><button type="button" title="Dia anterior" aria-label="Dia anterior" onclick="shiftReportDate(-1)">${managerIcon('arrow-left')}</button><input id="report-date" type="date" value="${reportDate}" aria-label="Selecionar dia do relatório" onchange="setReportDate(this.value)" /><button type="button" title="Próximo dia" aria-label="Próximo dia" onclick="shiftReportDate(1)">${managerIcon('arrow-right-small')}</button><button class="report-today-button" type="button" onclick="showTodayReport()">Hoje</button></div>` : ''}
      ${REPORTS_UI_STATE.period === 'custom' ? `<div class="report-custom-range"><label>Data inicial<input id="report-custom-start" type="date" value="${REPORTS_UI_STATE.customStart}" /></label><span aria-hidden="true">${managerIcon('arrow-right-small')}</span><label>Data final<input id="report-custom-end" type="date" value="${REPORTS_UI_STATE.customEnd}" /></label><button class="btn-primary" type="button" onclick="applyCustomReportRange()">Aplicar período</button></div><p class="form-error" id="report-range-error">${escapeManagerHtml(REPORTS_UI_STATE.error)}</p>` : ''}
    </div>
    ${incomplete ? `<div class="report-backend-note"><span aria-hidden="true">${managerIcon('info')}</span><div><strong>Cobertura histórica parcial</strong><p>${coverage.orders_using_item_total_fallback} venda(s) usam o valor comprovado dos itens; ${coverage.orders_using_created_at_fallback} usam a criação como data histórica; ${coverage.items_without_unit_cost} item(ns) não possuem custo registrado.</p></div></div>` : ''}
    <div class="report-kpis">
      ${reportMetricCard('Faturamento', `R$ ${fmt(summary.revenue)}`, 'currency', `${summary.sales_count} vendas realizadas`, 'positive', true)}
      ${reportMetricCard('Custos dos produtos', `R$ ${fmt(summary.product_cost)}`, 'receipt', 'snapshots dos itens vendidos', 'warning')}
      ${reportMetricCard('Despesas no período', `R$ ${fmt(summary.expenses)}`, 'outgoing', `${summary.expense_count} registros`, 'danger')}
      ${reportMetricCard('Resultado', `R$ ${fmt(summary.result)}`, 'trend', 'faturamento − custos − despesas', Number(summary.result) >= 0 ? 'information' : 'danger', true)}
      ${reportMetricCard('Pedidos atendidos', String(summary.sales_count), 'check', 'entregues e não cancelados', 'neutral')}
      ${reportMetricCard('Ticket médio', `R$ ${fmt(summary.average_ticket)}`, 'calculator', 'média das vendas realizadas', 'neutral')}
    </div>
    <div class="card report-orders-card"><div>
      <div class="card-header report-orders-header"><div><span class="card-title">Vendas realizadas no período</span><p>${selectedOrders.length} ${selectedOrders.length === 1 ? 'venda encontrada' : 'vendas encontradas'}</p></div></div>
      ${selectedOrders.length ? `<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th>Atendimento</th><th>Pagamento</th><th>Valor</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="report-empty"><span aria-hidden="true">${managerIcon('calendar')}</span><strong>Nenhuma venda realizada neste período</strong><p>Escolha outro filtro ou período personalizado para consultar.</p></div>`}
    </div></div>
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
          <img class="tbl-img" src="${escapeManagerHtml(safeManagerImageUrl(p.img) || 'dogburger.png')}" alt="${escapeManagerHtml(p.name)}" loading="lazy" />
          <span class="tbl-name">${escapeManagerHtml(p.name)}</span>
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
  alert('Use a área Estoque de Lanches para reposições auditadas.');
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
      <span class="bar-row-name" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeManagerHtml(p.name)}</span>
      <span class="bar-row-val">R$ ${fmt(p.rev)}</span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:${(p.rev/maxRev*100)}%"></div></div>
  </div>`).join('');

  const expRows = expenses.slice(0, 10).map(e => `
    <div class="expense-row">
      <div>
        <p class="exp-name">${escapeManagerHtml(e.description)}</p>
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

function kpiCard(label, value, icon, color, sub, iconClass = '') {
  return `<div class="kpi-card">
    <div class="kpi-top">
      <span class="kpi-label">${label}</span>
      <span class="kpi-icon${iconClass ? ` ${iconClass}` : ''}">${icon}</span>
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
  return !error && ['owner', 'manager', 'attendant'].includes(data?.role) ? data.role : null;
}

function loadProductsForCurrentRole() {
  return ['owner', 'manager'].includes(currentManagerRole) ? Store.getAllProducts() : Store.getProducts();
}

async function initManager() {
  const role = await verifyManager();
  if (role) {
    currentManagerRole = role;
    const { data: { user } } = await DB.auth.getUser();
    const { data: profile } = await DB.from('profiles').select('name').eq('id', user.id).maybeSingle();
    document.querySelector('.m-online-label').textContent = profile?.name || user.email;
    document.getElementById('manager-login')?.classList.add('hidden');
    document.getElementById('page-manager').classList.remove('hidden');
    window.UICapabilities?.init(role);
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

initManager();
