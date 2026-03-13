import {
  IntroPost,
  PostWithEmbedding,
  Env,
  buildPostKey,
  buildMemberIndexKey,
  buildLocationIndexKey,
  buildEmbeddingKey,
  getEmbedding,
  encodeEmbeddingToBytes,
} from "./lib";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleCors();
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    try {
      const contentType = request.headers.get("Content-Type") || "";
      let post: IntroPost;

      if (contentType.includes("application/json")) {
        const body = await request.json();
        post = body.post || body;
      } else if (contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        post = {
          post_id: formData.get("post_id") as string,
          member_id: formData.get("member_id") as string,
          member_name: formData.get("member_name") as string,
          text: formData.get("text") as string,
          created_at: (formData.get("created_at") as string) || new Date().toISOString(),
          topics: formData.get("topics") ? JSON.parse(formData.get("topics") as string) : [],
          location: formData.get("location") ? JSON.parse(formData.get("location") as string) : undefined,
        };
      } else {
        return new Response(JSON.stringify({ error: "Unsupported content type" }), {
          status: 415,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      if (!post.post_id || !post.member_id || !post.text) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: post_id, member_id, text" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } }
        );
      }

      const textForEmbedding = `${post.member_name}: ${post.text}`;
      const embedding = await getEmbedding(textForEmbedding, env);

      const postWithEmbedding: PostWithEmbedding = {
        ...post,
        embedding,
      };

      await storePost(postWithEmbedding, env);

      return new Response(
        JSON.stringify({
          success: true,
          post_id: post.post_id,
          message: "Post ingested successfully",
        }),
        { status: 201, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Ingest error:", message);
      return new Response(
        JSON.stringify({ error: "Failed to ingest post", details: message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }
  },
};

async function storePost(post: PostWithEmbedding, env: Env): Promise<void> {
  const postKey = buildPostKey(post.post_id);
  const embeddingKey = buildEmbeddingKey(post.post_id);

  const postData = {
    post_id: post.post_id,
    member_id: post.member_id,
    member_name: post.member_name,
    text: post.text,
    created_at: post.created_at,
    topics: post.topics || [],
    location: post.location,
  };

  await env.VECTOR_STORE.put(postKey, JSON.stringify(postData));

  const embeddingBytes = encodeEmbeddingToBytes(post.embedding);
  await env.VECTOR_STORE.put(embeddingKey, embeddingBytes, {
    metadata: {
      post_id: post.post_id,
      dimension: post.embedding.length,
    },
  });

  await updateMemberIndex(post.member_id, post.post_id, env);
  await updateLocationIndex(post, env);

  const allPostsKey = "index:all_posts";
  const existingList = await env.VECTOR_STORE.get(allPostsKey, "json");
  const postIds: string[] = existingList || [];
  if (!postIds.includes(post.post_id)) {
    postIds.push(post.post_id);
    await env.VECTOR_STORE.put(allPostsKey, JSON.stringify(postIds));
  }
}

async function updateMemberIndex(
  memberId: string,
  postId: string,
  env: Env
): Promise<void> {
  const memberKey = buildMemberIndexKey(memberId);
  const existing = await env.VECTOR_STORE.get(memberKey, "json");
  const postIds: string[] = existing || [];

  if (!postIds.includes(postId)) {
    postIds.push(postId);
    await env.VECTOR_STORE.put(memberKey, JSON.stringify(postIds));
  }
}

async function updateLocationIndex(post: PostWithEmbedding, env: Env): Promise<void> {
  const loc = post.location;
  if (!loc) return;

  if (loc.city) {
    const cityKey = buildLocationIndexKey("city", loc.city);
    await addToLocationIndex(cityKey, post.post_id, env);
  }
  if (loc.country) {
    const countryKey = buildLocationIndexKey("country", loc.country);
    await addToLocationIndex(countryKey, post.post_id, env);
  }
  if (loc.region) {
    const regionKey = buildLocationIndexKey("region", loc.region);
    await addToLocationIndex(regionKey, post.post_id, env);
  }
}

async function addToLocationIndex(key: string, postId: string, env: Env): Promise<void> {
  const existing = await env.VECTOR_STORE.get(key, "json");
  const postIds: string[] = existing || [];
  if (!postIds.includes(postId)) {
    postIds.push(postId);
    await env.VECTOR_STORE.put(key, JSON.stringify(postIds));
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function handleCors(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}
