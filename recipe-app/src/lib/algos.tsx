import { Recipe } from "@/lib/types";

export type AdjList = Record<string, string[]>;

export type TableCell = {
	id: string;
	row: number;
	col: number;
	rowSpan: number;
	colSpan: number;
	/** Only one rectangle per node should render its label. */
	showLabel: boolean;
};

export type TableLayout = {
	rowIds: string[];
	columnCount: number;
	/** Repeated IDs describe visually joined regions; null is empty space. */
	grid: (string | null)[][];
	/** Rectangles starting in each row. Positions covered by spans are omitted. */
	rows: TableCell[][];
};

/** Largest contained rectangle per owner, using rendered dimensions when known. */
export function largestLabelRegions(grid: (string | null)[][], dimensions?: {
	rowHeights: readonly number[];
	columnWidths: readonly number[];
}): TableCell[] {
	const best = new Map<string, TableCell>();
	const bestAreas = new Map<string, number>();
	const rowOffsets = [0];
	const colOffsets = [0];
	for (let row = 0; row < grid.length; row++) rowOffsets.push(rowOffsets[row] + (dimensions?.rowHeights[row] ?? 1));
	for (let col = 0; col < (grid[0]?.length ?? 0); col++) colOffsets.push(colOffsets[col] + (dimensions?.columnWidths[col] ?? 1));
	for (let row = 0; row < grid.length; row++) {
		for (let col = 0; col < grid[row].length; col++) {
			const id = grid[row][col];
			if (id === null) continue;
			let width = grid[row].length - col;
			for (let bottom = row; bottom < grid.length; bottom++) {
				let run = 0;
				while (run < width && grid[bottom][col + run] === id) run++;
				width = run;
				if (width === 0) break;
				const height = bottom - row + 1;
				const area = (colOffsets[col + width] - colOffsets[col]) * (rowOffsets[bottom + 1] - rowOffsets[row]);
				if (!best.has(id) || area > bestAreas.get(id)!) {
					best.set(id, { id, row, col, rowSpan: height, colSpan: width, showLabel: true });
					bestAreas.set(id, area);
				}
			}
		}
	}
	return [...best.values()];
}

export function RecipeToAdjList(recipe: Recipe) {
	const adjList: AdjList = {};

	for (const ingrId of Object.keys(recipe.ingredients)) {
		adjList[ingrId] = [];
	}

	for (const [stepId, step] of Object.entries(recipe.steps)) {
		const reqs = [
			...(step.reqs?.stepIds ? step.reqs.stepIds : []),
			...(step.reqs?.ingredientIds ? step.reqs.ingredientIds : []),
		];
		adjList[stepId] = reqs;
	}

	return adjList;
}

