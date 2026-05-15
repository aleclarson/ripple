/** @import { LanguageServicePlugin } from '@volar/language-server' */
/** @import { TextDocument } from 'vscode-languageserver-textdocument' */
/** @import { DocumentSymbol, Range, SymbolKind as SymbolKindType } from '@volar/language-server' */

import { getVirtualCode, is_ripple_document, createLogging } from './utils.js';
import { parseModule } from '@tsrx/core';
import { SymbolKind } from '@volar/language-server';

const { log, logError } = createLogging('[Ripple Document Symbol Plugin]');

/**
 * @typedef {{
 * 	type: string;
 * 	start?: number;
 * 	end?: number;
 * 	id?: SymbolNode | null;
 * 	key?: SymbolNode;
 * 	name?: string;
 * 	value?: unknown;
 * 	kind?: string;
 * 	declaration?: SymbolNode | null;
 * 	declarations?: Array<SymbolNode & { id: SymbolNode, init?: SymbolNode | null }>;
 * 	body?: SymbolNode[] | { body?: SymbolNode[] };
 * 	css?: { start?: number, end?: number } | null;
 * }} SymbolNode
 */

/**
 * @returns {LanguageServicePlugin}
 */
export function createDocumentSymbolPlugin() {
	return {
		name: 'ripple-document-symbol',
		capabilities: {
			documentSymbolProvider: true,
		},
		create(context) {
			return {
				/**
				 * @param {TextDocument} document
				 * @returns {Promise<DocumentSymbol[]>}
				 */
				async provideDocumentSymbols(document) {
					let source = document.getText();
					let filename = document.uri;
					let parser = parseModule;

					if (!is_ripple_document(document.uri)) {
						const { virtualCode, sourceUri } = getVirtualCode(document, context);
						if (!virtualCode || virtualCode.languageId !== 'ripple') {
							log(`Skipping symbols in the '${virtualCode?.languageId}' context`);
							return [];
						}
						source = virtualCode.originalCode;
						filename = sourceUri.fsPath || sourceUri.path || filename;
						parser =
							/** @type {{ parse?: typeof parseModule }} */ (virtualCode.tsrx).parse || parseModule;
					}

					try {
						const ast = parser(source, filename, { collect: true, loose: true });
						const sourceDocument =
							source === document.getText()
								? document
								: createDocumentLike(filename, source, document.languageId);
						return collectDocumentSymbols(
							/** @type {SymbolNode} */ (/** @type {unknown} */ (ast)),
							sourceDocument,
						);
					} catch (error) {
						logError('Failed to provide document symbols:', error);
						return [];
					}
				},
			};
		},
	};
}

/**
 * @param {string} uri
 * @param {string} source
 * @param {string} languageId
 * @returns {Pick<TextDocument, 'positionAt' | 'getText' | 'languageId'>}
 */
function createDocumentLike(uri, source, languageId) {
	/** @type {number[] | undefined} */
	let lineOffsets;

	function getLineOffsets() {
		if (lineOffsets) return lineOffsets;
		lineOffsets = [0];
		for (let i = 0; i < source.length; i++) {
			if (source.charCodeAt(i) === 10) {
				lineOffsets.push(i + 1);
			}
		}
		return lineOffsets;
	}

	return {
		languageId,
		getText: () => source,
		positionAt(offset) {
			offset = Math.max(Math.min(offset, source.length), 0);
			const offsets = getLineOffsets();
			let low = 0;
			let high = offsets.length;
			while (low < high) {
				const mid = Math.floor((low + high) / 2);
				if (offsets[mid] > offset) high = mid;
				else low = mid + 1;
			}
			const line = low - 1;
			return { line, character: offset - offsets[line] };
		},
	};
}

/**
 * @param {SymbolNode} ast
 * @param {Pick<TextDocument, 'positionAt'>} document
 * @returns {DocumentSymbol[]}
 */
export function collectDocumentSymbols(ast, document) {
	const body = Array.isArray(ast.body) ? ast.body : [];
	return collectSymbolsFromStatements(body, document);
}

/**
 * @param {SymbolNode[]} statements
 * @param {Pick<TextDocument, 'positionAt'>} document
 * @returns {DocumentSymbol[]}
 */
function collectSymbolsFromStatements(statements, document) {
	/** @type {DocumentSymbol[]} */
	const symbols = [];

	for (const statement of statements) {
		if (!statement) continue;
		if (
			statement.type === 'ExportNamedDeclaration' ||
			statement.type === 'ExportDefaultDeclaration'
		) {
			if (statement.declaration) {
				symbols.push(...collectSymbolsFromStatements([statement.declaration], document));
			}
			continue;
		}

		const symbol = createSymbolForDeclaration(statement, document);
		if (symbol) {
			symbols.push(symbol);
		}
	}

	return symbols;
}

/**
 * @param {SymbolNode} node
 * @param {Pick<TextDocument, 'positionAt'>} document
 * @returns {DocumentSymbol | null}
 */
