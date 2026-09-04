import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lessonForDate, phaseForSeconds, csvCell, WakeLockController, shareFile, finishRecordingSession, recordingStatus, createRecordingSession, sealRecordingSession, recordingFilename, dateContext, needsLegacyRepair } from '../app.js';

test('assigns Lesson 79 during the anchor week', () => {
  assert.equal(lessonForDate(new Date(2026, 7, 31)).number, 79);
  assert.equal(lessonForDate(new Date(2026, 8, 6)).number, 79);
});

test('advances on the next Monday', () => {
  assert.equal(lessonForDate(new Date(2026, 8, 7)).number, 80);
});

test('switches from classroom to New Concept at ten minutes', () => {
  assert.equal(phaseForSeconds(599).kind, 'classroom');
  assert.equal(phaseForSeconds(600).kind, 'newConcept');
  assert.equal(phaseForSeconds(900).kind, 'complete');
});

test('quotes commas and quote characters in exported CSV values', () => {
  assert.equal(csvCell('读,两遍'), '"读,两遍"');
  assert.equal(csvCell('他说"好"'), '"他说""好"""');
});

test('locks elapsed seconds before resetting a finished recording session', () => {
  const result = finishRecordingSession(83);
  assert.deepEqual(result, { savedSeconds: 83, nextElapsed: 0 });
});

test('preserves the recording start date and duration in a sealed session', () => {
  const session = createRecordingSession(new Date(2026, 8, 4), 79);
  assert.deepEqual(sealRecordingSession(session, 901), {
    date: '2026-09-04', lessonNumber: 79, seconds: 901
  });
});

test('derives the filename from the sealed session date', () => {
  assert.equal(recordingFilename('2026-09-04', 'audio/mp4'), '2026-09-04_英语15分钟.m4a');
});

test('refreshes date context instead of retaining the date when the page opened', () => {
  assert.deepEqual(dateContext(new Date(2026, 8, 4)), { key: '2026-09-04', month: '2026-09' });
});

test('identifies a legacy zero-second record for repair', () => {
  assert.equal(needsLegacyRepair({ date: '2026-09-01', seconds: 0 }), true);
  assert.equal(needsLegacyRepair({ date: '2026-09-04', seconds: 600 }), false);
});

test('seals the session before stopping the recorder and releases the microphone afterward', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /sealedSession = sealRecordingSession\(activeSession, elapsed\);[\s\S]*?recorder\.stop\(\);/);
  assert.match(app, /recorder\.addEventListener\('stop',[\s\S]*?const session = sealedSession;[\s\S]*?stream\?\.getTracks\(\)\.forEach/);
});

test('runs the one-time legacy repair before rendering saved recordings', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /await repairLegacyRecords\(meta\);[\s\S]*?renderCalendar\(\); renderMonthList\(\);/);
});

test('provides clear child-facing recording status labels', () => {
  assert.deepEqual(recordingStatus('idle'), { text: '准备开始', tone: 'idle' });
  assert.deepEqual(recordingStatus('recording'), { text: '正在录音', tone: 'recording' });
  assert.deepEqual(recordingStatus('paused'), { text: '录音已暂停', tone: 'paused' });
  assert.deepEqual(recordingStatus('saved'), { text: '已保存，可重新录制', tone: 'saved' });
});

test('includes an accessible visible recording-state banner', () => {
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /id="recordingState"/);
  assert.match(page, /role="status"/);
  assert.match(page, /aria-live="polite"/);
});

test('uses separate child-friendly recording control rows', () => {
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /class="record-start-row"/);
  assert.match(page, /class="record-action-row"/);
  assert.match(page, /min-height:60px/);
  assert.match(page, /gap:14px/);
});

test('service worker caches every application shell file', () => {
  const worker = fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  for (const path of ['./', './index.html', './app.js', './manifest.webmanifest', './icons/icon.svg']) {
    assert.match(worker, new RegExp(path.replaceAll('.', '\\.')));
  }
});

test('keeps the screen awake while recording and releases it when finished', async () => {
  let released = false;
  const controller = new WakeLockController({
    wakeLock: { request: async () => ({ release: async () => { released = true; } }) }
  });

  assert.equal(await controller.acquire(), true);
  assert.equal(await controller.release(), true);
  assert.equal(released, true);
});

test('opens the system share sheet instead of an ambiguous browser download when files can be shared', async () => {
  let shared = false;
  let downloaded = false;
  const file = { name: '2026-09-01_英语15分钟.m4a' };
  const result = await shareFile(file, {
    canShare: ({ files }) => files[0] === file,
    share: async ({ files }) => { shared = files[0] === file; }
  }, () => { downloaded = true; });

  assert.equal(result, 'shared');
  assert.equal(shared, true);
  assert.equal(downloaded, false);
});

test('tries the iPad share sheet even when canShare incorrectly reports false', async () => {
  let shared = false;
  let downloaded = false;
  const file = { name: '2026-09-01_英语15分钟.m4a' };
  const result = await shareFile(file, {
    canShare: () => false,
    share: async ({ files }) => { shared = files[0] === file; }
  }, () => { downloaded = true; });

  assert.equal(result, 'shared');
  assert.equal(shared, true);
  assert.equal(downloaded, false);
});

test('uses the system share flow for CSV and monthly ZIP exports', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /elements\.exportCsv\.addEventListener\('click',[\s\S]*?saveToFiles/);
  assert.match(app, /elements\.packBtn\.addEventListener\('click',[\s\S]*?saveToFiles/);
});
