import { sureVerificationRequest, isUSA } from "./_lib.js";

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function allowedServer(countryName, server) {
  const usa = isUSA(countryName);
  if (usa) return ["usa-server-1", "usa-server-2"].includes(server);
  return ["global-server-1", "global-server-2"].includes(server);
}

function extractPrice(data) {
  return n(
    data?.price ??
    data?.data?.price ??
    data?.amount ??
    data?.data?.amount
  );
}

function findGlobalTwoPrice(data, serviceId, serviceName) {
  const prices = Array.isArray(data?.prices)
    ? data.prices
    : Array.isArray(data?.data?.prices)
      ? data.data.prices
      : Array.isArray(data)
        ? data
        : [];

  const wantedId = normalize(serviceId);
  const wantedName = normalize(serviceName);

  const row = prices.find(item => {
    const id = normalize(item?.service?.id ?? item?.service_id ?? item?.id);
    const name = normalize(item?.service?.name ?? item?.service_name ?? item?.name);
    return (wantedId && id === wantedId) || (wantedName && name === wantedName);
  });

  return {
    price: n(row?.price ?? row?.amount),
    providerServiceId: row?.service?.id ?? row?.service_id ?? row?.id ?? null,
    raw: row || null
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  try {
    const countryId = String(req.query?.countryId || "").trim();
    const countryName = String(req.query?.countryName || "").trim();
    const serviceId = String(req.query?.service || "").trim();
    const serviceName = String(req.query?.serviceName || "").trim();
    const server = String(req.query?.server || "").trim();

    if (!countryId || !serviceId || !server) {
      return res.status(400).json({
        success: false,
        error: "countryId, service and server are required."
      });
    }

    if (!allowedServer(countryName, server)) {
      return res.status(400).json({
        success: false,
        error: "That server is not available for the selected country."
      });
    }

    let providerPrice = null;
    let providerServiceId = serviceId;
    let raw = null;

    if (server === "global-server-2") {
      const data = await sureVerificationRequest("/global-server-2/price");
      const found = findGlobalTwoPrice(data, serviceId, serviceName);
      providerPrice = found.price;
      providerServiceId = found.providerServiceId || serviceId;
      raw = found.raw;
    } else {
      const data = await sureVerificationRequest(
        `/${server}/price?country_id=${encodeURIComponent(countryId)}&service=${encodeURIComponent(serviceId)}`
      );
      providerPrice = extractPrice(data);
      raw = data;
    }

    if (!Number.isFinite(providerPrice) || providerPrice <= 0) {
      return res.status(404).json({
        success: false,
        error: "Provider price not available for this server/service.",
        server,
        providerPrice: null
      });
    }

    return res.status(200).json({
      success: true,
      countryId,
      serviceId,
      serviceName,
      server,
      providerServiceId,
      providerPrice,
      raw
    });
  } catch (error) {
    console.error("Admin provider price error:", error);
    return res.status(502).json({
      success: false,
      error: error?.message || "Unable to load provider price."
    });
  }
}
