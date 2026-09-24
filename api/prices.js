import { sureVerificationRequest } from "./_lib.js";

function q(value) { return encodeURIComponent(String(value ?? "")); }

function jsonError(value, fallback = "Provider request failed.") {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  try {
    if (value.message) return String(value.message);
    if (value.error) return typeof value.error === "string" ? value.error : JSON.stringify(value.error);
    return JSON.stringify(value);
  } catch (_) { return fallback; }
}

function unwrapServices(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.services)) return data.services;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.services)) return data.data.services;
  return [];
}

function serviceName(row) {
  return String(row?.name ?? row?.serviceName ?? row?.service_name ?? row?.title ?? row?.service?.name ?? "").trim();
}
function serviceId(row) {
  return String(row?.id ?? row?.serviceId ?? row?.service_id ?? row?.service?.id ?? "").trim();
}

function findService(rows, requested) {
  const wanted = String(requested || "").trim().toLowerCase();
  return rows.find(r => serviceId(r).toLowerCase() === wanted) ||
         rows.find(r => serviceName(r).toLowerCase() === wanted) ||
         rows.find(r => serviceName(r).toLowerCase().includes(wanted)) ||
         rows.find(r => wanted.includes(serviceName(r).toLowerCase()) && serviceName(r)) || null;
}

function extractPrice(data, id, name) {
  const direct = [
    data?.price?.price,
    data?.price?.amount,
    data?.data?.price?.price,
    data?.data?.price?.amount,
    data?.amount,
    data?.data?.amount,
    data?.price
  ];
  for (const v of direct) {
    if (typeof v === "object") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const lists = [
    data?.prices,
    data?.data?.prices,
    Array.isArray(data) ? data : null
  ].filter(Array.isArray);

  for (const rows of lists) {
    const match = rows.find(row => {
      const rid = String(row?.service?.id ?? row?.service_id ?? row?.id ?? "").toLowerCase();
      const rn = String(row?.service?.name ?? row?.name ?? "").toLowerCase();
      return rid === String(id || "").toLowerCase() || rn === String(name || "").toLowerCase();
    });
    if (match) {
      const n = Number(match?.price ?? match?.amount ?? match?.selling_price);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

async function getService(server, countryId, requested) {
  const data = await sureVerificationRequest(`/${server}/services?country_id=${q(countryId)}`);
  const rows = unwrapServices(data);
  const match = findService(rows, requested);
  if (!match) {
    const available = rows.slice(0, 20).map(r => `${serviceName(r) || "?"} [${serviceId(r) || "?"}]`).filter(Boolean);
    throw new Error(`Service "${requested}" not found on ${server}. ${available.length ? `Available: ${available.join(", ")}` : "Provider returned no services."}`);
  }
  return { id: serviceId(match), name: serviceName(match) || requested };
}

async function providerPrice(server, countryId, service) {
  const svc = await getService(server, countryId, service);
  let data;
  if (server === "global-server-2") {
    data = await sureVerificationRequest("/global-server-2/price");
  } else {
    data = await sureVerificationRequest(`/${server}/price?country_id=${q(countryId)}&service=${q(svc.id)}`);
  }
  const price = extractPrice(data, svc.id, svc.name);
  if (price == null) throw new Error(`Provider returned a successful response but no price for ${svc.name} (${svc.id}) on ${server}.`);
  return { price, service: svc, raw: data };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success:false, error:"Method not allowed." });
  const countryId = String(req.query?.countryId || "").trim();
  const countryName = String(req.query?.countryName || "").trim();
  const service = String(req.query?.service || "").trim();
  const server = String(req.query?.server || "").trim();
  if (!countryId || !service || !server) return res.status(400).json({success:false,error:"countryId, service and server are required."});

  try {
    const result = await providerPrice(server, countryId, service);
    return res.status(200).json({success:true,countryId,countryName,service,server,provider_service_id:result.service.id,provider_service_name:result.service.name,provider_price:result.price});
  } catch (err) {
    const message = jsonError(err?.message || err, "Unable to load provider price.");
    console.error("Provider price error", {server,countryId,service,error:message});
    return res.status(502).json({success:false,error:message,server,countryId,service});
  }
}
