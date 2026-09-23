const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function getToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

async function authenticate(req) {
  const accessToken = getToken(req);

  if (!accessToken) {
    throw new Error("Unauthorized.");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error("Unauthorized.");
  }

  const user = await response.json();

  if (!user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}

async function db(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      message: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.hint ||
      data?.details ||
      `Supabase request failed (HTTP ${response.status})`
    );
  }

  return data;
}

export default async function handler(req, res) {
  if (
    !["GET", "POST", "PATCH"].includes(req.method)
  ) {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const user = await authenticate(req);

    const profiles = await db(
      `profiles?id=eq.${encodeURIComponent(
        user.id
      )}&select=id,email,role,is_active&limit=1`
    );

    const profile = profiles?.[0];

    if (
      !profile ||
      profile.role !== "admin" ||
      profile.is_active === false
    ) {
      return res.status(403).json({
        success: false,
        error: "Administrator access required."
      });
    }

    if (req.method === "GET") {
      const prices = await db(
        "product_prices?select=*&order=country_name.asc,service_name.asc"
      );

      return res.status(200).json({
        success: true,
        prices
      });
    }

    const body = req.body || {};

    const countryId = body.countryId;
    const serviceId = body.serviceId;
    const sellingPrice = Number(
      body.sellingPrice
    );

    if (
      !countryId ||
      !serviceId ||
      !Number.isFinite(sellingPrice) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid pricing data."
      });
    }

    const priceData = {
      country_id: String(countryId),
      country_name:
        body.countryName ||
        String(countryId),
      service_id: String(serviceId),
      service_name:
        body.serviceName ||
        String(serviceId),
      selling_price: sellingPrice,
      updated_at: new Date().toISOString()
    };

    const existing = await db(
      `product_prices?country_id=eq.${encodeURIComponent(
        countryId
      )}&service_id=eq.${encodeURIComponent(
        serviceId
      )}&select=id&limit=1`
    );

    let data;

    if (existing?.[0]?.id) {
      data = await db(
        `product_prices?id=eq.${encodeURIComponent(
          existing[0].id
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify(priceData)
        }
      );
    } else {
      data = await db(
        "product_prices",
        {
          method: "POST",
          body: JSON.stringify(priceData)
        }
      );
    }

    return res.status(200).json({
      success: true,
      price: Array.isArray(data)
        ? data[0]
        : data
    });

  } catch (error) {
    console.error(
      "Admin pricing error:",
      error
    );

    const message =
      error?.message ||
      "Unable to process pricing.";

    return res.status(
      message === "Unauthorized."
        ? 401
        : 500
    ).json({
      success: false,
      error: message
    });
  }
}
