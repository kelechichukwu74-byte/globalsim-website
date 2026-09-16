import {
  sureVerificationRequest,
  getServerForCountry
} from "./_lib.js";

const SUPABASE_URL =
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
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
    throw new Error(
      `Supabase returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.hint ||
      data?.details ||
      `Supabase returned HTTP ${response.status}.`
    );
  }

  return data;
}

function getToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7);
}

async function verifyAdmin(req) {
  const token = getToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    throw new Error("Unauthorized.");
  }

  const user = await response.json();

  const profiles =
    await supabaseRequest(
      `profiles?id=eq.${encodeURIComponent(
        user.id
      )}&select=id,role&limit=1`
    );

  const profile = profiles?.[0];

  if (!profile || profile.role !== "admin") {
    throw new Error("Administrator access is required.");
  }

  return user;
}

export default async function handler(req, res) {
  try {
    await verifyAdmin(req);

    if (req.method === "GET") {
      const rows =
        await supabaseRequest(
          "product_prices?select=*&order=updated_at.desc"
        );

      return res.status(200).json({
        success: true,
        prices: rows || []
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const {
      countryId,
      countryName,
      serviceId,
      serviceName,
      sellingPrice
    } = req.body || {};

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "Country is required."
      });
    }

    if (!serviceId) {
      return res.status(400).json({
        success: false,
        error: "Service is required."
      });
    }

    const price =
      Number(sellingPrice);

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Enter a valid selling price."
      });
    }

    const existing =
      await supabaseRequest(
        `product_prices?country_id=eq.${encodeURIComponent(
          countryId
        )}&service_id=eq.${encodeURIComponent(
          serviceId
        )}&select=id&limit=1`
      );

    let result;

    if (existing?.length) {
      result =
        await supabaseRequest(
          `product_prices?id=eq.${encodeURIComponent(
            existing[0].id
          )}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              country_id: countryId,
              country_name: countryName || "",
              service_id: serviceId,
              service_name: serviceName || "",
              selling_price: price,
              updated_at: new Date().toISOString()
            })
          }
        );
    } else {
      result =
        await supabaseRequest(
          "product_prices",
          {
            method: "POST",
            body: JSON.stringify({
              country_id: countryId,
              country_name: countryName || "",
              service_id: serviceId,
              service_name: serviceName || "",
              selling_price: price
            })
          }
        );
    }

    return res.status(200).json({
      success: true,
      message: "Selling price saved successfully.",
      price: result?.[0] || result
    });

  } catch (error) {
    console.error(
      "Admin pricing error:",
      error
    );

    const message =
      error?.message ||
      "Unable to manage pricing.";

    const status =
      message === "Unauthorized."
        ? 401
        : message ===
            "Administrator access is required."
          ? 403
          : 500;

    return res.status(status).json({
      success: false,
      error: message
    });
  }
}
