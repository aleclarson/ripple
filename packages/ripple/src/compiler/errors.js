/**
 @import * as AST from 'estree';
 @import { RippleCompileError } from 'ripple/compiler';
 */

/**
 * @typedef {{
 * 	node: AST.Node | AST.NodeWithLocation,
 * 	message?: string,
 * 	kind?: 'primary' | 'secondary',
 * }} DiagnosticLabelOption
 */

/**
 * @typedef {{
 * 	severity?: 'error' | 'warning',
 * 	code?: string,
 * 	help?: string,
 * 	notes?: string[],
 * 	labels?: DiagnosticLabelOption[],
 * }} DiagnosticOptions
 */

/**
 * @param {AST.Node | AST.NodeWithLocation} node
 * @param {string | undefined} message
 * @param {'primary' | 'secondary'} kind
 * @returns {import('ripple/compiler').RippleCompileLabel | null}
 */
function create_label(node, message, kind) {
	if (!node.loc) {
		return null;
	}

	return {
		kind,
		message,
		pos: node.start ?? undefined,
		end: node.end ?? undefined,
		loc: {
			start: {
				line: node.loc.start.line,
				column: node.loc.start.column,
			},
			end: {
				line: node.loc.end.line,
				column: node.loc.end.column,
			},
		},
	};
}

/**
 *
 * @param {string} message
 * @param {string | null} filename
 * @param {AST.Node | AST.NodeWithLocation} node
 * @param {RippleCompileError[]} [errors]
 * @param {AST.CommentWithLocation[]} [comments]
 * @param {DiagnosticOptions} [diagnostic_options]
 * @returns {void}
 */
export function error(message, filename, node, errors, comments, diagnostic_options = {}) {
	if (errors && comments && is_ripple_error_suppressed(node, comments)) {
		return;
	}

	const error = /** @type {RippleCompileError} */ (new Error(message));

	// same as the acorn compiler error
	error.pos = node.start ?? undefined;
	error.raisedAt = node.end ?? undefined;

	// custom properties
	error.fileName = filename;
	error.end = node.end ?? undefined;
	error.severity = diagnostic_options.severity ?? 'error';
	error.code = diagnostic_options.code;
	error.help = diagnostic_options.help;
	error.notes = diagnostic_options.notes;
	error.loc = !node.loc
		? undefined
		: {
				start: {
					line: node.loc.start.line,
					column: node.loc.start.column,
				},
				end: {
					line: node.loc.end.line,
					column: node.loc.end.column,
				},
			};
	error.labels = [];
	const primary_label = create_label(node, undefined, 'primary');
	if (primary_label) {
		error.labels.push(primary_label);
	}

	for (const label of diagnostic_options.labels ?? []) {
		const diagnostic_label = create_label(label.node, label.message, label.kind ?? 'secondary');
		if (diagnostic_label) {
			error.labels.push(diagnostic_label);
		}
	}

	if (errors) {
		error.type = 'usage';
		errors.push(error);
		return;
	}

	error.type = 'fatal';
	throw error;
}

/**
 * @param {AST.CommentWithLocation} comment
 * @return {boolean}
 */
function is_ripple_error_suppress_comment(comment) {
	const text = comment.value.trim();
	return text.startsWith('@ripple-ignore') || text.startsWith('@ripple-expect-error');
}

/**
 * @param {AST.Node | AST.NodeWithLocation} node
 * @param {AST.CommentWithLocation[]} comments
 */
function is_ripple_error_suppressed(node, comments) {
	if (node.loc) {
		const node_start_line = node.loc.start.line;
		for (const comment of comments) {
			if (comment.type === 'Line' && comment.loc.start.line === node_start_line - 1) {
				if (is_ripple_error_suppress_comment(comment)) {
					return true;
				}
			}
		}
	}
	return false;
}
