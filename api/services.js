import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rfitbmkizfmwfqqskwhy.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseRequest(path) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json"
    }
  });

  const text = await r.text();
  const data = text ? JSON.parse(text) : {};

  if (!r.ok) {
    throw new Error(
      data?.message ||
      data?.hint ||
      data?.details ||
      `Supabase request failed (HTTP ${r.status})`
    );
  }

  return data;
}

function clean(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeName(value) {
  return clean(value).replace(/[^a-z0-9]+/g, "");
}

function serviceId(service) {
  return service?.id ??
    service?.serviceId ??
    service?.service_id ??
    service?.serviceCountryPriceId ??
    service?.service_country_price_id ??
    null;
}

function serviceName(service) {
  return service?.name ??
    service?.serviceName ??
    service?.service_name ??
    service?.title ??
    service?.service ??
    "";
}

function serviceCode(service) {
  return service?.code ??
    service?.serviceCode ??
    service?.service_code ??
    service?.slug ??
    "";
}

async function getProviderServices(server, countryId) {
  try {
    const data = await sureVerificationRequest(
      `/${server}/services?country_id=${encodeURIComponent(countryId)}`
    );

    const services =
      Array.isArray(data?.services) ? data.services :
      Array.isArray(data?.data) ? data.data :
      Array.isArray(data) ? data : [];

    return services.map(service => ({
      ...service,
      available_servers: [server]
    }));
  } catch (error) {
    console.error(`Service load failed for ${server}:`, error?.message || error);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const countryId = req.query?.countryId;

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "countryId is required"
      });
    }

    const requestedServer = req.query?.server;
    const requestedCode = clean(req.query?.countryCode);
    const isUS = requestedCode === "us" || requestedCode === "usa";

    // Load the provider portals that can supply numbers for the country.
    // For US, include the two USA portals plus both global portals.
    // For every other country, include both global portals.
    const servers = requestedServer
      ? [requestedServer]
      : isUS
        ? ["usa-server-1", "usa-server-2", "global-server-1", "global-server-2"]
        : ["global-server-1", "global-server-2"];

    const results = await Promise.all(
      [...new Set(servers)].map(server => getProviderServices(server, countryId))
    );

    // Combine duplicate services from the provider portals. Keep one catalog
    // item and remember every portal that supplies that service.
    const merged = new Map();

    for (const list of results) {
      for (const service of list) {
        const id = serviceId(service);
        const name = serviceName(service);
        const code = serviceCode(service);
        const key = clean(id) || normalizeName(name) || normalizeName(code);

        if (!key) continue;

        if (!merged.has(key)) {
          merged.set(key, {
            ...service,
            available_servers: [...(service.available_servers || [])]
          });
        } else {
          const current = merged.get(key);
          current.available_servers = [
            ...new Set([
              ...(current.available_servers || []),
              ...(service.available_servers || [])
            ])
          ];
        }
      }
    }

    let services = [...merged.values()];

    // Pull the prices saved by the admin. The customer catalog is matched
    // against the same country and service using ID, exact name, and a
    // normalized name so small provider naming differences do not hide the
    // selling price.
    try {
      const rows = await supabaseRequest(
        `product_prices?country_id=eq.${encodeURIComponent(countryId)}&select=service_id,service_name,selling_price`
      );

      const byId = new Map();
      const byName = new Map();

      for (const row of rows || []) {
        const amount = Number(row?.selling_price);
        if (!Number.isFinite(amount) || amount <= 0) continue;

        if (row?.service_id !== null && row?.service_id !== undefined) {
          byId.set(clean(row.service_id), amount);
        }

        if (row?.service_name) {
          byName.set(clean(row.service_name), amount);
          byName.set(normalizeName(row.service_name), amount);
        }
      }

      services = services.map(service => {
        const id = serviceId(service);
        const name = serviceName(service);
        const code = serviceCode(service);

        const customPrice =
          byId.get(clean(id)) ??
          byName.get(clean(name)) ??
          byName.get(normalizeName(name)) ??
          byName.get(clean(code)) ??
          byName.get(normalizeName(code));

        if (Number.isFinite(customPrice) && customPrice > 0) {
          return {
            ...service,
            selling_price: customPrice,
            sellingPrice: customPrice,
            price: customPrice,
            amount: customPrice
          };
        }

        return service;
      });
    } catch (pricingError) {
      console.error("Custom pricing lookup error:", pricingError);
      // Provider services still load if the optional price lookup fails.
    }

    return res.status(200).json({
      success: true,
      server: requestedServer || (isUS ? "multi-provider" : "global-provider"),
      services
    });
  } catch (error) {
    console.error("SureVerification services error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Unable to load services."
    });
  }
}
