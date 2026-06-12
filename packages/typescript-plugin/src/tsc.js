#!/usr/bin/env node

import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getRippleLanguagePlugin } from './language.js';
import { is_declaration_output, rewrite_tsrx_declaration_imports } from './declaration-rewrite.js';

const require = createRequire(import.meta.url);
const { runTsc } = /** @type {typeof import('@volar/typescript/lib/quickstart/runTsc.js')} */ (
	require('@volar/typescript/lib/quickstart/runTsc.js')
);
const tscPath = require.resolve('typescript/lib/tsc.js');
const ts = require('typescript');

process.env.TSRX_TSC = 'true';

const original_open_sync = fs.openSync;
const original_write_sync = fs.writeSync;
const original_close_sync = fs.closeSync;
/** @type {Map<number, string>} */
const open_declaration_files = new Map();

/**
 * @param {import('node:fs').PathLike} file
 * @returns {string | undefined}
 */
function get_file_name(file) {
	if (typeof file === 'string') {
		return file;
	}
	if (file instanceof URL) {
		return fileURLToPath(file);
	}
	return undefined;
}

/**
 * @param {import('node:fs').PathLike} file
 * @param {string | number} flags
 * @param {import('node:fs').Mode | undefined} mode
 * @returns {number}
 */
function open_sync(file, flags, mode) {
	const fd =
		mode === undefined
			? original_open_sync.call(fs, file, flags)
			: original_open_sync.call(fs, file, flags, mode);
	const file_name = get_file_name(file);
	if (file_name && is_declaration_output(file_name)) {
		open_declaration_files.set(fd, file_name);
	}
	return fd;
}

/**
 * @param {number} fd
 * @param {string | NodeJS.ArrayBufferView} data
 * @param {unknown[]} rest
 * @returns {number}
 */
function write_sync(fd, data, ...rest) {
	const file_name = open_declaration_files.get(fd);
	if (file_name && typeof data === 'string') {
		return Reflect.apply(original_write_sync, fs, [
			fd,
			rewrite_tsrx_declaration_imports(ts, data, file_name),
			...rest,
		]);
	}
	return Reflect.apply(original_write_sync, fs, [fd, /** @type {any} */ (data), ...rest]);
}

/**
 * @param {number} fd
 * @returns {void}
 */
function close_sync(fd) {
	open_declaration_files.delete(fd);
	return original_close_sync.call(fs, fd);
}

try {
	fs.openSync = /** @type {typeof fs.openSync} */ (open_sync);
	fs.writeSync = /** @type {typeof fs.writeSync} */ (write_sync);
	fs.closeSync = close_sync;

	runTsc(
		tscPath,
		{
			extraSupportedExtensions: ['.tsrx'],
			extraExtensionsToRemove: ['.tsrx'],
		},
		() => [getRippleLanguagePlugin()],
	);
} finally {
	fs.openSync = original_open_sync;
	fs.writeSync = original_write_sync;
	fs.closeSync = original_close_sync;
	open_declaration_files.clear();
}
