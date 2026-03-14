/** @import { RippleCompileError, RippleCompileLabel } from 'ripple/compiler'; */

import { DIAGNOSTIC_CODES } from './diagnostic-codes.js';

const DEFAULT_FILE_NAME = '<anon>';
const TAB_WIDTH = 2;

/**
 * @param {boolean} color
 * @returns {{
 * 	error_header: (text: string) => string,
 * 	warning_header: (text: string) => string,
 * 	header_message: (text: string) => string,
 * 	arrow: (text: string) => string,
 * 	gutter: (text: string) => string,
 * 	primary_caret: (text: string) => string,
 * 	secondary_caret: (text: string) => string,
 * 	primary_label: (text: string) => string,
 * 	secondary_label: (text: string) => string,
 * 	help: (text: string) => string,
 * 	note: (text: string) => string,
 * }}
 */
function create_palette(color) {
	if (!color) {
		return {
			error_header: (text) => text,
			warning_header: (text) => text,
			header_message: (text) => text,
			arrow: (text) => text,
			gutter: (text) => text,
			primary_caret: (text) => text,
			secondary_caret: (text) => text,
			primary_label: (text) => text,
			secondary_label: (text) => text,
			help: (text) => text,
			note: (text) => text,
		};
	}

	const RESET = '\x1b[0m';
	const BOLD = '\x1b[1m';
	const RED = '\x1b[31m';
	const YELLOW = '\x1b[33m';
	const GREEN = '\x1b[32m';
	const BLUE = '\x1b[94m';
	const WHITE = '\x1b[97m';

	/**
	 * @param {string} ansi
	 * @returns {(text: string) => string}
	 */
	function wrap(ansi) {
		return (text) => `${ansi}${text}${RESET}`;
	}

	return {
		error_header: wrap(`${BOLD}${RED}`),
		warning_header: wrap(`${BOLD}${YELLOW}`),
		header_message: wrap(`${BOLD}${WHITE}`),
		arrow: wrap(BLUE),
		gutter: wrap(BLUE),
		primary_caret: wrap(`${BOLD}${RED}`),
		secondary_caret: wrap(BLUE),
		primary_label: wrap(`${BOLD}${RED}`),
		secondary_label: wrap(BLUE),
		help: wrap(`${BOLD}${YELLOW}`),
		note: wrap(`${BOLD}${GREEN}`),
	};
}

/**
 * @param {RippleCompileError} error
 * @returns {'error' | 'warning'}
 */
function get_severity(error) {
	return error.severity ?? 'error';
}

/**
 * @param {RippleCompileError} error
 * @returns {RippleCompileLabel | undefined}
 */
function get_primary_label(error) {
	if (!error.labels || error.labels.length === 0) {
		return undefined;
	}

	return error.labels.find((label) => label.kind !== 'secondary') ?? error.labels[0];
}

/**
 * @param {RippleCompileError} error
 * @returns {Array<{ label: RippleCompileLabel, is_primary: boolean }>}
 */
function get_ordered_labels(error) {
	if (!error.labels || error.labels.length === 0) {
		return [];
	}

	return error.labels
		.map((label) => ({
			label,
			is_primary: label.kind !== 'secondary',
		}))
		.sort((a, b) => {
			const line_difference = a.label.loc.start.line - b.label.loc.start.line;
			if (line_difference !== 0) {
				return line_difference;
			}

			const column_difference = a.label.loc.start.column - b.label.loc.start.column;
			if (column_difference !== 0) {
				return column_difference;
			}

			return Number(b.is_primary) - Number(a.is_primary);
		});
}

/**
 * @param {string} source
 * @param {number} line_number
 * @returns {string}
 */
function get_source_line(source, line_number) {
	const lines = source.split(/\r?\n/);
	return lines[line_number - 1] ?? '';
}

/**
 * @param {string} value
 * @param {number} [raw_column]
 * @returns {number}
 */
function get_display_column(value, raw_column = value.length) {
	let display_column = 0;

	for (let index = 0; index < raw_column && index < value.length; index += 1) {
		if (value[index] === '\t') {
			display_column += TAB_WIDTH - (display_column % TAB_WIDTH);
		} else {
			display_column += 1;
		}
	}

	return display_column;
}

/**
 * @param {string} value
 * @returns {string}
 */
