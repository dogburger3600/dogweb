'use strict';

(function exposeManagerRealtime(global) {
  const CHANNEL_NAME = 'manager-orders-realtime';
  const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000];
  const eventKeys = new Set(), knownOrderIds = new Set(), alertedOrderIds = new Set(), pendingInsertedOrderIds = new Set();
  let client, channel, callbacks = {}, reconnectTimer, reconnectChannel, reconcileTimer, reconnectAttempt = 0, reconcilingGeneration = null, reconcileAgainGeneration = null, detectNew = false, stopped = true, firstSubscription = true, generation = 0, audioContext, soundEnabled = false, soundDetail = '', soundTransition = false, connection = 'connecting', detail = '';

  function isActive(token) { return !stopped && token === generation; }
  function emitState(nextConnection = connection, nextDetail = detail) { connection = nextConnection; detail = nextDetail; callbacks.onState?.({ connection, detail, soundEnabled, soundDetail, lastSyncAt:callbacks.lastSyncAt || null }); }
  function clearReconnect(expected) { if (expected && reconnectChannel !== expected) return; clearTimeout(reconnectTimer); reconnectTimer = null; reconnectChannel = null; }
  function rememberEvent(table, payload) {
    const rowId = payload.new?.id ?? payload.new?.order_id ?? payload.old?.id ?? payload.old?.order_id ?? 'unknown';
    const key = `${table}:${payload.eventType}:${rowId}:${payload.commit_timestamp || 'no-timestamp'}`;
    if (eventKeys.has(key)) return false;
    eventKeys.add(key); if (eventKeys.size > 500) eventKeys.delete(eventKeys.values().next().value); return true;
  }
  function playAlert(token) {
    if (!isActive(token) || !soundEnabled || !audioContext || audioContext.state !== 'running') return;
    const start = audioContext.currentTime;
    [0, 0.18].forEach(offset => { const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(); oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(880, start + offset); gain.gain.setValueAtTime(0.0001, start + offset); gain.gain.exponentialRampToValueAtTime(0.22, start + offset + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.14); oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(start + offset); oscillator.stop(start + offset + 0.15); });
  }
  async function reconcile(token) {
    if (!isActive(token)) return;
    if (reconcilingGeneration === token) { reconcileAgainGeneration = token; return; }
    reconcilingGeneration = token; const shouldDetect = detectNew; detectNew = false;
    try {
      const freshOrders = await callbacks.fetchOrders?.();
      if (!isActive(token)) return;
      callbacks.applyOrders?.(freshOrders);
      const currentIds = (freshOrders || []).map(order => String(order.databaseId));
      const newIds = shouldDetect ? currentIds.filter(id => !knownOrderIds.has(id)) : [];
      currentIds.forEach(id => knownOrderIds.add(id));
      pendingInsertedOrderIds.forEach(id => { if (knownOrderIds.has(id) && !alertedOrderIds.has(id)) newIds.push(id); }); pendingInsertedOrderIds.clear();
      [...new Set(newIds)].forEach(id => { if (!alertedOrderIds.has(id)) { alertedOrderIds.add(id); playAlert(token); } });
      callbacks.lastSyncAt = Date.now(); emitState(connection, connection === 'connected' ? 'Dados reconciliados com o servidor' : detail);
    } catch (error) { if (isActive(token)) emitState(connection, `Falha ao sincronizar: ${error.message}`); }
    finally {
      if (reconcilingGeneration === token) reconcilingGeneration = null;
      if (isActive(token) && reconcileAgainGeneration === token) { reconcileAgainGeneration = null; scheduleReconcile(false, 0); }
    }
  }
  function scheduleReconcile(newOrder = false, delay = 120) { if (stopped) return; detectNew ||= newOrder; clearTimeout(reconcileTimer); const token = generation; reconcileTimer = setTimeout(() => reconcile(token), delay); }
  function handleEvent(table, payload) { if (!rememberEvent(table, payload)) return; const inserted = table === 'orders' && payload.eventType === 'INSERT'; if (inserted && payload.new?.id !== undefined) pendingInsertedOrderIds.add(String(payload.new.id)); scheduleReconcile(inserted); }
  function scheduleReconnect(localChannel, message) {
    if (stopped || reconnectTimer || channel !== localChannel) return;
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)]; reconnectAttempt += 1; reconnectChannel = localChannel; emitState('reconnecting', message || `Reconectando em ${Math.ceil(delay / 1000)}s`); const token = generation;
    reconnectTimer = setTimeout(async () => { if (!isActive(token) || channel !== localChannel || reconnectChannel !== localChannel) return; reconnectTimer = null; reconnectChannel = null; channel = null; await client.removeChannel(localChannel); if (isActive(token)) connect(); }, delay);
  }
  function connect() {
    if (stopped || channel) return;
    emitState(reconnectAttempt ? 'reconnecting' : 'connecting', 'Iniciando atualização automática');
    const token = generation;
    let localChannel;
    const handleChannelEvent = (table, payload) => {
      if (!isActive(token) || channel !== localChannel) return;
      handleEvent(table, payload);
    };
    localChannel = client.channel(CHANNEL_NAME).on('postgres_changes', { event:'*', schema:'public', table:'orders' }, p => handleChannelEvent('orders', p)).on('postgres_changes', { event:'*', schema:'public', table:'order_status_history' }, p => handleChannelEvent('order_status_history', p)).on('postgres_changes', { event:'*', schema:'public', table:'order_cancellations' }, p => handleChannelEvent('order_cancellations', p));
    channel = localChannel;
    localChannel.subscribe(status => { if (channel !== localChannel || stopped) return; if (status === 'SUBSCRIBED') { clearReconnect(localChannel); reconnectAttempt = 0; emitState('connected', 'Atualização automática ativa'); scheduleReconcile(firstSubscription, 0); firstSubscription = false; } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') scheduleReconnect(localChannel, 'Conexão Realtime indisponível'); });
  }
  async function toggleSound() {
    if (soundTransition) return soundEnabled;
    if (soundEnabled) { soundEnabled = false; soundDetail = ''; emitState(); return false; }
    soundTransition = true; const token = generation;
    try { const AudioContextClass = global.AudioContext || global.webkitAudioContext; if (!AudioContextClass) throw new Error('Áudio não suportado neste navegador'); audioContext ||= new AudioContextClass(); if (audioContext.state !== 'running') await audioContext.resume(); if (!isActive(token)) return false; soundEnabled = audioContext.state === 'running'; soundDetail = soundEnabled ? '' : 'O navegador bloqueou o áudio até uma interação válida'; emitState(); return soundEnabled; }
    catch (error) { if (isActive(token)) { soundEnabled = false; soundDetail = `Não foi possível habilitar o som: ${error.message}`; emitState(); } return false; }
    finally { if (token === generation) soundTransition = false; }
  }
  function start(options) { stop(); generation += 1; eventKeys.clear(); knownOrderIds.clear(); alertedOrderIds.clear(); pendingInsertedOrderIds.clear(); reconnectAttempt = 0; reconcilingGeneration = null; reconcileAgainGeneration = null; detectNew = false; firstSubscription = true; client = options.client; callbacks = { fetchOrders:options.fetchOrders, applyOrders:options.applyOrders, onState:options.onState, lastSyncAt:null }; (options.initialOrderIds || []).map(String).forEach(id => knownOrderIds.add(id)); stopped = false; connect(); }
  function stop() { generation += 1; stopped = true; soundEnabled = false; soundDetail = ''; soundTransition = false; clearReconnect(); clearTimeout(reconcileTimer); reconcileTimer = null; const oldChannel = channel; channel = null; if (oldChannel && client) void client.removeChannel(oldChannel); const oldAudio = audioContext; audioContext = null; if (oldAudio && oldAudio.state !== 'closed') void oldAudio.close(); }
  global.ManagerRealtime = Object.freeze({ start, stop, toggleSound });
})(window);
