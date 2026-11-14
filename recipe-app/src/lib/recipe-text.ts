import { inferRequirements } from "@/lib/recipe-inference";
import type { ExtractedRecipe } from "@/lib/recipe-extraction";

function instructionList(lines: string[]): string[] {
	const marker = /^\s*(?:[-*•]\s+|\d+[.)]\s+|step\s+\d+\s*[:.)-]?\s*)/i;
	if (lines.some((line) => marker.test(line))) {
		const result: string[] = [];
		for (const line of lines) {
			if (!line.trim()) continue;
			if (marker.test(line) || !result.length) result.push(line.replace(marker, "").trim());
			else result[result.length - 1] += ` ${line.trim()}`;
		}
		return result;
	}
	const paragraphs = lines.join("\n").split(/\n\s*\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
	return paragraphs.length > 1 ? paragraphs : lines.map((line) => line.trim()).filter(Boolean);
}

export function extractRecipeText(input: string): ExtractedRecipe {
	if (input.length > 50000) throw new Error("Recipe text must be 50,000 characters or fewer.");
	const lines = input.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim().replace(/^#{1,6}\s+/, ""));
	let section: "intro" | "ingredients" | "prep" | "instructions" | "notes" = "intro";
	let title = "";
	let servings = "";
	const ingredientLines: string[] = [];
	const instructions: string[] = [];
	const preparation: string[] = [];
	const intro: string[] = [];
	for (const line of lines) {
		if (/^ingredients?\s*:?(?:\s*\([^)]*\))?\s*$/i.test(line)) { section = "ingredients"; continue; }
		if (/^(?:instructions?|directions?|method|steps?)\s*:?$/i.test(line)) { section = "instructions"; continue; }
		if (/^(?:prep(?:aration)?(?:\s+steps?)?)\s*:?$/i.test(line)) { section = "prep"; continue; }
		if (/^(?:notes?|nutrition|storage)\s*:?$/i.test(line)) { section = "notes"; continue; }
		const serving = line.match(/^(?:servings?|serves|yield|makes)(?:\s*:\s*|\s+)(.+)$/i);
		if (serving) { servings = serving[1]; continue; }
		if (section === "intro") {
			if (line) { if (!title && !/^\s*[-*•\d¼½¾⅓⅔]/.test(line)) title = line.replace(/^title\s*:\s*/i, ""); else intro.push(line); }
		} else if (section === "ingredients") {
			if (line && !line.endsWith(":")) ingredientLines.push(line.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, ""));
		} else if (section === "instructions") instructions.push(line);
		else if (section === "prep") preparation.push(line);
	}
	// Also accept a common title + quantity list + numbered directions paste.
	if (!ingredientLines.length && intro.length) {
		const start = intro.findIndex((line) => /^\s*(?:step\s*\d+|\d+[.)]\s+[A-Za-z])/i.test(line));
		const candidates = start >= 0 ? intro.slice(0, start) : intro;
		if (candidates.every((line) => /^\s*(?:[-*•]\s*)?(?:\d|[¼½¾⅓⅔])/.test(line))) {
			ingredientLines.push(...candidates.map((line) => line.replace(/^[-*•]\s+/, "")));
			if (start >= 0) instructions.unshift(...intro.slice(start));
		}
	}
	const steps = instructionList(instructions);
	const prep = instructionList(preparation);
	if (!ingredientLines.length || !steps.length) throw new Error("Include an Ingredients section and an Instructions section, with each ingredient on its own line.");
	if (ingredientLines.length > 120 || steps.length + prep.length > 150) throw new Error("This recipe is too large to import.");
	const result = inferRequirements((title || "Imported recipe").slice(0, 300), servings.slice(0, 300), ingredientLines.map((line) => line.slice(0, 4000)), steps.map((line) => line.slice(0, 4000)));
	result.recipe.prepSteps = Object.fromEntries([...prep, ...Object.values(result.recipe.prepSteps ?? {}).map(({ label }) => label)].map((label, index) => [`prep-${index + 1}`, { label: label.slice(0, 4000) }]));
	return { ...result, method: "text" };
}
