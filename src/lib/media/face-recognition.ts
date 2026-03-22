import "server-only";

import { createHash } from "node:crypto";
import type { PersonRecord } from "@/lib/google/types";
import { getOciObjectContentByKey } from "@/lib/oci/object-storage";
import {
  OCI_GLOBAL_FACE_SCOPE_KEY,
  getOciMediaAssetByFileId,
  getOciPersonFaceProfilesForTenant,
  replaceOciFaceAnalysisForFile,
  upsertOciPersonFaceProfile,
  type OciPersonFaceProfileRow,
} from "@/lib/oci/tables";
import { analyzeInlineImageWithVision, type OciVisionFace } from "@/lib/oci/vision";
import { parseMediaMetadata } from "@/lib/media/upload";

export type FaceConfidenceBand = "high" | "medium" | "low";

export type PhotoFaceSuggestionMatch = {
  personId: string;
  displayName: string;
  confidenceScore: number;
  confidenceBand: FaceConfidenceBand;
};

export type PhotoFaceSuggestion = {
  faceId: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  detectionConfidence: number;
  qualityScore: number;
  matches: PhotoFaceSuggestionMatch[];
};

const MIN_MATCH_CONFIDENCE = 0.62;

function hashId(prefix: string, seed: string) {
  return `${prefix}-${createHash("sha1").update(seed.trim().toLowerCase()).digest("hex").slice(0, 12)}`;
}

function toStableNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(6);
}

function buildFaceInstanceId(input: {
  fileId: string;
  faceIndex: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}) {
  return hashId(
    "face",
    `${input.fileId}|${input.faceIndex}|${toStableNumber(input.boundingBox.x)}|${toStableNumber(input.boundingBox.y)}|${toStableNumber(input.boundingBox.width)}|${toStableNumber(input.boundingBox.height)}`,
  );
}

function readOriginalObjectKey(rawMetadata: string) {
  const parsed = parseMediaMetadata(rawMetadata) as Record<string, unknown> | null;
  if (!parsed) return "";
  const objectStorage = parsed.objectStorage;
  if (objectStorage && typeof objectStorage === "object") {
    const key = String((objectStorage as Record<string, unknown>).originalObjectKey ?? "").trim();
    if (key) return key;
  }
  return String(parsed.originalObjectKey ?? "").trim();
}

function parseEmbeddingJson(raw: string) {
  const value = raw.trim();
  if (!value) return [] as number[];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
  } catch {
    return [];
  }
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm <= 0 || rightNorm <= 0) {
    return 0;
  }
  const score = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(1, score));
}

function toConfidenceBand(score: number): FaceConfidenceBand {
  if (score >= 0.82) return "high";
  if (score >= 0.72) return "medium";
  return "low";
}

function chooseBestProfileFace(faces: OciVisionFace[]) {
  return faces
    .filter((face) => face.embedding.length > 0)
    .slice()
    .sort((left, right) => {
      const leftArea = left.boundingBox.width * left.boundingBox.height;
      const rightArea = right.boundingBox.width * right.boundingBox.height;
      const leftScore = left.qualityScore * 0.7 + left.confidence * 0.3 + leftArea * 0.05;
      const rightScore = right.qualityScore * 0.7 + right.confidence * 0.3 + rightArea * 0.05;
      return rightScore - leftScore;
    })[0] ?? null;
}

async function ensurePersonFaceProfileFromImageBytes(input: {
  familyGroupKey: string;
  personId: string;
  sourceFileId: string;
  imageBytes: Buffer;
}): Promise<OciPersonFaceProfileRow | null> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const personId = input.personId.trim();
  const sourceFileId = input.sourceFileId.trim();
  if (!personId || !sourceFileId) {
    return null;
  }
  const vision = await analyzeInlineImageWithVision({ imageBytes: input.imageBytes });
  const face = chooseBestProfileFace(vision.faces);
  if (!face) {
    return null;
  }
  const updatedAt = new Date().toISOString();
  const profileId = hashId("fprofile", personId);
  const embeddingJson = JSON.stringify(face.embedding);
  await upsertOciPersonFaceProfile({
    familyGroupKey,
    profileId,
    personId,
    sourceFileId,
    sampleCount: 1,
    embeddingJson,
    updatedAt,
  });
  return {
    familyGroupKey: OCI_GLOBAL_FACE_SCOPE_KEY,
    profileId,
    personId,
    sourceFileId,
    sampleCount: 1,
    embeddingJson,
    updatedAt,
  };
}

async function bootstrapPersonFaceProfileFromHeadshot(input: {
  familyGroupKey: string;
  person: PersonRecord;
}): Promise<OciPersonFaceProfileRow | null> {
  const sourceFileId = input.person.photoFileId.trim();
  if (!sourceFileId) {
    return null;
  }
  const asset = await getOciMediaAssetByFileId(sourceFileId).catch(() => null);
  if (!asset) {
    return null;
  }
  const originalObjectKey = readOriginalObjectKey(asset.mediaMetadata);
  if (!originalObjectKey) {
    return null;
  }
  const source = await getOciObjectContentByKey(originalObjectKey).catch(() => null);
  if (!source) {
    return null;
  }
  return ensurePersonFaceProfileFromImageBytes({
    familyGroupKey: input.familyGroupKey,
    personId: input.person.personId,
    sourceFileId,
    imageBytes: Buffer.from(source.data),
  }).catch(() => null);
}

