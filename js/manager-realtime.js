'use strict';

(function exposeManagerRealtime(global) {
  const CHANNEL_NAME = 'manager-orders-realtime';
  const MAX_EVENT_KEYS = 500;
  const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000];

  let client = null;
  let channel = null;
  let callbacks = {};
  let reconnectTimer = null;
  let reconcileTimer = null;
  let reconnectAttempt = 0;
  let reconciling = false;
  let reconcileAgain = false;
  let detectNewOnNextReconcile = false;
  let stopped = true;
  let audioContext = null;
  let soundEnabled = false;
  let connectionState = 'connecting';
  let connectionDetail = '';

  const processedEventKeys = new Set();
  const knownOrderIds = new Set();
  const alertedOrderIds = new Set();
  const pendingInsertedOrderIds = new Set();

  function emitState(connection, detail = '') {
    connectionState = connection;
    connectionDetail = detail;
    callbacks.onState?.({
      connection,
      detail,
      soundEnabled,
      lastSyncAt: callbacks.lastSyncAt || null,
    });
  }

  function rememberEvent(key) {
    if (processedEventKeys.has(key)) return false;
    processedEventKeys.add(key);
    if (processedEventKeys.size > MAX_EVENT_KEYS) {
      processedEventKeys.delete(processedEventKeys.values().next().value);
    }
    return true;
  }

  function eventKey(table, payload) {
    const rowId = payload.new?.id ?? payload.new?.order_id ?? payload.old?.id ?? payload.old?.order_id ?? 'unknown';
    return `${table}:${payload.eventType}:${rowId}:${payload.commit_timestamp || 'no-timestamp'}`;
  }

  function playNewOrderAlert() {
    if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
    const start = audioContext.currentTime;
    [0, 0.18].forEach(offset => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, start + offset);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.22, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.14);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.15);
    });
  }

  function alertNewOrders(orderIds) {
    orderIds.forEach(orderId => {
      if (alertedOrderIds.has(orderId)) return;
      alertedOrderIds.add(orderId);
      playNewOrderAlert();
    });
  }

  async function reconcile() {
    if (reconciling) {
      reconcileAgain = true;
      return;
    }
    reconciling = true;
    const detectNew = detectNewOnNextReconcile;
    detectNewOnNextReconcile = false;
    try {
      const currentIds = (await callbacks.onReconcile?.() || []).map(String);
      const unseenIds = detectNew ? currentIds.filter(id => !knownOrderIds.has(id)) : [];
      currentIds.forEach(id => knownOrderIds.add(id));
      const confirmedInsertIds = [...pendingInsertedOrderIds].filter(id => knownOrderIds.has(id));
      pendingInsertedOrderIds.clear();
      alertNewOrders(new Set([...unseenIds, ...confirmedInsertIds]));
      callbacks.lastSyncAt = Date.now();
      emitState('connected');
    } catch (error) {
      emitState('error', `Falha ao sincronizar: ${error.message}`);
    } finally {
      reconciling = false;
      if (reconcileAgain) {
        reconcileAgain = false;
        scheduleReconcile(false, 0);
      }
    }
  }

  function scheduleReconcile(detectNew = false, delay = 120) {
    detectNewOnNextReconcile ||= detectNew;
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(reconcile, delay);
  }

  function handleEvent(table, payload) {
    if (!rememberEvent(eventKey(table, payload))) return;
    if (table === 'orders' && payload.eventType === 'INSERT' && payload.new?.id !== undefined) {
      pendingInsertedOrderIds.add(String(payload.new.id));
    }
    scheduleReconcile(false);
  }

  function scheduleReconnect(detail) {
    if (stopped || reconnectTimer) return;
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    reconnectAttempt += 1;
    emitState('reconnecting', detail || `Reconectando em ${Math.ceil(delay / 1000)}s`);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      const previous = channel;
      channel = null;
      if (previous) await client.removeChannel(previous);
      connect();
    }, delay);
  }

  function connect() {
    if (stopped || channel) return;
    emitState(reconnectAttempt ? 'reconnecting' : 'connecting');
    const localChannel = client
      .channel(CHANNEL_NAME)
      .on('postgres_changes', { event:'*', schema:'public', table:'orders' }, payload => handleEvent('orders', payload))
      .on('postgres_changes', { event:'*', schema:'public', table:'order_status_history' }, payload => handleEvent('order_status_history', payload))
      .on('postgres_changes', { event:'*', schema:'public', table:'order_cancellations' }, payload => handleEvent('order_cancellations', payload));
    channel = localChannel;
    localChannel.subscribe(status => {
      if (channel !== localChannel || stopped) return;
      if (status === 'SUBSCRIBED') {
        reconnectAttempt = 0;
        emitState('connected');
        // O baseline foi capturado antes da subscription; a comparação também
        // cobre pedidos criados durante essa pequena janela de conexão inicial.
        scheduleReconcile(true, 0);
        return;
      }
      if (status === 'CHANNEL_ERROR') scheduleReconnect('Erro na assinatura Realtime');
      if (status === 'TIMED_OUT') scheduleReconnect('Tempo de conexão esgotado');
      if (status === 'CLOSED') scheduleReconnect('Conexão Realtime encerrada');
    });
  }

  async function toggleSound() {
    if (soundEnabled) {
      soundEnabled = false;
      emitState(connectionState);
      return false;
    }
    try {
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Áudio não suportado neste navegador');
      audioContext ||= new AudioContextClass();
      if (audioContext.state !== 'running') await audioContext.resume();
      soundEnabled = audioContext.state === 'running';
      emitState(connectionState);
      return soundEnabled;
    } catch (error) {
      soundEnabled = false;
      emitState(connectionState, `Não foi possível habilitar o som: ${error.message}`);
      return false;
    }
  }

  function start(options) {
    stop();
    processedEventKeys.clear();
    knownOrderIds.clear();
    alertedOrderIds.clear();
    pendingInsertedOrderIds.clear();
    reconnectAttempt = 0;
    reconcileAgain = false;
    detectNewOnNextReconcile = false;
    client = options.client;
    callbacks = { onReconcile:options.onReconcile, onState:options.onState, lastSyncAt:null };
    (options.initialOrderIds || []).map(String).forEach(id => knownOrderIds.add(id));
    stopped = false;
    connect();
  }

  async function stop() {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearTimeout(reconcileTimer);
    reconnectTimer = null;
    reconcileTimer = null;
    const previous = channel;
    channel = null;
    if (previous && client) await client.removeChannel(previous);
  }

  global.ManagerRealtime = Object.freeze({ start, stop, toggleSound });
})(window);

