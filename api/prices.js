import {
  getServersForCountry,
  sureVerificationRequest,
  quote,
  getProviderPrice
} from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed."
      });
    }

    const {
      countryId,
      countryCode,
      countryName,
      service
    } = req.query || {};

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

    const servers = getServersForCountry(
      countryCode || countryName
    );

    const results = [];

    for (const server of servers) {
      try {
        const path =
          `/${server}/price` +
          `?country_id=${quote(countryId)}` +
          `&service=${quote(service)}`;

        const providerResponse =
          await sureVerificationRequest(path);

        const providerPrice =
          getProviderPrice(providerResponse);

        results.push({
          server,
          providerPrice,
          available: providerPrice !== null,
          raw: providerResponse
        });

      } catch (error) {
        results.push({
          server,
          providerPrice: null,
          available: false,
          error: error.message
        });
      }
    }

    const available = results.filter(
      row =>
        row.available &&
        Number(row.providerPrice) > 0
    );

    /*
      USA Server 2 is intentionally first.
      Therefore, when USA Server 2 has a valid
      price, it becomes the selected provider.
    */
    const selected =
      available.length > 0
        ? available[0]
        : null;

    return res.status(200).json({
      success: true,

      countryId,
      countryCode: countryCode || "",
      countryName: countryName || "",

      servers: results.map(row => ({
        server: row.server,
        providerPrice: row.providerPrice,
        available: row.available,
        error: row.error || null
      })),

      selected: selected
        ? {
            server: selected.server,
            providerPrice: selected.providerPrice
          }
        : null
    });

  } catch (error) {
    console.error("prices.js error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Unable to retrieve provider prices."
    });
  }
}
