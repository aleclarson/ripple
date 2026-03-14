/**
 * @import {Diagnostic, Range, LanguageServicePlugin, LanguageServiceContext, Position, Mapper} from '@volar/language-server';
 * @import {TextDocument} from 'vscode-languageserver-textdocument';
 * @import {RippleVirtualCode} from '@ripple-ts/typescript-plugin/src/language.js';
 */
// @ts-expect-error: ESM type import is fine
/** @import {RippleCompileError} from 'ripple/compiler'; */

const { getVirtualCode, createLogging } = require('./utils.js');

const { log } = createLogging('[Ripple Compile Error Diagnostic Plugin]');
const { DiagnosticSeverity } = require('@volar/language-server');

/**
 * @param {RippleCompileError} error
 * @returns {Diagnostic['severity']}
 */
function get_diagnostic_severity(error) {
	return error.severity === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error;
}

/**
 * @param {RippleCompileError} error
 * @returns {string}
 */
function get_diagnostic_message(error) {
	const detail_lines = [];

	if (error.help) {
		detail_lines.push(`help: ${error.help}`);
	}

	for (const note of error.notes ?? []) {
		detail_lines.push(`note: ${note}`);
	}

	return detail_lines.length === 0
		? error.message
		: `${error.message}\n\n${detail_lines.join('\n')}`;
}

/**
 * @returns {LanguageServicePlugin}
 */
function createCompileErrorDiagnosticPlugin() {
	log('Creating Ripple diagnostic plugin...');

	return {
		name: 'ripple-diagnostics',
		capabilities: {
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false,
			},
		},
		create(/** @type {LanguageServiceContext} */ context) {
			return {
				provideDiagnostics(document, _token) {
					log('Providing Ripple diagnostics for:', document.uri);

					/** @type {Diagnostic[]} */
					const diagnostics = [];
					const { virtualCode, sourceMap } = getVirtualCode(document, context);

					if (!virtualCode || virtualCode.languageId !== 'ripple') {
						// skip if it's like embedded css
						return diagnostics;
					}

					if (!virtualCode.fatalErrors.length && !virtualCode.usageErrors.length) {
						return diagnostics;
					}

					for (const error of [...virtualCode.fatalErrors, ...virtualCode.usageErrors]) {
						const diagnostic = parseCompilationErrorWithDocument(
							error,
							virtualCode,
							sourceMap,
							document,
						);
						diagnostics.push(diagnostic);
					}

					log('Generated', diagnostics.length, 'diagnostics');
					return diagnostics;
				},
			};
		},
	};
}

/**
 * @param {RippleCompileError} error
 * @param {RippleVirtualCode} virtualCode
 * @param {Mapper | undefined} sourceMap
 * @param {TextDocument} document
 * @returns {Diagnostic}
 */
function parseCompilationErrorWithDocument(error, virtualCode, sourceMap, document) {
	const primary_label = error.labels?.find((label) => label.kind !== 'secondary');
	const diagnostic_range =
		error.type === 'fatal'
			? get_error_range_from_source(error, document, primary_label)
			: get_error_range_from_mapping(error, virtualCode, sourceMap, document, primary_label);

	const relatedInformation = (error.labels ?? [])
		.filter((label) => label.kind === 'secondary' && label.loc)
		.map((label) => ({
			location: {
				uri: document.uri,
				range:
					error.type === 'fatal'
						? get_error_range_from_source(error, document, label)
						: get_error_range_from_mapping(error, virtualCode, sourceMap, document, label),
			},
			message: label.message ?? error.message,
		}));

	return {
		severity: get_diagnostic_severity(error),
		range: diagnostic_range,
		message: get_diagnostic_message(error),
		source: 'Ripple',
		code: error.code ?? (error.type === 'fatal' ? 'ripple-compile-error' : 'ripple-usage-error'),
		relatedInformation: relatedInformation.length === 0 ? undefined : relatedInformation,
	};
}

/**
 * @param {RippleCompileError} error
 * @param {RippleVirtualCode} virtualCode
 * @param {Mapper | undefined} sourceMap
 * @param {TextDocument} document
 * @param {{ pos?: number, end?: number } | undefined} label
 * @returns {Range}
 */
function get_error_range_from_mapping(error, virtualCode, sourceMap, document, label) {
	/** @type {Position | null} */
	let start = null;
	/** @type {Position | null} */
	let end = null;

	if ((label?.pos ?? error.pos) != null) {
		const start_offset = get_start_offset_from_error(error, label);
		const end_offset = get_end_offset_from_error(error, start_offset, label);
		const mapping = virtualCode.findMappingBySourceRange(start_offset, end_offset);

		if (mapping) {
			start = document.positionAt(mapping.generatedOffsets[0]);
			end = document.positionAt(mapping.generatedOffsets[0] + mapping.generatedLengths[0]);
		} else if (sourceMap) {
			const result = sourceMap.toGeneratedRange(start_offset, end_offset, true).next().value;

			if (result) {
				const [gen_start_offset, gen_end_offset] = result;
				start = document.positionAt(gen_start_offset);
				end = document.positionAt(gen_end_offset);
			}
		}
	}

	if (!start || !end) {
		start = { line: 0, character: 0 };
		end = { line: 0, character: 1 };
	}

	return { start, end };
}

/**
 * @param {RippleCompileError} error
 * @param {TextDocument} document
 * @param {{ pos?: number, end?: number } | undefined} [label]
 * @returns {Range}
 */
function get_error_range_from_source(error, document, label) {
	const start_offset = get_start_offset_from_error(error, label);
	return {
		start: document.positionAt(start_offset),
		end: document.positionAt(get_end_offset_from_error(error, start_offset, label)),
	};
}

/**
 * @param {RippleCompileError} error
 * @param {number} [start_offset]
 * @param {{ pos?: number, end?: number } | undefined} [label]
 * @returns {number}
 */
function get_end_offset_from_error(error, start_offset, label) {
	start_offset = start_offset ?? get_start_offset_from_error(error, label);
	const end_offset = label?.end ?? error.end;
	return end_offset != null
		? end_offset
		: error.raisedAt && (error.raisedAt ?? 0) > start_offset
			? error.raisedAt
			: start_offset + 1;
}

/**
 * @param {RippleCompileError} error
 * @param {{ pos?: number } | undefined} [label]
 * @returns {number}
 */
function get_start_offset_from_error(error, label) {
	return label?.pos ?? error.pos ?? 0;
}

module.exports = {
	createCompileErrorDiagnosticPlugin,
};
