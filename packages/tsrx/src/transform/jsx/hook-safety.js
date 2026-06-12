/** @import { JsxTransformContext } from '@tsrx/core/types' */

import { error } from '../../errors.js';
import { is_function_or_component_node } from '../../utils/ast.js';

const HOOK_OUTER_ASSIGNMENT_ERROR =
	'Hook calls inside conditional or repeated TSRX scopes must keep their results local to the generated hook component.';
const HOOK_CALLBACK_OUTER_MUTATION_ERROR =
	'Hook callbacks inside conditional or repeated TSRX scopes must not mutate bindings declared outside the generated hook component.';

/**
 * @typedef {JsxTransformContext} TransformContext
 */

/**
 * @param {any} node
 * @param {string[]} names
 * @param {string} hook_name
 * @param {TransformContext} transform_context
 * @returns {void}
 */
function report_hook_outer_assignment_error(node, names, hook_name, transform_context) {
	const target =
		names.length === 1 ? `\`${names[0]}\`` : names.map((name) => `\`${name}\``).join(', ');
	error(
		`${HOOK_OUTER_ASSIGNMENT_ERROR} The ${hook_name} result is assigned to ${target}, which is declared outside that generated component. Declare the hook result inside the TSRX branch, or move the hook into an explicit child component and pass values with props.`,
		transform_context.filename,
		node,
		transform_context.errors,
		transform_context.comments,
	);
}

/**
 * @param {any} node
 * @param {string[]} names
 * @param {string} hook_name
 * @param {TransformContext} transform_context
 * @returns {void}
 */
function report_hook_callback_outer_mutation_error(node, names, hook_name, transform_context) {
	const target =
		names.length === 1 ? `\`${names[0]}\`` : names.map((name) => `\`${name}\``).join(', ');
	error(
		`${HOOK_CALLBACK_OUTER_MUTATION_ERROR} The ${hook_name} callback mutates ${target}. Read outer values through props or dependencies, and move mutable state into an explicit child component when it needs to change over time.`,
		transform_context.filename,
		node,
		transform_context.errors,
		transform_context.comments,
	);
}

/**
 * @param {any[]} body_nodes
 * @param {TransformContext} transform_context
 * @param {boolean} include_platform_setup
 * @returns {boolean}
 */
export function body_contains_top_level_hook_call(
	body_nodes,
	transform_context,
	include_platform_setup = false,
) {
	return body_nodes.some((node) =>
		statement_contains_top_level_hook_call(node, transform_context, include_platform_setup),
	);
}

/**
 * @param {any} node
 * @param {TransformContext} transform_context
 * @param {boolean} include_platform_setup
 * @returns {boolean}
 */
export function statement_contains_top_level_hook_call(node, transform_context, include_platform_setup) {
	return node_contains_top_level_hook_call(node, false, transform_context, include_platform_setup);
}

/**
 * @param {any} node
 * @param {boolean} inside_nested_function
 * @param {TransformContext} transform_context
 * @param {boolean} include_platform_setup
 * @returns {boolean}
 */
export function node_contains_top_level_hook_call(
	node,
	inside_nested_function,
	transform_context,
	include_platform_setup,
) {
	if (!node || typeof node !== 'object') {
		return false;
	}

	if (
		inside_nested_function &&
		(node.type === 'FunctionDeclaration' ||
			node.type === 'FunctionExpression' ||
			node.type === 'ArrowFunctionExpression')
	) {
		return false;
	}

	if (
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression'
	) {
		const next_inside_nested_function = true;
		for (const key of Object.keys(node)) {
			if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') {
				continue;
			}
			if (
				node_contains_top_level_hook_call(
					node[key],
					next_inside_nested_function,
					transform_context,
					include_platform_setup,
				)
			) {
				return true;
			}
		}
		return false;
	}

	if (
		!inside_nested_function &&
		node.type === 'CallExpression' &&
		(is_hook_callee(node.callee) ||
			(include_platform_setup &&
				transform_context.platform.hooks?.isTopLevelSetupCall?.(node, transform_context) === true))
	) {
		return true;
	}

	if (Array.isArray(node)) {
		return node.some((child) =>
			node_contains_top_level_hook_call(
				child,
				inside_nested_function,
				transform_context,
				include_platform_setup,
			),
		);
	}

	for (const key of Object.keys(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') {
			continue;
		}
		if (
			node_contains_top_level_hook_call(
				node[key],
				inside_nested_function,
				transform_context,
				include_platform_setup,
			)
		) {
			return true;
		}
	}

	return false;
}