function expand_tabs(value) {
	let expanded = '';
	let display_column = 0;

	for (const character of value) {
		if (character === '\t') {
			const spaces = TAB_WIDTH - (display_column % TAB_WIDTH);
			expanded += ' '.repeat(spaces);
			display_column += spaces;
		} else {
			expanded += character;
			display_column += 1;
		}
	}

	return expanded;
}

/**
 * @param {import('estree').SourceLocation} loc
 * @param {string} source_line
 * @returns {number}
 */
function get_caret_count(loc, source_line) {
	const start_column = get_display_column(source_line, loc.start.column);

	if (loc.start.line !== loc.end.line) {
		return Math.max(1, expand_tabs(source_line).length - start_column);
	}

	return Math.max(1, get_display_column(source_line, loc.end.column) - start_column);
}

/**
 * @param {number} width
 * @returns {string}
 */
function create_empty_gutter(width) {
	return `${' '.repeat(width)} |`;
}

/**
 * @param {number} width
 * @returns {string}
 */
function create_gap_gutter(width) {
	return `${' '.repeat(width)} ⋮`;
}

/**
 * @param {ReturnType<typeof create_palette>} palette
 * @param {number} gutter_width
 * @param {number} line_number
 * @param {string} source_line
 * @returns {string}
 */
function format_source_line(palette, gutter_width, line_number, source_line) {
	return `${palette.gutter(`${String(line_number).padStart(gutter_width, ' ')} |`)} ${expand_tabs(source_line)}`;
}

/**
 * @param {RippleCompileLabel} label
 * @param {string} source
 * @param {ReturnType<typeof create_palette>} palette
 * @param {boolean} is_primary
 * @param {number} gutter_width
 * @returns {string}
 */
function format_label_caret_line(label, source, palette, is_primary, gutter_width) {
	const source_line = get_source_line(source, label.loc.start.line);
	const gutter = create_empty_gutter(gutter_width);
	const caret_prefix = ' '.repeat(
		Math.max(0, get_display_column(source_line, label.loc.start.column)),
	);
	const caret = '^'.repeat(get_caret_count(label.loc, source_line));
	const suffix = !label.message
		? ''
		: ` ${(is_primary ? palette.primary_label : palette.secondary_label)(label.message)}`;

	return `${palette.gutter(gutter)} ${caret_prefix}${(is_primary
		? palette.primary_caret
		: palette.secondary_caret)(caret)}${suffix}`;
}

/**
 * @param {RippleCompileLabel} label
 * @param {string} source
 * @param {ReturnType<typeof create_palette>} palette
 * @param {boolean} is_primary
 * @param {number} gutter_width
 * @param {number} max_lines
 * @returns {string[]}
 */
function format_multiline_label_context(
	label,
	source,
	palette,
	is_primary,
	gutter_width,
	max_lines,
) {
	const source_lines = source.split(/\r?\n/);
	const total_lines = label.loc.end.line - label.loc.start.line + 1;
	const parts = [palette.gutter(create_empty_gutter(gutter_width))];

	if (total_lines <= max_lines) {
		for (
			let line_number = label.loc.start.line;
			line_number <= label.loc.end.line;
			line_number += 1
		) {
			parts.push(
				format_source_line(palette, gutter_width, line_number, source_lines[line_number - 1] ?? ''),
			);

			if (line_number === label.loc.start.line) {
				parts.push(format_label_caret_line(label, source, palette, is_primary, gutter_width));
			}
		}

		return parts;
	}

	for (
		let line_number = label.loc.start.line;
		line_number < label.loc.start.line + 3;
		line_number += 1
	) {
		parts.push(
			format_source_line(palette, gutter_width, line_number, source_lines[line_number - 1] ?? ''),
		);

		if (line_number === label.loc.start.line) {
			parts.push(format_label_caret_line(label, source, palette, is_primary, gutter_width));
		}
	}

	if (label.loc.start.line + 3 < label.loc.end.line - 2) {
		parts.push(palette.gutter(create_gap_gutter(gutter_width)));
	}

	for (
		let line_number = label.loc.end.line - 2;
		line_number <= label.loc.end.line;
		line_number += 1
	) {
		parts.push(
			format_source_line(palette, gutter_width, line_number, source_lines[line_number - 1] ?? ''),
		);
	}

	return parts;
}

