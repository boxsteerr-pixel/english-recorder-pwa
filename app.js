export function lessonForDate(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = monday.getDay();
  monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  monday.setHours(0, 0, 0, 0);
  const anchor = new Date(2026, 7, 31);
  const number = 79 + Math.floor((monday - anchor) / 604800000);
  const end = new Date(monday);
  end.setDate(end.getDate() + 6);
  return { number, start: monday, end };
}

export function phaseForSeconds(seconds) {
  if (seconds >= 900) return { kind: 'complete', label: '15分钟完成，可以结束录音。' };
  if (seconds >= 600) return { kind: 'newConcept', label: '新概念英语第二册 · 5分钟' };
  return { kind: 'classroom', label: '课内英语 · 10分钟' };
}

export function createRecordingSession(date, lessonNumber) {
  return { date: localDate(date), lessonNumber, seconds: 0 };
}

export function sealRecordingSession(session, seconds) {
  return { ...session, seconds: Math.max(0, Math.floor(seconds)) };
}

export function recordingFilename(date, mime) {
  return `${date}_英语15分钟.${extensionFor(mime)}`;
}

export function dateContext(date) {
  return { key: localDate(date), month: localMonth(date) };
}

export function needsLegacyRepair(record) {
  return record?.date !== '2026-09-04' || !Number(record?.seconds);
}

export function finishRecordingSession(elapsed) {
  return { savedSeconds: elapsed, nextElapsed: 0 };
}

export function recordingStatus(state) {
  return ({
    idle: { text: '准备开始', tone: 'idle' },
    recording: { text: '正在录音', tone: 'recording' },
    paused: { text: '录音已暂停', tone: 'paused' },
    saving: { text: '正在保存录音', tone: 'saving' },
    saved: { text: '已保存，可重新录制', tone: 'saved' }
  })[state] || { text: '准备开始', tone: 'idle' };
}

export function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export class WakeLockController {
  constructor(navigatorLike) {
    this.wakeLock = navigatorLike?.wakeLock;
    this.sentinel = null;
  }

  async acquire() {
    if (this.sentinel) return true;
    if (!this.wakeLock?.request) return false;
    try {
      this.sentinel = await this.wakeLock.request('screen');
      this.sentinel.addEventListener?.('release', () => { this.sentinel = null; });
      return true;
    } catch {
      this.sentinel = null;
      return false;
    }
  }

  async release() {
    if (!this.sentinel) return false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    await sentinel.release();
    return true;
  }
}

const DB_NAME = 'EnglishRecorderOfflineDB';
const STORE_NAME = 'recordingsV2';
const LEGACY_STORE_NAME = 'recordings';
const META_KEY = 'englishRecorderOfflineMetaV1';
const LEGACY_REPAIR_KEY = 'englishRecorderLegacyRepairV1';
const LEGACY_REPAIR_DATE = '2026-09-04';
const secondsPerDay = 900;
const pad = (value) => String(value).padStart(2, '0');
const localDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localMonth = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const formatTime = (seconds) => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;

async function database() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!localStorage.getItem(`${LEGACY_REPAIR_KEY}-store`) && db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
    const legacy = await readRecords(db, LEGACY_STORE_NAME);
    if (legacy.length) await writeRecords(db, legacy.map((record) => ({ ...record, id: record.id || `${record.date}-${record.filename || 'audio'}` })));
    localStorage.setItem(`${LEGACY_REPAIR_KEY}-store`, 'done');
  }
  return db;
}

function readRecords(db, storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function writeRecords(db, records) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    records.forEach((record) => transaction.objectStore(STORE_NAME).put(record));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function saveAudio(record) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ ...record, id: record.id || `${record.date}-${record.filename || 'audio'}` });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function monthlyAudio(month) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const result = [];
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (String(cursor.value.date).startsWith(month)) result.push(cursor.value);
        cursor.continue();
      } else resolve(result.sort((a, b) => a.date.localeCompare(b.date)));
    };
    request.onerror = () => reject(request.error);
  });
}

async function allAudio() {
  return readRecords(await database(), STORE_NAME);
}

function audioDuration(blob) {
  if (typeof Audio !== 'function' || !blob) return Promise.resolve(0);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob), player = new Audio();
    const finish = (value) => { URL.revokeObjectURL(url); resolve(Number.isFinite(value) ? Math.round(value) : 0); };
    player.onloadedmetadata = () => finish(player.duration);
    player.onerror = () => finish(0);
    player.src = url;
  });
}