/**
 * @param {any} callee
 * @returns {boolean}
 */
export function is_hook_callee(callee) {
	if (!callee) return false;

	if (callee.type === 'Identifier') {
		return /^use[A-Z0-9]/.test(callee.name);
	}

	if (
		!callee.computed &&
		callee.type === 'MemberExpression' &&
		callee.property?.type === 'Identifier'
	) {
		return /^use[A-Z0-9]/.test(callee.property.name);
	}

	return false;
}

/**
 * @param {any[]} body_nodes
 * @param {TransformContext} transform_context
 * @param {Set<string>} [local_binding_names]
 * @returns {void}
 */
export function validate_hook_safe_body_does_not_assign_hook_results_to_outer_bindings(
	body_nodes,
	transform_context,
	local_binding_names,
) {
	if (!is_react_like_hook_platform(transform_context)) {
		return;
	}
	if (!body_contains_top_level_hook_call(body_nodes, transform_context, true)) {
		return;
	}
	if (!transform_context.available_bindings || transform_context.available_bindings.size === 0) {
		return;
	}

	const shadowed_names = collect_block_binding_names(body_nodes);
	for (const name of local_binding_names || []) {
		shadowed_names.add(name);
	}
	validate_hook_outer_assignments_in_node(body_nodes, shadowed_names, transform_context, new Set());
}

/**
 * @param {TransformContext} transform_context
 * @returns {boolean}
 */
function is_react_like_hook_platform(transform_context) {
	return (
		transform_context.platform.name === 'React' || transform_context.platform.name === 'Preact'
	);
}

/**
 * @param {any[]} statements
 * @returns {Set<string>}
 */
function collect_block_binding_names(statements) {
	const names = new Set();
	for (const statement of statements || []) {
		collect_block_binding_names_from_statement(statement, names);
	}
	return names;
}

/**
 * @param {any} statement
 * @param {Set<string>} names
 * @returns {void}
 */
