import {
  Env,
  SearchResult,
  buildPostKey,
  buildEmbeddingKey,
  buildMemberIndexKey,
  buildLocationIndexKey,
  getEmbedding,
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

    if (path === "/search" || path === "/api/search") {
      if (request.method !== "GET" && request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }
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

async function handleSearch(request: Request, env: Env): Promise<Response> {
  try {
    let query: string;
    let nResults = 10;
    let memberId: string | undefined;
    let city: string | undefined;
    let country: string | undefined;
    let region: string | undefined;

    if (request.method === "GET") {
      const url = new URL(request.url);
      query = url.searchParams.get("q") || url.searchParams.get("query") || "";
      nResults = parseInt(url.searchParams.get("n") || url.searchParams.get("limit") || "10", 10);
      memberId = url.searchParams.get("member_id") || undefined;
      city = url.searchParams.get("city") || undefined;
      country = url.searchParams.get("country") || undefined;
      region = url.searchParams.get("region") || undefined;
    } else {
      const body = await request.json();
      query = body.query || body.q || "";
      nResults = body.n_results || body.limit || body.n || 10;
      memberId = body.member_id;
      city = body.city;
      country = body.country;
      region = body.region;
    }

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    const queryEmbedding = await getEmbedding(query, env);

    let candidateIds: string[];

    if (memberId) {
      const memberKey = buildMemberIndexKey(memberId);
      const memberPosts = await env.VECTOR_STORE.get(memberKey, "json");
      candidateIds = memberPosts || [];
    } else if (city || country || region) {
      candidateIds = [];
      if (city) {
        const cityKey = buildLocationIndexKey("city", city);
        const cityPosts = await env.VECTOR_STORE.get(cityKey, "json") as string[] | null;
        if (cityPosts) candidateIds.push(...cityPosts);
      }
      if (country) {
        const countryKey = buildLocationIndexKey("country", country);
        const countryPosts = await env.VECTOR_STORE.get(countryKey, "json") as string[] | null;
        if (countryPosts) candidateIds.push(...countryPosts);
      }
      if (region) {
        const regionKey = buildLocationIndexKey("region", region);
        const regionPosts = await env.VECTOR_STORE.get(regionKey, "json") as string[] | null;
        if (regionPosts) candidateIds.push(...regionPosts);
      }
      candidateIds = [...new Set(candidateIds)];
    } else {
      const allPostsKey = "index:all_posts";
      const allPosts = await env.VECTOR_STORE.get(allPostsKey, "json");
      candidateIds = allPosts || [];
    }

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
        city?: string;
        country?: string;
        region?: string;
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
            city: postData.city,
            country: postData.country,
            region: postData.region,
          },
        });
      }
    }

    return new Response(
      JSON.stringify({
        results: searchResults,
        total: searchResults.length,
        query,
      }),
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
    const allPosts = await env.VECTOR_STORE.get(allPostsKey, "json") as string[] | null;

    let uniqueMembers = new Set<string>();
    let cityCounts: Record<string, number> = {};
    let countryCounts: Record<string, number> = {};

    if (allPosts) {
      for (const postId of allPosts) {
        const postKey = buildPostKey(postId);
        const postData = await env.VECTOR_STORE.get(postKey, "json") as {
          member_id: string;
          city?: string;
          country?: string;
        } | null;

        if (postData) {
          uniqueMembers.add(postData.member_id);
          if (postData.city) {
            cityCounts[postData.city] = (cityCounts[postData.city] || 0) + 1;
          }
          if (postData.country) {
            countryCounts[postData.country] = (countryCounts[postData.country] || 0) + 1;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        total_posts: allPosts?.length || 0,
        unique_members: uniqueMembers.size,
        unique_cities: Object.keys(cityCounts).length,
        unique_countries: Object.keys(countryCounts).length,
        top_cities: Object.entries(cityCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
        top_countries: Object.entries(countryCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      }),
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
      if (postData) {
        posts.push(postData);
      }
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
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}
