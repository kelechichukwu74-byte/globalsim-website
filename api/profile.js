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
  const token = getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  if (!SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY is not configured."
    );
  }

  const response = await fetch(
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
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type":
            "application/json",
          Accept:
            "application/json",
          Prefer:
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
  try {
    const user =
      await getAuthenticatedUser(
        req
      );

    const userId =
      user.id;

    /*
     * GET PROFILE
     */
    if (
      req.method === "GET"
    ) {
      const rows =
        await supabaseRequest(
          `profiles?id=eq.${quote(
            userId
          )}&select=*&limit=1`
        );

      const profile =
        rows?.[0] || null;

      return res.status(200).json({
        success:
          true,

        profile:
          profile || {
            id:
              userId,
            email:
              user.email || ""
          },

        user: {
          id:
            userId,
          email:
            user.email || "",
          created_at:
            user.created_at ||
            null
        }
      });
    }

    /*
     * UPDATE PROFILE
     */
    if (
      req.method === "PATCH" ||
      req.method === "PUT"
    ) {
      const body =
        req.body || {};

      /*
       * Only allow normal customer profile
       * information to be changed here.
       *
       * Role, user ID and other protected
       * fields cannot be changed by the customer.
       */
      const updates = {};

      if (
        body.full_name !== undefined
      ) {
        updates.full_name =
          String(
            body.full_name
          ).trim();
      }

      if (
        body.fullName !== undefined
      ) {
        updates.full_name =
          String(
            body.fullName
          ).trim();
      }

      if (
        body.username !== undefined
      ) {
        updates.username =
          String(
            body.username
          ).trim();
      }

      if (
        body.phone !== undefined
      ) {
        updates.phone =
          String(
            body.phone
          ).trim();
      }

      if (
        body.phone_number !== undefined
      ) {
        updates.phone_number =
          String(
            body.phone_number
          ).trim();
      }

      if (
        body.avatar_url !== undefined
      ) {
        updates.avatar_url =
          String(
            body.avatar_url
          ).trim();
      }

      if (
        Object.keys(updates)
          .length === 0
      ) {
        return res.status(400).json({
          success:
            false,
          error:
            "No profile information was provided."
        });
      }

      /*
       * Never allow the customer to modify:
       * - id
       * - role
       * - balance
       * - wallet
       * - email through the profiles table
       */
      delete updates.id;
      delete updates.role;
      delete updates.balance;
      delete updates.wallet;
      delete updates.email;

      const updated =
        await supabaseRequest(
          `profiles?id=eq.${quote(
            userId
          )}`,
          {
            method:
              "PATCH",
            body:
              JSON.stringify(
                updates
              )
          }
        );

      return res.status(200).json({
        success:
          true,
        message:
          "Profile updated successfully.",
        profile:
          updated?.[0] ||
          null
      });
    }

    return res.status(405).json({
      success:
        false,
      error:
        "Method not allowed"
    });

  } catch (error) {
    console.error(
      "Profile API error:",
      error
    );

    const message =
      error?.message ||
      "Unable to load profile.";

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
        message
    });
  }
}
