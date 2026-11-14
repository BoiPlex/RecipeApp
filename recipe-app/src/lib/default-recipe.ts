import type { Recipe } from "@/lib/types";

export const defaultRecipe: Recipe = {
		title: "Banana Nut Bread",
		servings: "about 10 servings",
		ingredients: {
			bananas: { label: "2 large (250 g) ripe bananas" },
			butter: { label: "6 Tbs. (90 mL) butter" },
			vanilla: { label: "1 tsp. (5 mL) vanilla extract" },
			eggs: { label: "2 large eggs" },
			flour: { label: "1-1/3 cups (167 g) all-purpose flour" },
			sugar: { label: "2/3 cup (130 g) sugar" },
			bakingSoda: { label: "1/2 tsp. (2.3 g) baking soda" },
			bakingPowder: { label: "1/4 tsp. (1.2 g) baking powder" },
			salt: { label: "1/2 tsp. (3 g) salt" },
			walnuts: { label: "1/2 cup (70 g) chopped walnuts" },
		},
		prepSteps: {
			prep1: { label: "Butter and flour a loaf pan" },
			prep2: { label: "Preheat oven to 350°F (170°C)" },
		},
		steps: {
			mash1: { label: "Mash", reqs: { ingredientIds: ["bananas"] } },
			melt: { label: "Melt", reqs: { ingredientIds: ["butter"] } },
			beat: { label: "Lightly beat", reqs: { ingredientIds: ["eggs"] } },
			mash2: {
				label: "Mash until smooth",
				reqs: {
					stepIds: ["mash1", "melt", "beat"],
					ingredientIds: ["vanilla"],
				},
			},
			whisk: {
				label: "Whisk",
				reqs: {
					ingredientIds: ["flour", "sugar", "bakingSoda", "bakingPowder", "salt"],
				},
			},
			fold: {
				label: "Fold",
				reqs: { stepIds: ["mash2", "whisk"], ingredientIds: ["walnuts"] },
			},
			bake: {
				label: "Bake 350°F (170°C) 55 min.",
				reqs: { stepIds: ["fold"] },
			},
			coolInPan: {
				label: "Cool 10 min. in pan",
				reqs: { stepIds: ["bake"] },
			},
			coolOnRack: {
				label: "Cool on wire rack",
				reqs: { stepIds: ["coolInPan"] },
			},
		},
	};

