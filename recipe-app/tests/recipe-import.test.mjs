import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const loaded = { exports: {} };
  new Function('exports', 'require', 'module', 'fetch', outputText)(loaded.exports, id => imports[id] ?? require(id), loaded, globals.fetch ?? fetch);
  return loaded.exports;
}
const inference = load('../src/lib/recipe-inference.ts');
const extraction = load('../src/lib/recipe-extraction.ts', { '@/lib/recipe-inference': inference });
const textExtraction = load('../src/lib/recipe-text.ts', { '@/lib/recipe-inference': inference });

const algos = load('../src/lib/algos.tsx');
const metadata = {
  '@context': 'https://schema.org', '@type': ['Recipe'], name: 'Sugar &amp; Butter', recipeYield: '4 servings',
  recipeIngredient: ['6 Tbs. (90 mL) butter', '1/2 cup sugar'],
  recipeInstructions: [
    { '@type': 'HowToSection', name: 'Preparation', itemListElement: [
      { '@type': 'HowToStep', text: 'Preheat oven to 350°F.' },
      { '@type': 'HowToStep', text: 'Grease a loaf pan.' },
    ] },
    { '@type': 'HowToStep', text: 'Melt the butter.' },
    { '@type': 'HowToStep', text: 'Add the sugar.' },
    { '@type': 'HowToStep', text: 'Bake for 20 minutes.' },
  ],
};
const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@graph': [metadata] })}</script></head><body><p>Advertising that must not become an ingredient.</p></body></html>`;

test('Recipe JSON-LD extracts quantities, sections, preparation, and dependency IDs', () => {
  const result = extraction.extractRecipeHtml(html);
  assert.equal(result.method, 'structured-data');
  assert.equal(result.recipe.title, 'Sugar & Butter');
  assert.equal(result.recipe.servings, '4 servings');
  assert.equal(Object.keys(result.recipe.prepSteps).length, 2);
  assert.deepEqual(Object.values(result.recipe.ingredients).map(item => item.label), metadata.recipeIngredient);
  assert.deepEqual(result.recipe.steps['step-1'].reqs, { ingredientIds: ['ingredient-1'], stepIds: [] });
  assert.deepEqual(result.recipe.steps['step-2'].reqs, { ingredientIds: ['ingredient-2'], stepIds: ['step-1'] });
  assert.deepEqual(result.recipe.steps['step-3'].reqs, { ingredientIds: [], stepIds: ['step-2'] });
  assert.ok(result.warnings.some(warning => warning.includes('previous instruction')));
  assert.doesNotThrow(() => algos.adjListToTable(algos.RecipeToAdjList(result.recipe), Object.keys(result.recipe.ingredients)));
});

test('HTML headings and lists work without structured data, including entities', () => {
  const result = extraction.extractRecipeHtml(`<h1>Simple &amp; Sweet</h1><h2>Ingredients</h2><ul><li>&frac12; cup sugar</li><li>2 <b>eggs</b></li></ul><h2>Directions</h2><ol><li>Beat eggs.</li><li>Add sugar.</li></ol>`);
  assert.equal(result.method, 'html');
  assert.equal(result.recipe.title, 'Simple & Sweet');
  assert.equal(result.recipe.ingredients['ingredient-1'].label, '½ cup sugar');
  assert.deepEqual(result.recipe.steps['step-2'].reqs, { ingredientIds: ['ingredient-1'], stepIds: ['step-1'] });
});

test('microdata, recipe-card classes, and malformed metadata fall back safely', () => {
  const result = extraction.extractRecipeHtml(`<script type="application/ld+json">{invalid}</script><h1>Butter</h1><div class="wprm-recipe-ingredient"><span>1 cup</span> butter</div><div itemprop="recipeInstructions"><p>Melt butter.</p><p>Cool.</p></div>`);
  assert.equal(Object.keys(result.recipe.ingredients).length, 1);
  assert.equal(Object.keys(result.recipe.steps).length, 2);
  assert.equal(result.recipe.ingredients['ingredient-1'].label, '1 cup butter');
  assert.equal(result.method, 'html');
});

test('ambiguous names and reserved portions produce review warnings', () => {
  const { recipe, warnings } = inference.inferRequirements('Milk', '', ['1 cup almond milk', '1 cup coconut milk'], ['Heat the milk.', 'Reserve half of the mixture.']);
  assert.ok(warnings.some(warning => warning.includes('multiple ingredients')));
  assert.ok(warnings.some(warning => warning.includes('reserved quantities')));
  assert.deepEqual(recipe.steps['step-1'].reqs.ingredientIds, []);
});

