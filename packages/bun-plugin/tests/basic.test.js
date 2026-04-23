import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ripple } from '../src/index.js';

/**
 * @typedef {{
 * 	onResolve: Array<{ options: { filter: RegExp, namespace?: string }, callback: Function }>,
 * 	onLoad: Array<{ options: { filter: RegExp, namespace?: string }, callback: Function }>,
 * }} Hooks
 */

/**
 * @param {import('../types/index.js').RippleBunPluginOptions} [options]
 * @param {{ target?: string, root?: string }} [config]
 */
function setup_plugin(options, config = {}) {
	/** @type {Hooks} */
	const hooks = { onResolve: [], onLoad: [] };
	const plugin = ripple(options);
	plugin.setup({
		config,
		onResolve(hook_options, callback) {
			hooks.onResolve.push({ options: hook_options, callback });
		},
		onLoad(hook_options, callback) {
			hooks.onLoad.push({ options: hook_options, callback });
		},
	});
	return hooks;
}

/**
 * @param {Hooks} hooks
 * @param {string} file_path
 * @returns {Promise<{ contents: string, loader: string } | undefined>}
 */
async function load_tsrx(hooks, file_path) {
	const hook = hooks.onLoad.find(({ options }) => options.namespace === 'file');
	if (!hook) throw new Error('missing .tsrx onLoad hook');
	return hook.callback({ path: file_path, namespace: 'file', importer: '', kind: 'entry-point' });
}

/**
 * @param {Hooks} hooks
 * @param {string} id
 */
function load_css(hooks, id) {
	const resolve_hook = hooks.onResolve.find(({ options }) => options.filter.test(id));
	if (!resolve_hook) throw new Error('missing CSS onResolve hook');
	const resolved = resolve_hook.callback({ path: id, importer: '' });
	const load_hook = hooks.onLoad.find(({ options }) => options.namespace === resolved.namespace);
	if (!load_hook) throw new Error('missing CSS onLoad hook');
	return load_hook.callback({ path: resolved.path, namespace: resolved.namespace });
}

describe('@ripple-ts/bun-plugin', () => {
	it('compiles .tsrx files and serves emitted CSS through a virtual module', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'ripple-bun-plugin-'));
		try {
			const file_path = path.join(dir, 'App.tsrx');
			await writeFile(
				file_path,
				`export component App() {
					<div class="card">{'Hello world'}</div>

					<style>
						.card {
							color: red;
						}
					</style>
				}`,
			);

			const hooks = setup_plugin(undefined, { target: 'browser', root: dir });
			const transformed = await load_tsrx(hooks, file_path);
			const css_id = `${file_path}?ripple&type=style&lang.css`;
			const css = load_css(hooks, css_id);

			expect(transformed).toBeDefined();
			expect(transformed?.loader).toBe('js');
			expect(transformed?.contents).toContain(css_id);
			expect(transformed?.contents).toContain('ripple/internal/client');
			expect(css.loader).toBe('css');
			expect(css.contents).toContain('.card.');
			expect(css.contents).toContain('color: red;');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('can compile server modules without virtual CSS imports', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'ripple-bun-plugin-'));
		try {
			const file_path = path.join(dir, 'Server.tsrx');
			await writeFile(
				file_path,
				`export component Server() {
					<div>{'Hello server'}</div>
					<style>.div { color: blue; }</style>
				}`,
			);

			const hooks = setup_plugin({ emitCss: false }, { target: 'bun', root: dir });
			const transformed = await load_tsrx(hooks, file_path);

			expect(transformed).toBeDefined();
			expect(transformed?.contents).toContain('ripple/internal/server');
			expect(transformed?.contents).not.toContain('?ripple&type=style&lang.css');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('treats Bun default target as a client build', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'ripple-bun-plugin-'));
		try {
			const file_path = path.join(dir, 'DefaultTarget.tsrx');
			await writeFile(
				file_path,
				`export component DefaultTarget() {
					<div>{'Hello client'}</div>
				}`,
			);

			const hooks = setup_plugin(undefined, { root: dir });
			const transformed = await load_tsrx(hooks, file_path);

			expect(transformed).toBeDefined();
			expect(transformed?.contents).toContain('ripple/internal/client');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('honors exclude filters', async () => {
		const hooks = setup_plugin({ exclude: /ignored\.tsrx$/ }, { target: 'browser' });
		const transformed = await load_tsrx(hooks, '/project/ignored.tsrx');
		expect(transformed).toBeUndefined();
	});
});
