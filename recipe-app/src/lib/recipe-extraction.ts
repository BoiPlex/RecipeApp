import type { Recipe } from "@/lib/types";
import { inferRequirements } from "@/lib/recipe-inference";

type Element = { tag: string; attributes: Record<string, string>; children: (Element | string)[]; parent?: Element };
const entities: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°", ndash: "–", mdash: "—",
	frac14: "¼", frac12: "½", frac34: "¾", frac13: "⅓", frac23: "⅔", times: "×", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};
export function decodeHtml(text: string): string {
	return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, name: string) => {
		if (!name.startsWith("#")) return entities[name] ?? match;
		const value = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
		return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : "";
	});
}

/** A small inert HTML tree: no scripts execute and no page resources are loaded. */
function parseHtml(html: string): Element {
	const root: Element = { tag: "root", attributes: {}, children: [] };
	const stack = [root];
	const tokens = html.match(/<!--[^]*?-->|<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>[^]*?<\/\1\s*>|<\/?[a-z!][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+|</gi) ?? [];
	let count = 0;
	for (const token of tokens) {
		if (++count > 60000) throw new Error("This page is too complex to import.");
		if (token.startsWith("<!")) continue;
		const closing = token.match(/^<\/([\w-]+)/);
		if (closing) {
			for (let index = stack.length - 1; index > 0; index--) {
				if (stack[index].tag === closing[1].toLowerCase()) { stack.length = index; break; }
			}
			continue;
		}
		const opening = token.match(/^<([\w-]+)\b/);
		if (!opening) { stack.at(-1)!.children.push(token); continue; }
		const tag = opening[1].toLowerCase();
		if ((tag === "li" || tag === "p") && stack.at(-1)!.tag === tag) stack.pop();
		const end = token.indexOf(">");
		const attributes: Record<string, string> = Object.create(null);
		for (const match of token.slice(opening[0].length, end).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
			attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4]);
		}
		const parent = stack.at(-1)!;
		const element: Element = { tag, attributes, children: [], parent };
		parent.children.push(element);
		if (tag === "script" || tag === "style") {
			element.children.push(token.slice(end + 1).replace(new RegExp(`</${tag}\\s*>$`, "i"), ""));
		} else if (!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) && !token.endsWith("/>")) {
			if (stack.length > 250) throw new Error("This page is too deeply nested to import.");
			stack.push(element);
		}
	}
	return root;
}

