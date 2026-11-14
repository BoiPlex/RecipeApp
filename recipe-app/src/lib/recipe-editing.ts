import type { Recipe, Step } from "@/lib/types";
import { adjListToTable, RecipeToAdjList } from "@/lib/algos";

export function removeRecipeItem(recipe: Recipe, kind: "ingredients" | "steps" | "prepSteps", id: string): Recipe {
	const items: Record<string, Step> = { ...recipe[kind] };
	delete items[id];
	return cleanReferences({ ...recipe, [kind]: items });
}

export function movePrepStep(recipe: Recipe, id: string, direction: number): Recipe {
	const entries = Object.entries(recipe.prepSteps ?? {});
	const index = entries.findIndex(([key]) => key === id);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= entries.length) return recipe;
	[entries[index], entries[target]] = [entries[target], entries[index]];
	return { ...recipe, prepSteps: Object.fromEntries(entries) };
}

/** A new operation consumes the available outputs, placing it to the right. */
export function appendStep(recipe: Recipe, id: string): Recipe {
	const usedIngredients = new Set(Object.values(recipe.steps).flatMap((step) => step.reqs?.ingredientIds ?? []));
	const usedSteps = new Set(Object.values(recipe.steps).flatMap((step) => step.reqs?.stepIds ?? []));
	return {
		...recipe,
		steps: { ...recipe.steps, [id]: { label: "", reqs: {
			ingredientIds: Object.keys(recipe.ingredients).filter((key) => !usedIngredients.has(key)),
			stepIds: Object.keys(recipe.steps).filter((key) => !usedSteps.has(key)),
		} } },
	};
}

export function appendIngredientAndStep(recipe: Recipe, ingredientId: string, stepId: string): Recipe {
	const layout = adjListToTable(RecipeToAdjList(recipe), Object.keys(recipe.ingredients), recipe.rowOrder);
	const hasFullWidthStep = layout.grid.some((row) => {
		const id = row[0];
		return id !== null && Object.hasOwn(recipe.steps, id) && row.every((cell) => cell === id);
	});
	return {
		...recipe,
		...(hasFullWidthStep || recipe.rowOrder ? { rowOrder: [...layout.rowIds.filter(Boolean), ingredientId] } : {}),
		ingredients: { ...recipe.ingredients, [ingredientId]: { label: "" } },
		steps: { ...recipe.steps, [stepId]: { label: "", reqs: { ingredientIds: [ingredientId] } } },
	};
}

export function toggleRequirement(recipe: Recipe, stepId: string, inputId: string): Recipe | null {
	if (stepId === inputId || !Object.hasOwn(recipe.steps, stepId)) return null;
	const kind = Object.hasOwn(recipe.ingredients, inputId) ? "ingredientIds"
		: Object.hasOwn(recipe.steps, inputId) ? "stepIds" : null;
	if (!kind) return null;
	const step = recipe.steps[stepId];
	const inputs = step.reqs?.[kind] ?? [];
	const removing = inputs.includes(inputId);
	function coveredInputs(start: string): Set<string> {
		const pending = [start];
		const visited = new Set<string>();
		const covered = new Set<string>();
		while (pending.length) {
			const id = pending.pop()!;
			if (visited.has(id)) continue;
			visited.add(id);
			const reqs = recipe.steps[id]?.reqs;
			for (const ingredient of reqs?.ingredientIds ?? []) covered.add(ingredient);
			for (const dependency of reqs?.stepIds ?? []) {
				covered.add(dependency);
				pending.push(dependency);
			}
		}
		return covered;
	}
	if (!removing && (step.reqs?.stepIds ?? []).some(
		(selected) => coveredInputs(selected).has(inputId),
	)) return null;
	let reqs: Step["reqs"] = { ...step.reqs, [kind]: removing
		? inputs.filter((id) => id !== inputId) : [...inputs, inputId] };
	if (!removing && kind === "stepIds") {
		const covered = coveredInputs(inputId);
		reqs = {
			...reqs,
			stepIds: (reqs.stepIds ?? []).filter((id) => !covered.has(id)),
			ingredientIds: (reqs.ingredientIds ?? []).filter((id) => !covered.has(id)),
		};
	}
	const next = { ...recipe, steps: { ...recipe.steps, [stepId]: { ...step, reqs } } };
	try {
		adjListToTable(RecipeToAdjList(next));
		// Place the edited operation before unrelated competing consumers, so a
		// newly selected input is not separated from it by an old sibling branch.
		const ordered = new Set<string>();
		function visit(id: string) {
			if (ordered.has(id)) return;
			for (const req of next.steps[id].reqs?.stepIds ?? []) visit(req);
			ordered.add(id);
		}
		visit(stepId);
		for (const id of Object.keys(next.steps)) visit(id);
		return { ...next, steps: Object.fromEntries([...ordered].map((id) => [id, next.steps[id]])) };
	} catch {
		// Self references, missing inputs, and cycles are never applied.
		return null;
	}
}

export function cleanReferences(recipe: Recipe): Recipe {
	return {
		...recipe,
		steps: Object.fromEntries(Object.entries(recipe.steps).map(([id, step]) => [id, {
			...step,
			reqs: {
				ingredientIds: (step.reqs?.ingredientIds ?? []).filter((ref) => Object.hasOwn(recipe.ingredients, ref)),
				stepIds: (step.reqs?.stepIds ?? []).filter((ref) => ref !== id && Object.hasOwn(recipe.steps, ref)),
			},
		}])),
	};
}
