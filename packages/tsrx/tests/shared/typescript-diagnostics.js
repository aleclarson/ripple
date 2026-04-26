import { fileURLToPath } from 'url';
import ts from 'typescript';

/**
 * @typedef {{
 *   code: number,
 *   message: string,
 *   text?: string,
 * }} TypeDiagnostic
 */

/**
 * @typedef {{
 *   fileName: string | URL,
 *   jsxImportSource?: string,
 *   compilerOptions?: ts.CompilerOptions,
 * }} TypeDiagnosticOptions
 */

/**
 * @param {string | URL} file_name
 * @returns {string}
 */
function normalize_file_name(file_name) {
	return file_name instanceof URL ? fileURLToPath(file_name) : file_name;
}

/**
 * Runs TypeScript diagnostics against an in-memory TSX module.
 *
 * Keep `fileName` near the package under test so TypeScript resolves that
 * package's JSX runtime and ambient types.
 *
 * @param {string} code
 * @param {TypeDiagnosticOptions} options
 * @returns {TypeDiagnostic[]}
 */
export function getTypeDiagnostics(code, { fileName, jsxImportSource, compilerOptions = {} }) {
	const file_name = normalize_file_name(fileName);
	/** @type {ts.CompilerOptions} */
	const compiler_options = {
		noEmit: true,
		strict: true,
		jsx: ts.JsxEmit.ReactJSX,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		target: ts.ScriptTarget.ESNext,
		lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
		skipLibCheck: true,
		types: [],
		...compilerOptions,
	};

	if (jsxImportSource !== undefined) {
		compiler_options.jsxImportSource = jsxImportSource;
	}

	const host = ts.createCompilerHost(compiler_options);
	const get_source_file = host.getSourceFile.bind(host);
	const file_exists = host.fileExists.bind(host);
	const read_file = host.readFile.bind(host);

	host.getSourceFile = (name, language_version, on_error, should_create_new_source_file) => {
		if (name === file_name) {
			return ts.createSourceFile(name, code, language_version, true, ts.ScriptKind.TSX);
		}
		return get_source_file(name, language_version, on_error, should_create_new_source_file);
	};
	host.fileExists = (name) => name === file_name || file_exists(name);
	host.readFile = (name) => (name === file_name ? code : read_file(name));

	return ts
		.getPreEmitDiagnostics(ts.createProgram([file_name], compiler_options, host))
		.map((diagnostic) => ({
			code: diagnostic.code,
			message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
			text:
				diagnostic.file && diagnostic.start !== undefined
					? diagnostic.file.text.slice(
							diagnostic.start,
							diagnostic.start + (diagnostic.length ?? 0),
						)
					: undefined,
		}));
}