test('optional notes do not match instructions and divided ingredients keep mixtures independent', () => {
  const { recipe } = inference.inferRequirements('Parallel mixtures', '', [
    '1 cup flour', '1 teaspoon espresso powder (optional, skip if not using coffee)', '1 cup butter', '1 cup sugar, divided', '2 eggs', '1 teaspoon vanilla (optional, but recommended)',
  ], [
    'Sift the flour and espresso powder in a bowl.',
    'Melt butter with 1/2 cup sugar in a saucepan.',
    'Beat eggs, vanilla (if using), and remaining sugar in a bowl.',
    'Pour the butter mixture into the egg mixture.',
    'Add the dry ingredients to the batter.',
  ]);
  assert.deepEqual(recipe.steps['step-3'].reqs.stepIds, []);
  assert.ok(recipe.steps['step-3'].reqs.ingredientIds.includes('ingredient-4'));
  assert.deepEqual(recipe.steps['step-4'].reqs.stepIds, ['step-2', 'step-3']);
  assert.ok(recipe.steps['step-5'].reqs.stepIds.includes('step-1'));
  assert.ok(recipe.steps['step-5'].reqs.stepIds.includes('step-4'));
});

test('structured serving counts omit a redundant numeric-only value', () => {
  const result = extraction.extractRecipeHtml(`<script type="application/ld+json">${JSON.stringify({ ...metadata, recipeYield: ['1', '1 pan'] })}</script>`);
  assert.equal(result.recipe.servings, '1 pan');
});

test('unqualified sugar and powdered sugar are separate inputs and dry/wet mixes both connect', () => {
  const { recipe, warnings } = inference.inferRequirements('Sugar variants', '', [
    '1½ cups granulated sugar*', '½ cup powdered sugar (sifted)', '1 cup flour', '¼ cup cocoa powder', '2 eggs', '½ cup oil',
  ], [
    'Mix sugar with flour, cocoa powder, and powdered sugar.',
    'Beat eggs and oil in another bowl.',
    'Combine the dry mix and the wet mix.',
  ]);
  assert.ok(recipe.steps['step-1'].reqs.ingredientIds.includes('ingredient-1'));
  assert.ok(recipe.steps['step-1'].reqs.ingredientIds.includes('ingredient-2'));
  assert.deepEqual(recipe.steps['step-3'].reqs.stepIds, ['step-1', 'step-2']);
  assert.ok(!warnings.some(warning => warning.includes('No instruction matched')));
});

test('qualified sugar mentions do not pull in granulated sugar, and ambiguous variants stay unresolved', () => {
  const labels = ['1 cup granulated sugar', '1 cup powdered sugar'];
  const powdered = inference.inferRequirements('Powdered only', '', labels, ['Stir powdered sugar.']);
  assert.deepEqual(powdered.recipe.steps['step-1'].reqs.ingredientIds, ['ingredient-2']);
  const plain = inference.inferRequirements('Plain only', '', labels, ['Stir sugar.']);
  assert.deepEqual(plain.recipe.steps['step-1'].reqs.ingredientIds, ['ingredient-1']);
  const ambiguous = inference.inferRequirements('Ambiguous', '', ['1 cup brown sugar', '1 cup powdered sugar'], ['Stir sugar.']);
  assert.deepEqual(ambiguous.recipe.steps['step-1'].reqs.ingredientIds, []);
  assert.ok(ambiguous.warnings.some(warning => warning.includes('multiple ingredients')));
});

test('pages without a static recipe are rejected instead of inventing one', () => {
  assert.throws(() => extraction.extractRecipeHtml('<h1>Sign in</h1><script>window.recipe = {};</script>'), /No readable recipe/);
});

test('pasted text extracts title, servings, preparation, and multiline numbered instructions', () => {
  const result = textExtraction.extractRecipeText('Butter cake\nServings:4\n\nIngredients\n- 1 cup butter\n- 1 cup sugar\n\nPrep steps\n1. Grease the pan.\n\nInstructions\n1. Melt the butter\n   until fully melted.\n2. Add sugar.\n\nNotes\nStore in a tin.');
  assert.equal(result.method, 'text');
  assert.equal(result.recipe.title, 'Butter cake');
  assert.equal(result.recipe.servings, '4');
  assert.equal(Object.keys(result.recipe.prepSteps).length, 1);
  assert.equal(Object.keys(result.recipe.steps).length, 2);
  assert.equal(result.recipe.steps['step-1'].label, 'Melt the butter until fully melted.');
  assert.deepEqual(result.recipe.steps['step-2'].reqs, { ingredientIds: ['ingredient-2'], stepIds: ['step-1'] });
  assert.throws(() => textExtraction.extractRecipeText('Hello world'), /Ingredients section/);
});