type CandidateProfile = {
  personId: string;
  displayName: string;
  embedding: number[];
};

async function loadCandidateProfiles(input: {
  familyGroupKey: string;
  people: PersonRecord[];
  bootstrapBudget?: number;
}): Promise<CandidateProfile[]> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const existingProfiles = await getOciPersonFaceProfilesForTenant({ familyGroupKey }).catch(() => []);
  const profileByPersonId = new Map(existingProfiles.map((profile) => [profile.personId, profile] as const));

  let bootstrapBudget = Math.max(0, Math.trunc(input.bootstrapBudget ?? 0));
  if (bootstrapBudget > 0) {
    for (const person of input.people) {
      if (bootstrapBudget <= 0) {
        break;
      }
      const photoFileId = person.photoFileId.trim();
      if (!photoFileId) {
        continue;
      }
      const current = profileByPersonId.get(person.personId);
      if (current && current.sourceFileId.trim() === photoFileId && parseEmbeddingJson(current.embeddingJson).length > 0) {
        continue;
      }
      const bootstrapped = await bootstrapPersonFaceProfileFromHeadshot({
        familyGroupKey,
        person,
      });
      bootstrapBudget -= 1;
      if (bootstrapped) {
        profileByPersonId.set(person.personId, bootstrapped);
      }
    }
  }

  return input.people
    .map((person) => {
      const profile = profileByPersonId.get(person.personId);
      const embedding = parseEmbeddingJson(profile?.embeddingJson ?? "");
      if (embedding.length === 0) {
        return null;
      }
      return {
        personId: person.personId,
        displayName: person.displayName || person.personId,
        embedding,
      } satisfies CandidateProfile;
    })
    .filter((item): item is CandidateProfile => Boolean(item));
}

export async function seedPersonFaceProfileFromUpload(input: {
  familyGroupKey: string;
  personId: string;
  sourceFileId: string;
  imageBytes: Buffer;
}) {
  return ensurePersonFaceProfileFromImageBytes(input);
}

export async function buildAndPersistFaceSuggestions(input: {
  familyGroupKey: string;
  fileId: string;
  faces: OciVisionFace[];
  people: PersonRecord[];
}): Promise<PhotoFaceSuggestion[]> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const fileId = input.fileId.trim();
  if (!fileId) {
    return [];
  }

  const timestamp = new Date().toISOString();
  let candidateProfiles: CandidateProfile[] = [];
  const hasMatchableFaces = input.faces.some((face) => face.embedding.length > 0);
  if (hasMatchableFaces) {
    candidateProfiles = await loadCandidateProfiles({
      familyGroupKey,
      people: input.people,
      bootstrapBudget: 0,
    });
  }

  const suggestions = input.faces.map((face, index) => {
    const faceId = buildFaceInstanceId({
      fileId,
      faceIndex: index,
      boundingBox: face.boundingBox,
    });
    const matches = candidateProfiles
      .map((candidate) => {
        const confidenceScore = cosineSimilarity(face.embedding, candidate.embedding);
        return {
          personId: candidate.personId,
          displayName: candidate.displayName,
          confidenceScore,
          confidenceBand: toConfidenceBand(confidenceScore),
        } satisfies PhotoFaceSuggestionMatch;
      })
      .filter((candidate) => candidate.confidenceScore >= MIN_MATCH_CONFIDENCE)
      .sort((left, right) => right.confidenceScore - left.confidenceScore)
      .slice(0, 3);
    return {
      faceId,
      bbox: {
        x: face.boundingBox.x,
        y: face.boundingBox.y,
        width: face.boundingBox.width,
        height: face.boundingBox.height,
      },
      detectionConfidence: face.confidence,
      qualityScore: face.qualityScore,
      matches,
    } satisfies PhotoFaceSuggestion;
  });
  const embeddingByFaceId = new Map(
    input.faces.map((face, index) => [
      buildFaceInstanceId({
        fileId,
        faceIndex: index,
        boundingBox: face.boundingBox,
      }),
      face.embedding,
    ] as const),
  );

  await replaceOciFaceAnalysisForFile({
    familyGroupKey,
    fileId,
    instances: suggestions.map((suggestion) => ({
      faceId: suggestion.faceId,
      bboxX: suggestion.bbox.x,
      bboxY: suggestion.bbox.y,
      bboxW: suggestion.bbox.width,
      bboxH: suggestion.bbox.height,
      detectionConfidence: suggestion.detectionConfidence,
      qualityScore: suggestion.qualityScore,
      embeddingJson: JSON.stringify(embeddingByFaceId.get(suggestion.faceId) ?? []),
      createdAt: timestamp,
      updatedAt: timestamp,
      matches: suggestion.matches.map((match) => ({
        matchId: hashId("fmatch", `${suggestion.faceId}|${match.personId}`),
        candidatePersonId: match.personId,
        confidenceScore: match.confidenceScore,
        matchStatus: "suggested",
        createdAt: timestamp,
        matchMetadata: JSON.stringify({
          confidenceBand: match.confidenceBand,
          source: "person_face_profile",
        }),
      })),
    })),
  });

  return suggestions;
}
