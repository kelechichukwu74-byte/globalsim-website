import { sureVerificationRequest } from "./_lib.js";

const SERVERS = [
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
];

const text = value => String(value ?? "").trim();

function servicesFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.services)) return data.services;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.services)) return data.data.services;
  return [];
}

function getId(service) {
  return text(
    service?.id ??
    service?.service_id ??
    service?.serviceId ??
    service?.service?.id
  );
}

function getName(service) {
  return text(
    service?.name ??
    service?.service_name ??
    service?.serviceName ??
    service?.title ??
    service?.service?.name
  );
}

function findService(services, wanted) {
  const value = text(wanted).toLowerCase();

  return (
    services.find(
      s => getId(s).toLowerCase() === value
    ) ||
    services.find(
      s => getName(s).toLowerCase() === value
    ) ||
    services.find(
      s => getName(s).toLowerCase().includes(value)
    ) ||
    null
  );
}

function validNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractPrice(data, providerService) {
  const direct = [
    data?.price?.price,
    data?.price?.amount,
    data?.data?.price?.price,
    data?.data?.price?.amount,
    data?.amount,
    data?.data?.amount
  ];

  for (const value of direct) {
    const n = validNumber(value);
    if (n !== null) return n;
  }

  const lists = [
    data?.prices,
    data?.data?.prices,
    Array.isArray(data) ? data : null
  ].filter(Array.isArray);

  const wantedId = getId(providerService).toLowerCase();
  const wantedName = getName(providerService).toLowerCase();

  for (const list of lists) {
    for (const row of list) {
      const rowId = text(
        row?.service?.id ??
        row?.service_id ??
        row?.serviceId ??
        row?.id
      ).toLowerCase();

      const rowName = text(
        row?.service?.name ??
        row?.service_name ??
        row?.name
      ).toLowerCase();

      if (
        rowId === wantedId ||
        rowName === wantedName ||
        rowName.includes(wantedName) ||
        wantedName.includes(rowName)
      ) {
        const n =
          validNumber(row?.price) ??
          validNumber(row?.amount) ??
          validNumber(row?.selling_price);

        if (n !== null) return n;
      }
    }
  }

  return null;
}

async function resolveProviderService(
  server,
  countryId,
  service
) {
  const response = await sureVerificationRequest(
    `/${server}/services?country_id=${encodeURIComponent(countryId)}`
  );

  const services = servicesFrom(response);

  if (!services.length) {
    throw new Error(
      `No services returned by ${server}.`
    );
  }

  const found = findService(services, service);

  if (!found) {
    throw new Error(
      `Service "${service}" was not found on ${server}.`
    );
  }

  const id = getId(found);
  const name = getName(found);

  if (!id) {
    throw new Error(
      `Provider did not return an ID for ${name || service}.`
    );
  }

  return {
    id,
    name: name || service
  };
}

async function getProviderPrice({
  server,
  countryId,
  service
}) {
  const providerService =
    await resolveProviderService(
      server,
      countryId,
      service
    );

  let response;

  if (server === "global-server-2") {
    response = await sureVerificationRequest(
      "/global-server-2/price"
    );
  } else {
    response = await sureVerificationRequest(
      `/${server}/price?country_id=${encodeURIComponent(countryId)}&service=${encodeURIComponent(providerService.id)}`
    );
  }

  const price = extractPrice(
    response,
    providerService
  );

  if (price === null) {
    throw new Error(
      `Provider returned no price for ${providerService.name} on ${server}. Provider service ID: ${providerService.id}.`
    );
  }

  return {
    price,
    service: providerService
  };
}

function cleanError(error) {
  if (!error) {
    return "Unable to load provider price.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error.message === "string") {
    return error.message;
  }

  if (typeof error.error === "string") {
    return error.error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unable to load provider price.";
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  const countryId = text(req.query?.countryId);
  const countryName = text(req.query?.countryName);
  const service = text(req.query?.service);
  const server = text(req.query?.server);

  if (!countryId) {
    return res.status(400).json({
      success: false,
      error: "countryId is required."
    });
  }

  if (!service) {
    return res.status(400).json({
      success: false,
      error: "service is required."
    });
  }

  if (!server) {
    return res.status(400).json({
      success: false,
      error: "server is required."
    });
  }

  if (!SERVERS.includes(server)) {
    return res.status(400).json({
      success: false,
      error: `Invalid provider server: ${server}.`
    });
  }

  try {
    const result = await getProviderPrice({
      server,
      countryId,
      service
    });

    return res.status(200).json({
      success: true,
      country_id: countryId,
      country_name: countryName,
      server,
      requested_service: service,

      provider_service_id:
        result.service.id,

      provider_service_name:
        result.service.name,

      provider_price:
        result.price,

      provider_cost:
        result.price
    });

  } catch (error) {
    const message = cleanError(error);

    console.error(
      "Provider price error:",
      {
        countryId,
        countryName,
        service,
        server,
        error: message
      }
    );

    return res.status(502).json({
      success: false,
      error: message,
      country_id: countryId,
      country_name: countryName,
      service,
      server
    });
  }
}
