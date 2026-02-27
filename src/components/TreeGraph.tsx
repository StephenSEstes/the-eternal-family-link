"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FocusPanel } from "@/components/familyTree/FocusPanel";
import { GraphControls } from "@/components/familyTree/GraphControls";
import { PersonNodeCard } from "@/components/familyTree/PersonNodeCard";

type PersonNode = {
  personId: string;
  displayName: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
  birthDate?: string;
};

type GraphEdge = {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  label: string;
};

type HouseholdLink = {
  id: string;
  partner1PersonId: string;
  partner2PersonId: string;
  label?: string;
  notes?: string;
};

type TreeGraphProps = {
  nodes: PersonNode[];
  edges: GraphEdge[];
  households?: HouseholdLink[];
};

export function TreeGraph({ nodes, edges, households = [] }: TreeGraphProps) {
  const NODE_CARD_WIDTH = 208;
  const NODE_HALF_WIDTH = NODE_CARD_WIDTH / 2;
  const NODE_HALF_HEIGHT = 30;
  const SPOUSE_GAP = 0;
  const NON_SPOUSE_GAP = 56;
  const MIN_SCALE = 0.35;
  const MAX_SCALE = 2.8;

  const partnerMap = new Map<string, string>();
  const spousePairIds = new Set<string>();
  const spousePairMeta = new Map<string, { leftId: string; rightId: string; label: string }>();
  const parentEdges = edges.filter((edge) => edge.label.trim().toLowerCase() === "parent");

  const parentIdsByChild = new Map<string, Set<string>>();
  const childIdsByParent = new Map<string, Set<string>>();
  nodes.forEach((node) => {
    parentIdsByChild.set(node.personId, new Set());
    childIdsByParent.set(node.personId, new Set());
  });

  parentEdges.forEach((edge) => {
    parentIdsByChild.get(edge.toPersonId)?.add(edge.fromPersonId);
    childIdsByParent.get(edge.fromPersonId)?.add(edge.toPersonId);
  });

  households.forEach((unit) => {
    const leftId = unit.partner1PersonId;
    const rightId = unit.partner2PersonId;
    if (!leftId || !rightId) {
      return;
    }
    partnerMap.set(leftId, rightId);
    partnerMap.set(rightId, leftId);
    const pairKey = [leftId, rightId].sort().join("::");
    spousePairIds.add(pairKey);
    spousePairMeta.set(pairKey, { leftId, rightId, label: unit.label?.trim() ?? "" });
  });

  edges.forEach((edge) => {
    if (edge.label.trim().toLowerCase() !== "family") {
      return;
    }
    partnerMap.set(edge.fromPersonId, edge.toPersonId);
    partnerMap.set(edge.toPersonId, edge.fromPersonId);
    const pairKey = [edge.fromPersonId, edge.toPersonId].sort().join("::");
    spousePairIds.add(pairKey);
    if (!spousePairMeta.has(pairKey)) {
      spousePairMeta.set(pairKey, {
        leftId: edge.fromPersonId,
        rightId: edge.toPersonId,
        label: "",
      });
    }
  });

  const hiddenParentEdgeIds = new Set<string>();
  const familyChildConnectors: Array<{ pairKey: string; childId: string }> = [];
  parentIdsByChild.forEach((parentIds, childId) => {
    const parentList = Array.from(parentIds);
    if (parentList.length < 2) {
      return;
    }

    let matchedPairKey = "";
    let matchedParentIds: [string, string] | null = null;
    for (let i = 0; i < parentList.length && !matchedPairKey; i += 1) {
      for (let j = i + 1; j < parentList.length; j += 1) {
        const candidatePair = [parentList[i], parentList[j]] as [string, string];
        const pairKey = candidatePair.slice().sort().join("::");
        if (spousePairIds.has(pairKey)) {
          matchedPairKey = pairKey;
          matchedParentIds = candidatePair;
          break;
        }
      }
    }

    if (!matchedPairKey || !matchedParentIds) {
      return;
    }

    familyChildConnectors.push({ pairKey: matchedPairKey, childId });
    edges.forEach((edge) => {
      const isParent = edge.label.trim().toLowerCase() === "parent";
      if (!isParent || edge.toPersonId !== childId) {
        return;
      }
      if (edge.fromPersonId === matchedParentIds[0] || edge.fromPersonId === matchedParentIds[1]) {
        hiddenParentEdgeIds.add(edge.id);
      }
    });
  });

  const levels = new Map<string, number>();
  nodes.forEach((node) => levels.set(node.personId, 0));

  const queue = nodes
    .filter((node) => (parentIdsByChild.get(node.personId)?.size ?? 0) === 0)
    .map((node) => node.personId);
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    const currentLevel = levels.get(currentId) ?? 0;
    const children = Array.from(childIdsByParent.get(currentId) ?? []);
    children.forEach((childId) => {
      const next = Math.max(levels.get(childId) ?? 0, currentLevel + 1);
      levels.set(childId, next);
      queue.push(childId);
    });
  }

  for (let i = 0; i < nodes.length; i += 1) {
    parentEdges.forEach((edge) => {
      const parentLevel = levels.get(edge.fromPersonId) ?? 0;
      const childLevel = levels.get(edge.toPersonId) ?? 0;
      if (childLevel < parentLevel + 1) {
        levels.set(edge.toPersonId, parentLevel + 1);
      }
    });
  }

  for (let i = 0; i < nodes.length; i += 1) {
    spousePairIds.forEach((pairKey) => {
      const [aId, bId] = pairKey.split("::");
      const aLevel = levels.get(aId) ?? 0;
      const bLevel = levels.get(bId) ?? 0;
      const sameLevel = Math.max(aLevel, bLevel);
      levels.set(aId, sameLevel);
      levels.set(bId, sameLevel);
    });
  }

  const grouped = new Map<number, PersonNode[]>();
  nodes.forEach((node) => {
    const level = levels.get(node.personId) ?? 0;
    const bucket = grouped.get(level) ?? [];
    bucket.push(node);
    grouped.set(level, bucket);
  });

  const nodeMap = new Map(nodes.map((node) => [node.personId, node]));
  const levelsSorted = Array.from(grouped.keys()).sort((a, b) => a - b);
  const orderedByLevel = new Map<number, PersonNode[]>();
  levelsSorted.forEach((level) => {
    const sorted = (grouped.get(level) ?? []).slice().sort((a, b) => a.displayName.localeCompare(b.displayName));
    const ordered: PersonNode[] = [];
    const seen = new Set<string>();
    sorted.forEach((node) => {
      if (seen.has(node.personId)) {
        return;
      }
      ordered.push(node);
      seen.add(node.personId);
      const partnerId = partnerMap.get(node.personId);
      const partner = partnerId ? nodeMap.get(partnerId) : undefined;
      if (partner && (levels.get(partner.personId) ?? 0) === level && !seen.has(partner.personId)) {
        ordered.push(partner);
        seen.add(partner.personId);
      }
    });
    orderedByLevel.set(level, ordered);
  });

  const isSpousePair = (leftPersonId: string, rightPersonId: string) => {
    const pairKey = [leftPersonId, rightPersonId].sort().join("::");
    return spousePairIds.has(pairKey);
  };

  const rowWidth = (row: PersonNode[]) => {
    if (row.length === 0) {
      return 0;
    }
    let width = NODE_CARD_WIDTH;
    for (let i = 1; i < row.length; i += 1) {
      const previous = row[i - 1];
      const current = row[i];
      const gap = isSpousePair(previous.personId, current.personId) ? SPOUSE_GAP : NON_SPOUSE_GAP;
      width += NODE_CARD_WIDTH + gap;
    }
    return width;
  };

  const maxRowWidth = Math.max(0, ...Array.from(orderedByLevel.values()).map((row) => rowWidth(row)));
  const rowGap = 130;
  const xPadding = 90;
  const yPadding = 70;
  const width = Math.max(980, xPadding * 2 + maxRowWidth);
  const height = Math.max(440, yPadding * 2 + Math.max(0, levelsSorted.length - 1) * rowGap);

  const positions = new Map<string, { x: number; y: number }>();
  levelsSorted.forEach((level, levelIndex) => {
    const row = orderedByLevel.get(level) ?? [];
    const currentRowWidth = rowWidth(row);
    const startCenterX = (width - currentRowWidth) / 2 + NODE_HALF_WIDTH;
    const y = yPadding + levelIndex * rowGap;
    let x = startCenterX;
    row.forEach((node, index) => {
      positions.set(node.personId, { x, y });
      if (index >= row.length - 1) {
        return;
      }
      const nextNode = row[index + 1];
      const gap = isSpousePair(node.personId, nextNode.personId) ? SPOUSE_GAP : NON_SPOUSE_GAP;
      x += NODE_CARD_WIDTH + gap;
    });
  });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState("");

  const toTreeDisplayName = (value: string) => {
    const parts = value
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length <= 2) {
      return value.trim();
    }
    return `${parts[0]} ${parts[parts.length - 1]}`;
  };

  const asTreePerson = (person: PersonNode): PersonNode => ({
    ...person,
    displayName: toTreeDisplayName(person.displayName),
  });

  const peopleById = new Map(nodes.map((node) => [node.personId, asTreePerson(node)]));
  const selectedPerson = selectedPersonId ? peopleById.get(selectedPersonId) ?? null : null;

  const getAvatarUrl = useCallback(
    (person: PersonNode) => (person.gender === "female" ? "/placeholders/avatar-female.png" : "/placeholders/avatar-male.png"),
    [],
  );

  const clampScale = useCallback((value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)), []);

  const fitToView = useCallback(() => {
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const fitScale = clampScale(Math.min(rect.width / width, rect.height / height) * 0.94);
    const nextX = (rect.width - width * fitScale) / 2;
    const nextY = (rect.height - height * fitScale) / 2;
    setScale(fitScale);
    setOffset({ x: nextX, y: nextY });
  }, [clampScale, height, width]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

  const zoomAtPoint = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const el = viewportRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const nextScale = clampScale(scale * factor);
      if (nextScale === scale) {
        return;
      }

      const pointX = clientX - rect.left;
      const pointY = clientY - rect.top;
      const worldX = (pointX - offset.x) / scale;
      const worldY = (pointY - offset.y) / scale;
      setScale(nextScale);
      setOffset({
        x: pointX - worldX * nextScale,
        y: pointY - worldY * nextScale,
      });
    },
    [clampScale, offset.x, offset.y, scale],
  );

  const zoomFromCenter = useCallback(
    (factor: number) => {
      const el = viewportRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAtPoint],
  );

  const selectedParents = selectedPerson
    ? Array.from(parentIdsByChild.get(selectedPerson.personId) ?? [])
        .map((id) => peopleById.get(id))
        .filter((item): item is PersonNode => Boolean(item))
    : [];

  const selectedSpouses = selectedPerson
    ? (() => {
        const partner = partnerMap.get(selectedPerson.personId);
        if (!partner) {
          return [];
        }
        const person = peopleById.get(partner);
        return person ? [person] : [];
      })()
    : [];

  const selectedChildren = selectedPerson
    ? Array.from(childIdsByParent.get(selectedPerson.personId) ?? [])
        .map((id) => peopleById.get(id))
        .filter((item): item is PersonNode => Boolean(item))
    : [];

  return (
    <div
      ref={viewportRef}
      className={`tree-graph-wrap tree-map ${isPanning ? "tree-panning" : ""}`}
      onClick={() => setSelectedPersonId("")}
      onWheel={(event) => {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.1 : 0.9;
        zoomAtPoint(event.clientX, event.clientY, factor);
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch" && event.button !== 0) {
          return;
        }
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: offset.x,
          originY: offset.y,
        };
        setIsPanning(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
          return;
        }
        const dx = event.clientX - dragRef.current.startX;
        const dy = event.clientY - dragRef.current.startY;
        setOffset({
          x: dragRef.current.originX + dx,
          y: dragRef.current.originY + dy,
        });
      }}
      onPointerUp={(event) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
          return;
        }
        dragRef.current = null;
        setIsPanning(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
          return;
        }
        dragRef.current = null;
        setIsPanning(false);
      }}
    >
      <div className="tree-cloud-overlay" />
      <div
        className="tree-map-layer"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        }}
      >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="tree-lines"
        aria-label="Family tree graph"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {Array.from(spousePairIds).map((pairKey) => {
          const pair = spousePairMeta.get(pairKey);
          if (!pair) {
            return null;
          }
          const { leftId, rightId, label } = pair;
          const a = positions.get(leftId);
          const b = positions.get(rightId);
          if (!a || !b) {
            return null;
          }

          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const halfWidth = Math.max(90, distance / 2 + NODE_HALF_WIDTH + 14);
          const halfHeight = NODE_HALF_HEIGHT + 16;

          const dimmed =
            Boolean(selectedPersonId) &&
            selectedPersonId !== leftId &&
            selectedPersonId !== rightId;

          return (
            <g key={`cluster-${pairKey}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`tree-line ${dimmed ? "tree-dimmed" : ""}`} />
              <rect
                x={midX - halfWidth}
                y={midY - halfHeight}
                width={halfWidth * 2}
                height={halfHeight * 2}
                rx={22}
                ry={22}
                className={`tree-spouse-cluster ${dimmed ? "tree-dimmed" : ""}`}
              />
              {label ? (
                <text x={midX} y={midY + 4} className="tree-family-label">
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
        {edges.map((edge) => {
          if (hiddenParentEdgeIds.has(edge.id)) {
            return null;
          }
          const from = positions.get(edge.fromPersonId);
          const to = positions.get(edge.toPersonId);
          if (!from || !to) {
            return null;
          }
          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;
          const isFamilyEdge = edge.label.trim().toLowerCase() === "family";
          const isParentEdge = edge.label.trim().toLowerCase() === "parent";
          const dimmed =
            Boolean(selectedPersonId) &&
            edge.fromPersonId !== selectedPersonId &&
            edge.toPersonId !== selectedPersonId;
          return (
            <g key={edge.id}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={`tree-line ${dimmed ? "tree-dimmed" : ""}`} />
              {!isFamilyEdge && !isParentEdge ? (
                <text x={midX} y={midY} className={`tree-line-label ${dimmed ? "tree-dimmed" : ""}`}>
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {familyChildConnectors.map((connector) => {
          const pair = spousePairMeta.get(connector.pairKey);
          if (!pair) {
            return null;
          }
          const a = positions.get(pair.leftId);
          const b = positions.get(pair.rightId);
          const child = positions.get(connector.childId);
          if (!a || !b || !child) {
            return null;
          }
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const startY = midY + NODE_HALF_HEIGHT + 16;
          const endY = child.y - NODE_HALF_HEIGHT;
          const dimmed = Boolean(selectedPersonId) && connector.childId !== selectedPersonId && pair.leftId !== selectedPersonId && pair.rightId !== selectedPersonId;
          return (
            <line
              key={`family-child-${connector.pairKey}-${connector.childId}`}
              x1={midX}
              y1={startY}
              x2={child.x}
              y2={endY}
              className={`tree-line ${dimmed ? "tree-dimmed" : ""}`}
            />
          );
        })}
      </svg>

      {nodes.map((node) => {
        const pos = positions.get(node.personId);
        if (!pos) {
          return null;
        }
        const isSelected = selectedPersonId === node.personId;
        const isDimmed = Boolean(selectedPersonId) && !isSelected;
        const secondaryText = node.birthDate?.trim() ? `Born ${node.birthDate.trim()}` : "";
        return (
          <div
            key={node.personId}
            className="tree-node-card-wrap"
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
          >
            <PersonNodeCard
              personId={node.personId}
              displayName={toTreeDisplayName(node.displayName)}
              secondaryText={secondaryText}
              avatarUrl={getAvatarUrl(node)}
              selected={isSelected}
              dimmed={isDimmed}
              onSelect={setSelectedPersonId}
            />
          </div>
        );
      })}
      </div>
      <GraphControls onZoomIn={() => zoomFromCenter(1.15)} onZoomOut={() => zoomFromCenter(0.87)} onFit={fitToView} />
      {selectedPerson ? (
        <FocusPanel
          selectedPerson={selectedPerson}
          parents={selectedParents}
          spouses={selectedSpouses}
          childrenList={selectedChildren}
          getAvatarUrl={getAvatarUrl}
          onSelectPerson={setSelectedPersonId}
          onClose={() => setSelectedPersonId("")}
        />
      ) : null}
    </div>
  );
}
