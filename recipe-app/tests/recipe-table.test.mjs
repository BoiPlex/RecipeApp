import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
  });
  const loaded = { exports: {} };
  new Function('exports', 'require', 'module', outputText)(loaded.exports, id => imports[id] ?? require(id), loaded);
  return loaded.exports;
}
const algos = load('../src/lib/algos.tsx');
const editing = load('../src/lib/recipe-editing.ts', { '@/lib/algos': algos });
const exporting = load('../src/lib/export-table.ts');
const { defaultRecipe } = load('../src/lib/default-recipe.ts');

test('requirements allow shared inputs while rejecting self-reference, cycles, and missing nodes', () => {
  assert.equal(editing.toggleRequirement(defaultRecipe, 'fold', 'fold'), null);
  assert.equal(editing.toggleRequirement(defaultRecipe, 'mash1', 'bake'), null);
  assert.equal(editing.toggleRequirement(defaultRecipe, 'fold', 'missing'), null);
  assert.equal(editing.toggleRequirement(defaultRecipe, 'fold', 'bananas'), null);
  const separate = { ...defaultRecipe, steps: { ...defaultRecipe.steps, extra: { label: 'Extra' } } };
  assert.ok(editing.toggleRequirement(separate, 'extra', 'bananas'));
  assert.equal(editing.toggleRequirement(defaultRecipe, 'fold', 'mash1'), null);
  const removed = editing.toggleRequirement(defaultRecipe, 'mash1', 'bananas');
  assert.deepEqual(removed.steps.mash1.reqs.ingredientIds, []);
  const restored = editing.toggleRequirement(removed, 'mash1', 'bananas');
  assert.deepEqual(restored.steps.mash1.reqs.ingredientIds, ['bananas']);
});

test('deletion cleans references, prep reorders, new ingredients append, and new steps extend the flow', () => {
  const removed = editing.removeRecipeItem(defaultRecipe, 'steps', 'mash1');
  assert.deepEqual(removed.steps.mash2.reqs.stepIds, ['melt', 'beat']);
  const withoutBananas = editing.removeRecipeItem(defaultRecipe, 'ingredients', 'bananas');
  assert.deepEqual(withoutBananas.steps.mash1.reqs.ingredientIds, []);
  assert.deepEqual(Object.keys(editing.movePrepStep(defaultRecipe, 'prep2', -1).prepSteps), ['prep2', 'prep1']);
  const withIngredient = { ...defaultRecipe, ingredients: { ...defaultRecipe.ingredients, extra: { label: '' } } };
  const layout = algos.adjListToTable(algos.RecipeToAdjList(withIngredient));
  assert.equal(layout.rowIds.at(-1), 'extra');
  const withStep = editing.appendStep(withIngredient, 'newStep');
  assert.deepEqual(withStep.steps.newStep.reqs, { ingredientIds: ['extra'], stepIds: ['coolOnRack'] });
  assert.equal(algos.adjListToTable(algos.RecipeToAdjList(withStep)).columnCount, 8);
});

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  if (typeof tree.type === 'function') return elements(tree.type(tree.props));
  return [tree, ...elements(tree.props?.children)];
}

