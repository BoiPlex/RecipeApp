import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/export-table.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } });
const loaded = { exports: {} };
new Function('exports', 'module', 'setTimeout', outputText)(loaded.exports, loaded, callback => callback());
const { wrapCanvasText, exportTablePng } = loaded.exports;

test('canvas text wraps words, long tokens, and explicit newlines', () => {
  const context = { measureText: text => ({ width: text.length * 10 }) };
  assert.deepEqual(wrapCanvasText(context, 'abc defgh\n\nx', 30), ['abc', 'def', 'gh', '', 'x']);
});

test('PNG export draws measured borders and labels in chosen colors, excluding controls', async () => {
  const fills = [];
  const texts = [];
  const context = {
    scale() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    measureText: text => ({ width: text.length * 5 }),
    fillRect(...args) { fills.push({ color: this.fillStyle, args }); },
    fillText(text) { texts.push({ text, color: this.fillStyle }); },
  };
  const bounds = { left: 10, top: 20, width: 120, height: 80 };
  const marker = { dataset: { exportText: 'Mash bananas' }, getBoundingClientRect: () => bounds };
  const border = { tagName: 'TD', getBoundingClientRect: () => bounds };
  const queries = [];
  const container = {
    getBoundingClientRect: () => bounds,
    querySelectorAll(selector) {
      queries.push(selector);
      return selector === 'td, table' ? [border] : [marker];
    },
  };
  const canvas = {
    getContext: () => context,
    toBlob(callback, type) { assert.equal(type, 'image/png'); callback(new Blob(['png'], { type })); },
  };
  let downloaded = false;
  const link = { click() { downloaded = true; }, remove() {} };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    fonts: { ready: Promise.resolve() },
    createElement: tag => tag === 'canvas' ? canvas : link,
    body: { appendChild() {} },
  } });
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({
    borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '0px', borderLeftWidth: '1px',
    borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'none', borderLeftStyle: 'solid',
    fontStyle: 'normal', fontWeight: '400', fontSize: '16px', fontFamily: 'Arial', lineHeight: '20px',
    paddingLeft: '12px', paddingRight: '12px',
  }) });
  try {
    await exportTablePng(container, 'Banana / Bread', { background: '#112233', border: '#445566', text: '#778899' });
    assert.equal(canvas.width, 240);
    assert.equal(canvas.height, 160);
    assert.equal(fills[0].color, '#112233');
    assert.equal(fills.filter(fill => fill.color === '#445566').length, 3);
    assert.deepEqual(texts, [{ text: 'Mash bananas', color: '#778899' }]);
    assert.deepEqual(queries, ['td, table', '[data-export-text]']);
    assert.equal(link.download, 'Banana  Bread.png');
    assert.ok(downloaded);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
    if (previousStyle) Object.defineProperty(globalThis, 'getComputedStyle', previousStyle);
    else delete globalThis.getComputedStyle;
  }
});
