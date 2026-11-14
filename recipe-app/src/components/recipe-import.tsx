"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Recipe } from "@/lib/types";
import { fetchRecipePage } from "@/lib/fetch-recipe-page";
import { extractRecipeHtml } from "@/lib/recipe-extraction";
import { extractRecipeText } from "@/lib/recipe-text";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function RecipeImport({ onImported }: { onImported: (recipe: Recipe) => void }) {
	const [url, setUrl] = useState("");
	const [text, setText] = useState("");
	const [mode, setMode] = useState<"link" | "text">("link");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [warnings, setWarnings] = useState<string[]>([]);
	const [imported, setImported] = useState(false);
	const activeRequest = useRef<AbortController | null>(null);
	useEffect(() => {
		return () => { activeRequest.current?.abort(); };
	}, []);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (activeRequest.current || !(mode === "link" ? url : text).trim()) return;
		const controller = new AbortController();
		activeRequest.current = controller;
		const timeout = setTimeout(() => controller.abort(), 30000);
		setPending(true);
		setError("");
		setImported(false);
		setWarnings([]);
		try {
			const data = mode === "text"
				? extractRecipeText(text.trim())
				: extractRecipeHtml((await fetchRecipePage(url.trim(), controller.signal)).html);
			if (controller.signal.aborted) return;
			onImported(data.recipe);
			setWarnings(data.warnings ?? []);
			setImported(true);
		} catch (failure) {
			setError(controller.signal.aborted ? "The import timed out. Please try again." : failure instanceof Error ? failure.message : "The import failed. Check the recipe and try again.");
		} finally {
			clearTimeout(timeout);
			activeRequest.current = null;
			setPending(false);
		}
	}
	return (
		<section aria-label="Import recipe" className="mx-auto w-full max-w-2xl rounded-lg border border-slate-300 bg-white p-4 text-slate-900">
			<form onSubmit={(event) => { void submit(event); }} className="flex flex-col gap-3">
				<h2 className="font-semibold">Import a recipe</h2>
				{/* <p className="text-sm text-slate-600">Importing replaces the table below; review the automatically matched requirements afterward.</p> */}
				<Tabs className="flex flex-col" value={mode} onValueChange={(value) => { setMode(value === "text" ? "text" : "link"); setError(""); setImported(false); setWarnings([]); }}>
					<TabsList aria-label="Recipe input type" className="bg-slate-100">
						<TabsTrigger type="button" value="link" disabled={pending}>Link</TabsTrigger>
						<TabsTrigger type="button" value="text" disabled={pending}>Text</TabsTrigger>
					</TabsList>
					<TabsContent value="link" className="space-y-2">
						<p className="text-sm text-slate-600">Some websites block link imports. If a link fails, copy the recipe into the Text tab.</p>
						{/* <label htmlFor="recipe-url" className="block text-sm">Recipe link</label> */}
						<input id="recipe-url" type="url" required={mode === "link"} maxLength={2048} placeholder="https://example.com/recipe" value={url} onChange={(event) => setUrl(event.target.value)} disabled={pending || mode !== "link"}
							className="w-full rounded border border-slate-400 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60" />
					</TabsContent>
					<TabsContent value="text" className="space-y-2">
						{/* <label htmlFor="recipe-text" className="block text-sm">Recipe text</label> */}
						<textarea id="recipe-text" required={mode === "text"} maxLength={50000} rows={8} value={text} onChange={(event) => setText(event.target.value)} disabled={pending || mode !== "text"}
							placeholder={"Recipe title\nServings: 4\n\nIngredients\n1 cup flour\n2 eggs\n\nInstructions\n1. Beat the eggs.\n2. Add the flour."}
							className="field-sizing-content min-h-40 w-full resize-y overflow-hidden rounded border border-slate-400 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60" />
					</TabsContent>
				</Tabs>
				<button type="submit" disabled={pending} className="self-start rounded border border-slate-500 bg-slate-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Importing…" : "Import recipe"}</button>
				{pending && <p role="status" className="text-sm">{mode === "link" ? "Fetching the page and matching ingredients to instructions…" : "Matching ingredients to instructions…"}</p>}
				{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
				{imported && <p role="status" className="text-sm text-green-700">Recipe imported. Use Edit recipe to review or adjust its requirements.</p>}
			</form>
			{/* {warnings.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Review {warnings.length} possible matching {warnings.length === 1 ? "issue" : "issues"}</summary><ul className="mt-2 list-disc space-y-1 pl-5">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>} */}
		</section>
	);
}
