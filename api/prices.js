import { sureVerificationRequest, isUSA } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });

  const responseText = await response.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(`Supabase returned invalid JSON (HTTP ${response.status}).`);
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

function extractProviderPrice(data) {
  // USA Server 1 / USA Server 2 / Global Server 1:
  // { price: { service: {...}, price: 900 } }
  const candidates = [
    data?.price?.price,
    data?.price?.amount,
    data?.data?.price?.price,
    data?.data?.price?.amount,
    data?.price,
    data?.amount,
    data?.data?.amount
  ];

  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }

  // Global Server 2:
  // { prices: [{ service: {...}, price: 1604, id: 1 }, ...] }
  if (Array.isArray(data?.prices)) {
    const requestedService = String(data.__requestedService || "").trim().toLowerCase();

    const exact = data.prices.find(row =>
      String(row?.service?.id ?? row?.service_id ?? "").trim().toLowerCase() === requestedService
    );

    const row = exact || data.prices[0];

    const number = Number(
      row?.price ??
      row?.amount ??
      row?.selling_price
    );

    if (Number.isFinite(number) && number > 0) return number;
  }

  return null;
}

async function getProviderPrice({ server, countryId, service }) {
  if (!server) throw new Error("Server is required.");
  if (!countryId) throw new Error("Country ID is required.");
  if (!service) throw new Error("Service is required.");

  let data;

  if (server === "global-server-2") {
    data = await sureVerificationRequest("/global-server-2/price");
    data.__requestedService = service;
  } else if (
    server === "usa-server-1" ||
    server === "usa-server-2" ||
    server === "global-server-1"
  ) {
    data = await sureVerificationRequest(
      `/${server}/price?country_id=${q(countryId)}&service=${q(service)}`
    );
  } else {
    throw new Error("Invalid provider server.");
  }

  let price = extractProviderPrice(data);

  // Global Server 2 can return several service price tiers.
  if (server === "global-server-2" && Array.isArray(data?.prices)) {
    const row = data.prices.find(item =>
      String(item?.service?.id ?? item?.service_id ?? "").trim() === String(service).trim()
    );

    if (row) {
      const exactPrice = Number(row.price ?? row.amount ?? row.selling_price);
      if (Number.isFinite(exactPrice) && exactPrice > 0) price = exactPrice;
    }
  }

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Provider price not available for the selected server and service.");
  }

  return { price, raw: data };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const countryId = String(req.query?.countryId || "").trim();
      const countryName = String(req.query?.countryName || "").trim();
      const service = String(req.query?.service || "").trim();
      const server = String(req.query?.server || "").trim();

      if (!countryId || !service || !server) {
        return res.status(400).json({
          success: false,
          error: "countryId, service and server are required."
        });
      }

      const result = await getProviderPrice({
        server,
        countryId,
        service
      });

      let selling_price = null;

      // Preserve the existing customer selling-price lookup.
      try {
        const rows = await supabaseRequest(
          `product_prices?country_id=eq.${q(countryId)}&service_id=eq.${q(service)}&select=selling_price&limit=1`
        );
        selling_price = rows?.[0]?.selling_price ?? null;
      } catch (_) {}

      return res.status(200).json({
        success: true,
        countryId,
        countryName,
        service,
        server,
        provider_price: result.price,
        selling_price,
        raw: result.raw
      });
    }

    if (req.method === "POST") {
      // This endpoint is intentionally not used by the dashboard save button
      // unless an authenticated admin is added to this route. Keep price
      // changes behind the existing /api/admin-pricing authorization.
      return res.status(405).json({
        success: false,
        error: "Use the authenticated admin pricing endpoint to save selling prices."
      });
    }

    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  } catch (error) {
    console.error("Provider price error:", error);
    return res.status(502).json({
      success: false,
      error: error?.message || "Unable to load provider price."
    });
  }
}
