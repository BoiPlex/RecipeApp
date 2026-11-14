export type Recipe = {
	title?: string;
	servings?: string;
	prepSteps?: Record<string, { label: string }>;
	/** Explicit order for source rows after inserting below a full-width step. */
	rowOrder?: string[];
	ingredients: Record<string, Ingredient>;
	steps: Record<string, Step>;
};

export type Step = {
	label: string;
	reqs?: {
		ingredientIds?: string[];
		stepIds?: string[];
	};
};

export type Ingredient = {
	label: string;
}


