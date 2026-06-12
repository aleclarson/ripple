import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup_fixture_workspaces, create_fixture_workspace } from './workspace-fixtures.js';
import {
	is_declaration_output,
	rewrite_tsrx_declaration_imports,
} from '../src/declaration-rewrite.js';

const tsrx_tsc_path = new URL('../src/tsc.js', import.meta.url);

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function run_tsrx_tsc(args, cwd) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [tsrx_tsc_path.pathname, ...args], {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('close', (code) => {
			resolve({ code, stdout, stderr });
		});
	});
}

describe('typescript-plugin declaration import rewriting', () => {
	afterEach(() => {
		cleanup_fixture_workspaces();
	});

	it('detects declaration output files', () => {
		expect(is_declaration_output('/tmp/index.d.ts')).toBe(true);
		expect(is_declaration_output('/tmp/index.d.mts')).toBe(true);
		expect(is_declaration_output('/tmp/index.d.cts')).toBe(true);
		expect(is_declaration_output('/tmp/index.tsbuildinfo')).toBe(false);
		expect(is_declaration_output('/tmp/index.ts')).toBe(false);
	});

	it('rewrites only .tsrx declaration module specifiers', () => {
		const source = [
			`import type { Foo } from './foo.tsrx';`,
			`export { Foo as Bar } from "./bar.tsrx";`,
			`export * from './baz.tsrx';`,
			`import Alias = require('./alias.tsrx');`,
			`export type Lazy = typeof import('./lazy.tsrx');`,
			`export type Literal = './not-a-module.tsrx';`,
			`export declare const value = ".tsrx";`,
		].join('\n');

		const rewritten = rewrite_tsrx_declaration_imports(ts, source);

		expect(rewritten).toContain(`from './foo.tsx'`);
		expect(rewritten).toContain(`from "./bar.tsx"`);
		expect(rewritten).toContain(`from './baz.tsx'`);
		expect(rewritten).toContain(`require('./alias.tsx')`);
		expect(rewritten).toContain(`import('./lazy.tsx')`);
		expect(rewritten).toContain(`export type Literal = './not-a-module.tsrx';`);
		expect(rewritten).toContain(`export declare const value = ".tsrx";`);
	});

	it('rewrites .tsrx imports in emitted declaration files', async () => {
		const workspace = create_fixture_workspace('react-only');
		const src_dir = path.join(workspace, 'src');

		fs.writeFileSync(
			path.join(workspace, 'tsconfig.json'),
			JSON.stringify(
				{
					compilerOptions: {
						target: 'ESNext',
						module: 'ESNext',
						moduleResolution: 'Bundler',
						jsx: 'preserve',
						strict: true,
						declaration: true,
						emitDeclarationOnly: true,
						outDir: 'dist',
						allowImportingTsExtensions: true,
						skipLibCheck: true,
					},
					include: ['src/**/*'],
				},
				null,
				2,
			) + '\n',
		);
		fs.writeFileSync(path.join(src_dir, 'foo.tsrx'), 'export default function Foo() {};\n');
		fs.writeFileSync(
			path.join(src_dir, 'index.ts'),
			[
				`export { default as Foo } from './foo.tsrx';`,
				`export type FooModule = typeof import('./foo.tsrx');`,
			].join('\n') + '\n',
		);

		const result = await run_tsrx_tsc(['-p', 'tsconfig.json'], workspace);

		expect(result, result.stderr || result.stdout).toMatchObject({ code: 0 });

		const declaration = fs.readFileSync(path.join(workspace, 'dist', 'index.d.ts'), 'utf8');
		expect(declaration).toContain(`from './foo.tsx'`);
		expect(declaration).toContain(`import('./foo.tsx')`);
		expect(declaration).not.toContain('.tsrx');
	});
});
