import { describe, expect, it } from 'vitest';
import { runSharedCompileTests } from '@tsrx/core/test-harness/compile';
import { runSharedSourceMappingTests } from '@tsrx/core/test-harness/source-mappings';
import { compile, compile_to_volar_mappings } from '../src/index.js';

runSharedSourceMappingTests({
	compile,
	compile_to_volar_mappings,
	name: 'preact',
	rejectsComponentAwait: true,
});

runSharedCompileTests({ compile, name: 'preact', classAttrName: 'class' });

describe('@tsrx/preact basic', () => {
	it('preserves outer early-return narrowing when the branch renders before returning', () => {
		const { code } = compile(
			`declare function getFoo(): string | null;

			export component Test() {
				const foo = getFoo();

				if (!foo) {
					<div>{"Foo not found"}</div>
					return;
				}

				<div>{foo.trim()}</div>
			}`,
			'Test.tsrx',
		);

		expect(code).toContain('if (!foo) {');
		expect(code).toContain('return Test__static1;');
		expect(code).toContain('return <div>{foo.trim()}</div>;');
		expect(code).not.toContain('return <>{(() =>');
	});

	it('does not shadow outer JSX captures in nested rendered early-return branches', () => {
		const { code } = compile(
			`export component App() {
				let value = 'outer';
				<p>{value}</p>
				value = 'after outer';

				if (value) {
					<span>{value}</span>
					value = 'branch';
					<b>{value}</b>
					return;
				}

				<i>{value}</i>
			}`,
			'App.tsrx',
		);

		expect(code.match(/const _tsrx_child_0/g)).toHaveLength(1);
		expect(code).toContain('const _tsrx_child_1 = <span>{value}</span>;');
		expect(code).toContain('const _tsrx_child_2 = <b>{value}</b>;');
		expect(code).toContain('return <>{_tsrx_child_0}{_tsrx_child_1}{_tsrx_child_2}</>;');
	});

	it('imports Suspense from preact/compat when try/pending is used', () => {
		const { code } = compile(
			`export component App() {
				try {
					<div>{'async content'}</div>
				} pending {
					<p>{'loading...'}</p>
				}
			}`,
			'App.tsrx',
		);

		expect(code).toContain('Suspense');
		expect(code).toContain("from 'preact/compat'");
		expect(code).not.toContain("from 'react'");
	});

	it('allows overriding the Suspense import source via compile options', () => {
		const { code } = compile(
			`export component App() {
				try {
					<div>{'async content'}</div>
				} pending {
					<p>{'loading...'}</p>
				}
			}`,
			'App.tsrx',
			{ suspenseSource: 'preact-suspense' },
		);

		expect(code).toContain('Suspense');
		expect(code).toContain("from 'preact-suspense'");
		expect(code).not.toContain("from 'preact/compat'");
	});

	it('imports TsrxErrorBoundary from @tsrx/preact/error-boundary when try/catch is used', () => {
		const { code } = compile(
			`component ThrowingChild() {
				<div>{'might throw'}</div>
			}

			export component App() {
				try {
					<ThrowingChild />
				} catch (err) {
					<p>{'caught error'}</p>
				}
			}`,
			'App.tsrx',
		);

		expect(code).toContain('TsrxErrorBoundary');
		expect(code).toContain("from '@tsrx/preact/error-boundary'");
		expect(code).not.toContain("from '@tsrx/react/error-boundary'");
	});

	it('accepts <tsx:preact> blocks', () => {
		const { code } = compile(
			`export component App() {
				<tsx:preact>
					<div>{'preact tsx'}</div>
				</tsx:preact>
			}`,
			'App.tsrx',
		);

		expect(code).toContain("{'preact tsx'}");
	});

	it('rejects unsupported tsx compat kinds with Preact-branded message', () => {
		expect(() =>
			compile(
				`export component App() {
					<tsx:solid>
						<div>{'solid tsx'}</div>
					</tsx:solid>
				}`,
				'App.tsrx',
			),
		).toThrow(/Preact TSRX/);
	});

	it('rejects await without use server directive with Preact-branded message', () => {
		expect(() =>
			compile(
				`export component App() {
					const data = await fetchData();
					<div>{data}</div>
				}`,
				'App.tsrx',
			),
		).toThrow(/Preact components/);
	});

	it('applies for-control-flow keys to rendered elements', () => {
		const { code } = compile(
			`export component App({ items }: { items: { id: string, text: string }[] }) {
				for (const item of items; key item.id) {
					<div>{item.text}</div>
				}
			}`,
			'App.tsrx',
		);

		expect(code).toContain('.map(');
		expect(code).toContain('key={item.id}');
		expect(code).not.toContain('does not support `key` in `for` control flow');
	});

	it('does not hoist render-time expressions across early returns', () => {
		const { code } = compile(
			`export component Test() {
				<div>{Date.now()}</div>

				if (Math.random() > 0.5) {
					return;
				}
			}`,
			'Test.tsrx',
		);

		expect(code).not.toContain('const Test__static1');
		expect(code).toContain('if (Math.random() > 0.5) {');
		expect(code.match(/return <div>\{Date\.now\(\)\}<\/div>;/g)).toHaveLength(2);
		expect(code).not.toContain('return null;');
	});
});
