import { runSharedSwitchHelperHoistingTests } from '../../tsrx/tests/shared/hook-hoisting.js';
import { compile, compile_to_volar_mappings } from '../src/index.js';

runSharedSwitchHelperHoistingTests({
	compile,
	compile_to_volar_mappings,
	name: 'preact',
	clientHelperShape: 'module-function',
});