function createSymbolForDeclaration(node, document) {
	switch (node.type) {
		case 'Component':
			return createNamedNodeSymbol(
				getIdentifierName(node.id) || 'default',
				SymbolKind.Function,
				node,
				node.id || node,
				document,
				getChildSymbols(node, document),
			);

		case 'FunctionDeclaration':
			if (!node.id) return null;
			return createNamedNodeSymbol(
				getIdentifierName(node.id) || 'default',
				SymbolKind.Function,
				node,
				node.id,
				document,
				getChildSymbols(node, document),
			);

		case 'ClassDeclaration':
			if (!node.id) return null;
			return createNamedNodeSymbol(
				getIdentifierName(node.id) || 'default',
				SymbolKind.Class,
				node,
				node.id,
				document,
				getClassChildSymbols(node, document),
			);

		case 'VariableDeclaration':
			return createVariableDeclarationSymbol(node, document);

		case 'TSInterfaceDeclaration':
			if (!node.id) return null;
			return createNamedNodeSymbol(
				getIdentifierName(node.id) || 'interface',
				SymbolKind.Interface,
				node,
				node.id,
				document,
			);

		case 'TSTypeAliasDeclaration':
			if (!node.id) return null;
			return createNamedNodeSymbol(
				getIdentifierName(node.id) || 'type',
				SymbolKind.TypeParameter,
				node,
				node.id,
				document,
			);

		default:
			return null;
	}
}

/**
 * @param {SymbolNode} node
 * @param {Pick<TextDocument, 'positionAt'>} document
 * @returns {DocumentSymbol | null}
 */
function createVariableDeclarationSymbol(node, document) {
	const declarations = node.declarations || [];
	const namedDeclarations = declarations.filter(
		(declaration) => declaration.id.type === 'Identifier',
	);

	if (namedDeclarations.length === 0) {
		return null;
	}

	if (namedDeclarations.length === 1) {
		const declaration = namedDeclarations[0];
		const id = declaration.id;
		return createNamedNodeSymbol(
			getIdentifierName(id) || 'declaration',
			node.kind === 'const' ? SymbolKind.Constant : SymbolKind.Variable,
			node,
			id,
			document,
			declaration.init ? getInitializerChildSymbols(declaration.init, document) : [],
		);
	}

	return createNamedNodeSymbol(
		`${node.kind || 'var'} declarations`,
		node.kind === 'const' ? SymbolKind.Constant : SymbolKind.Variable,
		node,
		namedDeclarations[0].id,
		document,
		namedDeclarations.map((declaration) => {
			const id = declaration.id;
			return createNamedNodeSymbol(
				getIdentifierName(id) || 'declaration',
				node.kind === 'const' ? SymbolKind.Constant : SymbolKind.Variable,
				/** @type {SymbolNode} */ (/** @type {unknown} */ (declaration)),
				id,
				document,
				declaration.init ? getInitializerChildSymbols(declaration.init, document) : [],
			);
		}),
	);
}

/**
 * @param {SymbolNode} node
 * @param {Pick<TextDocument, 'positionAt'>} document
 * @returns {DocumentSymbol[]}
 */
function getInitializerChildSymbols(node, document) {
	if (node.type === 'Component') {
		return getChildSymbols(node, document);
	}
	if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
		return getChildSymbols(node, document);
	}
	return [];
}

/**
 * @param {SymbolNode} node
 * @param {Pick<TextDocument, 'positionAt'>} document
 * @returns {DocumentSymbol[]}
 */
function getChildSymbols(node, document) {
	if (Array.isArray(node.body)) {
		return collectSymbolsFromStatements(node.body, document);
	}
	if (node.body && !Array.isArray(node.body) && Array.isArray(node.body.body)) {
		return collectSymbolsFromStatements(node.body.body, document);
	}
	return [];
}

/**
 * @param {SymbolNode} node
 * @param {Pick<TextDocument, 'positionAt'>} document
 * @returns {DocumentSymbol[]}
 */
function getClassChildSymbols(node, document) {
	const body = !Array.isArray(node.body) && node.body?.body ? node.body.body : [];
	/** @type {DocumentSymbol[]} */
	const symbols = [];

	for (const member of body) {
		const name = getPropertyName(member.key);
		if (!name) continue;
		symbols.push(
			createNamedNodeSymbol(
				name,
				member.type === 'PropertyDefinition' ? SymbolKind.Property : SymbolKind.Method,
				member,
				member.key || member,
				document,
			),
		);
	}

	return symbols;
}

/**
 * @param {SymbolNode | undefined | null} node
 * @returns {string | null}
 */
function getPropertyName(node) {
	if (!node) return null;
	if (node.type === 'Identifier') return node.name || null;
	if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
	return null;
}

/**
 * @param {SymbolNode | null | undefined} node
 * @returns {string | null}
 */
function getIdentifierName(node) {
	return node?.name || null;
}

/**
 * @param {string} name
 * @param {SymbolKindType} kind
 * @param {SymbolNode} rangeNode
 * @param {SymbolNode} selectionNode
 * @param {Pick<TextDocument, 'positionAt'>} document
 * @param {DocumentSymbol[]} [children]
 * @returns {DocumentSymbol}
 */
function createNamedNodeSymbol(name, kind, rangeNode, selectionNode, document, children = []) {
	return {
		name,
		kind,
		range: createRange(rangeNode, document),
		selectionRange: createRange(/** @type {SymbolNode} */ (selectionNode), document),
		children,
	};
}

/**
 * @param {SymbolNode} node
 * @param {Pick<TextDocument, 'positionAt'>} document
 * @returns {Range}
 */
function createRange(node, document) {
	const start = typeof node.start === 'number' ? node.start : 0;
	const end = typeof node.end === 'number' ? node.end : start;
	return {
		start: document.positionAt(start),
		end: document.positionAt(end),
	};
}
