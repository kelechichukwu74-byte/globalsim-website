import { sureVerificationRequest } from "./_lib.js";

const ALLOWED_SERVERS = [
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
];

function str(value) {
  return String(value ?? "").trim();
}

function encode(value) {
  return encodeURIComponent(str(value));
}

function getServices(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.services)) return data.services;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.services)) return data.data.services;
  return [];
}

function serviceId(service) {
  return str(
    service?.id ??
    service?.service_id ??
    service?.serviceId ??
    service?.service?.id
  );
}

function serviceName(service) {
  return str(
    service?.name ??
    service?.service_name ??
    service?.serviceName ??
    service?.title ??
    service?.service?.name
  );
}

function findService(services, requested) {
  const wanted = str(requested).toLowerCase();

  if (!wanted) return null;

  // Exact provider ID
  let found = services.find(
    item => serviceId(item).toLowerCase() === wanted
  );

  if (found) return found;

  // Exact provider service name
  found = services.find(
    item => serviceName(item).toLowerCase() === wanted
  );

  if (found) return found;

  // Name contains requested value
  found = services.find(
    item =>
      serviceName(item)
        .toLowerCase()
        .includes(wanted)
  );

  if (found) return found;

  // Requested value contains provider name
  found = services.find(
    item => {
      const name = serviceName(item).toLowerCase();
      return name && wanted.includes(name);
    }
  );

  return found || null;
}

