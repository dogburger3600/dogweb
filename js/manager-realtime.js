'use strict';

(function exposeManagerRealtime(global) {
  const CHANNEL_NAME = 'manager-orders-realtime';
  const SOUND_STORAGE_KEY = 'dogburger:manager:new-order-sound-enabled';
  const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000];
  const eventKeys = new Set(), knownOrderIds = new Set(), alertedOrderIds = new Set(), pendingInsertedOrderIds = new Set();
  let client, channel, callbacks = {}, reconnectTimer, reconnectChannel, reconcileTimer, reconnectAttempt = 0, reconcilingGeneration = null, reconcileAgainGeneration = null, detectNew = false, stopped = true, firstSubscription = true, generation = 0, audioContext, audioTransition, soundEnabled = false, soundReady = false, soundDetail = '', connection = 'connecting', detail = '';

  function isActive(token) { return !stopped && token === generation; }
  function emitState(nextConnection = connection, nextDetail = detail) { connection = nextConnection; detail = nextDetail; callbacks.onState?.({ connection, detail, soundEnabled, soundReady, soundDetail, lastSyncAt:callbacks.lastSyncAt || null }); }
  function readSoundPreference() {
    try { return global.localStorage?.getItem(SOUND_STORAGE_KEY) === 'true'; }
    catch { return false; }
  }
  function persistSoundPreference(enabled) {
    try { global.localStorage?.setItem(SOUND_STORAGE_KEY, String(enabled)); }
    catch { /* A preferência continua válida nesta aba quando o armazenamento está indisponível. */ }
  }
  function waitingForAudioDetail() { return 'Preferência salva. Interaja com a página para liberar o áudio neste navegador.'; }
  function attachAudioUnlockListeners() {
    global.document?.addEventListener('pointerdown', handleAudioUnlock, true);
    global.document?.addEventListener('keydown', handleAudioUnlock, true);
    global.addEventListener?.('storage', handleSoundStorageChange);
  }
  function detachAudioUnlockListeners() {
    global.document?.removeEventListener('pointerdown', handleAudioUnlock, true);
    global.document?.removeEventListener('keydown', handleAudioUnlock, true);
    global.removeEventListener?.('storage', handleSoundStorageChange);
  }
  function handleSoundStorageChange(event) {
    if (event.key !== SOUND_STORAGE_KEY || stopped) return;
    soundEnabled = event.newValue === 'true';
    soundReady = soundEnabled && audioContext?.state === 'running';
    soundDetail = soundEnabled && !soundReady ? waitingForAudioDetail() : '';
    emitState();
  }
  async function ensureAudioReady(token) {
    if (!isActive(token) || !soundEnabled) return false;
    if (audioContext?.state === 'running') {
      soundReady = true;
      soundDetail = '';
      emitState();
      return true;
    }
    if (audioTransition) return audioTransition;
    const transition = (async () => {
      try {
        const AudioContextClass = global.AudioContext || global.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Áudio não suportado neste navegador');
        audioContext ||= new AudioContextClass();
        if (audioContext.state !== 'running') await audioContext.resume();
        if (!isActive(token) || !soundEnabled) return false;
        soundReady = audioContext.state === 'running';
        soundDetail = soundReady ? '' : waitingForAudioDetail();
      } catch (error) {
        if (!isActive(token) || !soundEnabled) return false;
        soundReady = false;
        soundDetail = `Preferência salva, mas o áudio ainda não foi liberado: ${error.message}`;
      }
      emitState();
      return soundReady;
    })();
    audioTransition = transition;
    try { return await transition; }
    finally { if (audioTransition === transition) audioTransition = null; }
  }
  function handleAudioUnlock() {
    if (soundEnabled && !soundReady) void ensureAudioReady(generation);
  }
  function clearReconnect(expected) { if (expected && reconnectChannel !== expected) return; clearTimeout(reconnectTimer); reconnectTimer = null; reconnectChannel = null; }
  function rememberEvent(table, payload) {
    const rowId = payload.new?.id ?? payload.new?.order_id ?? payload.old?.id ?? payload.old?.order_id ?? 'unknown';
    const key = `${table}:${payload.eventType}:${rowId}:${payload.commit_timestamp || 'no-timestamp'}`;
    if (eventKeys.has(key)) return false;
    eventKeys.add(key); if (eventKeys.size > 500) eventKeys.delete(eventKeys.values().next().value); return true;
  }
  function playAlert(token) {
    if (!isActive(token) || !soundEnabled || !soundReady || !audioContext || audioContext.state !== 'running') return;
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
    if (soundEnabled) {
      soundEnabled = false;
      soundReady = false;
      soundDetail = '';
      persistSoundPreference(false);
      emitState();
      return false;
    }
    soundEnabled = true;
    soundDetail = waitingForAudioDetail();
    persistSoundPreference(true);
    emitState();
    await ensureAudioReady(generation);
    return soundEnabled;
  }
  function start(options) { stop(); generation += 1; eventKeys.clear(); knownOrderIds.clear(); alertedOrderIds.clear(); pendingInsertedOrderIds.clear(); reconnectAttempt = 0; reconcilingGeneration = null; reconcileAgainGeneration = null; detectNew = false; firstSubscription = true; client = options.client; callbacks = { fetchOrders:options.fetchOrders, applyOrders:options.applyOrders, onState:options.onState, lastSyncAt:null }; (options.initialOrderIds || []).map(String).forEach(id => knownOrderIds.add(id)); soundEnabled = readSoundPreference(); soundReady = false; soundDetail = soundEnabled ? waitingForAudioDetail() : ''; stopped = false; attachAudioUnlockListeners(); if (soundEnabled) void ensureAudioReady(generation); connect(); }
  function stop() { generation += 1; stopped = true; detachAudioUnlockListeners(); soundEnabled = false; soundReady = false; soundDetail = ''; audioTransition = null; clearReconnect(); clearTimeout(reconcileTimer); reconcileTimer = null; const oldChannel = channel; channel = null; if (oldChannel && client) void client.removeChannel(oldChannel); const oldAudio = audioContext; audioContext = null; if (oldAudio && oldAudio.state !== 'closed') void oldAudio.close(); }
  global.ManagerRealtime = Object.freeze({ start, stop, toggleSound });
})(window);
