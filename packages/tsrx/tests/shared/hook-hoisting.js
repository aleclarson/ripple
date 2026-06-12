import { describe, expect, it } from 'vitest';

/**
 * @typedef {{
 *   compile: (source: string, filename?: string, options?: any) => { code: string },
 *   compile_to_volar_mappings: (source: string, filename?: string, options?: any) => { code: string },
 *   name: string,
 *   clientHelperShape: SwitchHelperClientShape,
 * }} SwitchHelperHoistingHarness
 */

/**
 * Shared assertions covering where each target places the lifted
 * `StatementBodyHook` helper component for hook-bearing switch cases
 * — module scope for the client transform on every target whose platform
 * sets `moduleScopedHookComponents: true` (React, Solid, Vue), and a local
 * `let App__StatementBodyHook<N>` cache slot + per-render `?? (= …)` lazy
 * initializer otherwise. `compile_to_volar_mappings` keeps the local-scoped
 * shape regardless of platform default so Volar's virtual TSX can still
 * resolve closure-captured bindings against the component body.
 *
 * The `StatementBodyHook` name is React-flavored historically, but on
 * Vue/Solid the lift solves different problems (avoid re-`defineVaporComponent`
 * per render, keep hooks in stable branch components, etc.) — same machinery
 * either way.
 *
 * @typedef {'module-function' | 'module-vapor-component' | 'local-cache'} SwitchHelperClientShape
 *
 * @param {SwitchHelperHoistingHarness} harness
 */
export function runSharedSwitchHelperHoistingTests({
	compile,
	compile_to_volar_mappings,
	name,
	clientHelperShape,
}) {
	describe(`[${name}] StatementBodyHook hoisting (client vs typeOnly)`, () => {
		// Two case bodies contain hooks, so two helpers should exist. The
		// non-hook case stays inline and cases remain isolated.
		const switch_source = `export function App({ status }: { status: string }) @{
				@switch (status) {
					@case "idle": {
						const idle_label = useMemo(() => 'Online', [status]);
						<span>{idle_label}</span>
					}
					@case "active": {
						const active_label = useMemo(() => 'Away', [status]);
						<span>{active_label}</span>
					}
					@case "offline": {
						<span>{'Offline'}</span>
					}
				}
			}`;

		it('lifts hook-bearing case bodies in the client transform', () => {
			const { code } = compile(switch_source, 'App.tsrx');

			if (clientHelperShape === 'module-function') {
				// React/Solid: top-level `function App__StatementBodyHook<N>()`
				// declarations, no per-render cache slots.
				const top_level_helper_count = (
					code.match(/^function App__StatementBodyHook\d+\([^)]*\)/gm) || []
				).length;
				expect(top_level_helper_count).toBe(2);
				expect(code).not.toContain('let App__StatementBodyHook');
			} else if (clientHelperShape === 'module-vapor-component') {
				// Vue: top-level `const App__StatementBodyHook<N> =
				// defineVaporComponent(function App__StatementBodyHook<N>() {...})`.
				const top_level_helper_count = (
					code.match(
						/^const App__StatementBodyHook\d+ = defineVaporComponent\(function App__StatementBodyHook\d+\([^)]*\)/gm,
					) || []
				).length;
				expect(top_level_helper_count).toBe(2);
				expect(code).not.toContain('let App__StatementBodyHook');
			} else {
				// Preact: local cache slot + `?? (= function …)` lazy
				// initializer per hook-bearing body; no top-level declarations.
				const cache_slot_count = (code.match(/^let App__StatementBodyHook\d+;$/gm) || []).length;
				expect(cache_slot_count).toBe(2);
				expect(code).toMatch(
					/const StatementBodyHook\d+\s*=\s*App__StatementBodyHook\d+\s*\?\?\s*\(App__StatementBodyHook\d+\s*=\s*function StatementBodyHook\d+\(\)/,
				);
			}
		});

		it('keeps hook-bearing case helpers local in the typeOnly transform', () => {
			const { code } = compile_to_volar_mappings(switch_source, 'App.tsrx');

			// Volar's virtual TSX always uses the local cache-slot pattern so
			// closure-captured bindings stay in the component scope for type
			// checking. The wrapper inside the lazy initializer varies per
			// target — `defineVaporComponent(function …)` on Vue, plain
			// `function …` elsewhere — but the slot + `?? (=` shape is uniform.
			const cache_slot_count = (code.match(/^let App__StatementBodyHook\d+;$/gm) || []).length;
			expect(cache_slot_count).toBe(2);
			expect(code).toMatch(
				/const StatementBodyHook\d+\s*=\s*App__StatementBodyHook\d+\s*\?\?\s*\(App__StatementBodyHook\d+\s*=\s*/,
			);
			// No top-level helper declarations in either lifted shape.
			expect(code).not.toMatch(/^function App__StatementBodyHook\d+\(\)/m);
			expect(code).not.toMatch(/^const App__StatementBodyHook\d+ = defineVaporComponent\(/m);
		});
	});
}

