import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {})
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
      `Supabase request failed (HTTP ${response.status})`
    );
  }

  return data;
}

/* =========================================================
   SERVER DEFINITIONS
   ========================================================= */

const USA_SERVERS = [
  "usa-server-1",
  "usa-server-2"
];

const GLOBAL_SERVERS = [
  "global-server-1",
  "global-server-2"
];

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isUSA(countryId, countryName) {
  const value = normalize(
    `${countryId || ""} ${countryName || ""}`
  );

  return (
    value === "us" ||
    value === "usa" ||
    value.includes("united states") ||
    value.includes("united states of america") ||
    value.includes("usa")
  );
}

function getServers(countryId, countryName) {
  return isUSA(countryId, countryName)
    ? USA_SERVERS
    : GLOBAL_SERVERS;
}

/* =========================================================
   PRICE EXTRACTOR
   ========================================================= */

function extractNormalPrice(data) {
  const possiblePrices = [
    data?.price,
    data?.data?.price,
    data?.amount,
    data?.data?.amount,
    data?.price?.price,
    data?.data?.price?.price
  ];

  for (const value of possiblePrices) {
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

/* =========================================================
   GLOBAL SERVER 2 PRICE
   ========================================================= */

async function getGlobalServer2Price({
  serviceId
}) {
  const data =
    await sureVerificationRequest(
      "/global-server-2/price"
    );

  const prices =
    Array.isArray(data?.prices)
      ? data.prices
      : Array.isArray(data?.data?.prices)
      ? data.data.prices
      : Array.isArray(data)
      ? data
      : [];

  const matches = prices.filter((row) => {
    const id =
      row?.service?.id ??
      row?.service_id ??
      row?.serviceId;

    return String(id) === String(serviceId);
  });

  if (!matches.length) {
    return {
      available: false,
      error:
        "Service is not available on Global Server 2.",
      raw: data
    };
  }

  /*
    Global Server 2 can have multiple price tiers.
    Return every matching tier so the admin can see
    the provider price and available stock.
  */

  const tiers = matches
    .map((row) => ({
      id:
        row?.id ??
        row?.price_id ??
        null,

      price: Number(row?.price),

      stock: Number(
        row?.service?.stocks ??
        row?.stocks ??
        0
      ),

      serviceId:
        row?.service?.id ??
        serviceId,

      serviceName:
        row?.service?.name ??
        ""
    }))
    .filter(
      (row) =>
        Number.isFinite(row.price) &&
        row.price > 0
    );

  if (!tiers.length) {
    return {
      available: false,
      error:
        "Global Server 2 returned no valid price.",
      raw: data
    };
  }

  /*
    Use the lowest available provider price as the
    primary displayed provider price.
  */

  tiers.sort(
    (a, b) => a.price - b.price
  );

  return {
    available: true,
    price: tiers[0].price,
    stock: tiers[0].stock,
    priceTierId: tiers[0].id,
    serviceId: tiers[0].serviceId,
    serviceName: tiers[0].serviceName,
    tiers,
    raw: data
  };
}

/* =========================================================
   NORMAL SERVER PRICE
   ========================================================= */

async function getNormalServerPrice({
  server,
  countryId,
  service
}) {
  const data =
    await sureVerificationRequest(
      `/${server}/price?country_id=${encodeURIComponent(
        countryId
      )}&service=${encodeURIComponent(service)}`
    );

  const price =
    extractNormalPrice(data);

  if (
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return {
      server,
      available: false,
      error:
        "Provider price is not available.",
      raw: data
    };
  }

  return {
    server,
    available: true,
    price,
    raw: data
  };
}

/* =========================================================
   LOAD SAVED SELLING PRICE
   ========================================================= */

async function getSellingPrice({
  countryId,
  service
}) {
  try {
    const rows =
      await supabaseRequest(
        `product_prices?country_id=eq.${encodeURIComponent(
          countryId
        )}&service_id=eq.${encodeURIComponent(
          service
        )}&select=*&limit=1`
      );

    return rows?.[0] || null;
  } catch {
    return null;
  }
}

/* =========================================================
   MAIN HANDLER
   ========================================================= */

export default async function handler(
  req,
  res
) {
  try {
    /*
      GET

      Used by the admin pricing screen:

      Country
        ↓
      Server Options
        ↓
      Service
        ↓
      Provider Price
        ↓
      Selling Price
    */

    if (req.method === "GET") {
      const countryId =
        String(
          req.query?.countryId || ""
        ).trim();

      const countryName =
        String(
          req.query?.countryName || ""
        ).trim();

      const service =
        String(
          req.query?.service || ""
        ).trim();

      const requestedServer =
        String(
          req.query?.server || ""
        ).trim();

      if (!countryId) {
        return res.status(400).json({
          success: false,
          error:
            "countryId is required."
        });
      }

      /*
        If only country is selected,
        return the available server options.
      */

      if (!service && !requestedServer) {
        const servers =
          getServers(
            countryId,
            countryName
          );

        return res.status(200).json({
          success: true,
          countryId,
          countryName,
          serverOptions: servers.map(
            (server) => ({
              id: server,
              name:
                server ===
                "usa-server-1"
                  ? "USA Server 1"
                  : server ===
                    "usa-server-2"
                  ? "USA Server 2"
                  : server ===
                    "global-server-1"
                  ? "Global Server 1"
                  : "Global Server 2"
            })
          )
        });
      }

      if (!service) {
        return res.status(400).json({
          success: false,
          error:
            "service is required."
        });
      }

      const allowedServers =
        getServers(
          countryId,
          countryName
        );

      /*
        If a specific server was selected,
        only query that server.
      */

      const servers =
        requestedServer &&
        allowedServers.includes(
          requestedServer
        )
          ? [requestedServer]
          : allowedServers;

      const results = [];

      for (const server of servers) {
        try {
          let result;

          if (
            server ===
            "global-server-2"
          ) {
            result =
              await getGlobalServer2Price({
                serviceId: service
              });

            result.server = server;
          } else {
            result =
              await getNormalServerPrice({
                server,
                countryId,
                service
              });
          }

          results.push({
            server,
            ...result
          });
        } catch (error) {
          results.push({
            server,
            available: false,
            error:
              error?.message ||
              "Provider price unavailable."
          });
        }
      }

      const saved =
        await getSellingPrice({
          countryId,
          service
        });

      const available =
        results.filter(
          (row) => row.available
        );

      return res.status(200).json({
        success: true,

        countryId,

        countryName,

        service,

        selectedServer:
          requestedServer || null,

        selling_price:
          saved?.selling_price ??
          null,

        savedPricing:
          saved || null,

        servers: results,

        selected:
          requestedServer
            ? results.find(
                (row) =>
                  row.server ===
                  requestedServer
              ) || null
            : available[0] || null
      });
    }

    /*
      POST

      Save the admin's selling price.

      This lets the same price.js API save:

      provider price
      +
      selling price

      into product_prices.
    */

    if (req.method === "POST") {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body)
          : req.body || {};

      const countryId =
        String(
          body.countryId || ""
        ).trim();

      const countryName =
        String(
          body.countryName || ""
        ).trim();

      const serviceId =
        String(
          body.serviceId ||
          body.service ||
          ""
        ).trim();

      const serviceName =
        String(
          body.serviceName || ""
        ).trim();

      const server =
        String(
          body.server || ""
        ).trim();

      const sellingPrice =
        Number(
          body.sellingPrice ??
          body.selling_price
        );

      const providerPrice =
        Number(
          body.providerPrice ??
          body.provider_price
        );

      if (
        !countryId ||
        !serviceId ||
        !serviceName ||
        !Number.isFinite(
          sellingPrice
        ) ||
        sellingPrice <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "countryId, serviceId, serviceName and a valid sellingPrice are required."
        });
      }

      const providerCost =
        Number.isFinite(
          providerPrice
        ) &&
        providerPrice > 0
          ? providerPrice
          : 0;

      const profit =
        providerCost > 0
          ? sellingPrice -
            providerCost
          : sellingPrice;

      /*
        First check if this country/service
        already has a product price.
      */

      const existing =
        await supabaseRequest(
          `product_prices?country_id=eq.${encodeURIComponent(
            countryId
          )}&service_id=eq.${encodeURIComponent(
            serviceId
          )}&select=*&limit=1`
        );

      const payload = {
        country_id: countryId,
        country_name:
          countryName ||
          countryId,
        service_id: serviceId,
        service_name: serviceName,
        selling_price: sellingPrice,
        is_active: true
      };

      /*
        Only add provider columns if your
        product_prices table contains them.
      */

      const existingRow =
        existing?.[0] || null;

      const updatePayload = {
        ...payload
      };

      if (
        existingRow &&
        Object.prototype.hasOwnProperty.call(
          existingRow,
          "provider_price"
        )
      ) {
        updatePayload.provider_price =
          providerCost;
      }

      if (
        existingRow &&
        Object.prototype.hasOwnProperty.call(
          existingRow,
          "provider_server"
        )
      ) {
        updatePayload.provider_server =
          server || null;
      }

      if (
        existingRow &&
        Object.prototype.hasOwnProperty.call(
          existingRow,
          "provider_cost"
        )
      ) {
        updatePayload.provider_cost =
          providerCost;
      }

      if (
        existingRow &&
        Object.prototype.hasOwnProperty.call(
          existingRow,
          "profit"
        )
      ) {
        updatePayload.profit =
          profit;
      }

      let saved;

      if (existingRow?.id) {
        saved =
          await supabaseRequest(
            `product_prices?id=eq.${encodeURIComponent(
              existingRow.id
            )}`,
            {
              method: "PATCH",
              body: updatePayload,
              headers: {
                Prefer:
                  "return=representation"
              }
            }
          );
      } else {
        saved =
          await supabaseRequest(
            "product_prices",
            {
              method: "POST",
              body: updatePayload,
              headers: {
                Prefer:
                  "return=representation"
              }
            }
          );
      }

      return res.status(200).json({
        success: true,
        message:
          "Selling price saved successfully.",
        pricing:
          saved?.[0] || null,
        provider_price:
          providerCost,
        selling_price:
          sellingPrice,
        profit
      });
    }

    return res.status(405).json({
      success: false,
      error:
        "Method not allowed."
    });
  } catch (error) {
    console.error(
      "Price API error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Unable to process pricing request."
    });
  }
}
