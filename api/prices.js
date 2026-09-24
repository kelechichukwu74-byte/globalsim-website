import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}

function unwrapServices(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.services)) return data.services;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.services)) return data.data.services;
  return [];
}

function serviceNameOf(row) {
  return String(
    row?.name ?? row?.serviceName ?? row?.service_name ?? row?.title ?? row?.service?.name ?? ""
  ).trim();
}

function serviceIdOf(row) {
  return String(
    row?.id ?? row?.serviceId ?? row?.service_id ?? row?.service?.id ?? ""
  ).trim();
}

function findService(rows, requested) {
  const wanted = String(requested ?? "").trim().toLowerCase();
  if (!wanted) return null;

  return (
    rows.find(row => serviceIdOf(row).toLowerCase() === wanted) ||
    rows.find(row => serviceNameOf(row).toLowerCase() === wanted) ||
    rows.find(row => serviceNameOf(row).toLowerCase().includes(wanted)) ||
    rows.find(row => wanted.includes(serviceNameOf(row).toLowerCase()) && serviceNameOf(row)) ||
    null
  );
}

async function getServerServiceId(server, countryId, requestedService) {
  const data = await sureVerificationRequest(
    `/${server}/services?country_id=${q(countryId)}`
  );
  const rows = unwrapServices(data);
  const match = findService(rows, requestedService);

  if (!match) {
    const available = rows.slice(0, 12).map(row => serviceNameOf(row) || serviceIdOf(row)).filter(Boolean);
    throw new Error(
      `Service "${requestedService}" is not available on ${server}.` +
      (available.length ? ` Available examples: ${available.join(", ")}` : "")
    );
  }

  return {
    id: serviceIdOf(match),
    name: serviceNameOf(match) || requestedService,
    raw: match
  };
}

function extractPrice(data, requestedServiceId, requestedServiceName) {
  const direct = [
    data?.price?.price,
    data?.price?.amount,
    data?.data?.price?.price,
    data?.data?.price?.amount,
    data?.amount,
    data?.data?.amount
  ];

  for (const value of direct) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const rows = Array.isArray(data?.prices)
    ? data.prices
    : Array.isArray(data?.data?.prices)
      ? data.data.prices
      : [];

  const wantedId = String(requestedServiceId || "").trim().toLowerCase();
  const wantedName = String(requestedServiceName || "").trim().toLowerCase();

  const row =
    rows.find(x => String(x?.service?.id ?? x?.service_id ?? x?.id ?? "").trim().toLowerCase() === wantedId) ||
    rows.find(x => String(x?.service?.name ?? x?.name ?? "").trim().toLowerCase() === wantedName) ||
    null;

  if (row) {
    const n = Number(row?.price ?? row?.amount ?? row?.selling_price);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
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
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Supabase returned invalid JSON (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(data?.message || data?.hint || `Supabase request failed (HTTP ${response.status}).`);
  return data;
}

async function getProviderPrice({ server, countryId, service }) {
  if (!server || !countryId || !service) throw new Error("Country, service and server are required.");

  // Resolve the logical service name to the exact provider service ID for this server.
  const providerService = await getServerServiceId(server, countryId, service);
  let data;

  if (server === "global-server-2") {
    // Global Server 2's price endpoint returns a list of service tiers and does not
    // take country/service query parameters according to the provider documentation.
    data = await sureVerificationRequest("/global-server-2/price");
  } else if (["usa-server-1", "usa-server-2", "global-server-1"].includes(server)) {
    data = await sureVerificationRequest(
      `/${server}/price?country_id=${q(countryId)}&service=${q(providerService.id)}`
    );
  } else {
    throw new Error("Invalid provider server.");
  }

  const price = extractPrice(data, providerService.id, providerService.name);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Provider returned no price for ${providerService.name} (${providerService.id}) on ${server}.`);
  }

  return { price, providerService, raw: data };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed." });

    const countryId = String(req.query?.countryId || "").trim();
    const countryName = String(req.query?.countryName || "").trim();
    const service = String(req.query?.service || "").trim();
    const server = String(req.query?.server || "").trim();

    if (!countryId || !service || !server) {
      return res.status(400).json({ success: false, error: "countryId, service and server are required." });
    }

    const result = await getProviderPrice({ server, countryId, service });
    let selling_price = null;

    try {
      const rows = await supabaseRequest(
        `product_prices?country_id=eq.${q(countryId)}&service_id=eq.${q(result.providerService.id)}&select=selling_price&limit=1`
      );
      selling_price = rows?.[0]?.selling_price ?? null;
    } catch (_) {}

    return res.status(200).json({
      success: true,
      countryId,
      countryName,
      service,
      server,
      provider_service_id: result.providerService.id,
      provider_service_name: result.providerService.name,
      provider_price: result.price,
      selling_price,
      raw: result.raw
    });
  } catch (error) {
    console.error("Provider price error:", error);
    return res.status(502).json({ success: false, error: error?.message || "Unable to load provider price." });
  }
}