/**
 * @param {RippleCompileLabel} label
 * @param {string} source
 * @param {ReturnType<typeof create_palette>} palette
 * @param {boolean} is_primary
 * @param {number} gutter_width
 * @param {boolean} [include_leading_gutter]
 * @param {boolean} [include_source_line]
 * @returns {string[]}
 */
function format_label_block(
	label,
	source,
	palette,
	is_primary,
	gutter_width,
	include_leading_gutter = true,
	include_source_line = true,
) {
	const line_number = String(label.loc.start.line);
	const source_line = get_source_line(source, label.loc.start.line);
	const gutter = create_empty_gutter(gutter_width);

	const parts = [format_label_caret_line(label, source, palette, is_primary, gutter_width)];

	if (include_source_line) {
		parts.unshift(format_source_line(palette, gutter_width, Number(line_number), source_line));
	}

	if (include_leading_gutter) {
		parts.unshift(palette.gutter(gutter));
	}

	return parts;
}

/**
 * @param {RippleCompileError} error
 * @returns {{ code?: string, help?: string, notes?: string[] }}
 */
function infer_diagnostic_details(error) {
	if (error.code || error.help || (error.notes && error.notes.length > 0)) {
		return {
			code: error.code,
			help: error.help,
			notes: error.notes,
		};
	}

	if (error.message === 'Identifier directly after number') {
		return {
			code: DIAGNOSTIC_CODES.IDENTIFIER_DIRECTLY_AFTER_NUMBER,
			help: 'Did you forget an operator between the number and the identifier?',
		};
	}

	if (error.message === "Cannot use keyword 'await' outside an async function") {
		return {
			code: DIAGNOSTIC_CODES.AWAIT_KEYWORD_OUTSIDE_ASYNC_OR_MODULE,
			help: 'Move the `await` expression into an async function or top-level module scope.',
		};
	}

	return {
		code: error.code,
		help: error.help,
		notes: error.notes,
	};
}

/**
 * @param {string} source
 * @param {number} offset
 * @returns {{ line: number, column: number }}
 */
function get_point_from_offset(source, offset) {
	offset = Math.max(0, Math.min(offset, source.length));
	let line = 1;
	let column = 0;

	for (let index = 0; index < offset; index += 1) {
		if (source[index] === '\n') {
			line += 1;
			column = 0;
		} else {
			column += 1;
		}
	}

	return { line, column };
}

/**
 * @param {RippleCompileError} error
 * @param {string} source
 * @returns {import('estree').SourceLocation | undefined}
 */
function normalize_error_loc(error, source) {
	if (error.loc?.start && error.loc?.end) {
		return error.loc;
	}

	if (error.loc && 'line' in error.loc && 'column' in error.loc) {
		const start = {
			line: Number(error.loc.line),
			column: Number(error.loc.column),
		};
		const end_offset =
			error.end ??
			(error.raisedAt != null && error.raisedAt > (error.pos ?? 0) ? error.raisedAt : undefined) ??
			(error.pos ?? 0) + 1;
		return {
			start,
			end: get_point_from_offset(source, end_offset),
		};
	}

	if (error.pos != null) {
		const start = get_point_from_offset(source, error.pos);
		const end_offset =
			error.end ??
			(error.raisedAt != null && error.raisedAt > error.pos ? error.raisedAt : undefined) ??
			error.pos + 1;
		return {
			start,
			end: get_point_from_offset(source, end_offset),
		};
	}

	return undefined;
}

/**
 * @param {string} message
 * @returns {string}
 */
function normalize_error_message(message) {
	message = message.replace(/ \(\d+:\d+\)$/, '');

	if (message === 'Unsyntactic continue') {
		return '`continue` statements are not allowed in components';
	}

	if (message === 'Unsyntactic break') {
		return '`break` statements are not allowed in components';
	}

	return message;
}

/**
 * @param {RippleCompileError} error
 * @param {string} source
 * @returns {void}
 */
function normalize_upstream_diagnostic(error, source) {
	if (error.message === "Cannot use keyword 'await' outside an async function") {
		error.message =
			'The `await` keyword can only be used inside an async function or at the top level of a module.';
		error.code = DIAGNOSTIC_CODES.AWAIT_KEYWORD_OUTSIDE_ASYNC_OR_MODULE;
		error.help = 'Move the `await` expression into an async function or top-level module scope.';
		return;
	}

	if (error.message !== 'Unexpected token' || error.pos == null) {
		return;
	}

	const window_start = Math.max(0, error.pos - 16);
	if (source.slice(error.pos, error.pos + 5) === 'using') {
		return;
	}
}

