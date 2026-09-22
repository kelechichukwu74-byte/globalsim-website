import {
  sureVerificationRequest,
  getServersForCountry
} from "./_lib.js";

/*
 * USE THE SAME SUPABASE PROJECT AS THE WEBSITE.
 * Do not replace these with a different project.
 */
const SUPABASE_URL =
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/*
 * Get the customer's Supabase login token.
 */
function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header) {
    return null;
  }

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token =
    header.slice(7).trim();

  return token || null;
}


/*
 * Verify the logged-in customer directly
 * with Supabase Auth.
 */
async function getAuthenticatedUser(req) {
  const token =
    getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",

        headers: {
          "apikey":
            SUPABASE_PUBLISHABLE_KEY,

          "Authorization":
            `Bearer ${token}`,

          "Accept":
            "application/json"
        }
      }
    );

  const responseText =
    await response.text();

  let userData = null;

  try {
    userData =
      responseText
        ? JSON.parse(responseText)
        : null;
  } catch (_) {
    userData = null;
  }

  if (!response.ok) {
    console.error(
      "Supabase authentication failed:",
      response.status,
      userData
    );

    throw new Error(
      "Unauthorized."
    );
  }

  if (!userData?.id) {
    throw new Error(
      "Unauthorized."
    );
  }

  return userData;
}


/*
 * Supabase database request.
 */
async function supabaseRequest(
  path,
  options = {}
) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/${path}`,
      {
        ...options,

        headers: {
          "apikey":
            SUPABASE_SERVICE_ROLE_KEY,

          "Authorization":
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            "application/json",

          "Accept":
            "application/json",

          "Prefer":
            "return=representation",

          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  let data = {};

  try {
    data =
      text
        ? JSON.parse(text)
        : {};
  } catch (_) {
    throw new Error(
      `Supabase returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.hint ||
      data?.details ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}
