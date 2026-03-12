"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HouseholdEditModal } from "@/components/HouseholdEditModal";
import { PersonEditModal } from "@/components/PersonEditModal";
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
    spousePairMeta.set(pairKey, { leftId, rightId, label: unit.label?.trim() || unit.id?.trim() || "" });
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
  const parentPairKeyByChildId = new Map<string, string>();
  familyChildConnectors.forEach((connector) => {
    if (!parentPairKeyByChildId.has(connector.childId)) {
      parentPairKeyByChildId.set(connector.childId, connector.pairKey);
    }
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
      unitIds.find((personId) => parentPairKeyByChildId.has(personId) && isDirectLineTreePerson(nodeMap.get(personId))) ??
      unitIds.find((personId) => parentPairKeyByChildId.has(personId));
    if (directChildId) {
      const pairKey = parentPairKeyByChildId.get(directChildId) ?? "";
      if (pairKey) {
        return `pair:${pairKey}`;
      }
    }
    return `unit:${unitIds.join("::")}`;
  }

  function getSiblingBlockPreferredCenterX(
    blockKey: string,
    fallbackCenterX: number,
    currentPositions: Map<string, { x: number; y: number }>,
  ) {
    if (!blockKey.startsWith("pair:")) {
      return fallbackCenterX;
    }
    const pair = spousePairMeta.get(blockKey.slice(5));
    if (!pair) {
      return fallbackCenterX;
    }
    const left = currentPositions.get(pair.leftId);
    const right = currentPositions.get(pair.rightId);
    if (!left || !right) {
      return fallbackCenterX;
    }
    return (left.x + right.x) / 2;
  }

  const peopleById = new Map(nodes.map((node) => [node.personId, node]));
  const editPerson = editPersonId ? peopleById.get(editPersonId) ?? null : null;

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
    const fitScale = clampScale(Math.min(rect.width / canvasWidth, rect.height / canvasHeight) * 0.94);
    const nextX = (rect.width - canvasWidth * fitScale) / 2;
    const nextY = (rect.height - canvasHeight * fitScale) / 2;
    setScale(fitScale);
    setOffset({ x: nextX, y: nextY });
  }, [canvasHeight, canvasWidth, clampScale]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

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

  return (
    <div
      ref={viewportRef}
      className={`tree-graph-wrap tree-map ${isPanning ? "tree-panning" : ""}`}
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

          return (
            <g key={`cluster-${pairKey}`} className="tree-household-group">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="tree-line" />
              <rect
                x={midX - halfWidth}
                y={midY - halfHeight}
                width={halfWidth * 2}
                height={halfHeight * 2}
                rx={22}
                ry={22}
                className="tree-spouse-cluster"
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
              {labelLines.length > 0 ? (
                <text x={midX} y={midY - halfHeight + 14} className="tree-family-label">
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
          return (
            <line
              key={`family-child-${connector.pairKey}-${connector.childId}`}
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
        const pos = positions.get(node.personId);
        if (!pos) {
          return null;
        }
        const secondaryText = toMonthDay(node.birthDate);
        const firstNameOnly = (node.firstName ?? "").trim() || node.displayName.trim().split(/\s+/)[0] || node.displayName;
        return (
          <div
            key={node.personId}
            className="tree-node-card-wrap"
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
          >
            <PersonNodeCard
              personId={node.personId}
              displayName={firstNameOnly}
              secondaryText={secondaryText}
              avatarUrl={getAvatarUrl(node)}
              onOpenPerson={(personId) => setEditPersonId(personId)}
            />
          </div>
        );
      })}
      </div>
      <GraphControls onZoomIn={() => zoomFromCenter(1.15)} onZoomOut={() => zoomFromCenter(0.87)} onFit={fitToView} />
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
