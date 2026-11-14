import type { Recipe } from "@/lib/types";

const ignored = new Set("a an the and or of to for with cup cups teaspoon teaspoons tsp tablespoon tablespoons tbsp tbs ounce ounces oz pound pounds lb lbs gram grams g kilogram kilograms kg ml milliliter milliliters liter liters l large small medium fresh ripe chopped diced sliced minced softened melted unsalted salted optional divided room temperature finely coarsely ground all purpose packed drained peeled grated shredded beaten cooked uncooked extra virgin plus more taste needed about at inch inches".split(" "));
const wet = new Set("egg milk cream butter oil water banana yogurt honey vanilla juice buttermilk syrup".split(" "));
const dry = new Set("flour sugar salt soda powder cocoa cinnamon oat yeast starch nut walnut".split(" "));
// An unqualified "sugar" normally means the recipe's plain/granulated sugar,
// while powdered/brown sugar must retain their distinguishing qualifiers.
const defaultModifiers: Record<string, Set<string>> = {
	sugar: new Set(["granulated", "white", "caster", "superfine", "cane"]),
};
function words(value: string): string[] {
	return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean)
		.map((word) => ({ leaves: "leaf", tomatoes: "tomato", potatoes: "potato", knives: "knife" }[word]
			?? (word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.endsWith("s") && !/(ss|us)$/.test(word) ? word.slice(0, -1) : word)));
}
export function inferRequirements(title: string, servings: string, ingredientLabels: string[], instructions: string[]): { recipe: Recipe; warnings: string[] } {
	const recipe: Recipe = { title, servings, ingredients: {}, prepSteps: {}, steps: {} };
	const warnings = new Set<string>();
	const ingredientWords = new Map<string, string[]>();
	const dividedIngredients = new Set<string>();
	ingredientLabels.forEach((label, index) => {
		const id = `ingredient-${index + 1}`;
		recipe.ingredients[id] = { label };
		// Parentheses often contain substitutions/optional notes, not ingredient
		// names; matching words such as "if" or "using" creates false inputs.
		ingredientWords.set(id, [...new Set(words(label.replace(/\([^)]*\)/g, " ")).filter((word) => !ignored.has(word)))]);
		if (/\b(?:divided|reserved)\b/i.test(label)) dividedIngredients.add(id);
	});
	const lastUse = new Map<string, string>();
	const contents = new Map<string, Set<string>>();
	let previous: string | undefined;
	for (const original of instructions) {
		const label = original.replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, "").trim();
		if (!label) continue;
		if (/\bpreheat\b/i.test(label) && !/\b(?:mix|stir|add|bake|combine)\b/i.test(label)
			|| /\b(?:grease|line|butter|flour|prepare)\b.{0,50}\b(?:pan|tin|tray|sheet|dish)\b/i.test(label) && !/\b(?:batter|dough|mixture|pour|transfer)\b/i.test(label)) {
			recipe.prepSteps![`prep-${Object.keys(recipe.prepSteps!).length + 1}`] = { label };
			continue;
		}
		const id = `step-${Object.keys(recipe.steps).length + 1}`;
		const instructionTokens = words(label);
		const instructionWords = new Set(instructionTokens);
		const ingredientInputs = new Set<string>();
		const stepInputs = new Set<string>();
		const matched = new Set<string>();
		for (const [ingredient, tokens] of ingredientWords) {
			if (tokens.length && tokens.every((token) => instructionWords.has(token))) matched.add(ingredient);
		}
		// Resolve each occurrence separately: "sugar ... powdered sugar" names
		// two inputs, even though both contain the same generic ingredient word.
		for (let index = 0; index < instructionTokens.length; index++) {
			const token = instructionTokens[index];
			if (ignored.has(token)) continue;
			const candidates = [...ingredientWords].filter(([, tokens]) => tokens.includes(token));
			if (candidates.length === 1) matched.add(candidates[0][0]);
			else if (candidates.length > 1) {
				const neighbors = [instructionTokens[index - 1], instructionTokens[index + 1]];
				const qualified = candidates.filter(([, tokens]) => tokens.some((word) => word !== token && neighbors.includes(word)));
				const plain = candidates.filter(([, tokens]) => tokens.every((word) => word === token || defaultModifiers[token]?.has(word)));
				if (qualified.length === 1) matched.add(qualified[0][0]);
				else if (!qualified.length && plain.length === 1) matched.add(plain[0][0]);
				else if (!candidates.some(([ingredient]) => matched.has(ingredient))) warnings.add(`“${label}”: “${token}” matches multiple ingredients; check its requirements.`);
			}
		}
		const namedGroup = /\b(wet|dry)\s+(?:ingredient|mixture|mix)(?:es|s)?\b/gi;
		let hasNamedGroup = false;
		for (const match of label.matchAll(namedGroup)) {
			hasNamedGroup = true;
			const group = match[1].toLowerCase() === "wet" ? wet : dry;
			for (const [ingredient, tokens] of ingredientWords) if (tokens.some((token) => group.has(token))) matched.add(ingredient);
		}
		for (const ingredient of matched) {
			const owner = lastUse.get(ingredient);
			const separatePortion = dividedIngredients.has(ingredient) && /\b(?:remaining|reserved|rest|half|third)\b|\d\s*\/\s*\d/i.test(label);
			if (owner && !separatePortion) stepInputs.add(owner);
			else ingredientInputs.add(ingredient);
		}
		const separate = /\b(?:another|separate|second|clean)\s+(?:bowl|pan|pot)|\bmeanwhile\b/i.test(label);
		const continuing = /\b(?:add|fold|pour|transfer|bake|roast|cook|cool|serve|refrigerate|chill|rest)\b/i.test(label)
			|| !hasNamedGroup && /\b(?:mixture|batter|dough|it|them)\b/i.test(label);
		if (previous && !separate && (continuing || !matched.size && !hasNamedGroup)) stepInputs.add(previous);
		if (previous && !separate && !matched.size && !hasNamedGroup) warnings.add(`“${label}”: requirements were inferred from the previous instruction; check mixture references.`);
		// If one input already includes another, keep the later operation only.
		for (const input of [...stepInputs]) {
			const pending = [...(recipe.steps[input].reqs?.stepIds ?? [])];
			const visited = new Set<string>();
			while (pending.length) {
				const dependency = pending.pop()!;
				if (visited.has(dependency)) continue;
				visited.add(dependency);
				stepInputs.delete(dependency);
				pending.push(...(recipe.steps[dependency].reqs?.stepIds ?? []));
			}
		}
		const usedIngredients = new Set(ingredientInputs);
		for (const input of stepInputs) for (const ingredient of contents.get(input) ?? []) {
			usedIngredients.add(ingredient);
			ingredientInputs.delete(ingredient);
		}
		if (!ingredientInputs.size && !stepInputs.size) warnings.add(`“${label}”: no requirements could be identified; select them in the table.`);
		if (/\b(?:remaining|reserve|reserved|divide|half|third)\b/i.test(label)) warnings.add(`“${label}”: check requirements for divided or reserved quantities.`);
		recipe.steps[id] = { label, reqs: { ingredientIds: [...ingredientInputs], stepIds: [...stepInputs] } };
		contents.set(id, usedIngredients);
		for (const ingredient of usedIngredients) lastUse.set(ingredient, id);
		previous = id;
	}
	for (const [id, ingredient] of Object.entries(recipe.ingredients)) {
		if (!lastUse.has(id)) warnings.add(`No instruction matched “${ingredient.label}”; check where it is used.`);
	}
	if (!Object.keys(recipe.steps).length && !Object.keys(recipe.prepSteps!).length) throw new Error("No recipe instructions were found.");
	return { recipe, warnings: [...warnings] };
}
