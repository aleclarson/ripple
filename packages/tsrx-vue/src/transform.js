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
 * This first pass only establishes Vue Vapor component wrapping plus plain JSX
 * element emission. Reactive control-flow and async component bodies stay
 * explicitly unsupported until the Vue target owns those lowerings.
 *
 * @type {JsxPlatform}
 */
const vue_platform = {
	name: 'Vue',
	imports: {
		suspense: 'vue',
		errorBoundary: 'vue',
	},
	jsx: {
		rewriteClassAttr: false,
		acceptedTsxKinds: ['vue'],
	},
	validation: {
		requireUseServerForAwait: true,
		scanUseServerDirectiveForAwaitWithCustomValidator: false,
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
		controlFlow: {
			tryStatement(node) {
				throw unsupported_vue_feature(node, '`try` statements');
			},
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
	if (!transform_context.needs_define_vapor_component) {
		return;
	}

	for (const statement of program.body) {
		if (statement.type !== 'ImportDeclaration' || statement.source?.value !== 'vue') {
			continue;
		}

		const has_define_vapor_component = statement.specifiers.some(
			(/** @type {any} */ specifier) =>
				specifier.type === 'ImportSpecifier' &&
				specifier.imported?.type === 'Identifier' &&
				specifier.imported.name === 'defineVaporComponent',
		);

		if (!has_define_vapor_component) {
			statement.specifiers.push({
				type: 'ImportSpecifier',
				imported: builders.id('defineVaporComponent'),
				local: builders.id('defineVaporComponent'),
				importKind: 'value',
				metadata: { path: [] },
			});
		}

		return;
	}

	program.body.unshift({
		type: 'ImportDeclaration',
		attributes: [],
		specifiers: [
			{
				type: 'ImportSpecifier',
				imported: builders.id('defineVaporComponent'),
				local: builders.id('defineVaporComponent'),
				importKind: 'value',
				metadata: { path: [] },
			},
		],
		importKind: 'value',
		source: builders.literal('vue'),
		metadata: { path: [] },
	});
}
