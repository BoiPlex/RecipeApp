export type TableColors = { background: string; border: string; text: string };

export const headerColorStops = ["#ff6b6b7e", "#fec9577e", "#48dafb77"] as const;
export const headerBackground = `linear-gradient(135deg, ${headerColorStops[0]} 0%, ${headerColorStops[1]} 50%, ${headerColorStops[2]} 100%)`;

/** Wrap text by measured width, including long words and explicit line breaks. */
export function wrapCanvasText(context: Pick<CanvasRenderingContext2D, "measureText">, text: string, width: number): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		let line = "";
		for (const word of paragraph.split(/\s+/).filter(Boolean)) {
			const candidate = line ? `${line} ${word}` : word;
			if (context.measureText(candidate).width <= width) { line = candidate; continue; }
			if (line) { lines.push(line); line = ""; }
			for (const character of word) {
				if (line && context.measureText(line + character).width > width) { lines.push(line); line = ""; }
				line += character;
			}
		}
		lines.push(line);
	}
	return lines;
}

/** Draw measured table geometry directly, excluding all editor controls. */
export async function exportTablePng(container: HTMLElement, title: string, colors: TableColors): Promise<void> {
	await document.fonts.ready;
	const bounds = container.getBoundingClientRect();
	if (!bounds.width || !bounds.height) throw new Error("The table is not visible.");
	const canvas = document.createElement("canvas");
	const scale = 2;
	canvas.width = Math.ceil(bounds.width * scale);
	canvas.height = Math.ceil(bounds.height * scale);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("PNG export is not available in this browser.");
	context.scale(scale, scale);
	context.fillStyle = colors.background;
	context.fillRect(0, 0, bounds.width, bounds.height);
	for (const header of container.querySelectorAll<HTMLElement>("[data-export-header]")) {
		const rect = header.getBoundingClientRect();
		const x = rect.left - bounds.left;
		const y = rect.top - bounds.top;
		// CSS's 135-degree gradient spans the rectangle's projected diagonal.
		const offset = (rect.width + rect.height) / 4;
		const centerX = x + rect.width / 2;
		const centerY = y + rect.height / 2;
		const gradient = context.createLinearGradient(centerX - offset, centerY - offset, centerX + offset, centerY + offset);
		headerColorStops.forEach((color, index) => gradient.addColorStop(index / 2, color));
		context.fillStyle = gradient;
		context.fillRect(x, y, rect.width, rect.height);
	}
	context.fillStyle = colors.border;
	for (const cell of container.querySelectorAll<HTMLElement>("td, table, caption")) {
		const rect = (cell.tagName === "TABLE" ? cell.querySelector("tbody") ?? cell : cell).getBoundingClientRect();
		const css = getComputedStyle(cell);
		const x = rect.left - bounds.left;
		const y = rect.top - bounds.top;
		const top = parseFloat(css.borderTopWidth) || 0;
		const right = parseFloat(css.borderRightWidth) || 0;
		const bottom = parseFloat(css.borderBottomWidth) || 0;
		const left = parseFloat(css.borderLeftWidth) || 0;
		if (css.borderTopStyle !== "none") context.fillRect(x, y, rect.width, top);
		if (css.borderRightStyle !== "none") context.fillRect(x + rect.width - right, y, right, rect.height);
		if (css.borderBottomStyle !== "none") context.fillRect(x, y + rect.height - bottom, rect.width, bottom);
		if (css.borderLeftStyle !== "none") context.fillRect(x, y, left, rect.height);
	}
	context.fillStyle = colors.text;
	context.textBaseline = "middle";
	for (const element of container.querySelectorAll<HTMLElement>("[data-export-text]")) {
		const rect = element.getBoundingClientRect();
		if (!rect.width || !rect.height) continue;
		const css = getComputedStyle(element);
		const fontSize = parseFloat(css.fontSize) || 16;
		const lineHeight = parseFloat(css.lineHeight) || fontSize * 1.2;
		context.font = `${css.fontStyle} ${css.fontWeight} ${fontSize}px ${css.fontFamily}`;
		const padding = Number(element.dataset.exportPadding ?? 0);
		const left = Math.max(padding, parseFloat(css.paddingLeft) || 0);
		const right = Math.max(padding, parseFloat(css.paddingRight) || 0);
		const width = Math.max(1, rect.width - left - right);
		const lines = wrapCanvasText(context, element.dataset.exportText ?? "", width);
		const align = element.dataset.exportAlign === "left" ? "left" : "center";
		context.textAlign = align;
		const x = rect.left - bounds.left + (align === "left" ? left : left + width / 2);
		const y = rect.top - bounds.top + rect.height / 2 - (lines.length - 1) * lineHeight / 2;
		context.save();
		context.beginPath();
		context.rect(rect.left - bounds.left, rect.top - bounds.top, rect.width, rect.height);
		context.clip();
		lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
		context.restore();
	}
	const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
		(result) => result ? resolve(result) : reject(new Error("Could not create the PNG.")), "image/png",
	));
	const url = URL.createObjectURL(blob);
	try {
		const link = document.createElement("a");
		link.href = url;
		link.download = `${title.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "recipe"}.png`;
		document.body.appendChild(link);
		link.click();
		link.remove();
	} finally {
		// Allow the browser to start the download before releasing the blob URL.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}
