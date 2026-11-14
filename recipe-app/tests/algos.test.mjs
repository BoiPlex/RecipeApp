import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Load the pure TypeScript utility without requiring a Next.js runtime.
const source = readFileSync(new URL('../src/lib/algos.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
});
const loaded = { exports: {} };
new Function('exports', 'module', compiled.outputText)(loaded.exports, loaded);
const { adjListToTable, largestLabelRegions, RecipeToAdjList, recipeDisplayLayout } = loaded.exports;

test('finishing steps move below only above seven step columns, excluding ingredients', () => {
  const ingredients = { a: { label: 'A' }, b: { label: 'B' } };
  const steps = {
    first: { label: 'First', reqs: { ingredientIds: ['a'] } },
    second: { label: 'Second', reqs: { ingredientIds: ['b'] } },
    combine: { label: 'Combine', reqs: { stepIds: ['first', 'second'] } },
  };
  let previous = 'combine';
  for (let index = 0; index < 5; index++) {
    steps[`finish${index}`] = { label: `Finish ${index}`, reqs: { stepIds: [previous] } };
    previous = `finish${index}`;
  }
  assert.equal(Object.keys(steps).length, 8);
  assert.equal(recipeDisplayLayout({ ingredients, steps }).columnCount, 8);
  assert.deepEqual(recipeDisplayLayout({ ingredients, steps }).footerStepIds, []);
  steps.last = { label: 'Last', reqs: { stepIds: [previous] } };
  const recipe = { ingredients, steps };
  const original = JSON.stringify(recipe);
  const display = recipeDisplayLayout(recipe);
  assert.deepEqual(display.footerStepIds, ['finish0', 'finish1', 'finish2', 'finish3', 'finish4', 'last']);
  assert.equal(display.columnCount, 3);
  assert.ok(display.grid.every(row => row.at(-1) === 'combine'));
  assert.equal(display.rowIds.length, 2);
  assert.ok(display.grid.every(row => row.every(id => !display.footerStepIds.includes(id))));
  assert.equal(JSON.stringify(recipe), original);
});

test('parallel steps remain in the grid when no finishing step covers every ingredient row', () => {
  const ingredients = { a: { label: 'A' }, b: { label: 'B' } };
  const steps = {};
  for (let index = 0; index < 8; index++) steps[`step${index}`] = {
    label: `Step ${index}`, reqs: index < 2 ? { ingredientIds: [index ? 'b' : 'a'] } : { stepIds: [`step${index - 2}`] },
  };
  assert.deepEqual(recipeDisplayLayout({ ingredients, steps }).footerStepIds, []);
});

test('a late full-height merge stays in the grid even when it exceeds seven columns', () => {
  const ingredients = { a: { label: 'A' }, b: { label: 'B' } };
  const steps = {};
  for (let index = 0; index < 8; index++) steps[`left${index}`] = {
    label: `Left ${index}`, reqs: index ? { stepIds: [`left${index - 1}`] } : { ingredientIds: ['a'] },
  };
  steps.right = { label: 'Right', reqs: { ingredientIds: ['b'] } };
  steps.merge = { label: 'Merge', reqs: { stepIds: ['left7', 'right'] } };
  const display = recipeDisplayLayout({ ingredients, steps });
  assert.deepEqual(display.footerStepIds, []);
  assert.equal(display.columnCount, 10);
  steps.after = { label: 'After merge', reqs: { stepIds: ['merge'] } };
  assert.deepEqual(recipeDisplayLayout({ ingredients, steps }).footerStepIds, ['after']);
});

test('label rectangle maximizes area across the underlying cell partitions', () => {
  const grid = Array.from({ length: 10 }, (_, row) =>
    [row >= 4 ? 'fold' : null, 'fold']);
  assert.deepEqual(largestLabelRegions(grid), [
    { id: 'fold', row: 4, col: 0, rowSpan: 6, colSpan: 2, showLabel: true },
  ]);
});

test('largest rectangle prefers area over width and handles separate owners', () => {
  const grid = [
    ['a', 'a', 'a', 'a', 'b'],
    ['a', 'a', null, null, 'b'],
    ['a', 'a', null, null, 'b'],
  ];
  const regions = largestLabelRegions(grid);
  assert.deepEqual(regions.find(cell => cell.id === 'a'),
    { id: 'a', row: 0, col: 0, rowSpan: 3, colSpan: 2, showLabel: true });
  assert.equal(regions.find(cell => cell.id === 'b').rowSpan, 3);
  assert.deepEqual(largestLabelRegions([]), []);
});

