import {
  IntroPost,
  PostWithEmbedding,
  Env,
  SearchResult,
  buildPostKey,
  buildMemberIndexKey,
  buildLocationIndexKey,
  buildEmbeddingKey,
  getEmbedding,
  encodeEmbeddingToBytes,
  cosineSimilarity,
  decodeEmbeddingFromBytes,
} from "./lib";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleCors();
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "/ingest") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }
      return handleIngest(request, env);
    }

    if (path === "/search" || path === "/api/search") {
      return handleSearch(request, env);
    }

    if (path === "/stats" || path === "/api/stats") {
      return handleStats(env);
    }

    if (path.startsWith("/member/") || path.startsWith("/api/member/")) {
      const memberId = path.split("/").pop();
      if (memberId) {
        return handleMemberPosts(memberId, env);
      }
    }

    if (path === "/health" || path === "/api/health") {
      return new Response(
        JSON.stringify({ status: "ok", environment: env.ENVIRONMENT || "development" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  },
};

async function handleIngest(request: Request, env: Env): Promise<Response> {
  try {
    const contentType = request.headers.get("Content-Type") || "";
    let post: IntroPost;

    if (contentType.includes("application/json")) {
      const body = await request.json();
      post = body.post || body;
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
}

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

async function updateMemberIndex(memberId: string, postId: string, env: Env): Promise<void> {
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

async function handleSearch(request: Request, env: Env): Promise<Response> {
  try {
    let query: string;
    let nResults = 10;

    if (request.method === "GET") {
      const url = new URL(request.url);
      query = url.searchParams.get("q") || url.searchParams.get("query") || "";
      nResults = parseInt(url.searchParams.get("n") || url.searchParams.get("limit") || "10", 10);
    } else {
      const body = await request.json();
      query = body.query || body.q || "";
      nResults = body.n_results || body.limit || body.n || 10;
    }

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    const queryEmbedding = await getEmbedding(query, env);

    const allPostsKey = "index:all_posts";
    const allPosts = (await env.VECTOR_STORE.get(allPostsKey, "json")) as string[] | null;
    const candidateIds = allPosts || [];

    const results: Array<{ postId: string; similarity: number }> = [];

    for (const postId of candidateIds) {
      const embeddingKey = buildEmbeddingKey(postId);
      const embeddingData = await env.VECTOR_STORE.get(embeddingKey, { type: "arrayBuffer" });

      if (embeddingData) {
        const embedding = decodeEmbeddingFromBytes(new Uint8Array(embeddingData));
        const similarity = cosineSimilarity(queryEmbedding, embedding);
        results.push({ postId, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    const topResults = results.slice(0, nResults);

    const searchResults: SearchResult[] = [];
    for (const result of topResults) {
      const postKey = buildPostKey(result.postId);
      const postData = await env.VECTOR_STORE.get(postKey, "json") as {
        post_id: string;
        member_id: string;
        member_name: string;
        text: string;
        created_at: string;
      } | null;

      if (postData) {
        searchResults.push({
          post_id: postData.post_id,
          text: postData.text,
          member_id: postData.member_id,
          member_name: postData.member_name,
          similarity: result.similarity,
          metadata: {
            post_id: postData.post_id,
            member_id: postData.member_id,
            member_name: postData.member_name,
            created_at: postData.created_at,
            text: postData.text.substring(0, 500),
          },
        });
      }
    }

    return new Response(
      JSON.stringify({ results: searchResults, total: searchResults.length, query }),
      { headers: { "Content-Type": "application/json", ...corsHeaders() } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Search error:", message);
    return new Response(
      JSON.stringify({ error: "Search failed", details: message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } }
    );
  }
}

async function handleStats(env: Env): Promise<Response> {
  try {
    const allPostsKey = "index:all_posts";
    const allPosts = (await env.VECTOR_STORE.get(allPostsKey, "json")) as string[] | null;

    return new Response(
      JSON.stringify({ total_posts: allPosts?.length || 0 }),
      { headers: { "Content-Type": "application/json", ...corsHeaders() } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Failed to get stats", details: message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } }
    );
  }
}

async function handleMemberPosts(memberId: string, env: Env): Promise<Response> {
  try {
    const memberKey = buildMemberIndexKey(memberId);
    const postIds = (await env.VECTOR_STORE.get(memberKey, "json")) as string[] | null;

    if (!postIds || postIds.length === 0) {
      return new Response(
        JSON.stringify({ member_id: memberId, posts: [] }),
        { headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    const posts = [];
    for (const postId of postIds) {
      const postKey = buildPostKey(postId);
      const postData = await env.VECTOR_STORE.get(postKey, "json");
      if (postData) posts.push(postData);
    }

    return new Response(
      JSON.stringify({ member_id: memberId, posts }),
      { headers: { "Content-Type": "application/json", ...corsHeaders() } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Failed to get member posts", details: message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } }
    );
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
  return new Response(null, { status: 204, headers: corsHeaders() });
}
