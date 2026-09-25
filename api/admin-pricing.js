const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function bearer(req) {
  const value =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  return String(value).startsWith("Bearer ")
    ? String(value).slice(7).trim()
    : "";
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer:
          options.prefer ||
          "return=representation",
        ...(options.headers || {})
      },
      ...(options.body !== undefined
        ? { body: options.body }
        : {})
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      String(
        data?.message ||
        data?.error ||
        data?.hint ||
        data?.details ||
        `Supabase returned HTTP ${response.status}.`
      )
    );
  }

  return data;
}

async function getUser(req) {
  const token = bearer(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  const user =
    await response.json().catch(() => null);

  if (!response.ok || !user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}

async function requireAdmin(req) {
  const user = await getUser(req);

  const rows = await supabaseRequest(
    `profiles?id=eq.${encodeURIComponent(
      user.id
    )}&select=id,role&limit=1`
  );

  if (rows?.[0]?.role !== "admin") {
    throw new Error(
      "Administrator access required."
    );
  }

  return user;
}

function quote(value) {
  return encodeURIComponent(
    String(value ?? "")
  );
}

function text(value) {
  return String(value ?? "").trim();
}

function nullableNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

const ALLOWED_SERVERS = new Set([
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
]);

export default async function handler(req, res) {
  try {
    await requireAdmin(req);

    if (req.method === "GET") {
      const rows = await supabaseRequest(
        "product_prices" +
        "?select=" +
        [
          "id",
          "country_id",
          "country_name",
          "service_id",
          "service_name",
          "provider_server",
          "provider_service_id",
          "provider_cost",
          "provider_price",
          "provider_base_url",
          "selling_price",
          "is_active",
          "created_at",
          "updated_at"
        ].join(",") +
        "&order=country_name.asc,provider_server.asc,service_name.asc"
      );

      return res.status(200).json({
        success: true,
        prices: rows || []
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed."
      });
    }

    const body = req.body || {};

    const countryId =
      text(body.countryId);

    const countryName =
      text(body.countryName);

    const providerServer =
      text(body.providerServer);

    const providerServiceId =
      text(
        body.providerServiceId ||
        body.serviceId
      );

    const providerServiceName =
      text(
        body.providerServiceName ||
        body.serviceName
      );

    const sellingPrice =
      Number(body.sellingPrice);

    const receivedProviderPrice =
      nullableNumber(
        body.providerPrice ??
        body.provider_cost ??
        body.providerCost
      );

    const separateProviderCost =
      nullableNumber(
        body.providerCost ??
        body.provider_cost
      );

    const providerPrice =
      receivedProviderPrice;

    const providerCost =
      separateProviderCost !== null
        ? separateProviderCost
        : providerPrice;

    const providerBaseUrl =
      text(
        body.providerBaseUrl ||
        body.provider_base_url ||
        "https://sureverifications.com/api/v1"
      );

    if (
      !countryId ||
      !providerServer ||
      !providerServiceId ||
      !providerServiceName
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Country, server and service are required."
      });
    }

    if (
      !ALLOWED_SERVERS.has(providerServer)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid provider server."
      });
    }

    if (
      !Number.isFinite(sellingPrice) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Selling price must be greater than zero."
      });
    }

    if (
      !Number.isFinite(providerPrice) ||
      providerPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Provider price is required and must be greater than zero."
      });
    }

    const existing =
      await supabaseRequest(
        "product_prices" +
        `?country_id=eq.${quote(countryId)}` +
        `&provider_server=eq.${quote(providerServer)}` +
        `&provider_service_id=eq.${quote(providerServiceId)}` +
        "&select=id&limit=1"
      );

    const row = {
      country_id:
        countryId,

      country_name:
        countryName || countryId,

      service_id:
        providerServiceId,

      service_name:
        providerServiceName,

      provider_server:
        providerServer,

      provider_service_id:
        providerServiceId,

      provider_cost:
        Number.isFinite(providerCost)
          ? providerCost
          : providerPrice,

      provider_price:
        providerPrice,

      provider_base_url:
        providerBaseUrl,

      selling_price:
        sellingPrice,

      is_active:
        true
    };

    let saved;

    if (existing?.[0]?.id) {
      saved =
        await supabaseRequest(
          `product_prices?id=eq.${quote(
            existing[0].id
          )}`,
          {
            method: "PATCH",
            body: JSON.stringify(row)
          }
        );
    } else {
      saved =
        await supabaseRequest(
          "product_prices",
          {
            method: "POST",
            body: JSON.stringify(row)
          }
        );
    }

    return res.status(200).json({
      success: true,
      message:
        "Selling price saved successfully.",
      price:
        saved?.[0] || null
    });

  } catch (error) {
    console.error(
      "Admin provider pricing error:",
      error
    );

    const message =
      error?.message ||
      "Unable to process server pricing.";

    if (message === "Unauthorized.") {
      return res.status(401).json({
        success: false,
        error: message
      });
    }

    if (
      message ===
      "Administrator access required."
    ) {
      return res.status(403).json({
        success: false,
        error: message
      });
    }

    return res.status(500).json({
      success: false,
      error: String(message)
    });
  }
}
