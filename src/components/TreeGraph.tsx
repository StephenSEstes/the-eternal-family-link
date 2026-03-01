"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HouseholdEditModal } from "@/components/HouseholdEditModal";
import { PersonEditModal } from "@/components/PersonEditModal";
import { FocusPanel } from "@/components/familyTree/FocusPanel";
import { GraphControls } from "@/components/familyTree/GraphControls";
import { PersonNodeCard } from "@/components/familyTree/PersonNodeCard";

type PersonNode = {
  personId: string;
  displayName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  nickName?: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
  birthDate?: string;
  phones?: string;
  address?: string;
  hobbies?: string;
  notes?: string;
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
  tenantKey: string;
  canManage: boolean;
  nodes: PersonNode[];
  edges: GraphEdge[];
  households?: HouseholdLink[];
};

export function TreeGraph({ tenantKey, canManage, nodes, edges, households = [] }: TreeGraphProps) {
  const router = useRouter();
  const NODE_CARD_WIDTH = 208;
  const NODE_HALF_WIDTH = NODE_CARD_WIDTH / 2;
  const NODE_HALF_HEIGHT = 30;
  const SPOUSE_GAP = 0;
  const NON_SPOUSE_GAP = 56;
  const MIN_SCALE = 0.18;
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

  // Nudge child nodes to center beneath the midpoint of their parent household cluster.
  const childrenByPairKey = new Map<string, string[]>();
  for (const connector of familyChildConnectors) {
    const bucket = childrenByPairKey.get(connector.pairKey) ?? [];
    bucket.push(connector.childId);
    childrenByPairKey.set(connector.pairKey, bucket);
  }
  const desiredChildX = new Map<string, number>();
  childrenByPairKey.forEach((childIds, pairKey) => {
    const pair = spousePairMeta.get(pairKey);
    if (!pair) {
      return;
    }
    const left = positions.get(pair.leftId);
    const right = positions.get(pair.rightId);
    if (!left || !right) {
      return;
    }
    const centerX = (left.x + right.x) / 2;
    const sortedChildIds = childIds
      .slice()
      .sort((a, b) => (nodeMap.get(a)?.displayName ?? a).localeCompare(nodeMap.get(b)?.displayName ?? b));
    const spacing = NODE_CARD_WIDTH + 26;
    const start = centerX - ((sortedChildIds.length - 1) * spacing) / 2;
    sortedChildIds.forEach((childId, index) => {
      desiredChildX.set(childId, start + index * spacing);
    });
  });

  levelsSorted.forEach((level) => {
    const row = orderedByLevel.get(level) ?? [];
    if (row.length === 0) {
      return;
    }
    const withDesired = row.filter((node) => desiredChildX.has(node.personId));
    if (withDesired.length === 0) {
      return;
    }
    const orderedRow = row
      .slice()
      .sort((a, b) => {
        const ax = desiredChildX.get(a.personId) ?? positions.get(a.personId)?.x ?? 0;
        const bx = desiredChildX.get(b.personId) ?? positions.get(b.personId)?.x ?? 0;
        return ax - bx;
      });

    let cursor = Number.NEGATIVE_INFINITY;
    orderedRow.forEach((node) => {
      const pos = positions.get(node.personId);
      if (!pos) {
        return;
      }
      const preferred = desiredChildX.get(node.personId) ?? pos.x;
      const minX = cursor + NODE_CARD_WIDTH + 22;
      const nextX = Math.max(preferred, minX);
      positions.set(node.personId, { x: nextX, y: pos.y });
      cursor = nextX;
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
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    distance: number;
    midpointX: number;
    midpointY: number;
  } | null>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [editPersonId, setEditPersonId] = useState("");
  const [selectedHouseholdId, setSelectedHouseholdId] = useState("");
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

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

  const toMonthDay = (value?: string) => {
    const raw = (value ?? "").trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return `${match[2]}-${match[3]}`;
    }
    return "";
  };

  const asTreePerson = (person: PersonNode): PersonNode => ({
    ...person,
    displayName: [person.firstName, person.lastName].filter((part) => part?.trim()).join(" ").trim() || toTreeDisplayName(person.displayName),
  });

  const peopleById = new Map(nodes.map((node) => [node.personId, asTreePerson(node)]));
  const selectedPerson = selectedPersonId ? peopleById.get(selectedPersonId) ?? null : null;
  const editPerson = editPersonId ? peopleById.get(editPersonId) ?? null : null;
  const householdByPersonId = useMemo(() => {
    const out = new Map<string, HouseholdLink>();
    households.forEach((unit) => {
      out.set(unit.partner1PersonId, unit);
      out.set(unit.partner2PersonId, unit);
    });
    return out;
  }, [households]);

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

  const updatePinch = useCallback(
    (target: HTMLDivElement) => {
      const touchPoints = Array.from(touchPointersRef.current.values());
      if (touchPoints.length !== 2) {
        return;
      }
      const [a, b] = touchPoints;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      if (!distance) {
        return;
      }
      const rect = target.getBoundingClientRect();
      const midpointClientX = (a.x + b.x) / 2;
      const midpointClientY = (a.y + b.y) / 2;
      const midpointX = midpointClientX - rect.left;
      const midpointY = midpointClientY - rect.top;

      const previous = pinchRef.current;
      if (!previous) {
        pinchRef.current = { distance, midpointX, midpointY };
        return;
      }

      const currentScale = scaleRef.current;
      const currentOffset = offsetRef.current;
      const factor = distance / previous.distance;
      const nextScale = clampScale(currentScale * factor);

      const worldX = (previous.midpointX - currentOffset.x) / currentScale;
      const worldY = (previous.midpointY - currentOffset.y) / currentScale;
      const nextOffset = {
        x: midpointX - worldX * nextScale,
        y: midpointY - worldY * nextScale,
      };

      scaleRef.current = nextScale;
      offsetRef.current = nextOffset;
      setScale(nextScale);
      setOffset(nextOffset);
      pinchRef.current = { distance, midpointX, midpointY };
    },
    [clampScale],
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
        if (event.pointerType === "touch") {
          touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          event.currentTarget.setPointerCapture(event.pointerId);
          if (touchPointersRef.current.size === 2) {
            dragRef.current = null;
            setIsPanning(false);
            pinchRef.current = null;
            updatePinch(event.currentTarget);
            return;
          }
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
        if (event.pointerType === "touch") {
          if (!touchPointersRef.current.has(event.pointerId)) {
            return;
          }
          touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (touchPointersRef.current.size === 2) {
            updatePinch(event.currentTarget);
            return;
          }
        }
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
        if (event.pointerType === "touch") {
          touchPointersRef.current.delete(event.pointerId);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          if (touchPointersRef.current.size < 2) {
            pinchRef.current = null;
          }
          if (touchPointersRef.current.size === 1) {
            const [remainingPointerId, remainingPoint] = Array.from(touchPointersRef.current.entries())[0];
            dragRef.current = {
              pointerId: remainingPointerId,
              startX: remainingPoint.x,
              startY: remainingPoint.y,
              originX: offsetRef.current.x,
              originY: offsetRef.current.y,
            };
            setIsPanning(true);
          } else {
            dragRef.current = null;
            setIsPanning(false);
          }
          return;
        }
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
        if (event.pointerType === "touch") {
          touchPointersRef.current.delete(event.pointerId);
          if (touchPointersRef.current.size < 2) {
            pinchRef.current = null;
          }
          if (touchPointersRef.current.size === 0) {
            dragRef.current = null;
            setIsPanning(false);
          }
          return;
        }
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
          const halfWidth = Math.max(112, distance / 2 + NODE_HALF_WIDTH + 24);
          const halfHeight = NODE_HALF_HEIGHT + 26;

          const dimmed =
            Boolean(selectedPersonId) &&
            selectedPersonId !== leftId &&
            selectedPersonId !== rightId;

          return (
            <g key={`cluster-${pairKey}`} className="tree-household-group">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`tree-line ${dimmed ? "tree-dimmed" : ""}`} />
              <rect
                x={midX - halfWidth}
                y={midY - halfHeight}
                width={halfWidth * 2}
                height={halfHeight * 2}
                rx={22}
                ry={22}
                className={`tree-spouse-cluster ${dimmed ? "tree-dimmed" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!canManage) {
                    return;
                  }
                  const unit = households.find((item) => {
                    const matchForward = item.partner1PersonId === leftId && item.partner2PersonId === rightId;
                    const matchReverse = item.partner1PersonId === rightId && item.partner2PersonId === leftId;
                    return matchForward || matchReverse;
                  });
                  if (unit) {
                    setSelectedHouseholdId(unit.id);
                  }
                }}
              />
              {label ? (
                <text x={midX} y={midY + 4} className="tree-family-label">
                  {label}
                </text>
              ) : null}
              {canManage ? (
                <>
                  <circle
                    cx={midX + halfWidth - 18}
                    cy={midY - halfHeight + 18}
                    r={7}
                    className="tree-household-action-dot"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      const unit = households.find((item) => {
                        const matchForward = item.partner1PersonId === leftId && item.partner2PersonId === rightId;
                        const matchReverse = item.partner1PersonId === rightId && item.partner2PersonId === leftId;
                        return matchForward || matchReverse;
                      });
                      if (unit) {
                        setSelectedHouseholdId(unit.id);
                      }
                    }}
                  />
                  <circle
                    cx={midX + halfWidth - 36}
                    cy={midY - halfHeight + 18}
                    r={7}
                    className="tree-household-action-dot"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      const unit = households.find((item) => {
                        const matchForward = item.partner1PersonId === leftId && item.partner2PersonId === rightId;
                        const matchReverse = item.partner1PersonId === rightId && item.partner2PersonId === leftId;
                        return matchForward || matchReverse;
                      });
                      if (unit) {
                        setSelectedHouseholdId(unit.id);
                      }
                    }}
                  />
                </>
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
        const secondaryText = toMonthDay(node.birthDate);
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
              hasHousehold={householdByPersonId.has(node.personId)}
              onSelect={setSelectedPersonId}
              onEditPerson={(personId) => {
                if (canManage) {
                  setEditPersonId(personId);
                }
              }}
              onEditHousehold={(personId) => {
                if (!canManage) {
                  return;
                }
                const unit = householdByPersonId.get(personId);
                if (unit) {
                  setSelectedHouseholdId(unit.id);
                }
              }}
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
      <PersonEditModal
        open={Boolean(editPerson)}
        tenantKey={tenantKey}
        canManage={canManage}
        person={editPerson}
        people={nodes}
        edges={edges}
        households={households}
        onClose={() => setEditPersonId("")}
        onSaved={() => router.refresh()}
        onEditHousehold={(householdId) => setSelectedHouseholdId(householdId)}
      />
      <HouseholdEditModal
        open={Boolean(selectedHouseholdId)}
        tenantKey={tenantKey}
        householdId={selectedHouseholdId}
        onClose={() => setSelectedHouseholdId("")}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
