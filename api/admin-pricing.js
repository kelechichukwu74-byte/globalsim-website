import { sureVerificationRequest } from "./_lib.js";

const SERVERS = [
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
];

function clean(value) {
  return String(value ?? "").trim();
}

function getServices(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.services)) return data.services;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.services)) {
    return data.data.services;
  }
  return [];
}

function serviceId(service) {
  return clean(
    service?.id ??
    service?.service_id ??
    service?.serviceId ??
    service?.service?.id
  );
}

function serviceName(service) {
  return clean(
    service?.name ??
    service?.service_name ??
    service?.serviceName ??
    service?.title ??
    service?.service?.name
  );
}

function findService(services, requestedId, requestedName) {
  const id = clean(requestedId).toLowerCase();
  const name = clean(requestedName).toLowerCase();

  if (id) {
    const exactId = services.find(
      service =>
        serviceId(service).toLowerCase() === id
    );

    if (exactId) {
      return exactId;
    }
  }

  if (name) {
    const exactName = services.find(
      service =>
        serviceName(service).toLowerCase() === name
    );

    if (exactName) {
      return exactName;
    }

    const partialName = services.find(
      service =>
        serviceName(service)
          .toLowerCase()
          .includes(name)
    );

    if (partialName) {
      return partialName;
    }
  }

  return null;
}

function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? number
    : null;
}

function extractPrice(data, selectedService) {
  const directPrices = [
    data?.price?.price,
    data?.price?.amount,
    data?.price,
    data?.amount,
    data?.data?.price?.price,
    data?.data?.price?.amount,
    data?.data?.price,
    data?.data?.amount
  ];

  for (const value of directPrices) {
    const price = numberOrNull(value);

    if (price !== null) {
      return price;
    }
  }

  const lists = [
    data?.prices,
    data?.data?.prices,
    Array.isArray(data) ? data : null
  ].filter(Array.isArray);

  const wantedId =
    serviceId(selectedService).toLowerCase();

  const wantedName =
    serviceName(selectedService).toLowerCase();

  for (const list of lists) {
    for (const row of list) {
      const rowId = clean(
        row?.service?.id ??
        row?.service_id ??
        row?.serviceId ??
        row?.id
      ).toLowerCase();

      const rowName = clean(
        row?.service?.name ??
        row?.service_name ??
        row?.serviceName ??
        row?.name
      ).toLowerCase();

      const matches =
        rowId === wantedId ||
        rowName === wantedName ||
        (
          wantedName &&
          rowName.includes(wantedName)
        ) ||
        (
          rowName &&
          wantedName.includes(rowName)
        );

      if (!matches) {
        continue;
      }

      const price =
        numberOrNull(row?.price) ??
        numberOrNull(row?.amount) ??
        numberOrNull(row?.provider_price) ??
        numberOrNull(row?.selling_price);

      if (price !== null) {
        return price;
      }
    }
  }

  return null;
}

async function getProviderService({
  server,
  countryId,
  requestedServiceId,
  requestedServiceName
}) {
  const query = new URLSearchParams();

  query.set(
    "country_id",
    String(countryId)
  );

  const response =
    await sureVerificationRequest(
      `/${server}/services?${query.toString()}`
    );

  const services =
    getServices(response);

  if (!services.length) {
    throw new Error(
      `No services were returned by ${server}.`
    );
  }

  const selected =
    findService(
      services,
      requestedServiceId,
      requestedServiceName
    );

  if (!selected) {
    throw new Error(
      `Service "${requestedServiceName || requestedServiceId}" was not found on ${server}.`
    );
  }

  const id = serviceId(selected);
  const name = serviceName(selected);

  if (!id) {
    throw new Error(
      `SureVerification did not return a service ID for ${name || requestedServiceName}.`
    );
  }

  return {
    id,
    name
  };
}

async function getPrice({
  server,
  countryId,
  requestedServiceId,
  requestedServiceName
}) {
  const providerService =
    await getProviderService({
      server,
      countryId,
      requestedServiceId,
      requestedServiceName
    });

  let response;

  /*
   * Global Server 2:
   * price endpoint does not require country_id/service.
   */
  if (server === "global-server-2") {
    response =
      await sureVerificationRequest(
        "/global-server-2/price"
      );
  } else {
    const query =
      new URLSearchParams();

    query.set(
      "country_id",
      String(countryId)
    );

    query.set(
      "service",
      providerService.id
    );

    response =
      await sureVerificationRequest(
        `/${server}/price?${query.toString()}`
      );
  }

  const price =
    extractPrice(
      response,
      providerService
    );

  if (price === null) {
    throw new Error(
      `SureVerification returned no valid price for ${providerService.name} on ${server}. Provider service ID: ${providerService.id}.`
    );
  }

  return {
    price,
    service: providerService
  };
}

function errorMessage(error) {
  if (!error) {
    return "Provider price not available.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error?.message) {
    return String(error.message);
  }

  if (error?.error) {
    return String(error.error);
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Provider price not available.";
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  const countryId =
    clean(req.query?.countryId);

  const countryName =
    clean(req.query?.countryName);

  const requestedServiceId =
    clean(
      req.query?.serviceId ||
      req.query?.providerServiceId
    );

  const requestedServiceName =
    clean(
      req.query?.serviceName ||
      req.query?.service
    );

  const server =
    clean(req.query?.server);

  if (!countryId) {
    return res.status(400).json({
      success: false,
      error: "countryId is required."
    });
  }

  if (!requestedServiceId && !requestedServiceName) {
    return res.status(400).json({
      success: false,
      error:
        "serviceId or service is required."
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
      error:
        `Invalid provider server: ${server}.`
    });
  }

  try {
    const result =
      await getPrice({
        server,
        countryId,
        requestedServiceId,
        requestedServiceName
      });

    return res.status(200).json({
      success: true,

      country_id:
        countryId,

      country_name:
        countryName,

      server,

      requested_service:
        requestedServiceName,

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
    const message =
      errorMessage(error);

    console.error(
      "SureVerification provider price error:",
      {
        countryId,
        countryName,
        requestedServiceId,
        requestedServiceName,
        server,
        error: message
      }
    );

    return res.status(502).json({
      success: false,
      error: message,
      country_id: countryId,
      country_name: countryName,
      service: requestedServiceName,
      service_id: requestedServiceId,
      server
    });
  }
}
