#!/usr/bin/env node

import { createRequire } from 'node:module';
import { getRippleLanguagePlugin } from '@tsrx/typescript-plugin/src/language.js';

const require = createRequire(import.meta.url);
const { runTsc } = /** @type {typeof import('@volar/typescript/lib/quickstart/runTsc.js')} */ (
	require('@volar/typescript/lib/quickstart/runTsc.js')
);
const tscPath = require.resolve('typescript/lib/tsc.js');

runTsc(
	tscPath,
	{
		extraSupportedExtensions: ['.tsrx'],
		extraExtensionsToRemove: ['.tsrx'],
	},
	() => [getRippleLanguagePlugin()],
);
