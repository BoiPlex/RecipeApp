# Recipe importing

All recipe parsing and requirement matching run in the browser. No API key, LLM,
application server, sign-in, usage tracking, or daily limit is needed.

The Text tab accepts a recipe with Ingredients and Instructions headings. Optional
title, servings, and prep sections are supported. Text is limited to 50,000 characters.
Importing replaces the table below and exits any active table edit.

The Link tab fetches HTTP(S) recipe pages directly from the browser, without cookies
or a third-party proxy. The destination must allow cross-origin requests (CORS).
Many recipe websites do not, so link imports may fail; copy the recipe into the Text
tab instead. HTTPS deployments also cannot read HTTP pages blocked as mixed content.
Fetches can be cancelled and have a 30-second timeout and a 2 MiB HTML limit.

Extraction prefers Recipe JSON-LD, followed by microdata, supported recipe-card
classes, and ingredient/instruction lists. Requirements are inferred from ingredient
names, the most recent operations using them, and cooking/mixture keywords.
Review and edit requirements in the table: rule-based matching cannot reliably
resolve every pronoun, mixture, divided quantity, or ambiguous ingredient.

When the table exceeds seven step columns (excluding the ingredient column), the
first step spanning all ingredient rows remains in the grid. Only the full-height
finishing sequence after that step is displayed as full-width rows below it.
Dependencies remain in the recipe, and these rows keep their normal editing and
requirement-selection controls.

Fetched HTML is parsed as inert text, never rendered or executed. Sign-in, paywalls,
and bot protection are not bypassed. Parser complexity and nesting are bounded.