async function repairLegacyRecords(meta) {
  if (localStorage.getItem(LEGACY_REPAIR_KEY)) return meta;
  const audio = await allAudio();
  const legacy = audio.filter(needsLegacyRepair);
  if (!legacy.length) { localStorage.setItem(LEGACY_REPAIR_KEY, 'done'); return meta; }
  const repaired = await Promise.all(legacy.map(async (record, index) => {
    const mime = record.mime || record.blob?.type || 'audio/mp4';
    const base = recordingFilename(LEGACY_REPAIR_DATE, mime);
    const filename = legacy.length === 1 ? base : base.replace('.', `_旧录音${index + 1}.`);
    const seconds = Number(record.seconds) || await audioDuration(record.blob);
    return { ...record, date: LEGACY_REPAIR_DATE, filename, seconds, id: `${LEGACY_REPAIR_DATE}-legacy-${index + 1}` };
  }));
  const db = await database();
  await writeRecords(db, [...audio.filter((record) => !needsLegacyRepair(record)), ...repaired]);
  const migrated = { ...(meta[LEGACY_REPAIR_DATE] || {}) };
  for (const [date, record] of Object.entries(meta)) {
    if (date === LEGACY_REPAIR_DATE) continue;
    Object.assign(migrated, record, { seconds: Number(migrated.seconds || 0) + Number(record.seconds || 0) });
    delete meta[date];
  }
  migrated.seconds = Math.max(Number(migrated.seconds || 0), repaired.reduce((total, record) => total + Number(record.seconds || 0), 0));
  migrated.done = migrated.seconds >= secondsPerDay;
  migrated.audioFilename = repaired.map((record) => record.filename).join('、');
  meta[LEGACY_REPAIR_DATE] = migrated;
  localStorage.setItem(META_KEY, JSON.stringify(meta));
  localStorage.setItem(LEGACY_REPAIR_KEY, 'done');
  return meta;
}

function preferredMime() {
  for (const mime of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
    if (window.MediaRecorder?.isTypeSupported?.(mime)) return mime;
  }
  return '';
}

function extensionFor(mime) {
  return mime.includes('mp4') || mime.includes('aac') ? 'm4a' : 'webm';
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function shareFile(file, navigatorLike, downloadFallback) {
  if (navigatorLike?.share) {
    try {
      await navigatorLike.share({ files: [file], title: file.name });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  downloadFallback();
  return 'downloaded';
}

function csvFor(month, meta) {
  const header = ['日期', '是否完成', '录音时长(秒)', '录音文件名', '录音格式', '课次', '朗读进度', '朗读次数', '备注'];
  const records = Object.keys(meta).filter((key) => key.startsWith(month)).sort().map((key) => {
    const record = meta[key];
    return [key, record.done ? '是' : '否', record.seconds || 0, record.audioFilename || '', record.audioFormat || '', record.lessonNumber || '', record.lessonProgress || '', record.readCount || '', record.note || ''];
  });
  return '\ufeff' + [header, ...records].map((row) => row.map(csvCell).join(',')).join('\n');
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) { let value = i; for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1; table[i] = value >>> 0; }
  return table;
})();
const crc32 = (bytes) => { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; };
const u16 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255]);
const u32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const join = (parts) => { const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; };
function dosTime(date = new Date()) { return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() }; }
async function zip(files) {
  const encoder = new TextEncoder(), locals = [], central = []; let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), data = new Uint8Array(await file.blob.arrayBuffer()), checksum = crc32(data), time = dosTime();
    const local = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(time.time), u16(time.date), u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    locals.push(local);
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(time.time), u16(time.date), u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length;
  }
  const localData = join(locals), centralData = join(central);
  return new Blob([localData, centralData, join([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralData.length), u32(localData.length), u16(0)])], { type: 'application/zip' });
}

