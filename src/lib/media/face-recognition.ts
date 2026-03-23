import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";
import type { PersonRecord } from "@/lib/google/types";
import { getOciObjectContentByKey } from "@/lib/oci/object-storage";
import {
  OCI_GLOBAL_FACE_SCOPE_KEY,
  getOciFaceInstancesForFile,
  getOciMediaAssetByFileId,
  getOciPersonFaceProfilesForTenant,
  replaceOciFaceMatchesForFace,
  replaceOciFaceAnalysisForFile,
  updateOciFaceInstanceEmbedding,
  upsertOciPersonFaceProfile,
  type OciPersonFaceProfileRow,
} from "@/lib/oci/tables";
import { analyzeInlineImageWithVision, detectFacesInlineWithVision, type OciVisionFace } from "@/lib/oci/vision";
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

function averageEmbeddings(current: number[], incoming: number[], currentSamples: number) {
  if (current.length === 0 || incoming.length === 0 || current.length !== incoming.length || currentSamples <= 0) {
    return incoming;
  }
  return incoming.map((value, index) => ((current[index] * currentSamples) + value) / (currentSamples + 1));
}

function toConfidenceBand(score: number): FaceConfidenceBand {
  if (score >= 0.82) return "high";
  if (score >= 0.72) return "medium";
  return "low";
}

function scoreFaceCandidate(face: OciVisionFace) {
  const area = face.boundingBox.width * face.boundingBox.height;
  return face.qualityScore * 0.7 + face.confidence * 0.3 + area * 0.05;
}

function chooseBestFaceCandidate(faces: OciVisionFace[]) {
  return faces
    .slice()
    .sort((left, right) => scoreFaceCandidate(right) - scoreFaceCandidate(left))[0] ?? null;
}

function chooseBestProfileFace(faces: OciVisionFace[]) {
  return faces
    .filter((face) => face.embedding.length > 0)
    .sort((left, right) => scoreFaceCandidate(right) - scoreFaceCandidate(left))[0] ?? null;
}

async function cropFaceImageBytes(input: {
  imageBytes: Buffer;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}) {
  const safeWidth = Math.max(0.05, Math.min(1, Number(input.boundingBox.width ?? 0) || 0));
  const safeHeight = Math.max(0.05, Math.min(1, Number(input.boundingBox.height ?? 0) || 0));
  const safeX = Math.max(0, Math.min(1 - safeWidth, Number(input.boundingBox.x ?? 0) || 0));
  const safeY = Math.max(0, Math.min(1 - safeHeight, Number(input.boundingBox.y ?? 0) || 0));
  const paddingX = safeWidth * 0.18;
  const paddingY = safeHeight * 0.22;
  const base = sharp(input.imageBytes, { failOn: "none", animated: false }).rotate();
  const metadata = await base.metadata();
  const imageWidth = Math.max(1, metadata.width ?? 0);
  const imageHeight = Math.max(1, metadata.height ?? 0);
  const left = Math.max(0, Math.floor((safeX - paddingX) * imageWidth));
  const top = Math.max(0, Math.floor((safeY - paddingY) * imageHeight));
  const right = Math.min(imageWidth, Math.ceil((safeX + safeWidth + paddingX) * imageWidth));
  const bottom = Math.min(imageHeight, Math.ceil((safeY + safeHeight + paddingY) * imageHeight));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  return base
    .extract({ left, top, width, height })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function buildEmbeddingFromFaceCrop(input: {
  imageBytes: Buffer;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}) {
  const croppedBytes = await cropFaceImageBytes(input);
  const vision = await analyzeInlineImageWithVision({ imageBytes: croppedBytes });
  const face = chooseBestProfileFace(vision.faces);
  if (!face || face.embedding.length === 0) {
    throw new Error("Selected face crop did not produce an embedding vector.");
  }
  return face.embedding;
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
  const detection = await detectFacesInlineWithVision({ imageBytes: input.imageBytes });
  const detectedFace = chooseBestFaceCandidate(detection.faces);
  if (!detectedFace) {
    return null;
  }
  const embedding = await buildEmbeddingFromFaceCrop({
    imageBytes: input.imageBytes,
    boundingBox: detectedFace.boundingBox,
  }).catch(() => []);
  if (embedding.length === 0) {
    return null;
  }
  const updatedAt = new Date().toISOString();
  const profileId = hashId("fprofile", personId);
  const embeddingJson = JSON.stringify(embedding);
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

export async function associateDetectedFaceToPerson(input: {
  familyGroupKey: string;
  fileId: string;
  faceId: string;
  personId: string;
  reviewedBy: string;
  sourceImageBytes?: Buffer | null;
}) {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const fileId = input.fileId.trim();
  const faceId = input.faceId.trim();
  const personId = input.personId.trim();
  if (!fileId || !faceId || !personId) {
    throw new Error("file_id, face_id, and person_id are required");
  }

  const [faceInstances, existingProfiles] = await Promise.all([
    getOciFaceInstancesForFile({ familyGroupKey, fileId }),
    getOciPersonFaceProfilesForTenant({ familyGroupKey }).catch(() => []),
  ]);
  const faceInstance = faceInstances.find((item) => item.faceId === faceId);
  if (!faceInstance) {
    throw new Error("Detected face was not found for this photo.");
  }

  let embedding = parseEmbeddingJson(faceInstance.embeddingJson);
  if (embedding.length === 0) {
    if (!input.sourceImageBytes) {
      throw new Error("Unable to load source image bytes for face association.");
    }
    embedding = await buildEmbeddingFromFaceCrop({
      imageBytes: input.sourceImageBytes,
      boundingBox: {
        x: faceInstance.bboxX,
        y: faceInstance.bboxY,
        width: faceInstance.bboxW,
        height: faceInstance.bboxH,
      },
    });
  }

  const existingProfile = existingProfiles.find((profile) => profile.personId === personId) ?? null;
  const existingEmbedding = parseEmbeddingJson(existingProfile?.embeddingJson ?? "");
  const existingSamples = Math.max(0, existingProfile?.sampleCount ?? 0);
  const nextEmbedding = averageEmbeddings(existingEmbedding, embedding, existingSamples);
  const nextSampleCount =
    existingSamples > 0 && existingEmbedding.length === embedding.length
      ? existingSamples + 1
      : 1;
  const reviewedAt = new Date().toISOString();
  const profileId = hashId("fprofile", personId);
  const embeddingJson = JSON.stringify(embedding);

  await updateOciFaceInstanceEmbedding({
    faceId,
    embeddingJson,
    updatedAt: reviewedAt,
  });

  await upsertOciPersonFaceProfile({
    familyGroupKey,
    profileId,
    personId,
    sourceFileId: fileId,
    sampleCount: nextSampleCount,
    embeddingJson: JSON.stringify(nextEmbedding),
    updatedAt: reviewedAt,
  });

  await replaceOciFaceMatchesForFace({
    faceId,
    matches: [
      {
        matchId: hashId("fmatch", `${faceId}|${personId}|confirmed`),
        candidatePersonId: personId,
        confidenceScore: 1,
        matchStatus: "confirmed",
        reviewedBy: input.reviewedBy.trim(),
        reviewedAt,
        createdAt: reviewedAt,
        matchMetadata: JSON.stringify({
          source: "manual_review",
          profileSampleCount: nextSampleCount,
        }),
      },
    ],
  });

  return {
    familyGroupKey: OCI_GLOBAL_FACE_SCOPE_KEY,
    faceId,
    personId,
    sampleCount: nextSampleCount,
    updatedAt: reviewedAt,
  };
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
