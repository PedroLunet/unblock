import { Position } from '@xyflow/svelte';
import type { InternalNode, XYPosition } from '@xyflow/svelte';

/**
 * Intersection of the line between the two node centers with the source node's
 * rectangular boundary. Port of the official Svelte Flow "Floating Edges" example.
 */
function getNodeIntersection(intersectionNode: InternalNode, targetNode: InternalNode): XYPosition {
	const intersectionNodePosition = intersectionNode.internals.positionAbsolute;
	const targetPosition = targetNode.internals.positionAbsolute;

	// Nodes that have not been measured yet have no boundary to intersect.
	const w = (intersectionNode.measured.width ?? 0) / 2;
	const h = (intersectionNode.measured.height ?? 0) / 2;

	const x2 = intersectionNodePosition.x + w;
	const y2 = intersectionNodePosition.y + h;

	if (w === 0 || h === 0) return { x: x2, y: y2 };

	const x1 = targetPosition.x + (targetNode.measured.width ?? 0) / 2;
	const y1 = targetPosition.y + (targetNode.measured.height ?? 0) / 2;

	const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
	const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
	const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
	const xx3 = a * xx1;
	const yy3 = a * yy1;

	return {
		x: w * (xx3 + yy3) + x2,
		y: h * (-xx3 + yy3) + y2
	};
}

/** Which side of the node the intersection point lies on. */
function getEdgePosition(node: InternalNode, point: XYPosition): Position {
	const position = node.internals.positionAbsolute;
	const width = node.measured.width ?? 0;
	const height = node.measured.height ?? 0;

	const nx = Math.round(position.x);
	const ny = Math.round(position.y);
	const px = Math.round(point.x);
	const py = Math.round(point.y);

	if (px <= nx + 1) return Position.Left;
	if (px >= nx + width - 1) return Position.Right;
	if (py <= ny + 1) return Position.Top;
	if (py >= ny + height - 1) return Position.Bottom;
	return Position.Top;
}

export function getEdgeParams(
	source: InternalNode,
	target: InternalNode
): {
	sx: number;
	sy: number;
	tx: number;
	ty: number;
	sourcePos: Position;
	targetPos: Position;
} {
	const sourceIntersectionPoint = getNodeIntersection(source, target);
	const targetIntersectionPoint = getNodeIntersection(target, source);

	return {
		sx: sourceIntersectionPoint.x,
		sy: sourceIntersectionPoint.y,
		tx: targetIntersectionPoint.x,
		ty: targetIntersectionPoint.y,
		sourcePos: getEdgePosition(source, sourceIntersectionPoint),
		targetPos: getEdgePosition(target, targetIntersectionPoint)
	};
}
