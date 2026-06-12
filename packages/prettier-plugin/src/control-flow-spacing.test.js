import { describe, it, expect } from 'vitest';
import prettier from 'prettier';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

expect.extend({
	toBeWithNewline(received, expected) {
		const expectedWithNewline = expected.endsWith('\n') ? expected : expected + '\n';
		const pass = received === expectedWithNewline;

		return {
			pass,
			message: () => {
				const { matcherHint, EXPECTED_COLOR, RECEIVED_COLOR } = this.utils;

				return (
					matcherHint('toBeWithNewline') +
					'\n\nExpected:\n' +
					EXPECTED_COLOR(expectedWithNewline) +
					'\nReceived:\n' +
					RECEIVED_COLOR(received)
				);
			},
		};
	},
});

/**
 * @param {string} code
 * @param {import('prettier').Options} [options]
 */
const format = async (code, options = {}) => {
	return await prettier.format(code, {
		parser: 'tsrx',
		plugins: [join(__dirname, 'index.js')],
		...options,
	});
};

describe('prettier-plugin control-flow spacing', () => {
	it('adds blank lines between TSRX control-flow directives and other JSX children', async () => {
		const input = `const App = () => <>
  <h1>{title}</h1>
  @if (ready) {<span>Ready</span>}
  {'after if'}
  @for (const item of items) {<span>{item}</span>}
  <footer />
</>;`;
		const expected = `const App = () => <>
  <h1>{title}</h1>

  @if (ready) {
    <span>Ready</span>
  }

  {"after if"}

  @for (const item of items) {
    <span>{item}</span>
  }

  <footer />
</>;`;

		const result = await format(input);
		expect(result).toBeWithNewline(expected);
	});

	it('adds a blank line before a TSRX control-flow directive used as the JSX root', async () => {
		const input = `function App() @{const ready = true; @if (ready) {<span>Ready</span>}}`;
		const expected = `function App() @{
  const ready = true;

  @if (ready) {
    <span>Ready</span>
  }
}`;

		const result = await format(input);
		expect(result).toBeWithNewline(expected);
	});

	it('does not add a leading blank line before a setup-less TSRX control-flow root', async () => {
		const input = `function App() @{@if (ready) {<span>Ready</span>}}`;
		const expected = `function App() @{
  @if (ready) {
    <span>Ready</span>
  }
}`;

		const result = await format(input);
		expect(result).toBeWithNewline(expected);
	});

	it('does not add outer blank lines when TSRX control flow is the first or last JSX child', async () => {
		const input = `const App = () => <>
  @if (ready) {<span>Ready</span>}
  <main />
  @for (const item of items) {<span>{item}</span>}
</>;`;
		const expected = `const App = () => <>
  @if (ready) {
    <span>Ready</span>
  }

  <main />

  @for (const item of items) {
    <span>{item}</span>
  }
</>;`;

		const result = await format(input);
		expect(result).toBeWithNewline(expected);
	});
});
