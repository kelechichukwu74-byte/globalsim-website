import {
  sureVerificationRequest,
  getServersForCountry
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/*
  Supabase REST helper
*/
async function supabaseRequest(path) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      headers: {
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        Accept:
          "application/json"
      }
    }
  );

  const text =
    await response.text();

  let data = [];

  try {
    data =
      text
        ? JSON.parse(text)
        : [];
  } catch {
    throw new Error(
      `Supabase returned invalid JSON (HTTP ${response.status}).`
    );
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


/*
  Normalize SureVerification service response.
*/
function extractServices(data) {
  if (
    Array.isArray(data?.services)
  ) {
    return data.services;
  }

  if (
    Array.isArray(data?.data)
  ) {
    return data.data;
  }

  if (
    Array.isArray(data)
  ) {
    return data;
  }

  return [];
}


/*
  Create a stable key for a service.
*/
function getServiceKey(service) {
  const id =
    service?.id ??
    service?.serviceId ??
    service?.service_id ??
    service?.serviceCountryPriceId ??
    service?.service_country_price_id;

  const name =
    service?.name ??
    service?.serviceName ??
    service?.service_name ??
    service?.title ??
    "";

  return String(
    id || name
  ).trim().toLowerCase();
}


/*
  Load services from one SureVerification server.
*/
async function loadServerServices(
  server,
  countryId
) {
  try {
    const data =
      await sureVerificationRequest(
        `/${server}/services?country_id=${encodeURIComponent(
          countryId
        )}`
      );

    return {
      server,
      services:
        extractServices(data),
      error: null
    };

  } catch (error) {
    console.error(
      `SureVerification ${server} services error:`,
      error
    );

    return {
      server,
      services: [],
      error:
        error?.message ||
        "Unable to load services."
    };
  }
}


/*
  Main endpoint
*/
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

  try {
    const countryId =
      req.query?.countryId;

    const requestedServer =
      req.query?.server;

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error:
          "countryId is required"
      });
    }


    /*
      If a specific server was requested,
      use only that server.

      Otherwise check both appropriate
      servers for the country.
    */
    const servers =
      requestedServer
        ? [requestedServer]
        : getServersForCountry(
            countryId
          );


    /*
      Ask all applicable servers for their
      available services.
    */
    const results =
      await Promise.all(
        servers.map(
          server =>
            loadServerServices(
              server,
              countryId
            )
        )
      );


    /*
      Load admin-configured selling prices.
    */
    let sellingPrices = [];

    try {
      sellingPrices =
        await supabaseRequest(
          `product_prices?country_id=eq.${encodeURIComponent(
            countryId
          )}&select=country_id,country_name,service_id,service_name,selling_price`
        );

    } catch (pricingError) {
      console.error(
        "Admin pricing lookup error:",
        pricingError
      );

      sellingPrices = [];
    }


    /*
      Build selling-price lookup.
    */
    const priceMap =
      new Map();

    for (
      const row of sellingPrices
    ) {
      if (!row?.service_id) {
        continue;
      }

      priceMap.set(
        String(
          row.service_id
        ),
        {
          sellingPrice:
            Number(
              row.selling_price
            ),

          serviceName:
            row.service_name ||
            ""
        }
      );
    }


    /*
      Combine services from all servers.

      A service may exist on more than
      one server, so keep information
      about every server where it exists.
    */
    const serviceMap =
      new Map();

    for (
      const result of results
    ) {
      for (
        const service of result.services
      ) {
        const serviceId =
          service?.id ??
          service?.serviceId ??
          service?.service_id ??
          service?.serviceCountryPriceId ??
          service?.service_country_price_id;

        const serviceName =
          service?.name ??
          service?.serviceName ??
          service?.service_name ??
          service?.title ??
          String(
            serviceId || ""
          );

        const key =
          getServiceKey({
            ...service,
            id:
              serviceId,
            name:
              serviceName
          });

        if (!key) {
          continue;
        }


        if (
          !serviceMap.has(key)
        ) {
          serviceMap.set(
            key,
            {
              ...service,

              id:
                serviceId,

              name:
                serviceName,

              serviceName:
                serviceName,

              servers: [],

              available_servers: []
            }
          );
        }


        const existing =
          serviceMap.get(key);


        /*
          Save each server where
          this service is available.
        */
        if (
          !existing.servers.includes(
            result.server
          )
        ) {
          existing.servers.push(
            result.server
          );
        }


        if (
          !existing.available_servers.includes(
            result.server
          )
        ) {
          existing.available_servers.push(
            result.server
          );
        }


        /*
          Keep the original provider
          service data available.
        */
        existing.server =
          existing.server ||
          result.server;
      }
    }


    /*
      Apply admin selling prices.
    */
    const services =
      Array.from(
        serviceMap.values()
      ).map(service => {
        const configured =
          priceMap.get(
            String(
              service.id
            )
          );


        const sellingPrice =
          configured &&
          Number.isFinite(
            configured.sellingPrice
          ) &&
          configured.sellingPrice > 0
            ? configured.sellingPrice
            : null;


        return {
          ...service,

          selling_price:
            sellingPrice,

          sellingPrice:
            sellingPrice,

          provider_price:
            undefined
        };
      });


    /*
      Return the services plus
      all applicable servers.
    */
    return res.status(200).json({
      success: true,

      countryId,

      servers,

      serverResults:
        results.map(
          result => ({
            server:
              result.server,

            serviceCount:
              result.services.length,

            available:
              result.services.length > 0,

            error:
              result.error
          })
        ),

      services
    });

  } catch (error) {
    console.error(
      "SureVerification services error:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Unable to load services."
    });
  }
}
