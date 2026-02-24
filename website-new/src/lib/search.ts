export function extract_snippet(content: string, search_query: string, max_length = 120): string {
	const lower_content = content.toLowerCase();
	const terms = search_query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return content.slice(0, max_length) + '...';

	let best_idx = -1;
	let best_score = -1;

	for (const term of terms) {
		if (term.length < 2) continue;
		for (
			let idx = lower_content.indexOf(term);
			idx !== -1;
			idx = lower_content.indexOf(term, idx + 1)
		) {
			const score = term.length + (idx === 0 ? 10 : 0);
			if (score > best_score) {
				best_score = score;
				best_idx = idx;
			}
		}
	}

	if (best_idx === -1) {
		return content.slice(0, max_length) + '...';
	}

	const context_start = Math.max(0, best_idx - 30);
	let start = context_start;
	if (context_start > 0) {
		const space_idx = content.lastIndexOf(' ', best_idx - 10);
		if (space_idx > context_start) start = space_idx + 1;
	}

	const end = Math.min(content.length, start + max_length);
	let snippet = content.slice(start, end).trim();

	if (start > 0) snippet = '...' + snippet;
	if (end < content.length) snippet = snippet + '...';

	return snippet;
}
