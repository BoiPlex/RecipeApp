"use client";

import {
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import type { Recipe } from "@/lib/types";
import {
	largestLabelRegions,
	recipeDisplayLayout,
	type TableCell,
} from "@/lib/algos";
import {
	appendIngredientAndStep,
	appendStep,
	movePrepStep,
	removeRecipeItem,
	toggleRequirement,
} from "@/lib/recipe-editing";

import { exportTablePng, headerBackground, type TableColors } from "@/lib/export-table";

type Box = { left: number; top: number; width: number; height: number };
type RequirementEdit = { id: string; original: Recipe };

function Action({
	label,
	tooltip = label,
	children,
	onClick,
	disabled = false,
	className = "",
}: {
	label: string;
	tooltip?: string;
	children: ReactNode;
	onClick: () => void;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			className={`group/action relative inline-flex min-h-7 min-w-7 items-center justify-center rounded border border-slate-400 bg-white px-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
		>
			{children}
			<span
				role="tooltip"
				className="pointer-events-none absolute top-full left-1/2 z-50 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white group-hover/action:block group-focus-visible/action:block"
			>
				{tooltip}
			</span>
		</button>
	);
}

/** Split only where partial borders require it; labels use independent regions. */
function borderCells(
	grid: (string | null)[][],
	rows: TableCell[][],
	columnCount: number,
) {
	const result: TableCell[][] = grid.map(() => []);
	for (const cell of rows.flat()) {
		const { id, row, col, rowSpan, colSpan } = cell;
		const left = Array.from(
			{ length: rowSpan },
			(_, offset) => grid[row + offset]?.[col - 1] === id,
		);
		const right = Array.from(
			{ length: rowSpan },
			(_, offset) => grid[row + offset]?.[col + colSpan] === id,
		);
		const top = Array.from(
			{ length: colSpan },
			(_, offset) => grid[row - 1]?.[col + offset] === id,
		);
		const bottom = Array.from(
			{ length: colSpan },
			(_, offset) => grid[row + rowSpan]?.[col + offset] === id,
		);
		const partial = [left, right, top, bottom].some(
			(edge) => edge.some(Boolean) && !edge.every(Boolean),
		);
		if (!partial) {
			result[row].push(cell);
			continue;
		}
		if (colSpan === 1) {
			let start = 0;
			while (start < rowSpan) {
				let end = start + 1;
				while (
					end < rowSpan &&
					left[end] === left[start] &&
					right[end] === right[start]
				)
					end++;
				result[row + start].push({
					...cell,
					row: row + start,
					rowSpan: end - start,
					showLabel: cell.showLabel && start === 0,
				});
				start = end;
			}
		} else {
			for (let r = row; r < row + rowSpan; r++) {
				for (let c = col; c < col + colSpan; c++) {
					result[r].push({
						id,
						row: r,
						col: c,
						rowSpan: 1,
						colSpan: 1,
						showLabel: cell.showLabel && r === row && c === col,
					});
				}
			}
		}
	}
	grid.forEach((row, r) =>
		row.forEach((id, col) => {
			if (id === null)
				result[r].push({
					id: "",
					row: r,
					col,
					rowSpan: 1,
					colSpan: 1,
					showLabel: false,
				});
		}),
	);
	if (!result.length)
		result.push([
			{
				id: "",
				row: 0,
				col: 0,
				rowSpan: 1,
				colSpan: Math.max(1, columnCount),
				showLabel: false,
			},
		]);
	return result.map((row) => row.sort((a, b) => a.col - b.col));
}

export default function RecipeTable({
	recipe: savedRecipe,
	onChange,
}: {
	recipe: Recipe;
	onChange: (recipe: Recipe) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(savedRecipe);
	const [requirementEdit, setRequirementEdit] =
		useState<RequirementEdit | null>(null);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [geometry, setGeometry] = useState<{
		labels: Record<string, Box>;
		body: Box | null;
	}>({ labels: {}, body: null });
	const [colors, setColors] = useState<TableColors>({
		background: "#ffffff",
		border: "#16a34a",
		text: "#0f172a",
	});
	const [exporting, setExporting] = useState(false);
	const [exportError, setExportError] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);
	const recipe = editing ? draft : savedRecipe;
	const { grid, rows, columnCount, footerStepIds } =
		recipeDisplayLayout(recipe);
	const regions = [
		...largestLabelRegions(grid),
		...footerStepIds.map((id) => ({
			id,
			row: -1,
			col: 0,
			rowSpan: 1,
			colSpan: Math.max(1, columnCount),
			showLabel: true,
		})),
	];
	const renderedRows =
		!grid.length && footerStepIds.length
			? []
			: borderCells(grid, rows, columnCount);
	const prepSteps = Object.entries(recipe.prepSteps ?? {});
	const selecting = requirementEdit !== null;
	const controls = editing && !selecting;
	const layoutKey = JSON.stringify({ recipe, grid, footerStepIds });

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const { grid: measuredGrid }: { grid: (string | null)[][] } =
			JSON.parse(layoutKey);
		let disposed = false;
		const measure = () => {
			if (disposed) return;
			const origin = container.getBoundingClientRect();
			const rowBounds = new Map<number, DOMRect>();
			const columnBounds = new Map<number, number>();
			container
				.querySelectorAll<HTMLTableRowElement>("tr[data-grid-row]")
				.forEach((row) =>
					rowBounds.set(
						Number(row.dataset.gridRow),
						row.getBoundingClientRect(),
					),
				);
			container
				.querySelectorAll<HTMLTableCellElement>("td[data-grid-col]")
				.forEach((cell) => {
					const bounds = cell.getBoundingClientRect();
					const col = Number(cell.dataset.gridCol);
					columnBounds.set(col, bounds.left);
					columnBounds.set(col + cell.colSpan, bounds.right);
				});
			// A column boundary hidden inside every colspan has no measured edge;
			// interpolate only those missing boundaries between known endpoints.
			const columnCount = measuredGrid[0]?.length ?? 0;
			for (let col = 0; col <= columnCount; col++) {
				if (columnBounds.has(col)) continue;
				let left = col - 1;
				let right = col + 1;
				while (left >= 0 && !columnBounds.has(left)) left--;
				while (right <= columnCount && !columnBounds.has(right))
					right++;
				if (left >= 0 && right <= columnCount)
					columnBounds.set(
						col,
						columnBounds.get(left)! +
							((columnBounds.get(right)! -
								columnBounds.get(left)!) *
								(col - left)) /
								(right - left),
					);
			}
			const measuredRegions = largestLabelRegions(measuredGrid, {
				rowHeights: measuredGrid.map(
					(_, row) => rowBounds.get(row)?.height ?? 1,
				),
				columnWidths: Array.from(
					{ length: columnCount },
					(_, col) =>
						(columnBounds.get(col + 1) ?? 1) -
						(columnBounds.get(col) ?? 0),
				),
			});
			const labels: Record<string, Box> = {};
			for (const region of measuredRegions) {
				const top = rowBounds.get(region.row)?.top;
				const bottom = rowBounds.get(
					region.row + region.rowSpan - 1,
				)?.bottom;
				const left = columnBounds.get(region.col);
				const right = columnBounds.get(region.col + region.colSpan);
				if (
					top === undefined ||
					bottom === undefined ||
					left === undefined ||
					right === undefined
				)
					continue;
				labels[region.id] = {
					left: left - origin.left,
					top: top - origin.top,
					width: right - left,
					height: bottom - top,
				};
			}
			container
				.querySelectorAll<HTMLTableCellElement>("td[data-footer-step]")
				.forEach((cell) => {
					const bounds = cell.getBoundingClientRect();
					labels[cell.dataset.footerStep!] = {
						left: bounds.left - origin.left,
						top: bounds.top - origin.top,
						width: bounds.width,
						height: bounds.height,
					};
				});
			const bodyBounds = container
				.querySelector("tbody")
				?.getBoundingClientRect();
			const first = rowBounds.get(0);
			const body =
				first && bodyBounds
					? {
							left: bodyBounds.left - origin.left,
							top: first.top - origin.top,
							width: bodyBounds.width,
							height: bodyBounds.bottom - first.top,
						}
					: null;
			setGeometry({ labels, body });
		};
		measure();
		// Font loading can move text without changing the dependency graph.
		void document.fonts.ready.then(measure);
		const frame = requestAnimationFrame(measure);
		const observer = new ResizeObserver(measure);
		observer.observe(container);
		container
			.querySelectorAll("tr, td, caption")
			.forEach((element) => observer.observe(element));
		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [layoutKey, editing]);

	const selectedStep = requirementEdit
		? recipe.steps[requirementEdit.id]
		: undefined;
	const selectedInputs = new Set([
		...(selectedStep?.reqs?.ingredientIds ?? []),
		...(selectedStep?.reqs?.stepIds ?? []),
	]);
	const candidates = new Map(
		regions.map(({ id }) => [
			id,
			requirementEdit
				? toggleRequirement(recipe, requirementEdit.id, id)
				: null,
		]),
	);

	function updateLabel(
		kind: "ingredients" | "steps" | "prepSteps",
		id: string,
		label: string,
	) {
		setDraft((previous) => ({
			...previous,
			[kind]: {
				...previous[kind],
				[id]: { ...previous[kind]?.[id], label },
			},
		}));
	}
	function toggleInput(id: string) {
		if (!requirementEdit) return;
		const next = toggleRequirement(draft, requirementEdit.id, id);
		if (next) setDraft(next);
	}
	function background(id: string) {
		if (!selecting)
			return editing ? "bg-yellow-50" : "bg-[var(--recipe-bg)]";
		if (!id) return "bg-slate-100";
		if (requirementEdit.id === id) return "bg-blue-100";
		if (selectedInputs.has(id))
			return "bg-red-100 cursor-pointer hover:bg-red-200";
		return candidates.get(id)
			? "bg-green-100 cursor-pointer hover:bg-green-200"
			: "bg-slate-100 text-slate-400 cursor-not-allowed";
	}
	function finishRequirements(discard: boolean) {
		if (discard && requirementEdit) {
			setDraft(requirementEdit.original);
		}
		setRequirementEdit(null);
	}
	const actionsClass = (id: string) =>
		`pointer-events-auto absolute -right-2 -top-3 z-30 flex gap-1 transition-opacity group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 ${hoveredId === id ? "opacity-100" : "opacity-0"}`;
	const textAreaClass =
		"pointer-events-auto field-sizing-content block w-full resize-none overflow-hidden bg-transparent px-3 py-1 text-center outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500";
	const captionTextAreaClass =
		"field-sizing-content block min-w-[1ch] max-w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-left outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500";
	async function downloadPng() {
		if (!containerRef.current || exporting) return;
		setExporting(true);
		setExportError("");
		try {
			await exportTablePng(
				containerRef.current,
				recipe.title || "recipe",
				colors,
			);
		} catch (error) {
			setExportError(
				error instanceof Error
					? error.message
					: "Could not export the table.",
			);
		} finally {
			setExporting(false);
		}
	}

	return (
		<div>
			<section aria-label="Recipe table" className="p-2 mb-12">
				<div
					className="group/table relative w-fit"
					style={
						{
							"--recipe-bg": colors.background,
							"--recipe-border": colors.border,
							"--recipe-text": colors.text,
						} as CSSProperties
					}
				>
					<fieldset className="mb-2 flex flex-wrap gap-4 text-sm">
						{/* <legend className="mb-2 font-medium">Table colors</legend> */}
						{(["background", "border", "text"] as const).map(
							(key) => (
								<label
									key={key}
									className="flex items-center gap-2 capitalize"
								>
									{key}
									<input
										type="color"
										aria-label={`${key[0].toUpperCase()}${key.slice(1)} color`}
										value={colors[key]}
										onChange={(event) =>
											setColors({
												...colors,
												[key]: event.target.value,
											})
										}
										className="h-8 w-10 cursor-pointer rounded border border-slate-300"
									/>
								</label>
							),
						)}
					</fieldset>
					<div className="z-40 flex items-center gap-2 whitespace-nowrap mb-3">
						{!editing ? (
							<>
								<Action
									label="Edit recipe"
									onClick={() => {
										setDraft(savedRecipe);
										setEditing(true);
									}}
								>
									Edit recipe
								</Action>

								<Action
									label="Export table as PNG"
									disabled={exporting}
									onClick={() => {
										void downloadPng();
									}}
								>
									{exporting ? "Exporting…" : "Export as PNG"}
								</Action>
								{exportError && (
									<p
										role="alert"
										className="text-sm text-red-700"
									>
										{exportError}
									</p>
								)}
							</>
						) : !selecting ? (
							<>
								<Action
									label="Save recipe"
									onClick={() => {
										onChange(draft);
										setEditing(false);
									}}
								>
									Save
								</Action>
								<Action
									label="Discard recipe changes"
									onClick={() => {
										setDraft(savedRecipe);
										setEditing(false);
									}}
								>
									Discard
								</Action>
								<Action
									label="Clear recipe"
									onClick={() => {
										setDraft({
											title: "",
											servings: "",
											ingredients: {},
											steps: {},
											prepSteps: {},
										});
										setHoveredId(null);
									}}
								>
									Clear all
								</Action>
							</>
						) : (
							<div aria-hidden="true" className="h-7" />
						)}
					</div>
					<div ref={containerRef} className="relative">
						<table
							aria-label="Recipe preparation flow"
							className="min-w-96 table-fixed border-collapse border border-[var(--recipe-border)] bg-[var(--recipe-bg)] text-[var(--recipe-text)]"
						>
							<caption
								data-export-header=""
								style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact", ...(!editing ? { backgroundColor: colors.background, backgroundImage: headerBackground } : {}) }}
								className={`group/cell relative px-3 py-2 text-left text-[var(--recipe-text)] border-2 border-[var(--recipe-border)] ${editing ? "bg-yellow-400" : ""}`}
							>
								{controls ? (
									<div className="flex flex-wrap items-start gap-x-1">
										<textarea
											data-export-text={
												recipe.title || "Recipe title"
											}
											data-export-align="left"
											aria-label="Recipe title"
											placeholder="Recipe title"
											rows={1}
											value={recipe.title ?? ""}
											onChange={(event) =>
												setDraft({
													...draft,
													title: event.target.value,
												})
											}
											className={`${captionTextAreaClass} font-bold`}
										/>
										<span
											className="inline-flex max-w-full items-start"
											data-export-text={` (${recipe.servings || "Servings"})`}
											data-export-align="left"
										>
											<span aria-hidden="true">(</span>
											<textarea
												aria-label="Servings"
												placeholder="Servings"
												rows={1}
												value={recipe.servings ?? ""}
												onChange={(event) =>
													setDraft({
														...draft,
														servings:
															event.target.value,
													})
												}
												className={captionTextAreaClass}
											/>
											<span aria-hidden="true">)</span>
										</span>
									</div>
								) : (
									<div className="flex flex-wrap items-start gap-x-1">
										<strong
											data-export-text={
												recipe.title ||
												"Untitled recipe"
											}
											data-export-align="left"
										>
											{recipe.title || "Untitled recipe"}
										</strong>
										{recipe.servings && (
											<span
												data-export-text={` (${recipe.servings})`}
												data-export-align="left"
											>{` (${recipe.servings})`}</span>
										)}
									</div>
								)}
								{controls && prepSteps.length === 0 && (
									<div className="absolute -bottom-3 left-1/2 z-30 -translate-x-1/2 opacity-0 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100">
										<Action
											label="Add prep step"
											onClick={() =>
												setDraft({
													...draft,
													prepSteps: {
														...draft.prepSteps,
														[crypto.randomUUID()]: {
															label: "",
														},
													},
												})
											}
										>
											+
										</Action>
									</div>
								)}
							</caption>
							<tbody>
								{prepSteps.map(([id, step], index) => (
									<tr key={id}>
										<td
											data-export-text={
												step.label || "New prep step"
											}
											colSpan={Math.max(1, columnCount)}
											className={`group/cell relative border border-[var(--recipe-border)] px-3 py-2 text-center ${selecting ? "bg-slate-100" : editing ? "bg-yellow-50" : ""}`}
										>
											{controls ? (
												<>
													<span
														aria-hidden="true"
														className="invisible whitespace-pre-wrap"
													>
														{step.label ||
															"New prep step"}
													</span>
													<div className="absolute inset-0 flex items-center">
														<textarea
															aria-label={`Prep step ${index + 1}`}
															placeholder="New prep step"
															rows={1}
															value={step.label}
															onChange={(event) =>
																updateLabel(
																	"prepSteps",
																	id,
																	event.target
																		.value,
																)
															}
															className={
																textAreaClass
															}
														/>
													</div>
													<div
														className={actionsClass(
															id,
														)}
													>
														<Action
															label={`Move prep step ${index + 1} up`}
															tooltip="Move prep step up"
															disabled={
																index === 0
															}
															onClick={() =>
																setDraft(
																	movePrepStep(
																		draft,
																		id,
																		-1,
																	),
																)
															}
														>
															↑
														</Action>
														<Action
															label={`Move prep step ${index + 1} down`}
															tooltip="Move prep step down"
															disabled={
																index ===
																prepSteps.length -
																	1
															}
															onClick={() =>
																setDraft(
																	movePrepStep(
																		draft,
																		id,
																		1,
																	),
																)
															}
														>
															↓
														</Action>
														<Action
															label={`Delete prep step ${index + 1}`}
															tooltip="Delete prep step"
															onClick={() =>
																setDraft(
																	removeRecipeItem(
																		draft,
																		"prepSteps",
																		id,
																	),
																)
															}
														>
															×
														</Action>
													</div>
												</>
											) : (
												<span className="whitespace-pre-wrap">
													{step.label ||
														"New prep step"}
												</span>
											)}
											{controls &&
												index ===
													prepSteps.length - 1 && (
													<div className="absolute -bottom-3 left-1/2 z-30 -translate-x-1/2 opacity-0 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100">
														<Action
															label="Add prep step"
															onClick={() =>
																setDraft({
																	...draft,
																	prepSteps: {
																		...draft.prepSteps,
																		[crypto.randomUUID()]:
																			{
																				label: "",
																			},
																	},
																})
															}
														>
															+
														</Action>
													</div>
												)}
										</td>
									</tr>
								))}
								{renderedRows.map((cells, row) => (
									<tr key={row} data-grid-row={row}>
										{cells.map(
											({
												id,
												row: r,
												col,
												rowSpan,
												colSpan,
												showLabel,
											}) => {
												const owner = grid[r]?.[col];
												const ingredient =
													Object.hasOwn(
														recipe.ingredients,
														id,
													);
												const label =
													recipe.ingredients[id]
														?.label ??
													recipe.steps[id]?.label;
												const placeholder = ingredient
													? "New ingredient"
													: "New step";
												const borders = [
													grid[r - 1]?.[col] !== owner
														? "border-t"
														: "border-t-0",
													grid[r + rowSpan]?.[col] !==
													owner
														? "border-b"
														: "border-b-0",
													grid[r]?.[col - 1] !== owner
														? "border-l"
														: "border-l-0",
													grid[r]?.[col + colSpan] !==
													owner
														? "border-r"
														: "border-r-0",
												];
												return (
													<td
														key={col}
														data-grid-col={col}
														rowSpan={rowSpan}
														colSpan={colSpan}
														data-export-text={
															ingredient &&
															showLabel &&
															!editing
																? label ||
																	placeholder
																: undefined
														}
														data-export-align="left"
														onMouseEnter={() =>
															setHoveredId(id)
														}
														onMouseLeave={() =>
															setHoveredId(null)
														}
														onClick={
															selecting &&
															candidates.get(id)
																? () =>
																		toggleInput(
																			id,
																		)
																: undefined
														}
														className={`border-[var(--recipe-border)] px-3 py-4 align-middle ${borders.join(" ")} ${background(id)}`}
													>
														{showLabel && (
															<>
																<span
																	aria-hidden={
																		editing ||
																		!ingredient
																	}
																	className={`whitespace-pre-wrap wrap-break-word ${editing || !ingredient ? "invisible" : ""}`}
																>
																	{label ||
																		placeholder}
																</span>
																{!ingredient && (
																	<span className="sr-only">
																		{label ||
																			placeholder}
																	</span>
																)}
															</>
														)}
														{!grid.length && (
															<span className="text-sm text-slate-400">
																Add an
																ingredient or
																step
															</span>
														)}
													</td>
												);
											},
										)}
									</tr>
								))}
								{footerStepIds.map((id) => (
									<tr key={id}>
										<td
											data-footer-step={id}
											colSpan={Math.max(1, columnCount)}
											onMouseEnter={() =>
												setHoveredId(id)
											}
											onMouseLeave={() =>
												setHoveredId(null)
											}
											onClick={
												selecting && candidates.get(id)
													? () => toggleInput(id)
													: undefined
											}
											className={`relative border border-[var(--recipe-border)] px-3 py-2 text-center ${background(id)}`}
										>
											<span
												aria-hidden="true"
												className="invisible whitespace-pre-wrap wrap-break-word"
											>
												{recipe.steps[id].label ||
													"New step"}
											</span>
											<span className="sr-only">
												{recipe.steps[id].label ||
													"New step"}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					{regions.map(({ id }) => {
						const ingredient = Object.hasOwn(
							recipe.ingredients,
							id,
						);
						if (ingredient && !editing) return null;
						const label = (
							ingredient
								? recipe.ingredients[id]
								: recipe.steps[id]
						).label;
						const placeholder = ingredient
							? "New ingredient"
							: "New step";
						const current = requirementEdit?.id === id;
						const valid = selecting && !!candidates.get(id);
						const box = geometry.labels[id];
						return (
							<div
								key={id}
								style={box as CSSProperties}
								data-label-region={id}
								data-export-text={label || placeholder}
								data-export-padding="12"
								data-export-align={
									ingredient ? "left" : "center"
								}
								role={
									selecting && !current ? "button" : undefined
								}
								tabIndex={valid ? 0 : undefined}
								aria-label={
									selecting && !current
										? `${selectedInputs.has(id) ? "Remove" : "Add"} prerequisite: ${label || placeholder}`
										: undefined
								}
								aria-pressed={
									selecting && !current
										? selectedInputs.has(id)
										: undefined
								}
								aria-disabled={
									selecting && !current ? !valid : undefined
								}
								onClick={
									valid ? () => toggleInput(id) : undefined
								}
								onKeyDown={
									valid
										? (event) => {
												if (
													event.key === "Enter" ||
													event.key === " "
												) {
													event.preventDefault();
													toggleInput(id);
												}
											}
										: undefined
								}
								onMouseEnter={() => setHoveredId(id)}
								onMouseLeave={() => setHoveredId(null)}
								className={`group/cell absolute flex items-center justify-center text-[var(--recipe-text)] ${box ? "" : "invisible"} ${selecting ? (valid ? "cursor-pointer" : "cursor-not-allowed") : "pointer-events-none"} ${current ? "z-20 ring-2 ring-inset ring-blue-600" : ""}`}
							>
								{controls ? (
									<textarea
										aria-label={`${ingredient ? "Ingredient" : "Step"}: ${label || placeholder}`}
										placeholder={placeholder}
										rows={1}
										value={label}
										onChange={(event) =>
											updateLabel(
												ingredient
													? "ingredients"
													: "steps",
												id,
												event.target.value,
											)
										}
										className={`${textAreaClass} ${ingredient ? "text-left" : ""}`}
									/>
								) : (
									<span
										aria-hidden={!selecting}
										className="pointer-events-none min-w-0 w-full whitespace-pre-wrap px-3 text-center wrap-break-word"
									>
										{label || placeholder}
									</span>
								)}
								{controls && (
									<div className={actionsClass(id)}>
										{!ingredient && (
											<Action
												label={`Edit requirements: ${label || placeholder}`}
												tooltip="Edit requirements"
												onClick={() =>
													setRequirementEdit({
														id,
														original: draft,
													})
												}
											>
												Reqs
											</Action>
										)}
										<Action
											label={`Delete ${ingredient ? "ingredient" : "step"}: ${label || placeholder}`}
											tooltip={
												ingredient
													? "Delete ingredient"
													: "Delete step"
											}
											onClick={() =>
												setDraft(
													removeRecipeItem(
														draft,
														ingredient
															? "ingredients"
															: "steps",
														id,
													),
												)
											}
										>
											×
										</Action>
									</div>
								)}
								{current && (
									<div className="pointer-events-auto absolute -right-2 -top-3 z-40 flex gap-1">
										<Action
											label="Apply requirements"
											onClick={() =>
												finishRequirements(false)
											}
										>
											Apply
										</Action>
										<Action
											label="Undo requirement changes"
											onClick={() =>
												finishRequirements(true)
											}
										>
											Undo
										</Action>
									</div>
								)}
							</div>
						);
					})}
					{controls && (
						<>
							<div className="absolute -bottom-4 left-1/2 z-30 -translate-x-1/2 opacity-0 group-hover/table:opacity-100 group-focus-within/table:opacity-100">
								<Action
									label="Add ingredient and step"
									onClick={() =>
										setDraft(
											appendIngredientAndStep(
												draft,
												crypto.randomUUID(),
												crypto.randomUUID(),
											),
										)
									}
								>
									+
								</Action>
							</div>
							<div
								className="absolute -right-4 z-30 -translate-y-1/2 opacity-0 group-hover/table:opacity-100 group-focus-within/table:opacity-100"
								style={{
									top: geometry.body
										? geometry.body.top +
											geometry.body.height / 2
										: "60%",
								}}
							>
								<Action
									label="Add step"
									onClick={() =>
										setDraft(
											appendStep(
												draft,
												crypto.randomUUID(),
											),
										)
									}
								>
									+
								</Action>
							</div>
						</>
					)}
					</div>
				</div>
			</section>
		</div>
	);
}
