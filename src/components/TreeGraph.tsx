"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HouseholdEditModal } from "@/components/HouseholdEditModal";
import { PersonEditModal } from "@/components/PersonEditModal";
import { FocusPanel, type FocusPanelGroup } from "@/components/familyTree/FocusPanel";
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
  email?: string;
  address?: string;
  hobbies?: string;
  notes?: string;
  familyGroupRelationshipType?: "founder" | "direct" | "in_law" | "undeclared";
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
  canManageRelationshipType?: boolean;
  nodes: PersonNode[];
  edges: GraphEdge[];
  households?: HouseholdLink[];
};

type FocusTarget =
  | { kind: "person"; personId: string }
  | { kind: "household"; householdId: string }
  | null;

type FocusNavigationData = {
  selectedPerson: PersonNode;
  selectedHouseholdId: string;
  selectedHouseholdLabel: string;
  currentPeople: PersonNode[];
  parents: PersonNode[];
  parentTarget: FocusTarget;
  spouses: PersonNode[];
  siblings: PersonNode[];
  childrenList: PersonNode[];
};

type GraphBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type FocusContextData = {
  emphasizedPersonIds: Set<string>;
  emphasizedHouseholdIds: Set<string>;
  selectedPersonIds: Set<string>;
  selectedHouseholdIds: Set<string>;
  emphasizedEdgeIds: Set<string>;
  emphasizedConnectorKeys: Set<string>;
  bounds: GraphBounds;
  anchorBounds: GraphBounds | null;
  alignTopY: number;
};

