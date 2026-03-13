export interface IntroPost {
  post_id: string;
  member_id: string;
  member_name: string;
  text: string;
  location?: {
    city?: string;
    country?: string;
    region?: string;
  };
  created_at: string;
  topics?: string[];
}

export interface PostWithEmbedding extends IntroPost {
  embedding: number[];
}

export interface SearchResult {
  post_id: string;
  text: string;
  member_id: string;
  member_name: string;
  similarity: number;
  metadata: {
    post_id: string;
    member_id: string;
    member_name: string;
    created_at: string;
    text: string;
    city?: string;
    country?: string;
    region?: string;
  };
}

export interface Env {
  VECTOR_STORE: KVNamespace;
  EMBEDDING_SERVICE_URL: string;
  ENVIRONMENT?: string;
}

export const EMBEDDING_DIMENSION = 384;
export const MAX_KV_VALUE_SIZE = 128000;

export async function getEmbedding(
  text: string,
  env: Env
): Promise<number[]> {
  if (!env.EMBEDDING_SERVICE_URL) {
    throw new Error("EMBEDDING_SERVICE_URL not configured");
  }

  const response = await fetch(`${env.EMBEDDING_SERVICE_URL}/embed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding service failed: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    embedding: number[];
  };
  return data.embedding;
}

export async function getEmbeddings(
  texts: string[],
  env: Env
): Promise<number[][]> {
  if (!env.EMBEDDING_SERVICE_URL) {
    throw new Error("EMBEDDING_SERVICE_URL not configured");
  }

  const response = await fetch(`${env.EMBEDDING_SERVICE_URL}/embed_batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ texts }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding service failed: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    embeddings: number[][];
  };
  return data.embeddings;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same dimension");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

export function serializeEmbedding(embedding: number[]): string {
  const float32Array = new Float32Array(embedding);
  const uint8Array = new Uint8Array(float32Array.buffer);
  return btoa(String.fromCharCode(...uint8Array));
}

export function deserializeEmbedding(base64: string): number[] {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return Array.from(new Float32Array(bytes.buffer));
}

export function encodeEmbeddingToBytes(embedding: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(embedding).buffer);
}

export function decodeEmbeddingFromBytes(bytes: Uint8Array): number[] {
  return Array.from(new Float32Array(bytes.buffer));
}

export function buildPostKey(postId: string): string {
  return `post:${postId}`;
}

export function buildMemberIndexKey(memberId: string): string {
  return `member_index:${memberId}`;
}

export function buildLocationIndexKey(
  locationType: "city" | "country" | "region",
  value: string
): string {
  return `location_index:${locationType}:${value.toLowerCase()}`;
}

export function buildEmbeddingKey(postId: string): string {
  return `embedding:${postId}`;
}