/** Compact long recipes by moving the full-height finishing sequence below. */
export function recipeDisplayLayout(recipe: Recipe): TableLayout & { footerStepIds: string[] } {
	const full = adjListToTable(RecipeToAdjList(recipe), Object.keys(recipe.ingredients), recipe.rowOrder);
	const stepColumns = full.columnCount - (Object.keys(recipe.ingredients).length ? 1 : 0);
	if (stepColumns <= 7 || !full.grid.length) return { ...full, footerStepIds: [] };
	const ingredientRows = full.rowIds.map((id, row) => Object.hasOwn(recipe.ingredients, id) ? row : -1).filter((row) => row >= 0);
	const mainRows = ingredientRows;
	if (!mainRows.length) return { ...full, footerStepIds: [] };
	let mergeId: string | undefined;
	let mergeColumn = -1;
	for (let col = 1; col < full.columnCount; col++) {
		const id = full.grid[mainRows[0]][col];
		if (id !== null && Object.hasOwn(recipe.steps, id) && mainRows.every((row) => full.grid[row][col] === id)) {
			mergeId = id;
			mergeColumn = col;
			break;
		}
	}
	if (!mergeId) return { ...full, footerStepIds: [] };
	function followsMerge(id: string): boolean {
		const pending = [...(recipe.steps[id].reqs?.stepIds ?? [])];
		const seen = new Set<string>();
		while (pending.length) {
			const req = pending.pop()!;
			if (req === mergeId) return true;
			if (seen.has(req)) continue;
			seen.add(req);
			pending.push(...(recipe.steps[req].reqs?.stepIds ?? []));
		}
		return false;
	}
	const footer = new Set<string>();
	for (let col = full.columnCount - 1; col > mergeColumn; col--) {
		const id = full.grid[mainRows[0]][col];
		if (id === null || id === mergeId || !Object.hasOwn(recipe.steps, id) || !followsMerge(id) || !mainRows.every((row) => full.grid[row][col] === id)) break;
		footer.add(id);
	}
	// Keep any operation needed by a step still in the grid in the grid too.
	let changed = true;
	while (changed) {
		changed = false;
		for (const [id, step] of Object.entries(recipe.steps)) {
			if (footer.has(id)) continue;
			for (const req of step.reqs?.stepIds ?? []) if (footer.delete(req)) changed = true;
		}
	}
	if (!footer.size) return { ...full, footerStepIds: [] };
	const footerStepIds: string[] = [];
	const visited = new Set<string>();
	function visit(id: string) {
		if (visited.has(id)) return;
		visited.add(id);
		for (const req of recipe.steps[id].reqs?.stepIds ?? []) visit(req);
		if (footer.has(id)) footerStepIds.push(id);
	}
	for (const id of Object.keys(recipe.steps)) visit(id);
	const gridRecipe = { ...recipe, steps: Object.fromEntries(Object.entries(recipe.steps).filter(([id]) => !footer.has(id))) };
	const compact = adjListToTable(RecipeToAdjList(gridRecipe), Object.keys(recipe.ingredients), full.rowIds);
	return { ...compact, footerStepIds };
}

/**
 * Lay out an acyclic dependency graph from left to right.
 * Each ingredient owns one row; requirement-free steps occupy bottom rows.
 * Operations sharing rows use separate columns.
 * Pass ingredient IDs to distinguish ingredients from steps without inputs;
 * otherwise all nodes without requirements are treated as source rows.
 */
