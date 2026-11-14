"use client";

import RecipeImport from "@/components/recipe-import";
import RecipeTable from "@/components/recipe-table";
import { defaultRecipe } from "@/lib/default-recipe";
import { useState } from "react";

export default function Home() {
	const [recipe, setRecipe] = useState(defaultRecipe);
	const [importVersion, setImportVersion] = useState(0);

	return (
		<main className="mx-auto flex flex-col gap-8 p-4 sm:p-8">
			<div className="flex flex-col items-center gap-3">
				<div className="text-7xl font-semibold bg-[linear-gradient(135deg,#ff6b6b_0%,#feca57_50%,#48dbfb_100%)] text-transparent bg-clip-text pb-3 [-webkit-text-stroke:1px_black]">
					Tabular Recipe Maker
				</div>
				<h2 className="text-2xl">Turns boring recipes into a table format that may or may not be useful...</h2>
			</div>
			<RecipeImport
				onImported={(imported) => {
					setRecipe(imported);
					setImportVersion((version) => version + 1);
				}}
			/>
			<RecipeTable
				key={importVersion}
				recipe={recipe}
				onChange={setRecipe}
			/>
		</main>
	);
}
