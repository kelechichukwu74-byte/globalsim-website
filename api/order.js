function getBearerToken(req) {
  const headers = req?.headers || {};

  const authorization =
    headers.authorization ||
    headers.Authorization ||
    headers["x-supabase-auth"] ||
    headers["X-Supabase-Auth"] ||
    "";

  if (!authorization) {
    return null;
  }

  const value = String(authorization).trim();

  if (value.toLowerCase().startsWith("bearer ")) {
    return value.slice(7).trim();
  }

  return value;
}


async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const apiKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    }
  );

  const text = await response.text();

  let user = {};

  try {
    user = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Unauthorized.");
  }

  if (!response.ok || !user?.id) {
    console.error(
      "SUPABASE AUTH ERROR:",
      response.status,
      user
    );

    throw new Error("Unauthorized.");
  }

  return user;
}
