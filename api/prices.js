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
async function supabaseRequest(
  path,
  options = {}
) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/${path}`,
      {
        ...options,

        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            "application/json",

          Accept:
            "application/json",

          ...(options.headers || {})
        }
      }
    );

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
  Extract provider price from the
  different response formats.
*/
function extractProviderPrice(data) {
  const candidates = [
    data?.price,
    data?.amount,
    data?.data?.price,
    data?.data?.amount,
    data?.providerResponse?.price,
    data?.providerResponse?.amount
  ];

  for (
    const candidate of candidates
  ) {
    const value =
      Number(candidate);

    if (
      Number.isFinite(value) &&
      value > 0
    ) {
      return value;
    }
  }

  return null;
}


/*
  Check one SureVerification server.
*/
async function checkServerPrice(
  server,
  countryId,
  service
) {
  try {
    const data =
      await sureVerificationRequest(
        `/${server}/price?country_id=${encodeURIComponent(
          countryId
        )}&service=${encodeURIComponent(
          service
        )}`
      );

    const providerPrice =
      extractProviderPrice(data);

    return {
      server,

      available:
        providerPrice !== null,

      provider_price:
        providerPrice,

      providerPrice:
        providerPrice,

      error:
        providerPrice === null
          ? "Provider price is unavailable."
          : null
    };

  } catch (error) {
    console.error(
      `SureVerification ${server} price error:`,
      error
    );

    return {
      server,

      available: false,

      provider_price: null,

      providerPrice: null,

      error:
        error?.message ||
        "Unable to load provider price."
    };
  }
}


/*
  Main prices endpoint
*/
export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET"
  ) {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const countryId =
      req.query?.countryId;

    const service =
      req.query?.service;

    const requestedServer =
      req.query?.server;


    if (!countryId) {
      return res.status(400).json({
        success: false,

        error:
          "countryId is required"
      });
    }


    if (!service) {
      return res.status(400).json({
        success: false,

        error:
          "service is required"
      });
    }


    /*
      Use a specific server when requested.

      Otherwise check both servers
      available for the country.
    */
    const servers =
      requestedServer
        ? [requestedServer]
        : getServersForCountry(
            countryId
          );


    /*
      Check all applicable provider
      servers at the same time.
    */
    const serverResults =
      await Promise.all(
        servers.map(
          server =>
            checkServerPrice(
              server,
              countryId,
              service
            )
        )
      );


    /*
      Keep only servers that returned
      a valid provider price.
    */
    const availableServers =
      serverResults
        .filter(
          result =>
            result.available
        );


    /*
      Sort provider prices from
      cheapest to most expensive.

      This is ONLY provider cost.
      It does NOT change the customer's
      configured selling price.
    */
    availableServers.sort(
      (a, b) =>
        Number(
          a.provider_price
        ) -
        Number(
          b.provider_price
        )
    );


    /*
      The cheapest available provider
      server is the first candidate.
    */
    const selectedProvider =
      availableServers[0] ||
      null;


    /*
      Load the admin selling price.
    */
    let sellingPrice =
      null;

    let pricing =
      null;

    try {
      const pricingRows =
        await supabaseRequest(
          `product_prices?country_id=eq.${encodeURIComponent(
            countryId
          )}&service_id=eq.${encodeURIComponent(
            service
          )}&select=id,country_id,country_name,service_id,service_name,selling_price&limit=1`
        );

      pricing =
        pricingRows?.[0] ||
        null;


      if (pricing) {
        const configuredPrice =
          Number(
            pricing.selling_price
          );

        if (
          Number.isFinite(
            configuredPrice
          ) &&
          configuredPrice > 0
        ) {
          sellingPrice =
            configuredPrice;
        }
      }

    } catch (pricingError) {
      console.error(
        "Admin selling price lookup error:",
        pricingError
      );
    }


    /*
      Return all provider prices so
      the purchase endpoint can choose
      an available provider.
    */
    return res.status(200).json({
      success: true,

      countryId,

      service,

      servers,

      serverResults,

      availableServers,

      selectedProvider,

      selectedServer:
        selectedProvider?.server ||
        null,

      provider_price:
        selectedProvider?.provider_price ||
        null,

      providerPrice:
        selectedProvider?.providerPrice ||
        null,

      selling_price:
        sellingPrice,

      sellingPrice:
        sellingPrice,

      configured:
        sellingPrice !== null,

      pricing
    });

  } catch (error) {
    console.error(
      "SureVerification price error:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Unable to load price."
    });
  }
}