function elements(root: Element): Element[] {
	const result: Element[] = [];
	const pending = [root];
	while (pending.length) {
		const node = pending.pop()!;
		result.push(node);
		for (const child of [...node.children].reverse()) if (typeof child !== "string") pending.push(child);
	}
	return result;
}
function text(node: Element): string {
	if (/^(script|style|nav|noscript|svg)$/.test(node.tag)) return "";
	return decodeHtml(node.children.map((child) => typeof child === "string" ? child : text(child)).join(" ")).replace(/\s+/g, " ").trim();
}
function clean(value: unknown): string {
	return typeof value === "string" ? text(parseHtml(value)).slice(0, 4000) : typeof value === "number" ? String(value) : "";
}
function flattenInstructions(value: unknown, depth = 0): string[] {
	if (depth > 20) return [];
	if (Array.isArray(value)) return value.flatMap((item) => flattenInstructions(item, depth + 1));
	if (typeof value === "string") return value.split(/\n+/).map(clean).filter(Boolean);
	if (value && typeof value === "object") {
		const item = value as Record<string, unknown>;
		if (item.itemListElement) return flattenInstructions(item.itemListElement, depth + 1);
		return flattenInstructions(item.text ?? item.name, depth + 1);
	}
	return [];
}
function structuredRecipes(nodes: Element[]): Record<string, unknown>[] {
	const found: Record<string, unknown>[] = [];
	for (const script of nodes.filter((node) => node.tag === "script" && node.attributes.type?.toLowerCase() === "application/ld+json")) {
		try {
			const raw = script.children.join("").replace(/^\s*<!--|-->\s*$/g, "");
			const pending: { value: unknown; depth: number }[] = [{ value: JSON.parse(raw), depth: 0 }];
			let visited = 0;
			while (pending.length && visited++ < 20000) {
				const { value, depth } = pending.pop()!;
				if (depth > 20 || !value || typeof value !== "object") continue;
				if (Array.isArray(value)) { for (const child of [...value].reverse()) pending.push({ value: child, depth: depth + 1 }); continue; }
				const item = value as Record<string, unknown>;
				const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
				if (types.some((type) => typeof type === "string" && /(?:^|[/#])Recipe$/i.test(type))) found.push(item);
				else for (const child of Object.values(item).reverse()) pending.push({ value: child, depth: depth + 1 });
			}
		} catch { /* Malformed metadata can fall back to visible recipe markup. */ }
	}
	return found;
}

function htmlLists(nodes: Element[], kind: "ingredients" | "instructions"): string[] {
	const property = kind === "ingredients" ? "recipeIngredient" : "recipeInstructions";
	const classPattern = kind === "ingredients"
		? /^(wprm-recipe-ingredient|tasty-recipes-ingredients|recipe-ingredient|ingredients-item|ingredient)$/i
		: /^(wprm-recipe-instruction-text|tasty-recipes-instructions|recipe-instruction|instructions-section-item|direction|instruction)$/i;
	const candidates = nodes.filter((node) => node.attributes.itemprop?.split(/\s+/).includes(property)
		|| node.attributes.class?.split(/\s+/).some((name) => classPattern.test(name)));
	const selected = new Set<Element>();
	for (const node of candidates) {
		const list = elements(node).filter((child) => child.tag === "li");
		const paragraphs = kind === "instructions" && !list.length ? elements(node).filter((child) => child.tag === "p") : [];
		for (const item of list.length ? list : paragraphs.length ? paragraphs : [node]) selected.add(item);
	}
	if (selected.size) return [...selected].filter((node) => !elements(node).slice(1).some((child) => selected.has(child))).map(text).filter(Boolean);
	const headingPattern = kind === "ingredients" ? /^ingredients?\b/i : /^(instructions?|directions?|method|preparation)\b/i;
	const heading = nodes.find((node) => /^h[1-6]$/.test(node.tag) && headingPattern.test(text(node)));
	if (!heading?.parent) return [];
	const siblings = heading.parent.children;
	const result: string[] = [];
	for (const sibling of siblings.slice(siblings.indexOf(heading) + 1)) {
		if (typeof sibling === "string") continue;
		if (/^h[1-6]$/.test(sibling.tag)) break;
		const items = elements(sibling).filter((node) => node.tag === "li");
		if (items.length) result.push(...items.map(text));
		else if (sibling.tag === "p") result.push(text(sibling));
	}
	return result.filter(Boolean);
}

export type ExtractedRecipe = { recipe: Recipe; warnings: string[]; method: "structured-data" | "html" | "text" };
export function extractRecipeHtml(html: string): ExtractedRecipe {
	const nodes = elements(parseHtml(html));
	const structured = structuredRecipes(nodes);
	const data = structured.find((item) => Array.isArray(item.recipeIngredient) && flattenInstructions(item.recipeInstructions).length);
	const ingredients = data ? (data.recipeIngredient as unknown[]).map(clean).filter(Boolean) : htmlLists(nodes, "ingredients");
	const instructions = data ? flattenInstructions(data.recipeInstructions) : htmlLists(nodes, "instructions");
	if (!ingredients.length || !instructions.length) throw new Error("No readable recipe ingredients and instructions were found. Try a page with a recipe card; pages requiring JavaScript or sign-in cannot be imported.");
	if (ingredients.length > 120 || instructions.length > 150) throw new Error("This recipe is too large to import.");
	const title = data ? clean(data.name) : text(nodes.find((node) => node.tag === "h1") ?? nodes.find((node) => node.tag === "title") ?? { tag: "span", attributes: {}, children: [] });
	const yields = data ? (Array.isArray(data.recipeYield) ? data.recipeYield.map(clean) : [clean(data.recipeYield)]).filter(Boolean) : [];
	const servings = data ? [...new Set(yields)].filter((value) => !yields.some((other) => other !== value && other.startsWith(`${value} `))).join(" / ") : text(nodes.find((node) => node.attributes.itemprop === "recipeYield") ?? { tag: "span", attributes: {}, children: [] });
	const { recipe, warnings } = inferRequirements(title.slice(0, 300) || "Imported recipe", servings.slice(0, 300), ingredients.map((label) => label.slice(0, 4000)), instructions.map((label) => label.slice(0, 4000)));
	if (structured.length > 1) warnings.unshift("Multiple recipes were found; the first complete recipe was imported.");
	if (!data) warnings.unshift("Imported from visible HTML; check quantities and instruction boundaries.");
	return { recipe, warnings, method: data ? "structured-data" : "html" };
}