/**
 * @param {RippleCompileError} error
 * @param {string} source
 * @returns {void}
 */
function normalize_error_span(error, source) {
	if (
		error.message.includes('Trailing comma is not permitted after the rest element') &&
		error.pos != null &&
		error.pos > 0 &&
		source[error.pos - 1] === ','
	) {
		error.pos -= 1;
		error.end = error.pos + 1;
		error.loc = undefined;
	}
}

/**
 * @param {RippleCompileError} error
 * @param {string} source
 * @param {boolean} [color]
 * @returns {string}
 */
function format_compile_error_frame(error, source, color = false) {
	const primary_label = get_primary_label(error);
	if (!primary_label) {
		return '';
	}

	const palette = create_palette(color);
	const ordered_labels = get_ordered_labels(error);
	const gutter_width = Math.max(
		...ordered_labels.map(({ label }) => String(label.loc.start.line).length),
	);
	const footer_prefix = `${' '.repeat(gutter_width)} = `;

	const blocks = [
		palette.arrow(
			`${' '.repeat(gutter_width)}--> ${error.fileName ?? DEFAULT_FILE_NAME}:${primary_label.loc.start.line}:${primary_label.loc.start.column + 1}`,
		),
	];

	if (
		(error.code === DIAGNOSTIC_CODES.SWITCH_CASE_REQUIRES_TEMPLATE ||
			error.code === DIAGNOSTIC_CODES.FOR_OF_REQUIRES_TEMPLATE ||
			error.code === DIAGNOSTIC_CODES.IF_THEN_REQUIRES_TEMPLATE ||
			error.code === DIAGNOSTIC_CODES.IF_ELSE_REQUIRES_TEMPLATE ||
			error.code === DIAGNOSTIC_CODES.TRY_MAIN_REQUIRES_TEMPLATE ||
			error.code === DIAGNOSTIC_CODES.TRY_PENDING_REQUIRES_TEMPLATE) &&
		ordered_labels.length === 1
	) {
		const { label, is_primary } = ordered_labels[0];
		blocks.push(
			...format_multiline_label_context(label, source, palette, is_primary, gutter_width, 5),
		);

		const { help, notes } = infer_diagnostic_details(error);

		if (help) {
			blocks.push(`${footer_prefix}${palette.help('help')}: ${help}`);
		}

		for (const note of notes ?? []) {
			blocks.push(`${footer_prefix}${palette.note('note')}: ${note}`);
		}

		return blocks.join('\n');
	}

	if (error.code === DIAGNOSTIC_CODES.CSS_EXPECTED_TOKEN && ordered_labels.length === 1) {
		const { label, is_primary } = ordered_labels[0];
		const source_lines = source.split(/\r?\n/);
		const start_line = Math.max(1, label.loc.start.line - 2);
		const end_line = Math.min(source_lines.length, label.loc.start.line + 2);
		blocks.push(palette.gutter(create_empty_gutter(gutter_width)));

		for (let line_number = start_line; line_number <= end_line; line_number += 1) {
			blocks.push(
				format_source_line(palette, gutter_width, line_number, source_lines[line_number - 1] ?? ''),
			);

			if (line_number === label.loc.start.line) {
				blocks.push(format_label_caret_line(label, source, palette, is_primary, gutter_width));
			}
		}

		const { help, notes } = infer_diagnostic_details(error);

		if (help) {
			blocks.push(`${footer_prefix}${palette.help('help')}: ${help}`);
		}

		for (const note of notes ?? []) {
			blocks.push(`${footer_prefix}${palette.note('note')}: ${note}`);
		}

		return blocks.join('\n');
	}

	let previous_line = null;

	for (const { label, is_primary } of ordered_labels) {
		const has_gap = previous_line != null && label.loc.start.line - previous_line > 1;
		const is_same_line = previous_line === label.loc.start.line;

		if (has_gap) {
			blocks.push(palette.gutter(create_gap_gutter(gutter_width)));
		}

		blocks.push(
			...format_label_block(
				label,
				source,
				palette,
				is_primary,
				gutter_width,
				!has_gap && !is_same_line,
				!is_same_line,
			),
		);
		previous_line = label.loc.start.line;
	}

	const { help, notes } = infer_diagnostic_details(error);

	if (help) {
		blocks.push(`${footer_prefix}${palette.help('help')}: ${help}`);
	}

	for (const note of notes ?? []) {
		blocks.push(`${footer_prefix}${palette.note('note')}: ${note}`);
	}

	return blocks.join('\n');
}

