import path from 'path';
import { createFilter } from '@rollup/pluginutils';
import { compile } from 'ripple/compiler';

const PREFIX = '[@ripple-ts/rollup-plugin]';

/**
 * @param {unknown} error
 * @param {string} id
 * @returns {Error | {
 * 	name: string,
 * 	message: string,
 * 	plugin: string,
 * 	id: string,
 * 	loc: { file: string, line: number, column: number } | undefined,
 * 	frame: string | undefined,
 * 	code: string,
 * 	stack: undefined,
 * }}
 */
function create_ripple_plugin_error(error, id) {
	if (!(error instanceof Error)) {
		return /** @type {Error} */ (new Error(String(error)));
	}

	const ripple_error = /** @type {import('ripple/compiler').RippleCompileError} */ (error);
	const loc = ripple_error.loc
		? {
				file: id,
				line: ripple_error.loc.start.line,
				column: ripple_error.loc.start.column + 1,
			}
		: undefined;

	return {
		name: 'RippleCompileError',
		message: ripple_error.message,
		plugin: 'ripple',
		id,
		loc,
		frame: ripple_error.frame,
		code: ripple_error.code ?? 'RIPPLE_COMPILE_ERROR',
		stack: undefined,
	};
}

/**
 * @param [options] {Partial<import('.').Options>}
 * @returns {import('rollup').Plugin}
 */
export default function (options = {}) {
	const { compilerOptions = {}, ...rest } = options;
	const extensions = ['.ripple'];
	const filter = createFilter(rest.include, rest.exclude);

	// [filename]:[chunk]
	const cache_emit = new Map();
	const { emitCss = true } = rest;

	if (emitCss) {
		const cssOptionValue = 'external';
		if (compilerOptions.css) {
			console.warn(
				`${PREFIX} Forcing \`"compilerOptions.css": ${
					typeof cssOptionValue === 'string' ? `"${cssOptionValue}"` : cssOptionValue
				}\` because "emitCss" was truthy.`,
			);
		}
		compilerOptions.css = cssOptionValue;
	} else {
		compilerOptions.css = 'injected';
	}

	return {
		name: 'ripple',

		/**
		 * Returns CSS contents for a file, if ours
		 */
		load(id) {
			return cache_emit.get(id) || null;
		},

		/**
		 * Transforms a `.ripple` file into a `.js` file.
		 * NOTE: If `emitCss`, append static `import` to virtual CSS file.
		 */
		async transform(code, id) {
			if (!filter(id) || !id.endsWith('.ripple')) return null;

			const extension = path.extname(id);
			if (!~extensions.indexOf(extension)) return null;

			const filename = path.relative(process.cwd(), id);

			let compiled;
			try {
				compiled = await compile(code, filename, id);
			} catch (error) {
				this.error(create_ripple_plugin_error(error, id));
			}

			const { js, css } = compiled;

			if (emitCss && css && css.code) {
				const fname = id.replace(new RegExp(`\\${extension}$`), '.css');
				js.code += `\nimport ${JSON.stringify(fname)};\n`;
				cache_emit.set(fname, css);
			}
			return js;
		},
	};
}
