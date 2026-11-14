const MAX_BYTES = 2 * 1024 * 1024;

export function validateRecipeUrl(input: string): URL {
	let url: URL;
	try { url = new URL(input); } catch { throw new Error("Enter a valid HTTP or HTTPS recipe URL."); }
	if (!/^https?:$/.test(url.protocol) || url.username || url.password || input.length > 2048) {
		throw new Error("Enter a valid HTTP or HTTPS recipe URL without a username or password.");
	}
	url.hash = "";
	return url;
}

/** Fetch directly from the browser. The destination must permit CORS. */
export async function fetchRecipePage(input: string, signal?: AbortSignal): Promise<{ html: string; url: string }> {
	const url = validateRecipeUrl(input);
	let response: Response;
	try {
		response = await fetch(url.href, { signal, mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new Error("This website could not be read from your browser. It may block link imports. Copy the recipe into the Text tab instead.");
	}
	if (!response.ok) throw new Error(`The recipe website returned HTTP ${response.status}. Copy the recipe into the Text tab instead.`);
	if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get("content-type") ?? "")) {
		await response.body?.cancel();
		throw new Error("That URL is not an HTML recipe page.");
	}
	if (Number(response.headers.get("content-length")) > MAX_BYTES) {
		await response.body?.cancel();
		throw new Error("The recipe page is too large to import.");
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error("The recipe page is empty.");
	const decoder = new TextDecoder();
	let html = "";
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_BYTES) {
				await reader.cancel();
				throw new Error("The recipe page is too large to import.");
			}
			html += decoder.decode(value, { stream: true });
		}
		return { html: html + decoder.decode(), url: response.url || url.href };
	} finally {
		reader.releaseLock();
	}
}