export function adjListToTable(adjList: AdjList, ingredientIds?: readonly string[], rowOrder?: readonly string[]): TableLayout {
	const ids = Object.keys(adjList);
	const requirements = new Map(
		ids.map((id) => [id, [...new Set(adjList[id])]]),
	);
	const indegree = new Map<string, number>();
	const consumers = new Map<string, string[]>();

	for (const [id, reqs] of requirements) {
		indegree.set(id, reqs.length);
		for (const reqId of reqs) {
			if (!requirements.has(reqId)) {
				throw new Error(`Unknown requirement "${reqId}" in "${id}".`);
			}
			const outputs = consumers.get(reqId) ?? [];
			outputs.push(id);
			consumers.set(reqId, outputs);
		}
	}

	// Kahn's algorithm: prerequisites precede their consumers.
	const topo = ids.filter((id) => indegree.get(id) === 0);
	const depth = new Map<string, number>(topo.map((id) => [id, 0]));
	for (let index = 0; index < topo.length; index++) {
		const id = topo[index];
		for (const next of consumers.get(id) ?? []) {
			depth.set(next, Math.max(depth.get(next) ?? 0, depth.get(id)! + 1));
			const remaining = indegree.get(next)! - 1;
			indegree.set(next, remaining);
			if (remaining === 0) topo.push(next);
		}
	}
	if (topo.length !== ids.length) {
		throw new Error("Recipe dependencies contain a cycle.");
	}

	const ingredientSet = ingredientIds ? new Set(ingredientIds) : null;
	const sourceIds = ids.filter((id) => requirements.get(id)!.length === 0);
	const sourceSet = new Set(sourceIds);
	const rowIds: string[] = [];
	const visited = new Set<string>();
	// Traverse inputs once, keeping groups adjacent without duplicating shared inputs.
	const stack = ids.filter((id) => !consumers.has(id))
		.sort((a, b) => depth.get(b)! - depth.get(a)!).reverse();
	while (stack.length > 0) {
		const id = stack.pop()!;
		if (visited.has(id)) continue;
		visited.add(id);
		const reqs = requirements.get(id)!;
		if (sourceSet.has(id)) rowIds.push(id);
		else for (let i = reqs.length - 1; i >= 0; i--) stack.push(reqs[i]);
	}
	// Requirement-free steps have their own rows below all ingredient rows.
	if (ingredientSet) rowIds.sort((a, b) => Number(!ingredientSet.has(a)) - Number(!ingredientSet.has(b)));
	if (rowOrder) {
		const ranks = new Map(rowOrder.map((id, index) => [id, index]));
		rowIds.sort((a, b) => (ranks.get(a) ?? Infinity) - (ranks.get(b) ?? Infinity));
	}
	// A recipe containing only steps still needs a body in which to edit them.
	if (!rowIds.length && ids.length) rowIds.push("");
	const rowSets = new Map<string, Set<number>>();
	const columns = new Map<string, number>();
	const occupied = rowIds.map(() => new Set<number>());
	rowIds.forEach((id, row) => {
		if (!sourceSet.has(id)) return;
		rowSets.set(id, new Set([row]));
		columns.set(id, 0);
		occupied[row].add(0);
	});
	const firstStepColumn = sourceIds.length ? 1 : 0;
	// Respect the recipe's operation order while placing dependencies first.
	const placementOrder: string[] = [];
	const placed = new Set<string>();
	function visit(id: string) {
		if (placed.has(id)) return;
		placed.add(id);
		for (const req of requirements.get(id)!) visit(req);
		placementOrder.push(id);
	}
	for (const id of ids) visit(id);
	for (const id of placementOrder) {
		if (sourceSet.has(id)) continue;
		const reqs = requirements.get(id)!;
		const affectedRows = reqs.length
			? new Set(reqs.flatMap((req) => [...rowSets.get(req)!]))
			: new Set(rowIds.map((_, row) => row));
		let col = reqs.reduce((max, req) => Math.max(max, columns.get(req)! + 1), firstStepColumn);
		while ([...affectedRows].some((row) => occupied[row].has(col))) col++;
		columns.set(id, col);
		rowSets.set(id, affectedRows);
		for (const row of affectedRows) occupied[row].add(col);
	}
	const columnCount = [...columns.values()].reduce((max, col) => Math.max(max, col + 1), 0);
	const grid = rowIds.map((source, rowIndex) => {
		const row: (string | null)[] = Array(columnCount).fill(null);
		let previousCol = -1;
		if (sourceSet.has(source)) { row[0] = source; previousCol = 0; }
		const operations = topo.filter((id) => !sourceSet.has(id) && rowSets.get(id)!.has(rowIndex))
			.sort((a, b) => columns.get(a)! - columns.get(b)!);
		for (const id of operations) {
			const col = columns.get(id)!;
			for (let c = previousCol + 1; c <= col; c++) row[c] = id;
			previousCol = col;
		}
		const terminal = operations[operations.length - 1] ?? (ingredientSet && !ingredientSet.has(source) ? source : undefined);
		if (terminal) {
			for (let col = previousCol; col < columnCount; col++) row[col] = terminal;
		}
		return row;
	});

	const covered = grid.map(() => Array<boolean>(columnCount).fill(false));
	const labeled = new Set<string>();
	const rows: TableCell[][] = grid.map(() => []);
	for (let row = 0; row < grid.length; row++) {
		for (let col = 0; col < columnCount; col++) {
			const id = grid[row][col];
			if (covered[row][col] || id === null) continue;
			let colSpan = 1;
			while (col + colSpan < columnCount && !covered[row][col + colSpan]
				&& grid[row][col + colSpan] === id) colSpan++;
			let rowSpan = 1;
			while (row + rowSpan < grid.length) {
				let matches = true;
				for (let c = col; c < col + colSpan; c++) {
					if (covered[row + rowSpan][c] || grid[row + rowSpan][c] !== id) {
						matches = false;
						break;
					}
				}
				if (!matches) break;
				rowSpan++;
			}
			for (let r = row; r < row + rowSpan; r++) {
				for (let c = col; c < col + colSpan; c++) covered[r][c] = true;
			}
			rows[row].push({ id, row, col, rowSpan, colSpan, showLabel: !labeled.has(id) });
			labeled.add(id);
		}
	}
	return { rowIds, columnCount, grid, rows };
}
