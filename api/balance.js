const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

async function getAuthenticatedUser(req) {
  const token =
    getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  if (!SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY is not configured."
    );
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            SUPABASE_PUBLISHABLE_KEY,
          Authorization:
            `Bearer ${token}`,
          Accept:
            "application/json"
        }
      }
    );

  if (!response.ok) {
    throw new Error("Unauthorized.");
  }

  const user =
    await response.json();

  if (!user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}

async function supabaseRequest(
  path
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
        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Accept:
            "application/json"
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
  } catch {
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

function quote(value) {
  return encodeURIComponent(
    String(value)
  );
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET"
  ) {
    return res.status(405).json({
      success:
        false,
      error:
        "Method not allowed"
    });
  }

  try {
    const user =
      await getAuthenticatedUser(
        req
      );

    const wallets =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          user.id
        )}&select=user_id,balance&limit=1`
      );

    const wallet =
      wallets?.[0];

    const balance =
      Number(
        wallet?.balance || 0
      );

    if (
      !Number.isFinite(
        balance
      )
    ) {
      throw new Error(
        "Unable to read wallet balance."
      );
    }

    return res.status(200).json({
      success:
        true,

      balance:
        balance,

      wallet: {
        user_id:
          user.id,
        balance:
          balance
      }
    });

  } catch (error) {
    console.error(
      "Balance API error:",
      error
    );

    const message =
      error?.message ||
      "Unable to load wallet balance.";

    if (
      message ===
      "Unauthorized."
    ) {
      return res.status(401).json({
        success:
          false,
        error:
          message
      });
    }

    return res.status(500).json({
      success:
        false,
      error:
        message,
      balance:
        0
    });
  }
}