function collect_block_binding_names_from_statement(statement, names) {
	if (!statement || typeof statement !== 'object') {
		return;
	}

	if (statement.type === 'VariableDeclaration') {
		for (const declaration of statement.declarations || []) {
			collect_pattern_names(declaration.id, names);
		}
		return;
	}

	if (
		(statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') &&
		statement.id?.type === 'Identifier'
	) {
		names.add(statement.id.name);
		return;
	}

	if (
		statement.type === 'ForOfStatement' ||
		statement.type === 'ForInStatement' ||
		(statement.type === 'JSXForExpression' &&
			(statement.statementType === 'ForOfStatement' ||
				statement.statementType === 'ForInStatement'))
	) {
		if (statement.left?.type === 'VariableDeclaration' && statement.left.kind === 'var') {
			for (const declaration of statement.left.declarations || []) {
				collect_pattern_names(declaration.id, names);
			}
		}
		return;
	}

	if (
		statement.type === 'ForStatement' &&
		statement.init?.type === 'VariableDeclaration' &&
		statement.init.kind === 'var'
	) {
		for (const declaration of statement.init.declarations || []) {
			collect_pattern_names(declaration.id, names);
		}
	}
}

/**
 * @param {any} pattern
 * @param {Set<string>} names
 * @returns {void}
 */
export function collect_pattern_names(pattern, names) {
	if (!pattern || typeof pattern !== 'object') {
		return;
	}

	if (pattern.type === 'Identifier') {
		names.add(pattern.name);
		return;
	}

	if (pattern.type === 'RestElement') {
		collect_pattern_names(pattern.argument, names);
		return;
	}

	if (pattern.type === 'AssignmentPattern') {
		collect_pattern_names(pattern.left, names);
		return;
	}

	if (pattern.type === 'ArrayPattern') {
		for (const element of pattern.elements || []) {
			collect_pattern_names(element, names);
		}
		return;
	}

	if (pattern.type === 'ObjectPattern') {
		for (const property of pattern.properties || []) {
			if (property.type === 'RestElement') {
				collect_pattern_names(property.argument, names);
			} else {
				collect_pattern_names(property.value, names);
			}
		}
	}
}

/**
 * @param {any} node
 * @param {Set<string>} shadowed_names
 * @param {TransformContext} transform_context
 * @param {Set<string>} hook_result_names
 * @returns {void}
 */
function validate_hook_outer_assignments_in_node(
	node,
	shadowed_names,
	transform_context,
	hook_result_names,
) {
	if (!node || typeof node !== 'object') {
		return;
	}

	if (Array.isArray(node)) {
		for (const child of node) {
			validate_hook_outer_assignments_in_node(
				child,
				shadowed_names,
				transform_context,
				hook_result_names,
			);
		}
		return;
	}

	if (is_function_or_component_node(node)) {
		return;
	}

	if (node.type === 'CallExpression' && is_hook_callee(node.callee)) {
		validate_hook_callback_outer_mutations(node, shadowed_names, transform_context);
	}

	if (node.type === 'BlockStatement') {
		const next_shadowed = new Set(shadowed_names);
		const next_hook_result_names = new Set(hook_result_names);
		for (const name of collect_block_binding_names(node.body || [])) {
			next_shadowed.add(name);
		}
		for (const child of node.body || []) {
			validate_hook_outer_assignments_in_node(
				child,
				next_shadowed,
				transform_context,
				next_hook_result_names,
			);
		}
		return;
	}

	if (node.type === 'VariableDeclaration') {
		for (const declaration of node.declarations || []) {
			if (
				declaration.init &&
				expression_contains_hook_derived_value(
					declaration.init,
					transform_context,
					hook_result_names,
				)
			) {
				collect_pattern_names(declaration.id, hook_result_names);
			}
			validate_hook_outer_assignments_in_node(
				declaration.init,
				shadowed_names,
				transform_context,
				hook_result_names,
			);
		}
		return;
	}

	if (
		node.type === 'AssignmentExpression' &&
		expression_contains_hook_derived_value(node.right, transform_context, hook_result_names)
	) {
		const outer_names = get_referenced_outer_binding_names(
			node.left,
			transform_context.available_bindings,
			shadowed_names,
		);
		if (outer_names.length > 0) {
			report_hook_outer_assignment_error(
				node.left,
				outer_names,
				find_first_hook_call_name(node.right) || 'hook',
				transform_context,
			);
		}
		for (const name of get_referenced_local_binding_names(node.left, shadowed_names)) {
			hook_result_names.add(name);
		}
	}

	if (is_for_of_control_node(node)) {
		if (
			node.left &&
			node.left.type !== 'VariableDeclaration' &&
			expression_contains_hook_derived_value(node.right, transform_context, hook_result_names)
		) {
			const outer_names = get_referenced_outer_binding_names(
				node.left,
				transform_context.available_bindings,
				shadowed_names,
			);
			if (outer_names.length > 0) {
				report_hook_outer_assignment_error(
					node.left,
					outer_names,
					find_first_hook_call_name(node.right) || 'hook',
					transform_context,
				);
			}
			for (const name of get_referenced_local_binding_names(node.left, shadowed_names)) {
				hook_result_names.add(name);
			}
		}

		validate_hook_outer_assignments_in_node(
			node.right,
			shadowed_names,
			transform_context,
			hook_result_names,
		);

		// Loop-declared bindings (`for (const x of …)`, `for (let x of …)`) live
		// only in the body. They are deliberately NOT in the enclosing block's
		// shadowed set (see collect_block_binding_names_from_statement), so add
		// them just for the body recursion to keep references to the loop var
		// from being flagged as outer-binding mutations.
		const body_shadowed = new Set(shadowed_names);
		if (node.left && node.left.type === 'VariableDeclaration') {
			for (const declaration of node.left.declarations || []) {
				collect_pattern_names(declaration.id, body_shadowed);
			}
		}
		validate_hook_outer_assignments_in_node(
			node.body,
			body_shadowed,
			transform_context,
			hook_result_names,
		);
		return;
	}

	for (const key of Object.keys(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') {
			continue;
		}
		validate_hook_outer_assignments_in_node(
			node[key],
			shadowed_names,
			transform_context,
			hook_result_names,
		);
	}
}


/**
 * @param {any} node
 * @returns {boolean}
 */
function is_for_of_control_node(node) {
	return (
		node?.type === 'ForOfStatement' ||
		(node?.type === 'JSXForExpression' && node.statementType === 'ForOfStatement')
	);
}

/**
 * @param {any} call_node
 * @param {Set<string>} shadowed_names
 * @param {TransformContext} transform_context
 * @returns {void}
 */
function validate_hook_callback_outer_mutations(call_node, shadowed_names, transform_context) {
	const hook_name = get_hook_callee_name(call_node.callee);
	for (const argument of call_node.arguments || []) {
		if (!is_function_or_component_node(argument)) {
			continue;
		}
		const callback_shadowed_names = create_function_like_shadowed_names(argument, shadowed_names);
		validate_hook_callback_outer_mutations_in_node(
			argument.body,
			callback_shadowed_names,
			transform_context,
			hook_name,
		);
	}
}

/**
 * @param {any} node
 * @param {Set<string>} shadowed_names
 * @returns {Set<string>}
 */
function create_function_like_shadowed_names(node, shadowed_names) {
	const next_shadowed_names = new Set(shadowed_names);
	for (const param of node.params || []) {
		collect_pattern_names(param, next_shadowed_names);
	}
	if (node.body?.type === 'BlockStatement') {
		for (const name of collect_block_binding_names(node.body.body || [])) {
			next_shadowed_names.add(name);
		}
	}
	return next_shadowed_names;
}

/**
 * @param {any} node
 * @param {Set<string>} shadowed_names
 * @param {TransformContext} transform_context
 * @param {string} hook_name
 * @returns {void}
 */
function validate_hook_callback_outer_mutations_in_node(
	node,
	shadowed_names,
	transform_context,
	hook_name,
) {
	if (!node || typeof node !== 'object') {
		return;
	}

	if (Array.isArray(node)) {
		for (const child of node) {
			validate_hook_callback_outer_mutations_in_node(
				child,
				shadowed_names,
				transform_context,
				hook_name,
			);
		}
		return;
	}

	if (is_function_or_component_node(node)) {
		validate_hook_callback_outer_mutations_in_node(
			node.body,
			create_function_like_shadowed_names(node, shadowed_names),
			transform_context,
			hook_name,
		);
		return;
	}

	if (node.type === 'BlockStatement') {
		const next_shadowed_names = new Set(shadowed_names);
		for (const name of collect_block_binding_names(node.body || [])) {
			next_shadowed_names.add(name);
		}
		for (const child of node.body || []) {
			validate_hook_callback_outer_mutations_in_node(
				child,
				next_shadowed_names,
				transform_context,
				hook_name,
			);
		}
		return;
	}

	if (node.type === 'AssignmentExpression') {
		const outer_names = get_referenced_outer_binding_names(
			node.left,
			transform_context.available_bindings,
			shadowed_names,
		);
		if (outer_names.length > 0) {
			report_hook_callback_outer_mutation_error(
				node.left,
				outer_names,
				hook_name,
				transform_context,
			);
		}
	}

	if (node.type === 'UpdateExpression') {
		const outer_names = get_referenced_outer_binding_names(
			node.argument,
			transform_context.available_bindings,
			shadowed_names,
		);
		if (outer_names.length > 0) {
			report_hook_callback_outer_mutation_error(
				node.argument,
				outer_names,
				hook_name,
				transform_context,
			);
		}
	}

	for (const key of Object.keys(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') {
			continue;
		}
		if (key === 'left' && node.type === 'AssignmentExpression') {
			continue;
		}
		if (key === 'argument' && node.type === 'UpdateExpression') {
			continue;
		}
		validate_hook_callback_outer_mutations_in_node(
			node[key],
			shadowed_names,
			transform_context,
			hook_name,
		);
	}
}

/**
 * @param {any} node
 * @param {TransformContext} transform_context
 * @param {Set<string>} hook_result_names
 * @returns {boolean}
 */
function expression_contains_hook_derived_value(node, transform_context, hook_result_names) {
	return (
		node_contains_top_level_hook_call(node, false, transform_context, true) ||
		references_name_in_set(node, hook_result_names)
	);
}

/**
 * @param {any} node
 * @param {Set<string>} names
 * @returns {boolean}
 */
function references_name_in_set(node, names) {
	if (!node || typeof node !== 'object' || names.size === 0) {
		return false;
	}

	if (node.type === 'Identifier') {
		return names.has(node.name);
	}

	if (
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression'
	) {
		return false;
	}

	if (Array.isArray(node)) {
		return node.some((child) => references_name_in_set(child, names));
	}

	for (const key of Object.keys(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') {
			continue;
		}
		if (key === 'property' && node.type === 'MemberExpression' && !node.computed) {
			continue;
		}
		if (key === 'key' && node.type === 'Property' && !node.computed && !node.shorthand) {
			continue;
		}
		if (references_name_in_set(node[key], names)) {
			return true;
		}
	}

	return false;
}

/**
 * @param {any} node
 * @param {Set<string>} shadowed_names
 * @returns {string[]}
 */
function get_referenced_local_binding_names(node, shadowed_names) {
	const names = new Set();
	collect_referenced_local_binding_names(node, shadowed_names, names);
	return [...names];
}

/**
 * @param {any} node
 * @param {Set<string>} shadowed_names
 * @param {Set<string>} names
 * @returns {void}
 */
function collect_referenced_local_binding_names(node, shadowed_names, names) {
	if (!node || typeof node !== 'object') {
		return;
	}

	if (node.type === 'Identifier') {
		if (shadowed_names.has(node.name)) {
			names.add(node.name);
		}
		return;
	}

	if (Array.isArray(node)) {
		for (const child of node) {
			collect_referenced_local_binding_names(child, shadowed_names, names);
		}
		return;
	}

	for (const key of Object.keys(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') {
			continue;
		}
		if (key === 'property' && node.type === 'MemberExpression' && !node.computed) {
			continue;
		}
		if (key === 'key' && node.type === 'Property' && !node.computed && !node.shorthand) {
			continue;
		}
		collect_referenced_local_binding_names(node[key], shadowed_names, names);
	}
}

/**
 * @param {any} node
 * @param {Map<string, AST.Identifier>} available_bindings
 * @param {Set<string>} shadowed_names
 * @returns {string[]}
 */
function get_referenced_outer_binding_names(node, available_bindings, shadowed_names) {
	const names = new Set();
	collect_referenced_outer_binding_names(node, available_bindings, shadowed_names, names);
	return [...names];
}

/**
 * @param {any} node
 * @param {Map<string, AST.Identifier>} available_bindings
 * @param {Set<string>} shadowed_names
 * @param {Set<string>} names
 * @returns {void}
 */
function collect_referenced_outer_binding_names(node, available_bindings, shadowed_names, names) {
	if (!node || typeof node !== 'object') {
		return;
	}

	if (node.type === 'Identifier') {
		if (available_bindings.has(node.name) && !shadowed_names.has(node.name)) {
			names.add(node.name);
		}
		return;
	}

	if (Array.isArray(node)) {
		for (const child of node) {
			collect_referenced_outer_binding_names(child, available_bindings, shadowed_names, names);
		}
		return;
	}

	for (const key of Object.keys(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') {
			continue;
		}
		if (key === 'property' && node.type === 'MemberExpression' && !node.computed) {
			continue;
		}
		if (key === 'key' && node.type === 'Property' && !node.computed && !node.shorthand) {
			continue;
		}
		collect_referenced_outer_binding_names(node[key], available_bindings, shadowed_names, names);
	}
}

/**
 * @param {any} node
 * @returns {string | null}
 */
function find_first_hook_call_name(node) {
	if (!node || typeof node !== 'object') {
		return null;
	}

	if (node.type === 'CallExpression' && is_hook_callee(node.callee)) {
		return get_hook_callee_name(node.callee);
	}

	if (
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression'
	) {
		return null;
	}

	if (Array.isArray(node)) {
		for (const child of node) {
			const name = find_first_hook_call_name(child);
			if (name) return name;
		}
		return null;
	}

	for (const key of Object.keys(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') {
			continue;
		}
		const name = find_first_hook_call_name(node[key]);
		if (name) return name;
	}

	return null;
}

/**
 * @param {any} callee
 * @returns {string}
 */
function get_hook_callee_name(callee) {
	if (callee?.type === 'Identifier') {
		return callee.name;
	}
	if (
		callee?.type === 'MemberExpression' &&
		!callee.computed &&
		callee.property?.type === 'Identifier'
	) {
		return callee.property.name;
	}
	return 'hook';
}