function init() {
  const $ = (id) => document.getElementById(id);
  const elements = ['todayText', 'outsideTask', 'lessonNum', 'weekRange', 'timer', 'bar', 'phase', 'status', 'recordingState', 'start', 'pause', 'stop', 'player', 'saveBox', 'fileInfo', 'downloadAudio', 'lessonProgress', 'readCount', 'note', 'saveRecord', 'calendar', 'monthList', 'packMonth', 'packBtn', 'packStatus', 'exportCsv', 'secureWarn'].reduce((all, id) => ({ ...all, [id]: $(id) }), {});
  let meta = JSON.parse(localStorage.getItem(META_KEY) || '{}');
  let recorder, stream, chunks = [], elapsed = 0, startedAt = 0, tick, paused = false, audioUrl, latestRecording, activeSession, sealedSession;
  const screenWakeLock = new WakeLockController(navigator);
  const current = () => ({ now: new Date(), context: dateContext(new Date()) });
  const refreshToday = () => {
    const { now, context } = current(), lesson = lessonForDate(now), record = meta[context.key];
    elements.todayText.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · 课内10分钟 + Lesson ${lesson.number} 5分钟`;
    elements.outsideTask.textContent = `新概念英语第二册 · Lesson ${lesson.number}`;
    elements.lessonNum.textContent = `Lesson ${lesson.number}`;
    elements.weekRange.textContent = `${localDate(lesson.start)} ～ ${localDate(lesson.end)}`;
    elements.lessonProgress.value = record?.lessonProgress || '';
    elements.readCount.value = record?.readCount || '';
    elements.note.value = record?.note || '';
    if (record?.done) elements.status.textContent = '今日已完成';
    return { context, lesson };
  };
  elements.packMonth.value = dateContext(new Date()).month;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { elements.secureWarn.classList.remove('hidden'); elements.start.disabled = true; }
  refreshToday();
  const updateTimer = () => { const phase = phaseForSeconds(elapsed); elements.timer.textContent = formatTime(elapsed); elements.bar.style.width = `${Math.min(100, elapsed / secondsPerDay * 100)}%`; elements.phase.textContent = phase.label; };
  const setRecordingState = (state) => { const next = recordingStatus(state); elements.recordingState.textContent = next.text; elements.recordingState.dataset.tone = next.tone; elements.status.textContent = next.text; };
  const saveMeta = (date, lessonNumber, done, seconds = elapsed) => { meta[date] = { ...(meta[date] || {}), done: Boolean(done), seconds, lessonNumber, lessonProgress: elements.lessonProgress.value.trim(), readCount: elements.readCount.value ? Number(elements.readCount.value) : '', note: elements.note.value.trim() }; localStorage.setItem(META_KEY, JSON.stringify(meta)); elements.status.textContent = done ? '今日已完成' : '已保存'; renderCalendar(); renderMonthList(); };
  const renderCalendar = () => { const now = new Date(), year = now.getFullYear(), month = now.getMonth(); elements.calendar.innerHTML = ''; for (let blank = 0; blank < new Date(year, month, 1).getDay(); blank += 1) elements.calendar.append(document.createElement('div')); for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day += 1) { const key = `${year}-${pad(month + 1)}-${pad(day)}`, cell = document.createElement('div'); cell.className = `day${meta[key]?.done ? ' done' : ''}`; cell.innerHTML = `<b>${day}</b><span>${meta[key]?.done ? '✅' : '—'}</span>`; elements.calendar.append(cell); } };
  async function renderMonthList() { const month = dateContext(new Date()).month, audio = await monthlyAudio(month), byDate = Object.fromEntries(audio.map((record) => [record.date, record])); const keys = [...new Set([...Object.keys(meta).filter((key) => key.startsWith(month)), ...audio.map((record) => record.date)])].sort(); elements.monthList.innerHTML = keys.length ? keys.map((key) => { const record = meta[key] || {}, file = byDate[key], seconds = Number(record.seconds || file?.seconds || 0); return `<div class="list-row"><b>${key}</b> ${record.done ? '✅' : '⚠️'} · ${Math.floor(seconds / 60)}分${seconds % 60}秒<br>${file ? `🎙 ${file.filename}` : '尚无录音文件'}</div>`; }).join('') : '暂无记录'; }
  elements.start.addEventListener('click', async () => { const now = new Date(), lesson = lessonForDate(now); activeSession = createRecordingSession(now, lesson.number); try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mime = preferredMime(); recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); chunks = []; recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); }); recorder.addEventListener('stop', async () => { const session = sealedSession; if (!session) return; const actualMime = recorder.mimeType || mime || 'audio/webm', blob = new Blob(chunks, { type: actualMime }), filename = recordingFilename(session.date, actualMime); if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = URL.createObjectURL(blob); latestRecording = { blob, filename, mime: actualMime }; elements.player.src = audioUrl; elements.player.classList.remove('hidden'); await saveAudio({ date: session.date, filename, mime: actualMime, blob, seconds: session.seconds }); meta[session.date] = { ...(meta[session.date] || {}), audioFilename: filename, audioFormat: actualMime }; localStorage.setItem(META_KEY, JSON.stringify(meta)); elements.fileInfo.textContent = `${filename} · ${Math.round(blob.size / 1024)}KB · ${actualMime}`; elements.saveBox.classList.remove('hidden'); saveMeta(session.date, session.lessonNumber, session.seconds >= secondsPerDay, session.seconds); stream?.getTracks().forEach((track) => track.stop()); sealedSession = undefined; activeSession = undefined; elements.start.disabled = false; setRecordingState('saved'); }); recorder.start(); await screenWakeLock.acquire(); startedAt = Date.now(); tick = setInterval(() => { elapsed = Math.floor((Date.now() - startedAt) / 1000); updateTimer(); }, 500); elements.start.disabled = true; elements.pause.disabled = false; elements.stop.disabled = false; setRecordingState('recording'); } catch (error) { activeSession = undefined; alert(`无法启动麦克风：${error.message || error}`); } });
  elements.pause.addEventListener('click', async () => { if (!recorder) return; if (!paused) { recorder.pause(); clearInterval(tick); await screenWakeLock.release(); paused = true; elements.pause.textContent = '继续'; setRecordingState('paused'); } else { recorder.resume(); await screenWakeLock.acquire(); startedAt = Date.now() - elapsed * 1000; tick = setInterval(() => { elapsed = Math.floor((Date.now() - startedAt) / 1000); updateTimer(); }, 500); paused = false; elements.pause.textContent = '暂停'; setRecordingState('recording'); } });
  elements.stop.addEventListener('click', async () => { if (recorder?.state === 'inactive' || !activeSession) return; sealedSession = sealRecordingSession(activeSession, elapsed); elapsed = finishRecordingSession(sealedSession.seconds).nextElapsed; clearInterval(tick); updateTimer(); await screenWakeLock.release(); elements.pause.disabled = true; elements.stop.disabled = true; setRecordingState('saving'); recorder.stop(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refreshToday(); renderCalendar(); renderMonthList(); if (recorder?.state === 'recording' && !paused) screenWakeLock.acquire(); } });
  const saveToFiles = async (blob, filename, type) => {
    if (typeof File !== 'function') return download(blob, filename);
    const file = new File([blob], filename, { type });
    return shareFile(file, navigator, () => download(blob, filename));
  };
  elements.saveRecord.addEventListener('click', () => { const { context, lesson } = refreshToday(); saveMeta(context.key, lesson.number, meta[context.key]?.done || elapsed >= secondsPerDay); alert('今日记录已保存。'); });
  elements.exportCsv.addEventListener('click', async () => {
    const month = dateContext(new Date()).month; await saveToFiles(new Blob([csvFor(month, meta)], { type: 'text/csv;charset=utf-8' }), `${month}_英语录音记录.csv`, 'text/csv;charset=utf-8');
  });
  elements.downloadAudio.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!latestRecording) return;
    try {
      await saveToFiles(latestRecording.blob, latestRecording.filename, latestRecording.mime);
    } catch (error) {
      alert(`无法打开“存储到文件”：${error.message || error}`);
    }
  });
  elements.packBtn.addEventListener('click', async () => { const month = elements.packMonth.value; elements.packStatus.textContent = '正在生成 ZIP…'; try { const audio = await monthlyAudio(month), selected = Object.fromEntries(Object.entries(meta).filter(([key]) => key.startsWith(month))); const files = audio.map((record) => ({ name: `audio/${record.filename}`, blob: record.blob })); files.push({ name: 'record.csv', blob: new Blob([csvFor(month, meta)], { type: 'text/csv;charset=utf-8' }) }, { name: 'record.json', blob: new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' }) }); await saveToFiles(await zip(files), `${month}_英语录音打包.zip`, 'application/zip'); elements.packStatus.textContent = `已打开存储面板，包含录音 ${audio.length} 个。`; } catch (error) { elements.packStatus.textContent = `打包失败：${error.message || error}`; } });
  (async () => { meta = await repairLegacyRecords(meta); refreshToday(); renderCalendar(); renderMonthList(); updateTimer(); })();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

if (typeof document !== 'undefined') init();
