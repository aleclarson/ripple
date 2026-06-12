/**
 * @import * as AST from '@tsrx/core/types/estree';
 */

/**
 * @param {AST.Node | AST.Comment} node
 * @returns {boolean}
 */
function isTSRXControlFlow(node) {
	return (
		node.type === 'JSXIfExpression' ||
		node.type === 'JSXForExpression' ||
		node.type === 'JSXSwitchExpression' ||
		node.type === 'JSXTryExpression'
	);
}

/**
 * @param {AST.Node | AST.Comment} node
 * @returns {boolean}
 */
function isTSRXJSXChild(node) {
	return (
		isTSRXControlFlow(node) ||
		node.type === 'JSXElement' ||
		node.type === 'JSXText' ||
		node.type === 'JSXExpressionContainer' ||
		node.type === 'JSXFragment'
	);
}

/**
 * @param {AST.Node | AST.Comment} currentNode
 * @param {AST.Node | AST.Comment} nextNode
 * @returns {boolean}
 */
export function shouldAddTSRXControlFlowBlankLine(currentNode, nextNode) {
	if (isTSRXControlFlow(nextNode) && !isTSRXJSXChild(currentNode)) {
		return true;
	}

	return (
		isTSRXControlFlow(currentNode) !== isTSRXControlFlow(nextNode) &&
		isTSRXJSXChild(currentNode) &&
		isTSRXJSXChild(nextNode)
	);
}