test('pouring-step labels use the largest rendered rectangle instead of the most grid cells', () => {
  // Brownie-style pouring region: a wide upper arm and a narrow vertical arm.
  const grid = [
    [null, null, 'pour', 'pour'], [null, null, 'pour', 'pour'],
    [null, null, null, 'pour'], [null, null, null, 'pour'],
    [null, null, null, 'pour'], [null, null, null, 'pour'],
  ];
  const logical = largestLabelRegions(grid)[0];
  assert.equal(logical.colSpan, 1);
  assert.equal(logical.rowSpan, 6);
  const measured = largestLabelRegions(grid, {
    columnWidths: [100, 80, 180, 40], rowHeights: [120, 120, 40, 40, 40, 40],
  })[0];
  assert.deepEqual(measured, { id: 'pour', row: 0, col: 2, rowSpan: 2, colSpan: 2, showLabel: true });
  assert.deepEqual(largestLabelRegions(grid, { columnWidths: [1, 1, 1, 1], rowHeights: [1, 1, 1, 1, 1, 1] }), largestLabelRegions(grid));
});

test('recipe inputs become contiguous rows and irregular merge regions', () => {
  const recipe = {
    ingredients: { bananas: {}, butter: {}, eggs: {}, vanilla: {} },
    steps: {
      mash: { reqs: { ingredientIds: ['bananas'] } },
      melt: { reqs: { ingredientIds: ['butter'] } },
      beat: { reqs: { ingredientIds: ['eggs'] } },
      smooth: { reqs: { stepIds: ['mash', 'melt', 'beat'], ingredientIds: ['vanilla'] } },
    },
  };
  const layout = adjListToTable(RecipeToAdjList(recipe));
  assert.deepEqual(layout.grid, [
    ['bananas', 'mash', 'smooth'],
    ['butter', 'melt', 'smooth'],
    ['eggs', 'beat', 'smooth'],
    ['vanilla', 'smooth', 'smooth'],
  ]);
  const reconstructed = layout.grid.map(() => Array(layout.columnCount).fill(null));
  const labels = [];
  for (const cell of layout.rows.flat()) {
    if (cell.showLabel) labels.push(cell.id);
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
        assert.equal(reconstructed[r][c], null, 'spans must not overlap');
        reconstructed[r][c] = cell.id;
      }
    }
  }
  assert.deepEqual(reconstructed, layout.grid);
  assert.equal(labels.length, Object.keys(RecipeToAdjList(recipe)).length);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(layout.rows.flat().find(cell => cell.id === 'smooth').rowSpan, 4);
});

test('handles dependency order, grouping, disconnected nodes, and trailing gaps', () => {
  const layout = adjListToTable({ final: ['mix', 'b'], b: [], a: [], mix: ['a'], lone: [] });
  assert.deepEqual(layout.rowIds, ['a', 'b', 'lone']);
  assert.deepEqual(layout.grid, [['a', 'mix', 'final'], ['b', 'final', 'final'], ['lone', null, null]]);
});

test('empty graph produces an empty layout', () => {
  assert.deepEqual(adjListToTable({}), { rowIds: [], columnCount: 0, grid: [], rows: [] });
});

test('duplicate requirements count once', () => {
  assert.deepEqual(adjListToTable({ a: [], b: ['a', 'a'] }).grid, [['a', 'b']]);
});

test('rejects missing requirements and cycles', () => {
  assert.throws(() => adjListToTable({ a: ['missing'] }), /Unknown requirement/);
  assert.throws(() => adjListToTable({ a: ['b'], b: ['a'] }), /cycle/);
  assert.throws(() => adjListToTable({ a: ['a'] }), /cycle/);
});

test('shared requirements use separate columns without duplicating ingredient rows', () => {
  const layout = adjListToTable({ a: [], b: ['a'], c: ['a'], d: ['b', 'c'] });
  assert.deepEqual(layout.grid, [['a', 'b', 'c', 'd']]);
  assert.deepEqual(layout.rowIds, ['a']);
  assert.equal(layout.rows.flat().filter(cell => cell.showLabel).length, 4);
});

test('shorter terminal operations fill the rest of their rows', () => {
  const layout = adjListToTable({ a: [], b: [], mix: ['a'], bake: ['mix'], chop: ['b'] }, ['a', 'b']);
  const choppedRow = layout.grid[layout.rowIds.indexOf('b')];
  assert.deepEqual(choppedRow, ['b', 'chop', 'chop']);
});

test('steps without requirements occupy bottom rows without duplicating ingredients', () => {
  const layout = adjListToTable({ a: [], b: [], mix: ['a'], loose: [] }, ['a', 'b']);
  assert.equal(layout.rowIds.length, 3);
  assert.equal(new Set(layout.rowIds).size, 3);
  assert.equal(layout.rowIds.at(-1), 'loose');
  assert.ok(layout.grid.at(-1).every(id => id === 'loose'));
  assert.ok(layout.rows.flat().some(cell => cell.id === 'loose' && cell.showLabel));
  const withRequirements = adjListToTable({ a: [], b: [], mix: ['a'], loose: ['mix', 'a'] }, ['a', 'b']);
  assert.equal(withRequirements.rowIds.length, 2);
  const onlySteps = adjListToTable({ first: [], second: ['first'] }, []);
  assert.equal(onlySteps.grid.length, 1);
  assert.deepEqual(onlySteps.grid[0], ['first', 'second']);
});

test('IDs matching object prototype properties remain valid', () => {
  assert.deepEqual(adjListToTable({ toString: [], final: ['toString'] }).grid, [['toString', 'final']]);
});