// Exercise transactions and event handlers without adding a UI test dependency.
function tableHarness(initial = defaultRecipe) {
  const slots = [];
  let cursor = 0;
  let saved = initial;
  const updates = [];
  const react = {
    useState(initialValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef: () => ({ current: null }),
    useLayoutEffect: () => {},
  };
  const Table = load('../src/components/recipe-table.tsx', {
    react, '@/lib/algos': algos, '@/lib/recipe-editing': editing, '@/lib/export-table': exporting,
  }).default;
  let nodes;
  function render() {
    cursor = 0;
    nodes = elements(Table({ recipe: saved, onChange: recipe => { saved = recipe; updates.push(recipe); } }));
  }
  render();
  return {
    updates,
    get draft() { return slots[1]; },
    get selection() { return slots[2]; },
    get nodes() { return nodes; },
    button(label) { return nodes.find(el => el.type === 'button' && el.props['aria-label'] === label); },
    click(label) {
      const button = this.button(label);
      assert.ok(button, `button exists: ${label}`);
      button.props.onClick({ stopPropagation() {} }); render();
    },
    change(label, value) {
      const input = nodes.find(el => el.type === 'textarea' && el.props['aria-label'] === label);
      assert.ok(input, `textarea exists: ${label}`);
      input.props.onChange({ target: { value } }); render();
    },
    color(label, value) {
      const input = nodes.find(el => el.type === 'input' && el.props['aria-label'] === label);
      assert.ok(input, `color input exists: ${label}`);
      input.props.onChange({ target: { value } }); render();
    },
    select(id) {
      const region = nodes.find(el => el.props?.['data-label-region'] === id);
      assert.ok(region?.props.onClick, `selectable: ${id}`);
      region.props.onClick(); render();
    },
  };
}

test('the export container includes the caption and every step overlay', () => {
  const ui = tableHarness();
  const container = ui.nodes.find(el => el.type === 'div' && el.props.ref);
  assert.ok(container, 'table capture container exists');
  assert.match(container.props.className, /relative/);
  const captured = elements(container);
  const caption = captured.find(el => el.type === 'caption');
  assert.equal(caption.props.style.backgroundImage, exporting.headerBackground);
  assert.equal(caption.props.style.backgroundColor, '#ffffff');
  assert.equal(caption.props.style.printColorAdjust, 'exact');
  for (const [id, step] of Object.entries(defaultRecipe.steps)) {
    assert.ok(captured.some(el => el.props?.['data-label-region'] === id && el.props['data-export-text'] === step.label), `export includes ${id}`);
  }
});

test('main save/discard transact the whole recipe and preserve IDs on label edits', () => {
  const ui = tableHarness();
  ui.click('Edit recipe');
  ui.change('Recipe title', 'Changed');
  ui.change('Servings', '12');
  ui.change('Ingredient: 2 large (250 g) ripe bananas', '3 bananas');
  assert.deepEqual(ui.draft.steps.mash1.reqs.ingredientIds, ['bananas']);
  assert.equal(ui.updates.length, 0, 'draft never commits live');
  ui.click('Discard recipe changes');
  ui.click('Edit recipe');
  assert.equal(ui.draft.title, defaultRecipe.title);
  ui.change('Recipe title', 'Saved');
  ui.click('Save recipe');
  assert.equal(ui.updates.length, 1);
  assert.equal(ui.updates[0].title, 'Saved');
  assert.ok(ui.button('Edit recipe'));
});

test('requirements submode updates live, hides other controls, and can save or discard independently', () => {
  const ui = tableHarness();
  ui.click('Edit recipe');
  ui.change('Recipe title', 'Keep outer edit');
  ui.click('Edit requirements: Fold');
  assert.ok(!ui.button('Save recipe'));
  assert.ok(!ui.button('Discard recipe changes'));
  assert.ok(!ui.button('Add ingredient and step'));
  assert.ok(!ui.button('Delete step: Fold'));
  assert.equal(ui.nodes.filter(el => el.type === 'button').length, 2);
  assert.ok(ui.nodes.every(el => el.type !== 'textarea'));
  const invalid = ui.nodes.find(el => el.props?.['data-label-region'] === 'bake');
  assert.equal(invalid.props['aria-disabled'], true);
  assert.equal(invalid.props.onClick, undefined);
  const shared = ui.nodes.find(el => el.props?.['data-label-region'] === 'mash1');
  assert.equal(shared.props['aria-disabled'], true);
  ui.select('whisk');
  assert.deepEqual(ui.draft.steps.fold.reqs.stepIds, ['mash2']);
  ui.click('Undo requirement changes');
  assert.deepEqual(ui.draft.steps.fold.reqs.stepIds, ['mash2', 'whisk']);
  assert.equal(ui.draft.title, 'Keep outer edit');
  ui.click('Edit requirements: Fold');
  ui.select('whisk');
  ui.click('Apply requirements');
  assert.deepEqual(ui.draft.steps.fold.reqs.stepIds, ['mash2']);
  assert.equal(ui.updates.length, 0);
  ui.click('Save recipe');
  assert.deepEqual(ui.updates[0].steps.fold.reqs.stepIds, ['mash2']);
});

test('edge controls add blank cells with placeholders, delete items, and edit prep order', () => {
  const ui = tableHarness();
  ui.click('Edit recipe');
  const stepCount = Object.keys(ui.draft.steps).length;
  ui.click('Add ingredient and step');
  const newIngredient = Object.keys(ui.draft.ingredients).at(-1);
  assert.equal(Object.keys(ui.draft.steps).length, stepCount + 1);
  assert.deepEqual(Object.values(ui.draft.steps).at(-1).reqs, { ingredientIds: [newIngredient] });
  assert.equal(ui.draft.ingredients[newIngredient].label, '');
  assert.ok(ui.nodes.some(el => el.type === 'textarea' && el.props.placeholder === 'New ingredient' && el.props.value === ''));
  ui.click('Delete step: New step');
  ui.click('Delete ingredient: New ingredient');
  assert.ok(!ui.draft.ingredients[newIngredient]);
  ui.click('Add step');
  const addedStep = Object.values(ui.draft.steps).at(-1);
  assert.deepEqual(addedStep.reqs, { ingredientIds: [], stepIds: ['coolOnRack'] });
  assert.ok(ui.nodes.some(el => el.type === 'textarea' && el.props.placeholder === 'New step' && el.props.value === ''));
  ui.click('Delete step: New step');
  ui.click('Add prep step');
  assert.ok(ui.nodes.some(el => el.type === 'textarea' && el.props.placeholder === 'New prep step' && el.props.value === ''));
  ui.change('Prep step 3', 'Grease a tray');
  ui.click('Move prep step 3 up');
  assert.equal(Object.values(ui.draft.prepSteps)[1].label, 'Grease a tray');
  ui.click('Delete prep step 2');
  assert.equal(Object.keys(ui.draft.prepSteps).length, 2);
  for (const button of ui.nodes.filter(el => el.type === 'button')) assert.equal(button.props.title, undefined);
  for (const tooltip of ui.nodes.filter(el => el.props?.role === 'tooltip')) {
    assert.ok(!String(tooltip.props.children).includes(':'));
    assert.ok(!/\d/.test(String(tooltip.props.children)));
  }
});

test('empty recipes can add their first ingredient and first step', () => {
  const ui = tableHarness({ ingredients: {}, steps: {} });
  ui.click('Edit recipe');
  ui.click('Add ingredient and step');
  assert.equal(Object.keys(ui.draft.ingredients).length, 1);
  assert.equal(Object.keys(ui.draft.steps).length, 1);
  assert.doesNotThrow(() => algos.adjListToTable(algos.RecipeToAdjList(ui.draft)));
});

test('prep addition sits under the last prep row, falling back to the caption when empty', () => {
  const ui = tableHarness();
  ui.click('Edit recipe');
  const hasAdd = node => elements(node).some(el => el.type === 'button' && el.props['aria-label'] === 'Add prep step');
  assert.equal(hasAdd(ui.nodes.find(el => el.type === 'caption')), false);
  const prepCells = ui.nodes.filter(el => el.type === 'td' && elements(el).some(child => child.type === 'textarea' && /^Prep step/.test(child.props['aria-label'])));
  assert.equal(hasAdd(prepCells[0]), false);
  assert.equal(hasAdd(prepCells.at(-1)), true);
  ui.click('Delete prep step 1');
  ui.click('Delete prep step 1');
  assert.equal(hasAdd(ui.nodes.find(el => el.type === 'caption')), true);
  assert.equal(ui.nodes.filter(el => el.type === 'button' && el.props['aria-label'] === 'Add prep step').length, 1);
});

test('ingredient text has one visible copy during requirements selection', () => {
  const ui = tableHarness();
  ui.click('Edit recipe');
  ui.click('Edit requirements: Fold');
  const label = defaultRecipe.ingredients.bananas.label;
  const copies = ui.nodes.filter(el => el.type === 'span' && el.props.children === label);
  const visible = copies.filter(el => el.props['aria-hidden'] !== true && !/invisible|sr-only/.test(el.props.className ?? ''));
  assert.equal(visible.length, 1);
  ui.select('mash2');
  ui.select('mash1');
  assert.ok(ui.draft.steps.fold.reqs.stepIds.includes('mash1'));
  ui.click('Undo requirement changes');
  assert.deepEqual(ui.draft.steps.fold.reqs, defaultRecipe.steps.fold.reqs);
});

test('editing shared requirements keeps exactly one row per ingredient', () => {
  const ui = tableHarness();
  const rowCount = () => ui.nodes.filter(el => el.type === 'tr' && el.props['data-grid-row'] !== undefined).length;
  ui.click('Edit recipe');
  assert.equal(rowCount(), 10);
  ui.click('Edit requirements: Fold');
  ui.select('mash2');
  ui.select('mash1');
  assert.equal(rowCount(), 10);
  ui.select('butter');
  assert.equal(rowCount(), 10);
  ui.select('whisk');
  assert.equal(rowCount(), 10);
  ui.click('Undo requirement changes');
  assert.equal(rowCount(), 10);
});

test('steps with no requirements can select ingredients and steps, then save or discard', () => {
  const ui = tableHarness({
    ingredients: { a: { label: 'A' }, b: { label: 'B' } },
    steps: { mix: { label: 'Mix', reqs: { ingredientIds: ['a'] } }, loose: { label: 'Loose' } },
  });
  const rowCount = () => ui.nodes.filter(el => el.type === 'tr' && el.props['data-grid-row'] !== undefined).length;
  ui.click('Edit recipe');
  ui.click('Edit requirements: Loose');
  assert.equal(rowCount(), 3);
  ui.select('a');
  ui.select('mix');
  assert.deepEqual(ui.draft.steps.loose.reqs, { ingredientIds: [], stepIds: ['mix'] });
  assert.equal(rowCount(), 2);
  ui.click('Undo requirement changes');
  assert.equal(ui.draft.steps.loose.reqs, undefined);
  ui.click('Edit requirements: Loose');
  ui.select('mix');
  ui.click('Apply requirements');
  ui.click('Save recipe');
  assert.deepEqual(ui.updates[0].steps.loose.reqs.stepIds, ['mix']);
});

test('covered prerequisites are disabled and later steps replace selected earlier steps', () => {
  const base = {
    ingredients: { a: { label: 'A' } },
    steps: {
      first: { label: 'First', reqs: { ingredientIds: ['a'] } },
      middle: { label: 'Middle', reqs: { stepIds: ['first'] } },
      last: { label: 'Last', reqs: { stepIds: ['middle'] } },
      target: { label: 'Target', reqs: { stepIds: ['last'] } },
    },
  };
  assert.equal(editing.toggleRequirement(base, 'target', 'first'), null);
  assert.equal(editing.toggleRequirement(base, 'target', 'middle'), null);
  const unselected = editing.toggleRequirement(base, 'target', 'last');
  const withFirst = editing.toggleRequirement(unselected, 'target', 'first');
  const withLast = editing.toggleRequirement(withFirst, 'target', 'last');
  assert.deepEqual(withLast.steps.target.reqs.stepIds, ['last']);
  const redundant = { ...base, steps: { ...base.steps, target: { ...base.steps.target, reqs: { stepIds: ['first', 'last'] } } } };
  assert.ok(editing.toggleRequirement(redundant, 'target', 'first'));
});

test('selecting a sandwiched step places the edited operation immediately after it and discard restores order', () => {
  const base = {
    ingredients: { a: { label: 'A' } },
    steps: {
      first: { label: 'First', reqs: { ingredientIds: ['a'] } },
      middle: { label: 'Middle', reqs: { stepIds: ['first'] } },
      last: { label: 'Last', reqs: { stepIds: ['middle'] } },
      target: { label: 'Target', reqs: { stepIds: ['last'] } },
    },
  };
  const ui = tableHarness(base);
  ui.click('Edit recipe');
  ui.click('Edit requirements: Target');
  ui.select('last');
  let layout = algos.adjListToTable(algos.RecipeToAdjList(ui.draft), ['a']);
  assert.equal(layout.rowIds.at(-1), 'target');
  ui.select('middle');
  layout = algos.adjListToTable(algos.RecipeToAdjList(ui.draft), ['a']);
  assert.deepEqual(layout.grid, [['a', 'first', 'middle', 'target', 'last']]);
  assert.deepEqual(ui.draft.steps.target.reqs.stepIds, ['middle']);
  ui.click('Undo requirement changes');
  assert.deepEqual(Object.keys(ui.draft.steps), Object.keys(base.steps));
  assert.deepEqual(ui.draft.steps.target.reqs.stepIds, ['last']);
  ui.click('Edit requirements: Target');
  ui.select('last');
  ui.select('middle');
  ui.click('Apply requirements');
  ui.click('Save recipe');
  layout = algos.adjListToTable(algos.RecipeToAdjList(ui.updates[0]), ['a']);
  assert.deepEqual(layout.grid[0], ['a', 'first', 'middle', 'target', 'last']);
});

test('later requirements replace all covered step and ingredient selections while preserving unrelated inputs', () => {
  const recipe = {
    ingredients: { a: { label: 'A' }, b: { label: 'B' }, c: { label: 'C' } },
    steps: {
      first: { label: 'First', reqs: { ingredientIds: ['a'] } },
      second: { label: 'Second', reqs: { ingredientIds: ['b'] } },
      combined: { label: 'Combined', reqs: { stepIds: ['first', 'second'] } },
      later: { label: 'Later', reqs: { stepIds: ['combined'] } },
      target: { label: 'Target', reqs: { stepIds: ['first', 'second'], ingredientIds: ['a', 'c'] } },
    },
  };
  const ui = tableHarness(recipe);
  ui.click('Edit recipe');
  ui.click('Edit requirements: Target');
  ui.select('later');
  assert.deepEqual(ui.draft.steps.target.reqs, { stepIds: ['later'], ingredientIds: ['c'] });
  const earlier = ui.nodes.find(el => el.props?.['data-label-region'] === 'first');
  assert.equal(earlier.props['aria-disabled'], true);
  ui.click('Undo requirement changes');
  assert.deepEqual(ui.draft, recipe);
  ui.click('Edit requirements: Target');
  ui.select('later');
  ui.click('Apply requirements');
  ui.click('Save recipe');
  assert.deepEqual(ui.updates[0].steps.target.reqs, { stepIds: ['later'], ingredientIds: ['c'] });
});

test('requirement choices are green, selected requirements red, and unavailable cells gray', () => {
  const ui = tableHarness();
  ui.click('Edit recipe');
  ui.click('Edit requirements: Fold');
  ui.select('mash2');
  const cellWithLabel = label => ui.nodes.find(el => el.type === 'td' && elements(el).some(child => child.type === 'span' && child.props.children === label));
  assert.match(cellWithLabel('Mash').props.className, /bg-green-100/);
  assert.match(cellWithLabel('Whisk').props.className, /bg-red-100/);
  assert.match(cellWithLabel(defaultRecipe.steps.bake.label).props.className, /bg-slate-100/);
  ui.select('mash1');
  assert.match(cellWithLabel('Mash').props.className, /bg-red-100/);
  const selected = ui.nodes.find(el => el.props?.['data-label-region'] === 'mash1');
  assert.equal(selected.props['aria-pressed'], true);
});

test('ingredient and linked step append below existing full-width steps and retain their position after save', () => {
  const ui = tableHarness({
    ingredients: { a: { label: 'A' } },
    steps: { mix: { label: 'Mix', reqs: { ingredientIds: ['a'] } }, loose: { label: 'Loose' } },
  });
  ui.click('Edit recipe');
  ui.click('Add ingredient and step');
  const addedIngredient = Object.keys(ui.draft.ingredients).at(-1);
  const addedStep = Object.keys(ui.draft.steps).at(-1);
  let layout = algos.adjListToTable(algos.RecipeToAdjList(ui.draft), Object.keys(ui.draft.ingredients), ui.draft.rowOrder);
  assert.deepEqual(layout.rowIds, ['a', 'loose', addedIngredient]);
  assert.equal(layout.grid.at(-1)[0], addedIngredient);
  assert.ok(layout.grid.at(-1).slice(1).every(id => id === addedStep));
  ui.click('Save recipe');
  const saved = ui.updates[0];
  layout = algos.adjListToTable(algos.RecipeToAdjList(saved), Object.keys(saved.ingredients), saved.rowOrder);
  assert.deepEqual(layout.rowIds, ['a', 'loose', addedIngredient]);
  ui.click('Edit recipe');
  ui.click('Add ingredient and step');
  const secondIngredient = Object.keys(ui.draft.ingredients).at(-1);
  layout = algos.adjListToTable(algos.RecipeToAdjList(ui.draft), Object.keys(ui.draft.ingredients), ui.draft.rowOrder);
  assert.deepEqual(layout.rowIds, ['a', 'loose', addedIngredient, secondIngredient]);
});

test('single right add-step button consumes all available recipe outputs', () => {
  const ui = tableHarness({
    ingredients: { a: { label: 'A' }, b: { label: 'B' } },
    steps: { first: { label: 'First', reqs: { ingredientIds: ['a'] } }, second: { label: 'Second', reqs: { ingredientIds: ['b'] } } },
  });
  ui.click('Edit recipe');
  assert.equal(ui.nodes.filter(el => el.type === 'button' && el.props['aria-label'] === 'Add step').length, 1);
  ui.click('Add step');
  const added = Object.values(ui.draft.steps).at(-1);
  assert.deepEqual(added.reqs, { ingredientIds: [], stepIds: ['first', 'second'] });
  ui.click('Edit requirements: New step');
  assert.ok(!ui.button('Add step'));
});

test('colors and PNG export are available outside editing and colors survive discard', () => {
  const ui = tableHarness();
  assert.ok(ui.button('Export table as PNG'));
  ui.color('Background color', '#112233');
  ui.color('Border color', '#445566');
  ui.color('Text color', '#778899');
  const styles = () => ui.nodes.find(el => el.props?.style?.['--recipe-bg'])?.props.style;
  assert.deepEqual(styles(), { '--recipe-bg': '#112233', '--recipe-border': '#445566', '--recipe-text': '#778899' });
  ui.click('Edit recipe');
  ui.change('Recipe title', 'Discard this');
  ui.click('Discard recipe changes');
  assert.equal(styles()['--recipe-bg'], '#112233');
  assert.equal(ui.updates.length, 0);
});

test('full-height finishing steps render as editable full-width footer rows', () => {
  const recipe = { ...defaultRecipe, steps: { ...defaultRecipe.steps,
    extra1: { label: 'Finish one', reqs: { stepIds: ['coolOnRack'] } },
    extra2: { label: 'Finish two', reqs: { stepIds: ['extra1'] } },
  } };
  const ui = tableHarness(recipe);
  const display = algos.recipeDisplayLayout(recipe);
  assert.ok(display.footerStepIds.length > 0);
  const cells = ui.nodes.filter(el => el.type === 'td' && el.props['data-footer-step']);
  assert.deepEqual(cells.map(el => el.props['data-footer-step']), display.footerStepIds);
  assert.ok(cells.every(el => el.props.colSpan === display.columnCount));
  for (const id of display.footerStepIds) {
    const region = ui.nodes.find(el => el.props?.['data-label-region'] === id);
    assert.equal(region.props['data-export-text'], recipe.steps[id].label);
  }
  const id = display.footerStepIds.at(-1);
  const original = recipe.steps[id].label;
  ui.click('Edit recipe');
  ui.change(`Step: ${original}`, 'Updated footer');
  assert.equal(ui.draft.steps[id].label, 'Updated footer');
  assert.ok(ui.button('Delete step: Updated footer'));
  ui.click('Edit requirements: Updated footer');
  assert.ok(ui.nodes.find(el => el.props?.['data-label-region'] === id));
  assert.ok(ui.button('Apply requirements'));
  ui.click('Undo requirement changes');
  ui.click('Discard recipe changes');
});
