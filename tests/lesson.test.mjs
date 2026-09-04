import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lessonForDate, phaseForSeconds, csvCell } from '../app.js';

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

test('service worker caches every application shell file', () => {
  const worker = fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  for (const path of ['./', './index.html', './app.js', './manifest.webmanifest', './icons/icon.svg']) {
    assert.match(worker, new RegExp(path.replaceAll('.', '\\.')));
  }
});
