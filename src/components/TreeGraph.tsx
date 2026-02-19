"use client";

import Link from "next/link";

type PersonNode = {
  personId: string;
  displayName: string;
};

type GraphEdge = {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  label: string;
};

type TreeGraphProps = {
  basePath: string;
  nodes: PersonNode[];
  edges: GraphEdge[];
};

export function TreeGraph({ basePath, nodes, edges }: TreeGraphProps) {
  const width = 840;
  const height = 440;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.33;

  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
    positions.set(node.personId, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  });

  return (
    <div className="tree-graph-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="tree-lines" aria-label="Family tree graph">
        {edges.map((edge) => {
          const from = positions.get(edge.fromPersonId);
          const to = positions.get(edge.toPersonId);
          if (!from || !to) {
            return null;
          }
          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;
          return (
            <g key={edge.id}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="tree-line" />
              <text x={midX} y={midY} className="tree-line-label">
                {edge.label}
              </text>
            </g>
          );
        })}
      </svg>

      {nodes.map((node) => {
        const pos = positions.get(node.personId);
        if (!pos) {
          return null;
        }
        return (
          <Link
            key={node.personId}
            href={`${basePath}/people/${encodeURIComponent(node.personId)}`}
            className="tree-node"
            style={{ left: `${(pos.x / width) * 100}%`, top: `${(pos.y / height) * 100}%` }}
          >
            {node.displayName}
          </Link>
        );
      })}
    </div>
  );
}
