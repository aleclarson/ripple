# Hook Safety Rebase Integration Plan

After resetting this branch to the latest upstream commit, re-apply the hook-safety module with the smallest possible wiring diff.

1. Copy `packages/tsrx/src/transform/jsx/hook-safety.js` onto the reset branch.
2. In `packages/tsrx/src/transform/jsx/index.js`, import the module exports that replace the in-file helpers:
   - `body_contains_top_level_hook_call`
   - `collect_pattern_names`
   - `is_hook_callee`
   - `statement_contains_top_level_hook_call`
   - `node_contains_top_level_hook_call`
   - `validate_hook_safe_body_does_not_assign_hook_results_to_outer_bindings`
3. Remove the now-duplicated in-file implementations from `index.js`:
   - hook error constants/reporters
   - hook-call detection helpers
   - hook-safe outer-binding validation helpers
4. Copy the isolated hook-hoisting test harness and target-specific test entries onto the reset branch:
   - `packages/tsrx/tests/shared/hook-hoisting.js`
   - `packages/tsrx-react/tests/hook-hoisting.test.js`
   - `packages/tsrx-preact/tests/hook-hoisting.test.js`
5. Keep the behavioral wiring from `38be5f346856` separate from this extraction. Reintroduce only the small calls/sites that upstream still lacks, resolving conflicts in `index.js` around helper creation, hook splitting, for-of/switch/try handling, and React/Preact platform hooks.
6. Validate with:
   - `pnpm test --project tsrx-react -- packages/tsrx-react/tests/basic.test.js packages/tsrx-react/tests/hook-hoisting.test.js`
   - `pnpm test --project tsrx-preact -- packages/tsrx-preact/tests/basic.test.js packages/tsrx-preact/tests/hook-hoisting.test.js`

This should keep future rebases focused on a stable module import plus a few integration call sites, rather than repeatedly reconciling the hook-safety implementation inside `index.js`.
