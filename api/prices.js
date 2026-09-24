import { sureVerificationRequest } from "./_lib.js";

function encode(value) {
  return encodeURIComponent(String(value ?? ""));
}

function errorMessage(error) {
  if (!error) return "Unable to load provider price.";

  if (typeof error === "string") return error;

  if (typeof error?.message === "string") {
    return error.message;
  }

  if (typeof error?.error === "string") {
    return error.error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unable to load provider price.";
  }
}

function getServices(data) {
  if (Array.isArray(data)) return data;

  if (Array.isArray(data?.services)) {
    return data.services;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data?.data?.services)) {
    return data.data.services;
  }

  return [];
}

function getServiceId(service) {
  return String(
    service?.id ??
    service?.service_id ??
    service?.serviceId ??
    service?.service?.id ??
    ""
  ).trim();
}

function getServiceName(service) {
  return String(
    service?.name ??
    service?.service_name ??
    service?.serviceName ??
    service?.title ??
    service?.service?.name ??
    ""
  ).trim();
}

function findService(services, requested) {
  const wanted = String(requested || "").trim().toLowerCase();

  if (!wanted) return null;

  // Exact provider service ID
  let match = services.find(
    service =>
      getServiceId(service).toLowerCase() === wanted
  );

  if (match) return match;

  // Exact provider service name
  match = services.find(
    service =>
      getServiceName(service).toLowerCase() === wanted
  );

  if (match) return match;

  // Partial name match
  match = services.find(
    service =>
      getServiceName(service)
        .toLowerCase()
        .includes(wanted)
  );

  if (match) return match;

  // Reverse partial match
  match = services.find(service => {
    const name = getServiceName(service).toLowerCase();

    return (
      name &&
      wanted.includes(name)
    );
  });

  return match || null;
}

function extractPrice(data, providerServiceId, providerServiceName) {
  /*
   * USA Server 1 / USA Server 2 /
   * Global Server 1 normally return:
   *
   * {
   *   price: {
   *     service: {...},
   *     price: 900
   *   }
   * }
   */

  const possibleDirectPrices = [
    data?.price?.price,
    data?.price?.amount,
    data?.data?.price?.price,
    data?.data?.price?.amount,
    data?.amount,
    data?.data?.amount
  ];

  for (const value of possibleDirectPrices) {
    if (
      value !== null &&
      value !== undefined &&
      typeof value !== "object"
    ) {
      const number = Number(value);

      if (
        Number.isFinite(number) &&
        number > 0
      ) {
        return number;
      }
    }
  }

  /*
   * Global Server 2 returns:
   *
   * {
   *   prices: [
   *     {
   *       service: {
   *         id: "wa",
   *         name: "Whatsapp"
   *       },
   *       price: 1604,
   *       id: 1
   *     }
   *   ]
   * }
   */

  const priceLists = [
    data?.prices,
    data?.data?.prices,
    Array.isArray(data) ? data : null
  ].filter(Array.isArray);

  const wantedId = String(
    providerServiceId || ""
  ).toLowerCase();

  const wantedName = String(
    providerServiceName || ""
  ).toLowerCase();

  for (const list of priceLists) {
    for (const row of list) {
      const rowId = String(
        row?.service?.id ??
        row?.service_id ??
        row?.serviceId ??
        ""
      ).toLowerCase();

      const rowName = String(
        row?.service?.name ??
        row?.name ??
        row?.service_name ??
        ""
      ).toLowerCase();

      if (
        rowId === wantedId ||
        rowName === wantedName
      ) {
        const price = Number(
          row?.price ??
          row?.amount ??
          row?.selling_price
        );

        if (
          Number.isFinite(price) &&
          price > 0
        ) {
          return price;
        }
      }
    }
  }

  return null;
}

async function getProviderService(
  server,
  countryId,
  requestedService
) {
  const response =
    await sureVerificationRequest(
      `/${server}/services?country_id=${encode(countryId)}`
    );

  const services = getServices(response);

  if (!services.length) {
    throw new Error(
      `SureVerification returned no services for ${server} and country ${countryId}.`
    );
  }

  const service = findService(
    services,
    requestedService
  );

  if (!service) {
    const available = services
      .slice(0, 30)
      .map(service => {
        const id = getServiceId(service);
        const name = getServiceName(service);

        return `${name || "Unknown"} [${id || "no-id"}]`;
      })
      .join(", ");

    throw new Error(
      `Service "${requestedService}" was not found on ${server}. Available services: ${available}`
    );
  }

  const id = getServiceId(service);
  const name = getServiceName(service);

  if (!id) {
    throw new Error(
      `SureVerification returned "${name || requestedService}" without a service ID on ${server}.`
    );
  }

  return {
    id,
    name: name || requestedService
  };
}

async function getProviderPrice({
  server,
  countryId,
  requestedService
}) {
  /*
   * IMPORTANT:
   *
   * We do NOT trust the frontend service ID.
   *
   * Example:
   * Global Server 2 may use "wa".
   * USA Server 2 may use a completely different ID.
   *
   * Therefore we ask the selected server for its
   * own service list first.
   */

  const providerService =
    await getProviderService(
      server,
      countryId,
      requestedService
    );

  let response;

  /*
   * Global Server 2 has a different price endpoint.
   * Its price endpoint returns a list of price tiers.
   */
  if (server === "global-server-2") {
    response =
      await sureVerificationRequest(
        "/global-server-2/price"
      );
  } else {
    /*
     * USA Server 1
     * USA Server 2
     * Global Server 1
     */

    response =
      await sureVerificationRequest(
        `/${server}/price?country_id=${encode(countryId)}&service=${encode(providerService.id)}`
      );
  }

  const providerPrice =
    extractPrice(
      response,
      providerService.id,
      providerService.name
    );

  if (
    !Number.isFinite(providerPrice) ||
    providerPrice <= 0
  ) {
    throw new Error(
      `SureVerification returned no valid price for ${providerService.name} on ${server}. Provider service ID: ${providerService.id}.`
    );
  }

  return {
    providerPrice,
    providerService
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  const countryId = String(
    req.query?.countryId || ""
  ).trim();

  const countryName = String(
    req.query?.countryName || ""
  ).trim();

  const service = String(
    req.query?.service || ""
  ).trim();

  const server = String(
    req.query?.server || ""
  ).trim();

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

  const allowedServers = [
    "usa-server-1",
    "usa-server-2",
    "global-server-1",
    "global-server-2"
  ];

  if (!allowedServers.includes(server)) {
    return res.status(400).json({
      success: false,
      error: `Invalid provider server: ${server}`
    });
  }

  try {
    const result =
      await getProviderPrice({
        server,
        countryId,
        requestedService: service
      });

    return res.status(200).json({
      success: true,

      countryId,
      countryName,

      requested_service: service,

      server,

      provider_service_id:
        result.providerService.id,

      provider_service_name:
        result.providerService.name,

      provider_price:
        result.providerPrice
    });

  } catch (error) {
    const message =
      errorMessage(error);

    console.error(
      "SureVerification provider price error:",
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
      countryId,
      countryName,
      service,
      server
    });
  }
}
