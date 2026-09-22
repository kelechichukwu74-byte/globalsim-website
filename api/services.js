const SUPABASE_URL =
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_BASE_URL =
  "https://sureverifications.com/api/v1";


/* =========================================================
   HELPERS
   ========================================================= */

function clean(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeName(value) {
  return clean(value)
    .replace(/[^a-z0-9]+/g, "");
}

function getServiceId(service) {
  return (
    service?.id ??
    service?.serviceId ??
    service?.service_id ??
    service?.serviceCountryPriceId ??
    service?.service_country_price_id ??
    null
  );
}

function getServiceName(service) {
  return (
    service?.name ??
    service?.serviceName ??
    service?.service_name ??
    service?.title ??
    service?.service ??
    ""
  );
}

function getServiceCode(service) {
  return (
    service?.code ??
    service?.serviceCode ??
    service?.service_code ??
    service?.slug ??
    ""
  );
}


/* =========================================================
   SUREVERIFICATION
   ========================================================= */

async function getProviderServices(server, countryId) {

  const url =
    `${SURE_BASE_URL}/${server}/services?country_id=${encodeURIComponent(countryId)}`;

  const apiKey =
    process.env.SUREVERIFICATION_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const response = await fetch(url, {
    method: "GET",

    headers: {
      Accept: "application/json",
      "x-api-key": apiKey
    }
  });

  const text =
    await response.text();

  let data = {};

  try {
    data =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    throw new Error(
      `${server} returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      `${server} returned HTTP ${response.status}.`
    );
  }

  const services =
    Array.isArray(data?.services)
      ? data.services
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
          ? data
          : [];

  return services.map(service => ({
    ...service,

    available_servers: [
      server
    ]
  }));
}


/* =========================================================
   SUPABASE PRICING
   ========================================================= */

async function getAdminPrices(countryId) {

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }

  const url =
    `${SUPABASE_URL}/rest/v1/product_prices` +
    `?country_id=eq.${encodeURIComponent(countryId)}` +
    `&select=country_id,country_name,service_id,service_name,selling_price`;

  const response =
    await fetch(url, {
      method: "GET",

      headers: {
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        Accept:
          "application/json"
      }
    });

  const text =
    await response.text();

  let data = [];

  try {
    data =
      text
        ? JSON.parse(text)
        : [];
  } catch {
    return [];
  }

  if (!response.ok) {
    console.error(
      "Supabase pricing error:",
      data
    );

    return [];
  }

  return Array.isArray(data)
    ? data
    : [];
}


/* =========================================================
   MAIN HANDLER
   ========================================================= */

export default async function handler(
  req,
  res
) {

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }


  const countryId =
    req.query?.countryId;

  const countryCode =
    clean(req.query?.countryCode);

  const countryName =
    clean(req.query?.countryName);


  if (!countryId) {
    return res.status(400).json({
      success: false,
      error: "countryId is required"
    });
  }


  /* =======================================================
     PROVIDER ORDER

     United States:
     USA Server 2
     USA Server 1
     Global Server 1
     Global Server 2

     Other countries:
     Global Server 1
     Global Server 2
     ======================================================= */

  const isUS =
    countryCode === "us" ||
    countryCode === "usa" ||
    countryName === "united states" ||
    countryName === "united states of america";


  const servers = isUS
    ? [
        "usa-server-2",
        "usa-server-1",
        "global-server-1",
        "global-server-2"
      ]
    : [
        "global-server-1",
        "global-server-2"
      ];


  /* =======================================================
     ASK EVERY RELEVANT PROVIDER

     One failed portal must NOT stop the others.
     ======================================================= */

  const providerResults = [];

  const providerErrors = [];


  for (const server of servers) {

    try {

      const services =
        await getProviderServices(
          server,
          countryId
        );

      providerResults.push({
        server,
        services
      });

    } catch (error) {

      console.error(
        `Provider ${server} failed:`,
        error?.message || error
      );

      providerErrors.push({
        server,
        error:
          error?.message ||
          "Provider request failed"
      });

    }
  }


  /* =======================================================
     MERGE SERVICES
     ======================================================= */

  const merged =
    new Map();


  for (
    const provider
    of providerResults
  ) {

    for (
      const service
      of provider.services
    ) {

      const id =
        getServiceId(service);

      const name =
        getServiceName(service);

      const code =
        getServiceCode(service);


      const key =
        clean(id) ||
        normalizeName(name) ||
        normalizeName(code);


      if (!key) {
        continue;
      }


      if (!merged.has(key)) {

        merged.set(
          key,
          {
            ...service,

            available_servers: [
              ...(service.available_servers || [])
            ]
          }
        );

      } else {

        const existing =
          merged.get(key);


        existing.available_servers = [
          ...new Set([
            ...(existing.available_servers || []),
            ...(service.available_servers || [])
          ])
        ];


        /* Preserve useful provider data */

        if (
          existing.count == null &&
          service.count != null
        ) {
          existing.count =
            service.count;
        }

        if (
          existing.stock == null &&
          service.stock != null
        ) {
          existing.stock =
            service.stock;
        }
      }
    }
  }


  let services =
    [...merged.values()];


  /* =======================================================
     APPLY ADMIN SELLING PRICES
     ======================================================= */

  const prices =
    await getAdminPrices(
      countryId
    );


  const priceById =
    new Map();

  const priceByName =
    new Map();


  for (
    const row
    of prices
  ) {

    const amount =
      Number(
        row?.selling_price
      );


    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      continue;
    }


    if (
      row?.service_id !== null &&
      row?.service_id !== undefined
    ) {

      priceById.set(
        clean(row.service_id),
        amount
      );
    }


    if (row?.service_name) {

      priceByName.set(
        clean(row.service_name),
        amount
      );

      priceByName.set(
        normalizeName(
          row.service_name
        ),
        amount
      );
    }
  }


  services =
    services.map(service => {

      const id =
        getServiceId(service);

      const name =
        getServiceName(service);

      const code =
        getServiceCode(service);


      const sellingPrice =
        priceById.get(
          clean(id)
        ) ??
        priceByName.get(
          clean(name)
        ) ??
        priceByName.get(
          normalizeName(name)
        ) ??
        priceByName.get(
          clean(code)
        ) ??
        priceByName.get(
          normalizeName(code)
        );


      if (
        Number.isFinite(
          sellingPrice
        ) &&
        sellingPrice > 0
      ) {

        return {
          ...service,

          selling_price:
            sellingPrice,

          sellingPrice:
            sellingPrice,

          price:
            sellingPrice,

          amount:
            sellingPrice
        };
      }


      return service;
    });


  /* =======================================================
     IMPORTANT ERROR HANDLING

     If every provider failed, return the real reason
     instead of making the customer see a generic error.
     ======================================================= */

  if (
    providerResults.length === 0
  ) {

    return res.status(502).json({

      success: false,

      error:
        providerErrors
          .map(item =>
            `${item.server}: ${item.error}`
          )
          .join(" | ") ||
        "All SureVerification service providers failed.",

      providers: servers,

      providerErrors

    });
  }


  /* =======================================================
     SUCCESS
     ======================================================= */

  return res.status(200).json({

    success: true,

    server:
      isUS
        ? "multi-provider"
        : "global-provider",

    providers:
      servers,

    successfulProviders:
      providerResults.map(
        item => item.server
      ),

    failedProviders:
      providerErrors,

    services

  });
}