export function TreeGraph({
  tenantKey,
  canManage,
  canManageRelationshipType = false,
  nodes,
  edges,
  households = [],
}: TreeGraphProps) {
  const router = useRouter();
  const NODE_CARD_WIDTH = 116;
  const NODE_HALF_WIDTH = NODE_CARD_WIDTH / 2;
  const NODE_HALF_HEIGHT = 72;
  const SPOUSE_GAP = -16;
  const NON_SPOUSE_GAP = 56;
  const MIN_SCALE = 0.18;
  const MAX_SCALE = 2.8;

  const partnerMap = new Map<string, string>();
  const spousePairIds = new Set<string>();
  const spousePairMeta = new Map<string, { leftId: string; rightId: string; label: string }>();
  const householdMetaById = new Map<string, { householdId: string; memberIds: string[]; label: string }>();
  const householdIdByMemberId = new Map<string, string>();
  const pairHouseholdIdByPairKey = new Map<string, string>();
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
    if (!leftId && !rightId) {
      return;
    }
    if (!rightId) {
      householdIdByMemberId.set(leftId, unit.id);
      householdMetaById.set(unit.id, {
        householdId: unit.id,
        memberIds: [leftId],
        label: unit.label?.trim() || unit.id?.trim() || "",
      });
      return;
    }
    partnerMap.set(leftId, rightId);
    partnerMap.set(rightId, leftId);
    householdIdByMemberId.set(leftId, unit.id);
    householdIdByMemberId.set(rightId, unit.id);
    const pairKey = [leftId, rightId].sort().join("::");
    spousePairIds.add(pairKey);
    spousePairMeta.set(pairKey, { leftId, rightId, label: unit.label?.trim() || unit.id?.trim() || "" });
    pairHouseholdIdByPairKey.set(pairKey, unit.id);
    householdMetaById.set(unit.id, {
      householdId: unit.id,
      memberIds: [leftId, rightId],
      label: unit.label?.trim() || unit.id?.trim() || "",
    });
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
  const familyChildConnectors: Array<{ householdId: string; childId: string }> = [];
  parentIdsByChild.forEach((parentIds, childId) => {
    const parentList = Array.from(parentIds);
    let matchedHouseholdId = "";
    let matchedParentIds: string[] = [];
    if (parentList.length >= 2) {
      for (let i = 0; i < parentList.length && !matchedHouseholdId; i += 1) {
        for (let j = i + 1; j < parentList.length; j += 1) {
          const candidatePair = [parentList[i], parentList[j]] as [string, string];
          const pairKey = candidatePair.slice().sort().join("::");
          if (spousePairIds.has(pairKey)) {
            matchedHouseholdId = pairHouseholdIdByPairKey.get(pairKey) ?? "";
            matchedParentIds = candidatePair;
            break;
          }
        }
      }
    }
    if (!matchedHouseholdId) {
      const singleHousehold = Array.from(householdMetaById.values()).find(
        (item) => item.memberIds.length === 1 && parentList.includes(item.memberIds[0] ?? ""),
      );
      if (singleHousehold) {
        matchedHouseholdId = singleHousehold.householdId;
        matchedParentIds = singleHousehold.memberIds.slice();
      }
    }
    if (!matchedHouseholdId || matchedParentIds.length === 0) {
      return;
    }

    familyChildConnectors.push({ householdId: matchedHouseholdId, childId });
    edges.forEach((edge) => {
      const isParent = edge.label.trim().toLowerCase() === "parent";
      if (!isParent || edge.toPersonId !== childId) {
        return;
      }
      if (matchedParentIds.includes(edge.fromPersonId)) {
        hiddenParentEdgeIds.add(edge.id);
      }
    });
  });
  const parentHouseholdIdByChildId = new Map<string, string>();
  familyChildConnectors.forEach((connector) => {
    if (!parentHouseholdIdByChildId.has(connector.childId)) {
      parentHouseholdIdByChildId.set(connector.childId, connector.householdId);
    }
  });
  const childrenByHouseholdId = new Map<string, string[]>();
  familyChildConnectors.forEach((connector) => {
    const bucket = childrenByHouseholdId.get(connector.householdId) ?? [];
    bucket.push(connector.childId);
    childrenByHouseholdId.set(connector.householdId, bucket);
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
    const rowNodes = (grouped.get(level) ?? []).slice();
    const rowPersonIds = new Set(rowNodes.map((node) => node.personId));
    const rowUnits: Array<{ ids: string[]; sortPerson: PersonNode }> = [];
    const seen = new Set<string>();
    rowNodes.forEach((node) => {
      if (seen.has(node.personId)) {
        return;
      }
      const partnerId = partnerMap.get(node.personId);
      const hasPartnerInRow = Boolean(partnerId && rowPersonIds.has(partnerId) && !seen.has(partnerId));
      if (hasPartnerInRow && partnerId) {
        const partner = nodeMap.get(partnerId);
        if (partner) {
          rowUnits.push({
            ids: getOrderedUnitIds(node.personId, partnerId),
            sortPerson: getBranchAnchorPerson(node, partner),
          });
          seen.add(node.personId);
          seen.add(partnerId);
          return;
        }
      }
      rowUnits.push({
        ids: [node.personId],
        sortPerson: getBranchAnchorPerson(node),
      });
      seen.add(node.personId);
    });
    const ordered: PersonNode[] = [];
    rowUnits
      .slice()
      .sort((left, right) => {
        const byAnchor = comparePeopleForTreeOrder(left.sortPerson, right.sortPerson);
        if (byAnchor !== 0) {
          return byAnchor;
        }
        const leftLead = nodeMap.get(left.ids[0]);
        const rightLead = nodeMap.get(right.ids[0]);
        if (leftLead && rightLead) {
          const byLead = comparePeopleForTreeOrder(leftLead, rightLead);
          if (byLead !== 0) {
            return byLead;
          }
        }
        return left.ids.join("::").localeCompare(right.ids.join("::"));
      })
      .forEach((unit) => {
        unit.ids.forEach((personId) => {
          const person = nodeMap.get(personId);
          if (person) {
            ordered.push(person);
          }
        });
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
  // Extra vertical separation prevents household cluster boxes/labels from overlapping between generations.
  const rowGap = 236;
  const xPadding = 90;
  const yPadding = 118;
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
  const desiredChildX = new Map<string, number>();
  childrenByHouseholdId.forEach((childIds, householdId) => {
    const household = householdMetaById.get(householdId);
    if (!household) {
      return;
    }
    const memberPositions = household.memberIds
      .map((personId) => positions.get(personId))
      .filter((pos): pos is { x: number; y: number } => Boolean(pos));
    if (memberPositions.length === 0) {
      return;
    }
    const centerX = memberPositions.reduce((sum, pos) => sum + pos.x, 0) / memberPositions.length;
    const sortedChildIds = childIds
      .slice()
      .sort((a, b) => {
        const leftNode = nodeMap.get(a);
        const rightNode = nodeMap.get(b);
        if (leftNode && rightNode) {
          return comparePeopleForTreeOrder(leftNode, rightNode);
        }
        return a.localeCompare(b);
      });
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

    const rowPersonIds = new Set(row.map((node) => node.personId));
    const consumed = new Set<string>();
    const units: Array<{
      ids: string[];
      preferredCenterX: number;
      unitWidth: number;
      sortPerson: PersonNode;
      siblingBlockKey: string;
    }> = [];
    for (const node of row) {
      if (consumed.has(node.personId)) {
        continue;
      }
      const partnerId = partnerMap.get(node.personId);
      const hasPartnerInRow = Boolean(partnerId && rowPersonIds.has(partnerId) && !consumed.has(partnerId));
      if (hasPartnerInRow && partnerId) {
        const leftId = node.personId;
        const rightId = partnerId;
        const unitIds = getOrderedUnitIds(leftId, rightId);
        const leftPos = positions.get(unitIds[0]);
        const rightPos = positions.get(unitIds[1]);
        if (!leftPos || !rightPos) {
          consumed.add(leftId);
          consumed.add(rightId);
          continue;
        }
        const unitPeople = unitIds.map((personId) => nodeMap.get(personId)).filter((person): person is PersonNode => Boolean(person));
        units.push({
          ids: unitIds,
          preferredCenterX: getUnitPreferredCenterX(unitIds, desiredChildX, positions),
          unitWidth: NODE_CARD_WIDTH * 2 + SPOUSE_GAP,
          sortPerson: getBranchAnchorPerson(...unitPeople),
          siblingBlockKey: getSiblingBlockKey(unitIds),
        });
        consumed.add(leftId);
        consumed.add(rightId);
        continue;
      }

      const pos = positions.get(node.personId);
      if (!pos) {
        consumed.add(node.personId);
        continue;
      }
      units.push({
        ids: [node.personId],
        preferredCenterX: desiredChildX.get(node.personId) ?? pos.x,
        unitWidth: NODE_CARD_WIDTH,
        sortPerson: node,
        siblingBlockKey: getSiblingBlockKey([node.personId]),
      });
      consumed.add(node.personId);
    }

    const siblingBlocks = new Map<
      string,
      { key: string; preferredCenterX: number; sortPerson: PersonNode; units: typeof units }
    >();
    units.forEach((unit) => {
      const existing = siblingBlocks.get(unit.siblingBlockKey);
      if (!existing) {
        siblingBlocks.set(unit.siblingBlockKey, {
          key: unit.siblingBlockKey,
          preferredCenterX: getSiblingBlockPreferredCenterX(unit.siblingBlockKey, unit.preferredCenterX, positions),
          sortPerson: unit.sortPerson,
          units: [unit],
        });
        return;
      }
      existing.units.push(unit);
      if (comparePeopleForTreeOrder(unit.sortPerson, existing.sortPerson) < 0) {
        existing.sortPerson = unit.sortPerson;
      }
    });

    const sortedBlocks = Array.from(siblingBlocks.values())
      .map((block) => {
        const blockUnits = block.units.slice().sort((left, right) => {
          const bySortPerson = comparePeopleForTreeOrder(left.sortPerson, right.sortPerson);
          if (bySortPerson !== 0) {
            return bySortPerson;
          }
          return left.ids.join("::").localeCompare(right.ids.join("::"));
        });
        const blockWidth = blockUnits.reduce((total, unit, index) => {
          return total + unit.unitWidth + (index > 0 ? NON_SPOUSE_GAP : 0);
        }, 0);
        return {
          ...block,
          units: blockUnits,
          blockWidth,
        };
      })
      .sort((left, right) => {
        if (left.preferredCenterX !== right.preferredCenterX) {
          return left.preferredCenterX - right.preferredCenterX;
        }
        const bySortPerson = comparePeopleForTreeOrder(left.sortPerson, right.sortPerson);
        if (bySortPerson !== 0) {
          return bySortPerson;
        }
        return left.key.localeCompare(right.key);
      });

    let lastRightEdge = Number.NEGATIVE_INFINITY;
    for (const block of sortedBlocks) {
      const blockHalf = block.blockWidth / 2;
      const minCenter = Number.isFinite(lastRightEdge)
        ? lastRightEdge + NON_SPOUSE_GAP + blockHalf
        : block.preferredCenterX;
      const blockCenterX = Math.max(block.preferredCenterX, minCenter);
      let nextUnitCenterX = blockCenterX - blockHalf;
      block.units.forEach((unit) => {
        nextUnitCenterX += unit.unitWidth / 2;
        if (unit.ids.length === 2) {
          const halfSpan = (NODE_CARD_WIDTH + SPOUSE_GAP) / 2;
          const leftPos = positions.get(unit.ids[0]);
          const rightPos = positions.get(unit.ids[1]);
          if (leftPos) {
            positions.set(unit.ids[0], { x: nextUnitCenterX - halfSpan, y: leftPos.y });
          }
          if (rightPos) {
            positions.set(unit.ids[1], { x: nextUnitCenterX + halfSpan, y: rightPos.y });
          }
        } else {
          const onlyId = unit.ids[0];
          const pos = positions.get(onlyId);
          if (pos) {
            positions.set(onlyId, { x: nextUnitCenterX, y: pos.y });
          }
        }
        nextUnitCenterX += unit.unitWidth / 2 + NON_SPOUSE_GAP;
      });
      lastRightEdge = blockCenterX + blockHalf;
    }
  });

  // Re-center each parent household over its final child block after sibling grouping has settled.
  levelsSorted
    .slice()
    .sort((a, b) => b - a)
    .forEach((level) => {
      const row = orderedByLevel.get(level) ?? [];
      if (row.length === 0) {
        return;
      }

      const rowPersonIds = new Set(row.map((node) => node.personId));
      const consumed = new Set<string>();
      const units: Array<{ ids: string[]; desiredCenterX: number; unitWidth: number }> = [];

      for (const node of row) {
        if (consumed.has(node.personId)) {
          continue;
        }
        const partnerId = partnerMap.get(node.personId);
        const hasPartnerInRow = Boolean(partnerId && rowPersonIds.has(partnerId) && !consumed.has(partnerId));
        const unitIds = hasPartnerInRow && partnerId ? getOrderedUnitIds(node.personId, partnerId) : [node.personId];
        unitIds.forEach((personId) => consumed.add(personId));

        const householdId = getUnitHouseholdId(unitIds);
        const childCenters = (householdId ? childrenByHouseholdId.get(householdId) ?? [] : [])
          .map((childId) => positions.get(childId)?.x ?? Number.NaN)
          .filter((value) => Number.isFinite(value));
        const currentCenterX = getUnitCurrentCenterX(unitIds, positions);
        const desiredCenterX =
          childCenters.length > 0
            ? childCenters.reduce((sum, value) => sum + value, 0) / childCenters.length
            : currentCenterX;

        units.push({
          ids: unitIds,
          desiredCenterX,
          unitWidth: unitIds.length === 2 ? NODE_CARD_WIDTH * 2 + SPOUSE_GAP : NODE_CARD_WIDTH,
        });
      }

      if (
        units.length === 0 ||
        units.every((unit) => Math.abs(unit.desiredCenterX - getUnitCurrentCenterX(unit.ids, positions)) < 0.5)
      ) {
        return;
      }

      let lastRightEdge = Number.NEGATIVE_INFINITY;
      units.forEach((unit) => {
        const minCenterX = Number.isFinite(lastRightEdge)
          ? lastRightEdge + NON_SPOUSE_GAP + unit.unitWidth / 2
          : unit.desiredCenterX;
        const nextCenterX = Math.max(unit.desiredCenterX, minCenterX);
        setUnitCenterX(unit.ids, nextCenterX, positions);
        lastRightEdge = nextCenterX + unit.unitWidth / 2;
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
  const animationTimeoutRef = useRef<number | null>(null);
  const initializedTenantFocusRef = useRef("");

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [animateViewport, setAnimateViewport] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);
  const [focusPanelGroup, setFocusPanelGroup] = useState<FocusPanelGroup>("default");
  const [treeSearchQuery, setTreeSearchQuery] = useState("");
  const [editPersonId, setEditPersonId] = useState("");
  const [selectedHouseholdId, setSelectedHouseholdId] = useState("");
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  const deferredTreeSearchQuery = useDeferredValue(treeSearchQuery.trim().toLowerCase());

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current !== null) {
        window.clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  const selectedPersonIdForLayout = focusTarget?.kind === "person" ? focusTarget.personId.trim() : "";
  const selectedHouseholdIdForLayout =
    focusTarget?.kind === "household"
      ? focusTarget.householdId.trim()
      : selectedPersonIdForLayout
        ? householdIdByMemberId.get(selectedPersonIdForLayout) ?? ""
        : "";

  const layoutChildrenForHousehold = (
    householdId: string,
    options: {
      gap: number;
      highlightedPersonId?: string;
      highlightGapBoost?: number;
    },
  ) => {
    const normalizedHouseholdId = householdId.trim();
    if (!normalizedHouseholdId) {
      return;
    }
    const childIds = childrenByHouseholdId.get(normalizedHouseholdId) ?? [];
    if (childIds.length === 0) {
      return;
    }
    const household = householdMetaById.get(normalizedHouseholdId);
    if (!household) {
      return;
    }
    const memberPositions = household.memberIds
      .map((personId) => positions.get(personId))
      .filter((pos): pos is { x: number; y: number } => Boolean(pos));
    if (memberPositions.length === 0) {
      return;
    }
    const centerX = memberPositions.reduce((sum, pos) => sum + pos.x, 0) / memberPositions.length;
    const seen = new Set<string>();
    const units = childIds
      .map((childId) => {
        const partnerId = partnerMap.get(childId) ?? "";
        const unitIds = partnerId ? getOrderedUnitIds(childId, partnerId) : [childId];
        const canonicalUnitKey = unitIds.join("::");
        if (seen.has(canonicalUnitKey)) {
          return null;
        }
        seen.add(canonicalUnitKey);
        const anchorPerson = getBranchAnchorPerson(...unitIds.map((personId) => nodeMap.get(personId)));
        return {
          ids: unitIds,
          anchorPerson,
          unitWidth: unitIds.length === 2 ? NODE_CARD_WIDTH * 2 + SPOUSE_GAP : NODE_CARD_WIDTH,
          isHighlighted: Boolean(options.highlightedPersonId && unitIds.includes(options.highlightedPersonId)),
        };
      })
      .filter(
        (
          unit,
        ): unit is {
          ids: string[];
          anchorPerson: PersonNode;
          unitWidth: number;
          isHighlighted: boolean;
        } => Boolean(unit),
      )
      .sort((left, right) => {
        const byAnchor = comparePeopleForTreeOrder(left.anchorPerson, right.anchorPerson);
        if (byAnchor !== 0) {
          return byAnchor;
        }
        return left.ids.join("::").localeCompare(right.ids.join("::"));
      });
    if (units.length === 0) {
      return;
    }

    const gapAfter = (index: number) => {
      if (index >= units.length - 1) {
        return 0;
      }
      const boost =
        units[index]?.isHighlighted || units[index + 1]?.isHighlighted ? options.highlightGapBoost ?? 0 : 0;
      return options.gap + boost;
    };

    const totalWidth = units.reduce((sum, unit, index) => sum + unit.unitWidth + gapAfter(index), 0);
    let cursorX = centerX - totalWidth / 2;
    units.forEach((unit, index) => {
      const nextCenterX = cursorX + unit.unitWidth / 2;
      setUnitCenterX(unit.ids, nextCenterX, positions);
      cursorX += unit.unitWidth + gapAfter(index);
    });
  };

  if (selectedHouseholdIdForLayout) {
    layoutChildrenForHousehold(selectedHouseholdIdForLayout, {
      gap: 18,
    });
  }

  if (selectedPersonIdForLayout) {
    const parentHouseholdIdForLayout = parentHouseholdIdByChildId.get(selectedPersonIdForLayout) ?? "";
    if (parentHouseholdIdForLayout) {
      layoutChildrenForHousehold(parentHouseholdIdForLayout, {
        gap: 42,
        highlightedPersonId: selectedPersonIdForLayout,
        highlightGapBoost: 42,
      });
    }
    const descendantHouseholdId = householdIdByMemberId.get(selectedPersonIdForLayout) ?? "";
    if (descendantHouseholdId) {
      layoutChildrenForHousehold(descendantHouseholdId, {
        gap: 20,
      });
    }
  }

  // Normalize layout bounds after spouse/child nudges so clusters are never clipped by stale base width/height.
  const layoutPadding = 28;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  positions.forEach((pos) => {
    minX = Math.min(minX, pos.x - NODE_HALF_WIDTH);
    maxX = Math.max(maxX, pos.x + NODE_HALF_WIDTH);
    minY = Math.min(minY, pos.y - NODE_HALF_HEIGHT);
    maxY = Math.max(maxY, pos.y + NODE_HALF_HEIGHT);
  });

  spousePairMeta.forEach((pair) => {
    const left = positions.get(pair.leftId);
    const right = positions.get(pair.rightId);
    if (!left || !right) {
      return;
    }
    const midX = (left.x + right.x) / 2;
    const midY = (left.y + right.y) / 2;
    const distance = Math.hypot(left.x - right.x, left.y - right.y);
    const halfWidth = Math.max(96, distance / 2 + NODE_HALF_WIDTH + 12);
    const halfHeight = NODE_HALF_HEIGHT + 26;
    minX = Math.min(minX, midX - halfWidth);
    maxX = Math.max(maxX, midX + halfWidth);
    minY = Math.min(minY, midY - halfHeight);
    maxY = Math.max(maxY, midY + halfHeight);
  });
  householdMetaById.forEach((household) => {
    if (household.memberIds.length !== 1) {
      return;
    }
    const personPos = positions.get(household.memberIds[0] ?? "");
    if (!personPos) {
      return;
    }
    const halfWidth = NODE_HALF_WIDTH + 16;
    const halfHeight = NODE_HALF_HEIGHT + 26;
    minX = Math.min(minX, personPos.x - halfWidth);
    maxX = Math.max(maxX, personPos.x + halfWidth);
    minY = Math.min(minY, personPos.y - halfHeight);
    maxY = Math.max(maxY, personPos.y + halfHeight);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minX = 0;
    minY = 0;
    maxX = width;
    maxY = height;
  }

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const canvasWidth = Math.max(width, Math.ceil(contentWidth + layoutPadding * 2));
  const canvasHeight = Math.max(height, Math.ceil(contentHeight + layoutPadding * 2));
  const shiftX = layoutPadding - minX + Math.max(0, (canvasWidth - (contentWidth + layoutPadding * 2)) / 2);
  const shiftY = layoutPadding - minY + Math.max(0, (canvasHeight - (contentHeight + layoutPadding * 2)) / 2);
  if (shiftX !== 0 || shiftY !== 0) {
    positions.forEach((pos, personId) => {
      positions.set(personId, { x: pos.x + shiftX, y: pos.y + shiftY });
    });
  }

  const toMonthDay = (value?: string) => {
    const raw = (value ?? "").trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return `${match[2]}-${match[3]}`;
    }
    return "";
  };

  function parseBirthSortValue(value?: string) {
    const raw = (value ?? "").trim();
    if (!raw) {
      return Number.NaN;
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  function comparePeopleForTreeOrder(left: PersonNode, right: PersonNode) {
    const leftBirth = parseBirthSortValue(left.birthDate);
    const rightBirth = parseBirthSortValue(right.birthDate);
    if (Number.isFinite(leftBirth) && Number.isFinite(rightBirth) && leftBirth !== rightBirth) {
      return leftBirth - rightBirth;
    }
    return left.displayName.localeCompare(right.displayName);
  }

  function isDirectLineTreePerson(person?: PersonNode) {
    const relationshipType = person?.familyGroupRelationshipType ?? "";
    return relationshipType === "founder" || relationshipType === "direct";
  }

  function getBranchAnchorPerson(...people: Array<PersonNode | undefined>) {
    const present = people.filter((person): person is PersonNode => Boolean(person));
    if (present.length === 0) {
      throw new Error("Tree branch anchor requires at least one person.");
    }
    const directLinePeople = present.filter((person) => isDirectLineTreePerson(person));
    const candidates = directLinePeople.length > 0 ? directLinePeople : present;
    return candidates.slice().sort(comparePeopleForTreeOrder)[0] ?? present[0];
  }

  function getOrderedUnitIds(firstId: string, secondId?: string) {
    if (!secondId) {
      return [firstId];
    }
    const pairKey = [firstId, secondId].sort().join("::");
    const pair = spousePairMeta.get(pairKey);
    if (pair) {
      return [pair.leftId, pair.rightId];
    }
    const first = nodeMap.get(firstId);
    const second = nodeMap.get(secondId);
    if (first && second && comparePeopleForTreeOrder(first, second) > 0) {
      return [secondId, firstId];
    }
    return [firstId, secondId];
  }

  function getUnitPreferredCenterX(
    unitIds: string[],
    desiredCenters: Map<string, number>,
    currentPositions: Map<string, { x: number; y: number }>,
  ) {
    const desiredAnchorId =
      unitIds.find((personId) => desiredCenters.has(personId) && isDirectLineTreePerson(nodeMap.get(personId))) ??
      unitIds.find((personId) => desiredCenters.has(personId));
    if (desiredAnchorId) {
      const desiredX = desiredCenters.get(desiredAnchorId) ?? Number.NaN;
      if (Number.isFinite(desiredX)) {
        if (unitIds.length === 1) {
          return desiredX;
        }
        const halfSpan = (NODE_CARD_WIDTH + SPOUSE_GAP) / 2;
        return desiredAnchorId === unitIds[0] ? desiredX + halfSpan : desiredX - halfSpan;
      }
    }

    const currentCenters = unitIds
      .map((personId) => currentPositions.get(personId)?.x ?? Number.NaN)
      .filter((value) => Number.isFinite(value));
    if (currentCenters.length > 0) {
      return currentCenters.reduce((sum, value) => sum + value, 0) / currentCenters.length;
    }

    return 0;
  }

  function getSiblingBlockKey(unitIds: string[]) {
    const directChildId =
      unitIds.find((personId) => parentHouseholdIdByChildId.has(personId) && isDirectLineTreePerson(nodeMap.get(personId))) ??
      unitIds.find((personId) => parentHouseholdIdByChildId.has(personId));
    if (directChildId) {
      const householdId = parentHouseholdIdByChildId.get(directChildId) ?? "";
      if (householdId) {
        return `household:${householdId}`;
      }
    }
    return `unit:${unitIds.join("::")}`;
  }

  function getSiblingBlockPreferredCenterX(
    blockKey: string,
    fallbackCenterX: number,
    currentPositions: Map<string, { x: number; y: number }>,
  ) {
    if (!blockKey.startsWith("household:")) {
      return fallbackCenterX;
    }
    const household = householdMetaById.get(blockKey.slice(10));
    if (!household) {
      return fallbackCenterX;
    }
    const memberPositions = household.memberIds
      .map((personId) => currentPositions.get(personId))
      .filter((pos): pos is { x: number; y: number } => Boolean(pos));
    if (memberPositions.length === 0) {
      return fallbackCenterX;
    }
    return memberPositions.reduce((sum, pos) => sum + pos.x, 0) / memberPositions.length;
  }

  function getUnitHouseholdId(unitIds: string[]) {
    if (unitIds.length === 0) {
      return "";
    }
    if (unitIds.length === 1) {
      return householdIdByMemberId.get(unitIds[0] ?? "") ?? "";
    }
    const pairKey = unitIds.slice().sort().join("::");
    return pairHouseholdIdByPairKey.get(pairKey) ?? "";
  }

  function getUnitCurrentCenterX(
    unitIds: string[],
    currentPositions: Map<string, { x: number; y: number }>,
  ) {
    const centers = unitIds
      .map((personId) => currentPositions.get(personId)?.x ?? Number.NaN)
      .filter((value) => Number.isFinite(value));
    if (centers.length === 0) {
      return 0;
    }
    return centers.reduce((sum, value) => sum + value, 0) / centers.length;
  }

  function setUnitCenterX(
    unitIds: string[],
    centerX: number,
    currentPositions: Map<string, { x: number; y: number }>,
  ) {
    if (unitIds.length === 2) {
      const halfSpan = (NODE_CARD_WIDTH + SPOUSE_GAP) / 2;
      const leftPos = currentPositions.get(unitIds[0]);
      const rightPos = currentPositions.get(unitIds[1]);
      if (leftPos) {
        currentPositions.set(unitIds[0], { x: centerX - halfSpan, y: leftPos.y });
      }
      if (rightPos) {
        currentPositions.set(unitIds[1], { x: centerX + halfSpan, y: rightPos.y });
      }
      return;
    }

    const onlyId = unitIds[0] ?? "";
    const pos = currentPositions.get(onlyId);
    if (pos) {
      currentPositions.set(onlyId, { x: centerX, y: pos.y });
    }
  }

  function expandBounds(
    current:
      | {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
      }
      | null,
    next:
      | {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
      }
      | null,
  ) {
    if (!next) {
      return current;
    }
    if (!current) {
      return { ...next };
    }
    return {
      minX: Math.min(current.minX, next.minX),
      maxX: Math.max(current.maxX, next.maxX),
      minY: Math.min(current.minY, next.minY),
      maxY: Math.max(current.maxY, next.maxY),
    };
  }

  function getPersonBounds(personId: string) {
    const pos = positions.get(personId);
    if (!pos) {
      return null;
    }
    return {
      minX: pos.x - NODE_HALF_WIDTH,
      maxX: pos.x + NODE_HALF_WIDTH,
      minY: pos.y - NODE_HALF_HEIGHT,
      maxY: pos.y + NODE_HALF_HEIGHT,
    };
  }

  function getHouseholdBounds(householdId: string) {
    const household = householdMetaById.get(householdId);
    if (!household) {
      return null;
    }
    if (household.memberIds.length === 1) {
      const personBounds = getPersonBounds(household.memberIds[0] ?? "");
      if (!personBounds) {
        return null;
      }
      return {
        minX: personBounds.minX - 16,
        maxX: personBounds.maxX + 16,
        minY: personBounds.minY - 26,
        maxY: personBounds.maxY + 26,
      };
    }
    const [leftId, rightId] = household.memberIds;
    const left = positions.get(leftId ?? "");
    const right = positions.get(rightId ?? "");
    if (!left || !right) {
      return null;
    }
    const midX = (left.x + right.x) / 2;
    const midY = (left.y + right.y) / 2;
    const distance = Math.hypot(left.x - right.x, left.y - right.y);
    const halfWidth = Math.max(96, distance / 2 + NODE_HALF_WIDTH + 12);
    const halfHeight = NODE_HALF_HEIGHT + 26;
    return {
      minX: midX - halfWidth,
      maxX: midX + halfWidth,
      minY: midY - halfHeight,
      maxY: midY + halfHeight,
    };
  }

  const defaultFocusTarget = (() => {
    const topLevel = levelsSorted[0];
    if (topLevel === undefined) {
      return null;
    }
    const row = orderedByLevel.get(topLevel) ?? [];
    if (row.length === 0) {
      return null;
    }
    const rowPersonIds = new Set(row.map((node) => node.personId));
    const seen = new Set<string>();
    for (const node of row) {
      if (seen.has(node.personId)) {
        continue;
      }
      const partnerId = partnerMap.get(node.personId) ?? "";
      const hasPartnerInRow = Boolean(partnerId && rowPersonIds.has(partnerId) && !seen.has(partnerId));
      if (hasPartnerInRow && partnerId) {
        const unitIds = getOrderedUnitIds(node.personId, partnerId);
        unitIds.forEach((personId) => seen.add(personId));
        const householdId = getUnitHouseholdId(unitIds);
        if (householdId) {
          const householdMembers = unitIds
            .map((personId) => nodeMap.get(personId))
            .filter((person): person is PersonNode => Boolean(person));
          const anchor = getBranchAnchorPerson(...householdMembers);
          return { kind: "person", personId: anchor.personId } satisfies FocusTarget;
        }
        const left = nodeMap.get(unitIds[0] ?? "");
        const right = nodeMap.get(unitIds[1] ?? "");
        const anchor = getBranchAnchorPerson(left, right);
        return { kind: "person", personId: anchor.personId } satisfies FocusTarget;
      }
      seen.add(node.personId);
      return { kind: "person", personId: node.personId } satisfies FocusTarget;
    }
    return null;
  })();

  useEffect(() => {
    if (initializedTenantFocusRef.current === tenantKey) {
      return;
    }
    initializedTenantFocusRef.current = tenantKey;
    setFocusTarget(defaultFocusTarget);
  }, [defaultFocusTarget, tenantKey]);

  const peopleById = new Map(nodes.map((node) => [node.personId, node]));
  const editPerson = editPersonId ? peopleById.get(editPersonId) ?? null : null;

  const collectPeople = (personIds: string[]) => {
    const seen = new Set<string>();
    return personIds
      .map((personId) => personId.trim())
      .filter((personId) => {
        if (!personId || seen.has(personId)) {
          return false;
        }
        seen.add(personId);
        return true;
      })
      .map((personId) => peopleById.get(personId))
      .filter((person): person is PersonNode => Boolean(person))
      .sort(comparePeopleForTreeOrder);
  };

  const focusPanelData: FocusNavigationData | null = (() => {
    if (!focusTarget) {
      return null;
    }

    let selectedPersonId = "";
    let selectedHouseholdId = "";
    let spouseIds: string[] = [];
    let childIds: string[] = [];

    if (focusTarget.kind === "household") {
      const household = householdMetaById.get(focusTarget.householdId);
      const householdPeople = (household?.memberIds ?? [])
        .map((personId) => peopleById.get(personId))
        .filter((person): person is PersonNode => Boolean(person));
      if (!household || householdPeople.length === 0) {
        return null;
      }
      selectedPersonId = getBranchAnchorPerson(...householdPeople).personId;
      selectedHouseholdId = household.householdId;
      spouseIds = household.memberIds.filter((personId) => personId !== selectedPersonId);
      childIds = childrenByHouseholdId.get(household.householdId) ?? [];
    } else {
      selectedPersonId = focusTarget.personId;
      selectedHouseholdId = householdIdByMemberId.get(selectedPersonId) ?? "";
      if (selectedHouseholdId) {
        spouseIds = (householdMetaById.get(selectedHouseholdId)?.memberIds ?? []).filter((personId) => personId !== selectedPersonId);
        childIds = childrenByHouseholdId.get(selectedHouseholdId) ?? [];
      } else {
        const spouseId = partnerMap.get(selectedPersonId) ?? "";
        spouseIds = spouseId ? [spouseId] : [];
        childIds = Array.from(childIdsByParent.get(selectedPersonId) ?? []);
      }
    }

    const selectedPerson = peopleById.get(selectedPersonId) ?? null;
    if (!selectedPerson) {
      return null;
    }

    const parentHouseholdId = parentHouseholdIdByChildId.get(selectedPersonId) ?? "";
    const parentIds = parentHouseholdId
      ? householdMetaById.get(parentHouseholdId)?.memberIds ?? []
      : Array.from(parentIdsByChild.get(selectedPersonId) ?? []);
    const parents = collectPeople(parentIds.filter((personId) => personId !== selectedPersonId));
    const siblings = collectPeople(
      parentHouseholdId
        ? (childrenByHouseholdId.get(parentHouseholdId) ?? []).filter((personId) => personId !== selectedPersonId)
        : [],
    ).filter((person) => !spouseIds.includes(person.personId));

    return {
      selectedPerson,
      selectedHouseholdId,
      selectedHouseholdLabel: selectedHouseholdId ? householdMetaById.get(selectedHouseholdId)?.label ?? "" : "",
      currentPeople: collectPeople(
        selectedHouseholdId
          ? householdMetaById.get(selectedHouseholdId)?.memberIds ?? [selectedPersonId]
          : [selectedPersonId, ...spouseIds],
      ),
      parents,
      parentTarget: parentHouseholdId
        ? ({ kind: "household", householdId: parentHouseholdId } satisfies FocusTarget)
        : parents.length > 0
          ? ({ kind: "person", personId: getBranchAnchorPerson(...parents).personId } satisfies FocusTarget)
          : null,
      spouses: collectPeople(spouseIds),
      siblings,
      childrenList: collectPeople(childIds.filter((personId) => personId !== selectedPersonId)),
    };
  })();

  const focusTargetKey = focusTarget
    ? focusTarget.kind === "household"
      ? `household:${focusTarget.householdId}`
      : `person:${focusTarget.personId}`
    : "";

  useEffect(() => {
    setFocusPanelGroup("default");
  }, [focusTargetKey]);

  const focusContext: FocusContextData | null = (() => {
    if (!focusTarget || !focusPanelData) {
      return null;
    }

    const emphasizedPersonIds = new Set<string>();
    const emphasizedHouseholdIds = new Set<string>();
    const selectedPersonIds = new Set<string>();
    const selectedHouseholdIds = new Set<string>();
    let bounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
    let anchorBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
    let alignTopY = 0;

    const addPerson = (personId: string, includeInBounds = false) => {
      const normalizedPersonId = personId.trim();
      if (!normalizedPersonId) {
        return;
      }
      emphasizedPersonIds.add(normalizedPersonId);
      if (includeInBounds) {
        bounds = expandBounds(bounds, getPersonBounds(normalizedPersonId));
      }
    };

    const addHousehold = (householdId: string, includeInBounds = false) => {
      const normalizedHouseholdId = householdId.trim();
      if (!normalizedHouseholdId) {
        return;
      }
      emphasizedHouseholdIds.add(normalizedHouseholdId);
      householdMetaById.get(normalizedHouseholdId)?.memberIds.forEach((personId) => addPerson(personId));
      if (includeInBounds) {
        bounds = expandBounds(bounds, getHouseholdBounds(normalizedHouseholdId));
      }
    };

    const setHouseholdAnchor = (householdId: string) => {
      const next = getHouseholdBounds(householdId);
      if (!next) {
        return false;
      }
      anchorBounds = next;
      alignTopY = next.minY;
      return true;
    };

    const setPersonAnchor = (personId: string) => {
      const next = getPersonBounds(personId);
      if (!next) {
        return false;
      }
      anchorBounds = next;
      alignTopY = next.minY;
      return true;
    };

    const populateHouseholdFocus = (rootHouseholdId: string, highlightedPersonId = "") => {
      if (!setHouseholdAnchor(rootHouseholdId)) {
        return false;
      }
      addHousehold(rootHouseholdId, true);
      selectedHouseholdIds.add(rootHouseholdId);

      const rootMembers = householdMetaById.get(rootHouseholdId)?.memberIds ?? [];
      if (highlightedPersonId) {
        selectedPersonIds.add(highlightedPersonId);
      } else {
        rootMembers.forEach((personId) => selectedPersonIds.add(personId));
      }

      rootMembers.forEach((personId) => {
        const parentHouseholdId = parentHouseholdIdByChildId.get(personId) ?? "";
        if (parentHouseholdId) {
          addHousehold(parentHouseholdId);
          return;
        }
        Array.from(parentIdsByChild.get(personId) ?? []).forEach((parentId) => addPerson(parentId));
      });

      const childIds = childrenByHouseholdId.get(rootHouseholdId) ?? [];
      childIds.forEach((childId) => {
        addPerson(childId);
        const childHouseholdId = householdIdByMemberId.get(childId) ?? "";
        if (childHouseholdId && childHouseholdId !== rootHouseholdId) {
          addHousehold(childHouseholdId, true);
          return;
        }
        addPerson(childId, true);
      });

      return true;
    };

    if (focusPanelGroup === "siblings" && (focusPanelData.siblings.length > 0 || focusPanelData.parentTarget)) {
      if (focusPanelData.parentTarget?.kind === "household") {
        addHousehold(focusPanelData.parentTarget.householdId, true);
        selectedHouseholdIds.add(focusPanelData.parentTarget.householdId);
      } else if (focusPanelData.parentTarget?.kind === "person") {
        addPerson(focusPanelData.parentTarget.personId, true);
      }

      if (focusPanelData.selectedHouseholdId) {
        setHouseholdAnchor(focusPanelData.selectedHouseholdId);
        addHousehold(focusPanelData.selectedHouseholdId, true);
      } else {
        setPersonAnchor(focusPanelData.selectedPerson.personId);
        addPerson(focusPanelData.selectedPerson.personId, true);
      }
      selectedPersonIds.add(focusPanelData.selectedPerson.personId);
      focusPanelData.currentPeople.forEach((person) => addPerson(person.personId, true));
      focusPanelData.siblings.forEach((person) => addPerson(person.personId, true));
    } else if (focusTarget.kind === "household") {
      if (!populateHouseholdFocus(focusTarget.householdId, focusPanelData.selectedPerson.personId)) {
        return null;
      }
    } else {
      const selectedPersonId = focusTarget.personId;
      const personHouseholdId = householdIdByMemberId.get(selectedPersonId) ?? "";
      if (personHouseholdId) {
        if (!populateHouseholdFocus(personHouseholdId, selectedPersonId)) {
          return null;
        }
      } else {
        if (!setPersonAnchor(selectedPersonId)) {
          return null;
        }
        addPerson(selectedPersonId, true);
        selectedPersonIds.add(selectedPersonId);

        const parentHouseholdId = parentHouseholdIdByChildId.get(selectedPersonId) ?? "";
        if (parentHouseholdId) {
          addHousehold(parentHouseholdId);
        } else {
          Array.from(parentIdsByChild.get(selectedPersonId) ?? []).forEach((parentId) => addPerson(parentId));
        }

        const spouseId = partnerMap.get(selectedPersonId) ?? "";
        if (spouseId) {
          addPerson(spouseId);
          const spouseHouseholdId = householdIdByMemberId.get(spouseId) ?? "";
          if (spouseHouseholdId) {
            addHousehold(spouseHouseholdId);
          }
        }

        const childIds = Array.from(childIdsByParent.get(selectedPersonId) ?? []);
        childIds.forEach((childId) => {
          addPerson(childId);
          const childHouseholdId = householdIdByMemberId.get(childId) ?? "";
          if (childHouseholdId) {
            addHousehold(childHouseholdId, true);
            return;
          }
          addPerson(childId, true);
        });
      }
    }

    if (!bounds) {
      if (focusTarget.kind === "household") {
        bounds = getHouseholdBounds(focusTarget.householdId);
      } else {
        bounds = getPersonBounds(focusTarget.personId);
      }
    }
    if (!bounds) {
      return null;
    }

    const emphasizedEdgeIds = new Set<string>();
    edges.forEach((edge) => {
      const relationshipType = edge.label.trim().toLowerCase();
      if (relationshipType === "family") {
        const pairKey = [edge.fromPersonId, edge.toPersonId].sort().join("::");
        const householdId = pairHouseholdIdByPairKey.get(pairKey) ?? "";
        if (
          (householdId && emphasizedHouseholdIds.has(householdId)) ||
          (emphasizedPersonIds.has(edge.fromPersonId) && emphasizedPersonIds.has(edge.toPersonId))
        ) {
          emphasizedEdgeIds.add(edge.id);
        }
        return;
      }
      if (emphasizedPersonIds.has(edge.fromPersonId) && emphasizedPersonIds.has(edge.toPersonId)) {
        emphasizedEdgeIds.add(edge.id);
      }
    });

    const emphasizedConnectorKeys = new Set(
      familyChildConnectors
        .filter(
          (connector) =>
            emphasizedHouseholdIds.has(connector.householdId) && emphasizedPersonIds.has(connector.childId),
        )
        .map((connector) => `${connector.householdId}::${connector.childId}`),
    );

    return {
      emphasizedPersonIds,
      emphasizedHouseholdIds,
      selectedPersonIds,
      selectedHouseholdIds,
      emphasizedEdgeIds,
      emphasizedConnectorKeys,
      bounds,
      anchorBounds,
      alignTopY,
    };
  })();
  const focusBounds = focusContext?.bounds ?? null;
  const focusAnchorBounds = focusContext?.anchorBounds ?? null;
  const focusAlignTopY = focusContext?.alignTopY ?? 0;
  const focusMinX = focusBounds?.minX ?? Number.NaN;
  const focusMaxX = focusBounds?.maxX ?? Number.NaN;
  const focusMinY = focusBounds?.minY ?? Number.NaN;
  const focusMaxY = focusBounds?.maxY ?? Number.NaN;
  const focusAnchorMinX = focusAnchorBounds?.minX ?? Number.NaN;
  const focusAnchorMaxX = focusAnchorBounds?.maxX ?? Number.NaN;
  const focusAnchorMinY = focusAnchorBounds?.minY ?? Number.NaN;
  const focusAnchorMaxY = focusAnchorBounds?.maxY ?? Number.NaN;
  const focusTargetKind = focusTarget?.kind ?? "";
  const focusedPersonId = focusTarget?.kind === "person" ? focusTarget.personId : "";
  const focusedHouseholdId = focusTarget?.kind === "household" ? focusTarget.householdId : "";

  const getAvatarUrl = useCallback(
    (person: PersonNode) => (person.gender === "female" ? "/placeholders/avatar-female.png" : "/placeholders/avatar-male.png"),
    [],
  );
  const treeSearchResults = useMemo(() => {
    if (!deferredTreeSearchQuery) {
      return [];
    }
    return nodes
      .filter((node) => {
        const haystack = [
          node.displayName,
          node.firstName ?? "",
          node.middleName ?? "",
          node.lastName ?? "",
          node.nickName ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(deferredTreeSearchQuery);
      })
      .sort(comparePeopleForTreeOrder)
      .slice(0, 8);
  }, [deferredTreeSearchQuery, nodes]);

  const clampScale = useCallback((value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)), []);

  const stopViewportAnimation = useCallback(() => {
    if (animationTimeoutRef.current !== null) {
      window.clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
    setAnimateViewport(false);
  }, []);

  const applyViewport = useCallback(
    (nextScale: number, nextOffset: { x: number; y: number }, animate = false) => {
      scaleRef.current = nextScale;
      offsetRef.current = nextOffset;
      setScale(nextScale);
      setOffset(nextOffset);
      if (!animate) {
        stopViewportAnimation();
        return;
      }
      setAnimateViewport(true);
      if (animationTimeoutRef.current !== null) {
        window.clearTimeout(animationTimeoutRef.current);
      }
      animationTimeoutRef.current = window.setTimeout(() => {
        setAnimateViewport(false);
        animationTimeoutRef.current = null;
      }, 320);
    },
    [stopViewportAnimation],
  );

  const resetTreePointerState = useCallback((target?: HTMLDivElement | null, pointerId?: number) => {
    dragRef.current = null;
    touchPointersRef.current.clear();
    pinchRef.current = null;
    setIsPanning(false);
    if (target && typeof pointerId === "number" && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  }, []);

  useEffect(() => {
    const handleWindowBlur = () => {
      resetTreePointerState();
    };
    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, [resetTreePointerState]);

  const shouldIgnorePanStart = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return false;
    }
    return Boolean(
      target.closest(
        ".tree-person-card, .tree-focus-panel, .tree-search-card, .tree-control-cluster, .tree-spouse-cluster, .tree-household-action-dot",
      ),
    );
  }, []);

  const fitToView = useCallback(() => {
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const fitScale = clampScale(Math.min(rect.width / canvasWidth, rect.height / canvasHeight) * 0.94);
    const nextX = (rect.width - canvasWidth * fitScale) / 2;
    const nextY = (rect.height - canvasHeight * fitScale) / 2;
    applyViewport(fitScale, { x: nextX, y: nextY }, true);
  }, [applyViewport, canvasHeight, canvasWidth, clampScale]);

  const focusToBounds = useCallback(
    (
      bounds: { minX: number; maxX: number; minY: number; maxY: number },
      anchorBounds: { minX: number; maxX: number; minY: number; maxY: number } | null,
      alignTopY: number,
    ) => {
      const el = viewportRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const isMobile = rect.width <= 900;
      const sidePadding = Math.min(96, rect.width * 0.1);
      const topPadding = Math.min(108, rect.height * 0.16);
      const bottomPadding = Math.min(54, rect.height * 0.08);
      const focusWidth = Math.max(bounds.maxX - bounds.minX, NODE_CARD_WIDTH * 2);
      const focusHeight = Math.max(bounds.maxY - bounds.minY, NODE_HALF_HEIGHT * 3);
      const reservedRight = focusPanelData && !isMobile ? Math.min(304, rect.width * 0.3) : 0;
      const availableWidth = Math.max(140, rect.width - sidePadding * 2 - reservedRight);
      const availableHeight = Math.max(140, rect.height - topPadding - bottomPadding);
      const contextScale = Math.min(availableWidth / focusWidth, availableHeight / focusHeight) * 0.98;
      const targetBounds = anchorBounds ?? bounds;
      const targetWidth = Math.max(targetBounds.maxX - targetBounds.minX, NODE_CARD_WIDTH);
      const targetHeight = Math.max(targetBounds.maxY - targetBounds.minY, NODE_HALF_HEIGHT * 2);
      const targetScaleWidth = (availableWidth * (isMobile ? 0.34 : 0.26)) / targetWidth;
      const targetScaleHeight = (availableHeight * (isMobile ? 0.36 : 0.3)) / targetHeight;
      const nextScale = clampScale(Math.max(contextScale, Math.min(targetScaleWidth, targetScaleHeight)));
      const centerX = (targetBounds.minX + targetBounds.maxX) / 2;
      const targetCenterX = sidePadding + availableWidth / 2;
      const nextX = targetCenterX - centerX * nextScale;
      const nextY = topPadding - (anchorBounds?.minY ?? alignTopY) * nextScale;
      applyViewport(nextScale, { x: nextX, y: nextY }, true);
    },
    [applyViewport, clampScale, focusPanelData],
  );

  useEffect(() => {
    if (Number.isFinite(focusMinX) && Number.isFinite(focusMaxX) && Number.isFinite(focusMinY) && Number.isFinite(focusMaxY)) {
      focusToBounds(
        { minX: focusMinX, maxX: focusMaxX, minY: focusMinY, maxY: focusMaxY },
        Number.isFinite(focusAnchorMinX) &&
          Number.isFinite(focusAnchorMaxX) &&
          Number.isFinite(focusAnchorMinY) &&
          Number.isFinite(focusAnchorMaxY)
          ? {
              minX: focusAnchorMinX,
              maxX: focusAnchorMaxX,
              minY: focusAnchorMinY,
              maxY: focusAnchorMaxY,
            }
          : null,
        focusAlignTopY,
      );
      return;
    }
    fitToView();
  }, [
    fitToView,
    focusAlignTopY,
    focusAnchorMaxX,
    focusAnchorMaxY,
    focusAnchorMinX,
    focusAnchorMinY,
    focusMaxX,
    focusMaxY,
    focusMinX,
    focusMinY,
    focusedHouseholdId,
    focusedPersonId,
    focusTargetKind,
    focusToBounds,
  ]);

  useEffect(() => {
    const target = viewportRef.current;
    if (!target || typeof ResizeObserver === "undefined") {
      return;
    }
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        if (Number.isFinite(focusMinX) && Number.isFinite(focusMaxX) && Number.isFinite(focusMinY) && Number.isFinite(focusMaxY)) {
          focusToBounds(
            { minX: focusMinX, maxX: focusMaxX, minY: focusMinY, maxY: focusMaxY },
            Number.isFinite(focusAnchorMinX) &&
              Number.isFinite(focusAnchorMaxX) &&
              Number.isFinite(focusAnchorMinY) &&
              Number.isFinite(focusAnchorMaxY)
              ? {
                  minX: focusAnchorMinX,
                  maxX: focusAnchorMaxX,
                  minY: focusAnchorMinY,
                  maxY: focusAnchorMaxY,
                }
              : null,
            focusAlignTopY,
          );
          return;
        }
        fitToView();
      });
    });
    observer.observe(target);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  }, [
    fitToView,
    focusAlignTopY,
    focusAnchorMaxX,
    focusAnchorMaxY,
    focusAnchorMinX,
    focusAnchorMinY,
    focusMaxX,
    focusMaxY,
    focusMinX,
    focusMinY,
    focusedHouseholdId,
    focusedPersonId,
    focusTargetKind,
    focusToBounds,
  ]);

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
      applyViewport(
        nextScale,
        {
          x: pointX - worldX * nextScale,
          y: pointY - worldY * nextScale,
        },
        false,
      );
    },
    [applyViewport, clampScale, offset.x, offset.y, scale],
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

  const wrapHouseholdLabel = (value: string) => {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [];
    }
    const maxChars = 14;
    const maxLines = 2;
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxChars) {
        current = next;
        continue;
      }
      if (current) {
        lines.push(current);
      }
      current = word;
      if (lines.length >= maxLines - 1) {
        break;
      }
    }
    if (current && lines.length < maxLines) {
      lines.push(current);
    }
    if (lines.length === 0) {
      lines.push(words.join(" ").slice(0, maxChars));
    }
    if (words.join(" ").length > lines.join(" ").length) {
      const last = lines.length - 1;
      lines[last] = `${lines[last].slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
    }
    return lines;
  };

  const clearFocus = useCallback(() => {
    setFocusTarget(null);
    setTreeSearchQuery("");
    fitToView();
  }, [fitToView]);

  const openHouseholdEditor = useCallback((householdId: string) => {
    if (!householdId) {
      return;
    }
    setFocusTarget({ kind: "household", householdId });
    setSelectedHouseholdId(householdId);
  }, []);

  const handleHouseholdSelect = useCallback(
    (householdId: string) => {
      if (!householdId) {
        return;
      }
      const isSelected = focusTarget?.kind === "household" && focusTarget.householdId === householdId;
      if (isSelected && canManage) {
        openHouseholdEditor(householdId);
        return;
      }
      setTreeSearchQuery("");
      setFocusTarget({ kind: "household", householdId });
    },
    [canManage, focusTarget, openHouseholdEditor],
  );

  const handlePersonSelect = useCallback(
    (personId: string) => {
      if (!personId) {
        return;
      }
      const isSelected = focusTarget?.kind === "person" && focusTarget.personId === personId;
      if (isSelected) {
        setEditPersonId(personId);
        return;
      }
      setTreeSearchQuery("");
      setFocusTarget({ kind: "person", personId });
    },
    [focusTarget],
  );

  const handleFocusSearchSelect = useCallback((personId: string) => {
    if (!personId) {
      return;
    }
    setTreeSearchQuery("");
    setFocusTarget({ kind: "person", personId });
  }, []);

  const showDefaultGroup = useCallback(() => {
    setFocusPanelGroup("default");
  }, []);

  const showSpouseGroup = useCallback(() => {
    setFocusPanelGroup("spouses");
  }, []);

  const showSiblingGroup = useCallback(() => {
    setFocusPanelGroup("siblings");
  }, []);

  const showChildrenGroup = useCallback(() => {
    setFocusPanelGroup("children");
  }, []);

  const navigateToParents = useCallback(() => {
    if (!focusPanelData?.parentTarget) {
      return;
    }
    setTreeSearchQuery("");
    setFocusTarget(focusPanelData.parentTarget);
  }, [focusPanelData]);

  const shouldRenderPerson = (personId: string) =>
    !focusContext || focusContext.emphasizedPersonIds.has(personId);
  const shouldRenderHousehold = (householdId: string, memberIds: string[]) => {
    if (!focusContext) {
      return true;
    }
    if (householdId && focusContext.emphasizedHouseholdIds.has(householdId)) {
      return true;
    }
    return memberIds.every((personId) => focusContext.emphasizedPersonIds.has(personId));
  };
  const shouldRenderEdge = (edgeId: string) =>
    !focusContext || focusContext.emphasizedEdgeIds.has(edgeId);
  const shouldRenderConnector = (householdId: string, childId: string) =>
    !focusContext || focusContext.emphasizedConnectorKeys.has(`${householdId}::${childId}`);
  const isSelectedPerson = (personId: string) =>
    Boolean(focusContext?.selectedPersonIds.has(personId));
  const isRelatedPerson = (personId: string) =>
    Boolean(focusContext?.emphasizedPersonIds.has(personId)) && !isSelectedPerson(personId);
  const isSelectedHousehold = (householdId: string) =>
    Boolean(focusContext?.selectedHouseholdIds.has(householdId));

  return (
    <div
      ref={viewportRef}
      className={`tree-graph-wrap tree-map ${isPanning ? "tree-panning" : ""}`}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch" && event.button !== 0) {
          return;
        }
        if (shouldIgnorePanStart(event.target)) {
          return;
        }
        stopViewportAnimation();
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
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
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
      onLostPointerCapture={(event) => {
        resetTreePointerState(event.currentTarget, event.pointerId);
      }}
    >
      <div className="tree-cloud-overlay" />
      <div
        className={`tree-map-layer${animateViewport ? " is-animating" : ""}`}
        style={{
          width: `${canvasWidth}px`,
          height: `${canvasHeight}px`,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        }}
      >
      <svg
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        className="tree-lines"
        aria-label="Family tree graph"
        style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
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
          const halfWidth = Math.max(96, distance / 2 + NODE_HALF_WIDTH + 12);
          const halfHeight = NODE_HALF_HEIGHT + 26;
          const labelLines = label ? wrapHouseholdLabel(label) : [];

          const householdId = pairHouseholdIdByPairKey.get(pairKey) ?? "";
          if (!shouldRenderHousehold(householdId, [leftId, rightId])) {
            return null;
          }
          const selected = householdId ? isSelectedHousehold(householdId) : false;

          return (
            <g key={`cluster-${pairKey}`} className={`tree-household-group${selected ? " is-selected" : ""}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="tree-line" />
              <rect
                x={midX - halfWidth}
                y={midY - halfHeight}
                width={halfWidth * 2}
                height={halfHeight * 2}
                rx={22}
                ry={22}
                className={`tree-spouse-cluster${selected ? " is-focused" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleHouseholdSelect(householdId);
                }}
              />
              {labelLines.length > 0 ? (
                <text x={midX} y={midY - halfHeight + 14} className={`tree-family-label${selected ? " is-focused" : ""}`}>
                  {labelLines.map((line, index) => (
                    <tspan key={`${pairKey}-label-${index}`} x={midX} dy={index === 0 ? 0 : 12}>
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : null}
              {canManage ? (
                <circle
                  cx={midX + halfWidth - 18}
                  cy={midY - halfHeight + 18}
                  r={7}
                  className="tree-household-action-dot"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    openHouseholdEditor(householdId);
                  }}
                />
              ) : null}
            </g>
          );
        })}
        {Array.from(householdMetaById.values())
          .filter((household) => household.memberIds.length === 1)
          .map((household) => {
            const personId = household.memberIds[0] ?? "";
            const pos = positions.get(personId);
            if (!pos) {
              return null;
            }
            if (!shouldRenderHousehold(household.householdId, household.memberIds)) {
              return null;
            }
            const halfWidth = NODE_HALF_WIDTH + 16;
            const halfHeight = NODE_HALF_HEIGHT + 26;
            const labelLines = household.label ? wrapHouseholdLabel(household.label) : [];
            const selected = isSelectedHousehold(household.householdId);
            return (
              <g key={`cluster-single-${household.householdId}`} className={`tree-household-group${selected ? " is-selected" : ""}`}>
                <rect
                  x={pos.x - halfWidth}
                  y={pos.y - halfHeight}
                  width={halfWidth * 2}
                  height={halfHeight * 2}
                  rx={22}
                  ry={22}
                  className={`tree-spouse-cluster${selected ? " is-focused" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleHouseholdSelect(household.householdId);
                  }}
                />
                {labelLines.length > 0 ? (
                  <text x={pos.x} y={pos.y - halfHeight + 14} className={`tree-family-label${selected ? " is-focused" : ""}`}>
                    {labelLines.map((line, index) => (
                      <tspan key={`${household.householdId}-label-${index}`} x={pos.x} dy={index === 0 ? 0 : 12}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                ) : null}
                {canManage ? (
                  <circle
                    cx={pos.x + halfWidth - 18}
                    cy={pos.y - halfHeight + 18}
                    r={7}
                    className="tree-household-action-dot"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      openHouseholdEditor(household.householdId);
                    }}
                  />
                ) : null}
              </g>
            );
          })}
        {edges.map((edge) => {
          if (hiddenParentEdgeIds.has(edge.id)) {
            return null;
          }
          if (!shouldRenderEdge(edge.id)) {
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
          return (
            <g key={edge.id}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="tree-line" />
              {!isFamilyEdge && !isParentEdge ? (
                <text x={midX} y={midY} className="tree-line-label">
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {familyChildConnectors.map((connector) => {
          const household = householdMetaById.get(connector.householdId);
          if (!household) {
            return null;
          }
          if (!shouldRenderConnector(connector.householdId, connector.childId)) {
            return null;
          }
          const child = positions.get(connector.childId);
          const memberPositions = household.memberIds
            .map((personId) => positions.get(personId))
            .filter((pos): pos is { x: number; y: number } => Boolean(pos));
          if (memberPositions.length === 0 || !child) {
            return null;
          }
          const midX = memberPositions.reduce((sum, pos) => sum + pos.x, 0) / memberPositions.length;
          const midY = memberPositions.reduce((sum, pos) => sum + pos.y, 0) / memberPositions.length;
          const startY = midY + NODE_HALF_HEIGHT + 16;
          const endY = child.y - NODE_HALF_HEIGHT;
          return (
            <line
              key={`family-child-${connector.householdId}-${connector.childId}`}
              x1={midX}
              y1={startY}
              x2={child.x}
              y2={endY}
              className="tree-line"
            />
          );
        })}
      </svg>

      {nodes.map((node) => {
        if (!shouldRenderPerson(node.personId)) {
          return null;
        }
        const pos = positions.get(node.personId);
        if (!pos) {
          return null;
        }
        const secondaryText = toMonthDay(node.birthDate);
        const firstNameOnly = (node.firstName ?? "").trim() || node.displayName.trim().split(/\s+/)[0] || node.displayName;
        return (
          <div
            key={node.personId}
            className={`tree-node-card-wrap${isSelectedPerson(node.personId) ? " tree-focus-selected" : ""}${isRelatedPerson(node.personId) ? " tree-focus-related" : ""}`}
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
          >
            <PersonNodeCard
              personId={node.personId}
              displayName={firstNameOnly}
              secondaryText={secondaryText}
              avatarUrl={getAvatarUrl(node)}
              isSelected={isSelectedPerson(node.personId)}
              isDimmed={false}
              onSelectPerson={handlePersonSelect}
              onOpenPerson={(personId) => {
                setFocusTarget({ kind: "person", personId });
                setEditPersonId(personId);
              }}
            />
          </div>
        );
      })}
      </div>
      <div className="tree-search-card" onPointerDown={(event) => event.stopPropagation()}>
        <input
          id="tree-search-input"
          type="search"
          className="tree-search-input"
          value={treeSearchQuery}
          onChange={(event) => setTreeSearchQuery(event.target.value)}
          placeholder="Find a person"
          aria-label="Find a person in the family tree"
        />
        {deferredTreeSearchQuery ? (
          <div className="tree-search-results">
            {treeSearchResults.length > 0 ? (
              treeSearchResults.map((person) => (
                <button
                  key={`tree-search-${person.personId}`}
                  type="button"
                  className="tree-search-result"
                  onClick={() => handleFocusSearchSelect(person.personId)}
                >
                  <img src={getAvatarUrl(person)} alt={person.displayName} />
                  <span>{person.displayName}</span>
                </button>
              ))
            ) : (
              <p className="tree-search-empty">No matching people.</p>
            )}
          </div>
        ) : null}
      </div>
      <GraphControls
        onZoomIn={() => zoomFromCenter(1.15)}
        onZoomOut={() => zoomFromCenter(0.87)}
        onFit={fitToView}
        onClearFocus={focusTarget ? clearFocus : undefined}
      />
      {focusPanelData ? (
        <FocusPanel
          selectedPerson={focusPanelData.selectedPerson}
          selectedHouseholdLabel={focusPanelData.selectedHouseholdLabel}
          activeGroup={focusPanelGroup}
          currentPeople={focusPanelData.currentPeople}
          spouses={focusPanelData.spouses}
          siblings={focusPanelData.siblings}
          childrenList={focusPanelData.childrenList}
          hasParents={Boolean(focusPanelData.parentTarget)}
          getAvatarUrl={getAvatarUrl}
          onActivateDefault={showDefaultGroup}
          onActivateParents={navigateToParents}
          onActivateSpouses={showSpouseGroup}
          onActivateSiblings={showSiblingGroup}
          onActivateChildren={showChildrenGroup}
          onSelectPerson={handleFocusSearchSelect}
          onClose={clearFocus}
        />
      ) : null}
      <PersonEditModal
        open={Boolean(editPerson)}
        tenantKey={tenantKey}
        canManage={canManage}
        canManageRelationshipType={canManageRelationshipType}
        person={editPerson}
        people={nodes}
        edges={edges}
        households={households}
        onClose={() => setEditPersonId("")}
        onSaved={() => router.refresh()}
        onEditHousehold={(householdId) => openHouseholdEditor(householdId)}
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