test('pasted text accepts a title, quantity list, and numbered directions without headings', () => {
  const result = textExtraction.extractRecipeText('Butter cake\n1 cup butter\n1 cup sugar\n1. Melt butter.\n2. Add sugar.');
  assert.equal(Object.keys(result.recipe.ingredients).length, 2);
  assert.equal(Object.keys(result.recipe.steps).length, 2);
});

test('Link/Text tabs retain separate values and submit only the active input', async () => {
  const state = [];
  let cursor = 0;
  const calls = [];
  const imported = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return state[index] ??= { current: initial }; },
    useEffect() {},
  };
  const tabs = Object.fromEntries(['Tabs', 'TabsList', 'TabsTrigger', 'TabsContent'].map(name => [name, props => ({ type: name, props })]));
  const Component = load('../src/components/recipe-import.tsx', {
    react, '@/components/ui/tabs': tabs,
    '@/lib/recipe-text': { extractRecipeText(text) { calls.push({ text }); return textExtraction.extractRecipeText(text); } },
    '@/lib/recipe-extraction': extraction,
    '@/lib/fetch-recipe-page': { async fetchRecipePage(url) { calls.push({ url }); return { html, url }; } },
  }).default;
  function elements(tree) {
    if (Array.isArray(tree)) return tree.flatMap(elements);
    if (!tree || typeof tree !== 'object') return [];
    if (typeof tree.type === 'function') return elements(tree.type(tree.props));
    return [tree, ...elements(tree.props?.children)];
  }
  let nodes;
  const render = () => { cursor = 0; nodes = elements(Component({ onImported: recipe => imported.push(recipe) })); };
  render();
  nodes.find(el => el.props?.id === 'recipe-url').props.onChange({ target: { value: 'https://example.com/recipe' } });
  render();
  nodes.find(el => el.type === 'Tabs').props.onValueChange('text');
  render();
  assert.equal(nodes.find(el => el.props?.id === 'recipe-url').props.disabled, true);
  const area = nodes.find(el => el.props?.id === 'recipe-text');
  assert.match(area.props.className, /field-sizing-content/);
  area.props.onChange({ target: { value: 'Cake\nIngredients\n1 cup flour\nInstructions\nMix flour.' } });
  render();
  nodes.find(el => el.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  render();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].text.startsWith('Cake'));
  assert.equal(calls[0].url, undefined);
  assert.equal(imported.length, 1);
  nodes.find(el => el.type === 'Tabs').props.onValueChange('link');
  render();
  assert.equal(nodes.find(el => el.props?.id === 'recipe-url').props.value, 'https://example.com/recipe');
  nodes.find(el => el.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[1], { url: 'https://example.com/recipe' });
});

test('browser fetching uses CORS, omits credentials, and extracts the returned HTML', async () => {
  const controller = new AbortController();
  let calls = 0;
  const browser = load('../src/lib/fetch-recipe-page.ts', {}, { fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'https://example.com/recipe');
    assert.equal(options.mode, 'cors');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.signal, controller.signal);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } });
  const page = await browser.fetchRecipePage('https://example.com/recipe#ingredients', controller.signal);
  assert.equal(extraction.extractRecipeHtml(page.html).recipe.title, 'Sugar & Butter');
  assert.equal(calls, 1);
  for (const url of ['file:///recipe', 'javascript:alert(1)', 'https://user:pass@example.com', 'not a url']) {
    await assert.rejects(browser.fetchRecipePage(url), /valid HTTP/);
  }
  assert.equal(calls, 1);
});

test('browser fetching reports CORS failures with a text-import fallback and preserves cancellation', async () => {
  const controller = new AbortController();
  const failure = new TypeError('Failed to fetch');
  const browser = load('../src/lib/fetch-recipe-page.ts', {}, { fetch: async () => { throw failure; } });
  await assert.rejects(browser.fetchRecipePage('https://example.com'), /Text tab/);
  controller.abort();
  await assert.rejects(browser.fetchRecipePage('https://example.com', controller.signal), error => error === failure);
});

test('browser fetching rejects HTTP errors, non-HTML, and oversized declared or streamed pages', async () => {
  const cases = [
    [() => new Response('blocked', { status: 403 }), /HTTP 403/],
    [() => new Response('image', { headers: { 'Content-Type': 'image/png' } }), /not an HTML/],
    [() => new Response('huge', { headers: { 'Content-Type': 'text/html', 'Content-Length': String(3 * 1024 * 1024) } }), /too large/],
    [() => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'text/html' } }), /too large/],
  ];
  for (const [response, error] of cases) {
    const browser = load('../src/lib/fetch-recipe-page.ts', {}, { fetch: async () => response() });
    await assert.rejects(browser.fetchRecipePage('https://example.com'), error);
  }
});