/**
 * @param {RippleCompileError} error
 * @param {string} source
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
export function format_compile_error(error, source, options = {}) {
	const color = options.color === true;
	const palette = create_palette(color);
	const { code } = infer_diagnostic_details(error);
	const severity = get_severity(error);
	const severity_text = `${severity}${code ? `[${code}]` : ''}`;
	const header = `${(severity === 'warning' ? palette.warning_header : palette.error_header)(
		severity_text,
	)}${palette.header_message(`: ${error.message}`)}`;
	const frame = format_compile_error_frame(error, source, color);
	return frame ? `${header}\n${frame}` : header;
}

/**
 * @param {RippleCompileError} error
 * @param {string} source
 * @param {string} [filename]
 * @returns {RippleCompileError}
 */
export function enhance_compile_error(error, source, filename) {
	if (filename && !error.fileName) {
		error.fileName = filename;
	}

	normalize_upstream_diagnostic(error, source);
	error.message = normalize_error_message(error.message);
	normalize_error_span(error, source);
	error.severity ??= 'error';
	error.loc = normalize_error_loc(error, source);

	if (error.loc) {
		error.labels ??= [];

		if (!error.labels.some((label) => label.kind !== 'secondary')) {
			error.labels.unshift({
				kind: 'primary',
				loc: error.loc,
				message: undefined,
				pos: error.pos,
				end: error.end,
			});
		}
	}

	const { code, help, notes } = infer_diagnostic_details(error);
	error.code ??= code;
	error.help ??= help;
	error.notes ??= notes;

	if (
		error.code === DIAGNOSTIC_CODES.AWAIT_KEYWORD_OUTSIDE_ASYNC_OR_MODULE &&
		error.message === "Cannot use keyword 'await' outside an async function"
	) {
		error.message =
			'The `await` keyword can only be used inside an async function or at the top level of a module.';
	}

	if (error.code === DIAGNOSTIC_CODES.DUPLICATE_DECLARATION) {
		const primary_label = error.labels?.find((label) => label.kind !== 'secondary');
		const variable_name = error.message.match(
			/(?:Identifier |')([^']+)' has already been declared/,
		)?.[1];

		if (primary_label && !primary_label.message && variable_name) {
			primary_label.message = `The second declaration of '${variable_name}' is here.`;
		}
	}

	if (
		error.code === DIAGNOSTIC_CODES.UNCLOSED_SCRIPT_TAG ||
		error.code === DIAGNOSTIC_CODES.UNCLOSED_STYLE_TAG ||
		error.code === DIAGNOSTIC_CODES.UNCLOSED_TAG
	) {
		const primary_label = error.labels?.find((label) => label.kind !== 'secondary');
		if (primary_label && !primary_label.message) {
			primary_label.message = 'The tag should be closed before this.';
		}

		if (primary_label && error.raisedAt != null && error.raisedAt > 0) {
			primary_label.pos = error.raisedAt - 1;
			primary_label.end = error.raisedAt;
			primary_label.loc = {
				start: get_point_from_offset(source, error.raisedAt - 1),
				end: get_point_from_offset(source, error.raisedAt),
			};
		}
	}

	error.frame = format_compile_error_frame(error, source) || undefined;
	error.ansiFrame = format_compile_error_frame(error, source, true) || undefined;
	error.formattedMessage = format_compile_error(error, source);
	error.ansiFormattedMessage = format_compile_error(error, source, { color: true });
	return error;
}

/**
 * @param {RippleCompileError[]} errors
 * @param {string} source
 * @param {string} [filename]
 * @returns {RippleCompileError[]}
 */
export function enhance_compile_errors(errors, source, filename) {
	for (const error of errors) {
		enhance_compile_error(error, source, filename);
	}

	return errors;
}
