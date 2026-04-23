/** @import { JsxPlatform } from '@tsrx/core/types' */

import {
	builders,
	clone_identifier,
	componentToFunctionDeclaration,
	createJsxTransform,
	create_compile_error,
	setLocation,
} from '@tsrx/core';

/**
 * Minimal Vue platform descriptor consumed by `createJsxTransform`.
 *
 * Vue largely reuses the shared JSX lowering while wrapping compiled
 * components in `defineVaporComponent(...)` and handling its extra imports.
 * Async component bodies still stay explicitly unsupported.
 *
 * @type {JsxPlatform}
 */
const vue_platform = {
	name: 'Vue',
	imports: {
		suspense: 'vue',
		errorBoundary: '@tsrx/vue/error-boundary',
	},
	jsx: {
		rewriteClassAttr: false,
		acceptedTsxKinds: ['vue'],
	},
	validation: {
		requireUseServerForAwait: true,
		scanUseServerDirectiveForAwaitWithCustomValidator: false,
		unsupportedTryPendingMessage:
			'Vue TSRX does not support `pending` blocks in component templates yet. Vue Suspense uses fallback slots rather than a `fallback` prop, so `try { ... } pending { ... }` cannot be lowered correctly for this target yet.',
	},
	hooks: {
		initialState: () => ({
			needs_define_vapor_component: false,
		}),
		validateComponentAwait(await_expression) {
			throw create_compile_error(
				await_expression,
				'`await` is not yet supported in Vue TSRX components.',
			);
		},
		componentToFunction(component, ctx, helper_state) {
			ctx.needs_define_vapor_component = true;
			return component_to_vapor_component_declaration(component, ctx, helper_state);
		},
		injectImports(program, ctx) {
			inject_vue_imports(program, ctx);
		},
	},
};

export const transform = createJsxTransform(vue_platform);

/**
 * @param {any} component
 * @param {any} transform_context
 * @param {any} helper_state
 * @returns {any}
 */
function component_to_vapor_component_declaration(component, transform_context, helper_state) {
	const fn = componentToFunctionDeclaration(component, transform_context, helper_state);
	const meta = fn.metadata || { path: [] };
	const generated_helpers = helper_state?.helpers || [];
	const generated_statics = helper_state?.statics || [];
	const call = setLocation(
		/** @type {any} */ ({
			type: 'CallExpression',
			callee: {
				type: 'Identifier',
				name: 'defineVaporComponent',
				metadata: { path: [] },
			},
			arguments: [function_declaration_to_expression(fn)],
			optional: false,
			metadata: {
				path: [],
				generated_helpers,
				generated_statics,
			},
		}),
		component,
	);

	if (component.default || !component.id) {
		return call;
	}

	return setLocation(
		/** @type {any} */ ({
			type: 'VariableDeclaration',
			kind: 'const',
			declarations: [
				{
					type: 'VariableDeclarator',
					id: clone_identifier(component.id),
					init: call,
					metadata: { path: [] },
				},
			],
			metadata: {
				path: [],
				generated_helpers,
				generated_statics,
			},
		}),
		component,
	);
}

/**
 * @param {any} fn
 * @returns {any}
 */
function function_declaration_to_expression(fn) {
	return {
		...fn,
		type: 'FunctionExpression',
		metadata: {
			...(fn.metadata || {}),
			path: fn.metadata?.path || [],
		},
	};
}

/**
 * @param {any} node
 * @param {string} feature
 * @returns {Error}
 */
function unsupported_vue_feature(node, feature) {
	return create_compile_error(node, `${feature} are not yet supported in Vue TSRX.`);
}

/**
 * @param {import('estree').Program} program
 * @param {any} transform_context
 * @returns {void}
 */
function inject_vue_imports(program, transform_context) {
	if (transform_context.needs_define_vapor_component) {
		ensure_named_import(program, 'vue', 'defineVaporComponent');
	}

	if (transform_context.needs_suspense) {
		ensure_named_import(program, 'vue', 'Suspense');
	}

	if (transform_context.needs_error_boundary) {
		ensure_named_import(program, '@tsrx/vue/error-boundary', 'TsrxErrorBoundary');
	}
}

/**
 * @param {import('estree').Program} program
 * @param {string} source
 * @param {string} name
 * @returns {void}
 */
function ensure_named_import(program, source, name) {
	for (const statement of program.body) {
		if (statement.type !== 'ImportDeclaration' || statement.source?.value !== source) {
			continue;
		}

		const has_specifier = statement.specifiers.some(
			(/** @type {any} */ specifier) =>
				specifier.type === 'ImportSpecifier' &&
				specifier.imported?.type === 'Identifier' &&
				specifier.imported.name === name,
		);

		if (!has_specifier) {
			statement.specifiers.push(create_import_specifier(name));
		}

		return;
	}

	program.body.unshift(create_import_declaration(source, [create_import_specifier(name)]));
}

/**
 * @param {string} name
 * @returns {any}
 */
function create_import_specifier(name) {
	return {
		type: 'ImportSpecifier',
		imported: builders.id(name),
		local: builders.id(name),
		importKind: 'value',
		metadata: { path: [] },
	};
}

/**
 * @param {string} source
 * @param {any[]} specifiers
 * @returns {any}
 */
function create_import_declaration(source, specifiers) {
	return {
		type: 'ImportDeclaration',
		attributes: [],
		specifiers,
		importKind: 'value',
		source: builders.literal(source),
		metadata: { path: [] },
	};
}
