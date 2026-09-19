import {
  sureVerificationRequest,
  getServersForCountry
} from "./_lib.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

/*
 * Safely read Supabase data.
 */
async function supabaseRequest(path) {
  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured.");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json"
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
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
 * Try to extract the provider price from different
 * response structures that SureVerification may return.
 */
function extractProviderPrice(data) {
  const candidates = [
    data?.providerPrice,
    data?.provider_price,

    data?.price,
    data?.amount,

    data?.data?.providerPrice,
    data?.data?.provider_price,

    data?.data?.price,
    data?.data?.amount,

    data?.result?.providerPrice,
    data?.result?.provider_price,

    data?.result?.price,
    data?.result?.amount
  ];

  for (const value of candidates) {
    const number = Number(value);

    if (
      Number.isFinite(number) &&
      number > 0
    ) {
      return number;
    }
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  try {
    const countryId =
      req.query?.countryId;

    const countryName =
      req.query?.countryName || "";

    const service =
      req.query?.service;

    const countryCode =
      req.query?.countryCode || "";

    if (!countryId || !service) {
      return res.status(400).json({
        success: false,
        error:
          "countryId and service are required."
      });
    }

    /*
     * Use the country name first.
     * If the name is unavailable, use the country code.
     */
    const countryForServer =
      countryName || countryCode;

    const servers =
      getServersForCountry(
        countryForServer
      );

    const results = [];

    /*
     * Ask each appropriate provider server
     * for the price.
     */
    for (const server of servers) {
      try {
        const providerData =
          await sureVerificationRequest(
            `/${server}/price?country_id=${encodeURIComponent(
              countryId
            )}&service=${encodeURIComponent(
              service
            )}`
          );

        const providerPrice =
          extractProviderPrice(
            providerData
          );

        if (
          Number.isFinite(providerPrice) &&
          providerPrice > 0
        ) {
          results.push({
            server,
            providerPrice,
            price: providerPrice,
            amount: providerPrice,
            available: true
          });
        } else {
          results.push({
            server,
            providerPrice: null,
            price: null,
            amount: null,
            available: false,
            error:
              "Provider returned no price."
          });
        }

      } catch (error) {
        results.push({
          server,
          providerPrice: null,
          price: null,
          amount: null,
          available: false,
          error:
            error?.message ||
            "Provider price unavailable."
        });
      }
    }

    /*
     * Put available prices first and choose
     * the lowest available provider price.
     */
    results.sort(
      (a, b) => {
        const aPrice =
          Number.isFinite(a.providerPrice)
            ? a.providerPrice
            : Infinity;

        const bPrice =
          Number.isFinite(b.providerPrice)
            ? b.providerPrice
            : Infinity;

        return aPrice - bPrice;
      }
    );

    const selected =
      results.find(
        row =>
          row.available === true &&
          Number.isFinite(
            row.providerPrice
          )
      ) || null;

    /*
     * Also check whether an admin selling price
     * has already been saved for this country/service.
     */
    let sellingPrice = null;

    try {
      const rows =
        await supabaseRequest(
          `product_prices?country_id=eq.${encodeURIComponent(
            countryId
          )}&service_id=eq.${encodeURIComponent(
            service
          )}&select=selling_price&limit=1`
        );

      sellingPrice =
        rows?.[0]?.selling_price ?? null;

    } catch (error) {
      /*
       * Provider price should still work even if
       * the admin pricing row does not exist yet.
       */
      console.error(
        "Unable to read selling price:",
        error
      );
    }

    /*
     * Return providerPrice explicitly because
     * the Admin Dashboard expects this property.
     */
    return res.status(200).json({
      success: true,

      countryId,

      countryName,

      countryCode,

      service,

      selling_price:
        sellingPrice,

      sellingPrice:
        sellingPrice,

      selected,

      providerPrice:
        selected?.providerPrice ?? null,

      price:
        selected?.providerPrice ?? null,

      amount:
        selected?.providerPrice ?? null,

      available:
        selected?.available ?? false,

      servers: results
    });

  } catch (error) {
    console.error(
      "Provider price error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Unable to load provider price."
    });
  }
}
