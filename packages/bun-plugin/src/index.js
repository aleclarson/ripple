/** @import { BunPlugin } from 'bun' */
/** @import { CompileOptions } from '@tsrx/ripple/types' */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compile } from '@tsrx/ripple';

const DEFAULT_INCLUDE = /\.tsrx$/;
const STYLE_NAMESPACE = 'ripple-style';
const STYLE_QUERY = '?ripple&type=style&lang.css';
const STYLE_QUERY_PATTERN = /\?ripple&type=style&lang\.css$/;

/**
 * @typedef {{
 * 	include?: RegExp,
 * 	exclude?: RegExp | RegExp[],
 * 	mode?: 'auto' | 'client' | 'server',
 * 	dev?: boolean,
 * 	hmr?: boolean,
 * 	emitCss?: boolean,
 * 	minifyCss?: boolean,
 * 	compatKinds?: string[],
 * }} RippleBunPluginOptions
 */

/**
 * @param {RegExp} pattern
 * @param {string} value
 * @returns {boolean}
 */
function test_pattern(pattern, value) {
	pattern.lastIndex = 0;
	return pattern.test(value);
}

/**
 * @param {RegExp | RegExp[] | undefined} pattern
 * @param {string} value
 * @returns {boolean}
 */
function matches_pattern(pattern, value) {
	if (!pattern) return false;
	if (Array.isArray(pattern)) {
		return pattern.some((entry) => test_pattern(entry, value));
	}
	return test_pattern(pattern, value);
}

/**
 * @param {RippleBunPluginOptions} options
 * @param {string} value
 * @returns {boolean}
 */
function should_compile(options, value) {
	const include = options.include ?? DEFAULT_INCLUDE;
	return test_pattern(include, value) && !matches_pattern(options.exclude, value);
}

/**
 * @param {string} file_path
 * @returns {string}
 */
function to_style_id(file_path) {
	return file_path + STYLE_QUERY;
}

/**
 * @param {RippleBunPluginOptions['mode']} mode
 * @param {unknown} target
 * @returns {'client' | 'server'}
 */
function resolve_mode(mode, target) {
	if (mode === 'client' || mode === 'server') return mode;
	return target === undefined || target === 'browser' ? 'client' : 'server';
}

/**
 * @param {string} file_path
 * @param {string | undefined} root
 * @returns {string}
 */
function to_compile_filename(file_path, root) {
	if (!root) return file_path;
	const relative = path.relative(root, file_path);
	if (relative.startsWith('..') || path.isAbsolute(relative)) return file_path;
	return `/${relative.split(path.sep).join('/')}`;
}

/**
 * Bun plugin for `.tsrx` files that compiles them through `@tsrx/ripple`.
 * Component-local styles are exposed as virtual CSS modules so Bun can keep
 * them in the bundle graph.
 *
 * @param {RippleBunPluginOptions} [options]
 * @returns {BunPlugin}
 */
export function ripple(options = {}) {
	/** @type {Map<string, string>} */
	const css_cache = new Map();

	return {
		name: '@ripple-ts/bun-plugin',

		setup(build) {
			const root = build.config.root ?? process.cwd();
			const mode = resolve_mode(options.mode, build.config.target);
			const emit_css = options.emitCss ?? true;
			const dev = options.dev ?? false;
			const hmr = options.hmr ?? (dev && mode === 'client');

			build.onResolve({ filter: STYLE_QUERY_PATTERN }, (args) => ({
				path: args.path,
				namespace: STYLE_NAMESPACE,
			}));

			build.onLoad({ filter: STYLE_QUERY_PATTERN, namespace: STYLE_NAMESPACE }, (args) => ({
				contents: css_cache.get(args.path) ?? '',
				loader: 'css',
			}));

			build.onLoad(
				{ filter: options.include ?? DEFAULT_INCLUDE, namespace: 'file' },
				async (args) => {
					if (!should_compile(options, args.path)) return undefined;

					const source = await readFile(args.path, 'utf-8');
					const filename = to_compile_filename(args.path, root);
					/** @type {CompileOptions} */
					const compile_options = {
						mode,
						dev,
						hmr,
						minify_css: options.minifyCss ?? false,
						compat_kinds: options.compatKinds,
					};
					const { js, css } = compile(source, filename, compile_options);
					const style_id = to_style_id(args.path);

					if (emit_css && css !== '') {
						css_cache.set(style_id, css);
						return {
							contents: `${js.code}\nimport ${JSON.stringify(style_id)};\n`,
							loader: 'js',
						};
					}

					css_cache.delete(style_id);
					return {
						contents: js.code,
						loader: 'js',
					};
				},
			);
		},
	};
}

export default ripple;