function numberValue(value) {
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

function extractGlobalServer2Price(
  data,
  providerService
) {
  const wantedId =
    serviceId(providerService).toLowerCase();

  const wantedName =
    serviceName(providerService).toLowerCase();

  const lists = [];

  if (Array.isArray(data?.prices)) {
    lists.push(data.prices);
  }

  if (Array.isArray(data?.data?.prices)) {
    lists.push(data.data.prices);
  }

  if (Array.isArray(data)) {
    lists.push(data);
  }

  for (const list of lists) {
    for (const row of list) {
      const rowId = str(
        row?.service?.id ??
        row?.service_id ??
        row?.serviceId ??
        row?.id
      ).toLowerCase();

      const rowName = str(
        row?.service?.name ??
        row?.name ??
        row?.service_name
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

      if (!matches) continue;

      const price =
        numberValue(row?.price) ??
        numberValue(row?.amount) ??
        numberValue(row?.selling_price);

      if (price !== null && price > 0) {
        return price;
      }
    }
  }

  return null;
}

function extractNormalServerPrice(data) {
  const possible = [
    data?.price?.price,
    data?.price?.amount,
    data?.data?.price?.price,
    data?.data?.price?.amount,
    data?.price,
    data?.amount,
    data?.data?.amount
  ];

  for (const value of possible) {
    const price = numberValue(value);

    if (price !== null && price > 0) {
      return price;
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
      `No services were returned by ${server} for country ${countryId}.`
    );
  }

  const matched =
    findService(
      services,
      requestedService
    );

  if (!matched) {
    const available = services
      .slice(0, 50)
      .map(item => {
        const id = serviceId(item);
        const name = serviceName(item);

        return `${name || "Unknown"} [${id || "no-id"}]`;
      })
      .join(", ");

    throw new Error(
      `Service "${requestedService}" was not found on ${server}. Available services: ${available}`
    );
  }

  const id = serviceId(matched);
  const name = serviceName(matched);

  if (!id) {
    throw new Error(
      `Provider returned "${name || requestedService}" without a service ID on ${server}.`
    );
  }

  return {
    id,
    name: name || requestedService,
    raw: matched
  };
}

/*
 * Gets provider price from the correct server.
 *
 * USA Server 1:
 * /usa-server-1/price?country_id=...&service=...
 *
 * USA Server 2:
 * /usa-server-2/price?country_id=...&service=...
 *
 * Global Server 1:
 * /global-server-1/price?country_id=...&service=...
 *
 * Global Server 2:
 * /global-server-2/price
 */
async function getProviderPrice({
  server,
  countryId,
  requestedService
}) {
  const providerService =
    await getProviderService(
      server,
      countryId,
      requestedService
    );

  let response;

  if (server === "global-server-2") {
    response =
      await sureVerificationRequest(
        "/global-server-2/price"
      );
  } else {
    response =
      await sureVerificationRequest(
        `/${server}/price?country_id=${encode(countryId)}&service=${encode(providerService.id)}`
      );
  }

  let providerPrice;

  if (server === "global-server-2") {
    providerPrice =
      extractGlobalServer2Price(
        response,
        providerService
      );
  } else {
    providerPrice =
      extractNormalServerPrice(
        response
      );
  }

  if (
    providerPrice === null ||
    providerPrice <= 0
  ) {
    throw new Error(
      `No valid provider price was returned for ${providerService.name} on ${server}. Provider service ID: ${providerService.id}.`
    );
  }

  return {
    providerPrice,
    providerService,
    providerResponse: response
  };
}

/*
 * Get your saved selling price from Supabase.
 *
 * This is READ ONLY.
 * It does not change your database.
 */
async function getSavedSellingPrice({
  countryId,
  countryName,
  serviceId,
  serviceName,
  server
}) {
  const supabaseUrl =
    process.env.SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    return {
      sellingPrice: null,
      databaseAvailable: false
    };
  }

  const filters = [];

  if (countryId) {
    filters.push(
      `country_id=eq.${encodeURIComponent(countryId)}`
    );
  }

  if (serviceId) {
    filters.push(
      `service_id=eq.${encodeURIComponent(serviceId)}`
    );
  }

  if (server) {
    filters.push(
      `provider_server=eq.${encodeURIComponent(server)}`
    );
  }

  let url =
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/product_prices`;

  if (filters.length) {
    url += `?${filters.join("&")}`;
  }

  url +=
    filters.length ? "&limit=1" : "?limit=1";

  try {
    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization:
            `Bearer ${serviceRoleKey}`,
          Accept: "application/json"
        }
      });

    if (!response.ok) {
      return {
        sellingPrice: null,
        databaseAvailable: false
      };
    }

    const rows =
      await response.json();

    if (!Array.isArray(rows) || !rows.length) {
      return {
        sellingPrice: null,
        databaseAvailable: true
      };
    }

    const row = rows[0];

    const sellingPrice =
      numberValue(
        row?.selling_price
      );

    return {
      sellingPrice,
      databaseAvailable: true,
      databaseRow: {
        id: row?.id ?? null,
        country_id:
          row?.country_id ?? null,
        country_name:
          row?.country_name ?? null,
        service_id:
          row?.service_id ?? null,
        service_name:
          row?.service_name ?? null,
        provider_server:
          row?.provider_server ?? null,
        provider_price:
          row?.provider_price ?? null,
        selling_price:
          row?.selling_price ?? null,
        is_active:
          row?.is_active ?? null
      }
    };

  } catch {
    return {
      sellingPrice: null,
      databaseAvailable: false
    };
  }
}

function errorMessage(error) {
  if (!error) {
    return "Unable to load provider price.";
  }

  if (typeof error === "string") {
    return error;
  }

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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  const countryId =
    str(req.query?.countryId);

  const countryName =
    str(req.query?.countryName);

  const requestedService =
    str(req.query?.service);

  const requestedServiceId =
    str(req.query?.serviceId);

  const server =
    str(req.query?.server);

  if (!countryId) {
    return res.status(400).json({
      success: false,
      error: "countryId is required."
    });
  }

  if (!requestedService && !requestedServiceId) {
    return res.status(400).json({
      success: false,
      error:
        "service or serviceId is required."
    });
  }

  if (!server) {
    return res.status(400).json({
      success: false,
      error: "server is required."
    });
  }

  if (!ALLOWED_SERVERS.includes(server)) {
    return res.status(400).json({
      success: false,
      error:
        `Invalid provider server: ${server}`
    });
  }

  /*
   * Prefer service name because the provider has
   * different IDs on different servers.
   */
  const serviceToFind =
    requestedService ||
    requestedServiceId;

  try {
    const result =
      await getProviderPrice({
        server,
        countryId,
        requestedService:
          serviceToFind
      });

    /*
     * Read the saved selling price.
     *
     * We use the ACTUAL provider service ID
     * returned above rather than trusting the
     * frontend/database service ID.
     */
    const saved =
      await getSavedSellingPrice({
        countryId,
        countryName,
        serviceId:
          result.providerService.id,
        serviceName:
          result.providerService.name,
        server
      });

    /*
     * Keep the provider price in the response.
     *
     * Your website selling price remains your
     * own price, e.g. ₦3,000.
     */
    return res.status(200).json({
      success: true,

      country_id:
        countryId,

      country_name:
        countryName,

      server,

      requested_service:
        serviceToFind,

      provider_service_id:
        result.providerService.id,

      provider_service_name:
        result.providerService.name,

      provider_price:
        result.providerPrice,

      selling_price:
        saved.sellingPrice,

      provider_cost:
        result.providerPrice,

      profit:
        saved.sellingPrice !== null
          ? Number(
              (
                saved.sellingPrice -
                result.providerPrice
              ).toFixed(2)
            )
          : null,

      database_available:
        saved.databaseAvailable

    });

  } catch (error) {
    const message =
      errorMessage(error);

    console.error(
      "SureVerification price error:",
      {
        countryId,
        countryName,
        service:
          serviceToFind,
        server,
        error: message
      }
    );

    return res.status(502).json({
      success: false,
      error: message,

      country_id:
        countryId,

      country_name:
        countryName,

      server,

      requested_service:
        serviceToFind
    });
  }
}
