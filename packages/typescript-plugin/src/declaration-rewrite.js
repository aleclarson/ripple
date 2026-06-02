/** @import ts from 'typescript' */

const TSRX_EXTENSION = '.tsrx';
const TSX_EXTENSION = '.tsx';

/**
 * @param {string} file_name
 * @returns {boolean}
 */
export function is_declaration_output(file_name) {
	return (
		file_name.endsWith('.d.ts') || file_name.endsWith('.d.mts') || file_name.endsWith('.d.cts')
	);
}

/**
 * @param {string} specifier
 * @returns {string}
 */
function rewrite_specifier(specifier) {
	return specifier.endsWith(TSRX_EXTENSION)
		? specifier.slice(0, -TSRX_EXTENSION.length) + TSX_EXTENSION
		: specifier;
}

/**
 * @param {ts.StringLiteralLike} literal
 * @param {ts.SourceFile} source_file
 * @param {{ start: number, end: number, text: string }[]} replacements
 */
function add_replacement(literal, source_file, replacements) {
	const rewritten = rewrite_specifier(literal.text);
	if (rewritten === literal.text) {
		return;
	}

	replacements.push({
		start: literal.getStart(source_file) + 1,
		end: literal.getEnd() - 1,
		text: rewritten,
	});
}

/**
 * Rewrite .tsrx module specifiers that TypeScript preserves in declaration emit.
 *
 * @param {typeof import('typescript')} ts
 * @param {string} code
 * @param {string} file_name
 * @returns {string}
 */
export function rewrite_tsrx_declaration_imports(ts, code, file_name = 'output.d.ts') {
	const source_file = ts.createSourceFile(file_name, code, ts.ScriptTarget.Latest, true);
	/** @type {{ start: number, end: number, text: string }[]} */
	const replacements = [];

	/**
	 * @param {ts.Node} node
	 */
	function visit(node) {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			add_replacement(node.moduleSpecifier, source_file, replacements);
		} else if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteralLike(node.argument.literal)
		) {
			add_replacement(node.argument.literal, source_file, replacements);
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference) &&
			ts.isStringLiteralLike(node.moduleReference.expression)
		) {
			add_replacement(node.moduleReference.expression, source_file, replacements);
		}

		ts.forEachChild(node, visit);
	}

	visit(source_file);

	if (replacements.length === 0) {
		return code;
	}

	let rewritten = code;
	for (let i = replacements.length - 1; i >= 0; i--) {
		const replacement = replacements[i];
		rewritten =
			rewritten.slice(0, replacement.start) + replacement.text + rewritten.slice(replacement.end);
	}
	return rewritten;
}
