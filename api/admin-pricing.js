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

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: options.prefer || "return=representation"
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
  } catch (_) {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.hint ||
      `Supabase returned HTTP ${response.status}.`
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

  const user = await response.json().catch(() => null);

  if (!response.ok || !user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}

async function requireAdmin(req) {
  const user = await getUser(req);

  const rows = await supabaseRequest(
    `profiles?id=eq.${q(user.id)}&select=id,role&limit=1`
  );

  if (rows?.[0]?.role !== "admin") {
    throw new Error("Administrator access required.");
  }

  return user;
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
        "product_prices?select=id,country_id,country_name,service_id,service_name,selling_price,is_active,provider_server,provider_service_id&order=country_name.asc,provider_server.asc,service_name.asc"
      );

      return res.status(200).json({
        success: true,
        prices: rows || []
      });
    }

    if (req.method === "POST") {

      const body = req.body || {};

      const countryId =
        String(body.countryId || "").trim();

      const countryName =
        String(body.countryName || "").trim();

      const providerServer =
        String(body.providerServer || "").trim();

      const providerServiceId =
        String(
          body.providerServiceId ||
          body.serviceId ||
          ""
        ).trim();

      const serviceName =
        String(body.serviceName || "").trim();

      const sellingPrice =
        Number(body.sellingPrice);

      if (
        !countryId ||
        !providerServer ||
        !providerServiceId ||
        !serviceName
      ) {
        return res.status(400).json({
          success: false,
          error: "Country, server and service are required."
        });
      }

      if (!ALLOWED_SERVERS.has(providerServer)) {
        return res.status(400).json({
          success: false,
          error: "Invalid provider server."
        });
      }

      if (
        !Number.isFinite(sellingPrice) ||
        sellingPrice <= 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Selling price must be greater than zero."
        });
      }

      const existing =
        await supabaseRequest(
          `product_prices?country_id=eq.${q(countryId)}&provider_server=eq.${q(providerServer)}&provider_service_id=eq.${q(providerServiceId)}&select=id&limit=1`
        );

      const row = {
        country_id: countryId,
        country_name: countryName || countryId,
        service_id: providerServiceId,
        service_name: serviceName,
        selling_price: sellingPrice,
        is_active: true,
        provider_server: providerServer,
        provider_service_id: providerServiceId,
        provider_cost: 0
      };

      let saved;

      if (existing?.[0]?.id) {

        saved = await supabaseRequest(
          `product_prices?id=eq.${q(existing[0].id)}`,
          {
            method: "PATCH",
            body: JSON.stringify(row)
          }
        );

      } else {

        saved = await supabaseRequest(
          "product_prices",
          {
            method: "POST",
            body: JSON.stringify(row)
          }
        );
      }

      return res.status(200).json({
        success: true,
        price: saved?.[0] || null
      });
    }

    if (req.method === "DELETE") {

      const id =
        String(req.query?.id || "").trim();

      if (!id) {
        return res.status(400).json({
          success: false,
          error: "Price id is required."
        });
      }

      const existing =
        await supabaseRequest(
          `product_prices?id=eq.${q(id)}&select=id`
        );

      if (!existing?.[0]?.id) {
        return res.status(404).json({
          success: false,
          error: "Selling price not found."
        });
      }

      await supabaseRequest(
        `product_prices?id=eq.${q(id)}`,
        {
          method: "DELETE",
          prefer: "return=minimal"
        }
      );

      return res.status(200).json({
        success: true,
        message: "Selling price deleted."
      });
    }

    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });

  } catch (error) {

    console.error(
      "Admin pricing error:",
      error
    );

    const message =
      error?.message ||
      "Unable to process pricing request.";

    const status =
      message === "Unauthorized."
        ? 401
        : message === "Administrator access required."
          ? 403
          : 500;

    return res.status(status).json({
      success: false,
      error: message
    });
  }
}
