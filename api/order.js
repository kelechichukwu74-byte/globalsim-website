// api/order.js

import { createClient } from "@supabase/supabase-js";
import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_SERVERS = [
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
];

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function getProviderServer(body) {
  return (
    body?.providerServer ||
    body?.provider_server ||
    body?.server ||
    ""
  ).trim();
}

function getProviderCountryId(body) {
  return (
    body?.providerCountryId ||
    body?.provider_country_id ||
    body?.providerCountryID ||
    body?.countryProviderId ||
    body?.country_provider_id ||
    ""
  ).trim();
}

function getSupabaseCountryId(body) {
  return (
    body?.countryId ||
    body?.country_id ||
    body?.supabaseCountryId ||
    body?.supabase_country_id ||
    ""
  ).trim();
}

function getServiceId(body) {
  return (
    body?.providerServiceId ||
    body?.provider_service_id ||
    body?.serviceId ||
    body?.service_id ||
    body?.serviceCode ||
    body?.service_code ||
    ""
  ).trim();
}

function getServiceName(body) {
  return (
    body?.serviceName ||
    body?.service_name ||
    ""
  ).trim();
}

function getCountryName(body) {
  return (
    body?.countryName ||
    body?.country_name ||
    ""
  ).trim();
}

function getServerFromCountry(countryName, requestedServer) {
  if (
    requestedServer &&
    ALLOWED_SERVERS.includes(requestedServer)
  ) {
    return requestedServer;
  }

  const country = normalize(countryName);

  if (
    country === "united states" ||
    country === "united states of america" ||
    country === "usa" ||
    country === "us" ||
    country === "america"
  ) {
    return "usa-server-1";
  }

  return "global-server-1";
}

async function getWallet(userId) {
  const { data, error } = await supabase
    .from("wallets")
    .select("id,user_id,balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load wallet: ${error.message}`
    );
  }

  if (!data) {
    throw new Error(
      "Wallet not found for this account."
    );
  }

  return data;
}

async function updateWallet(
  walletId,
  balance
) {
  const { data, error } = await supabase
    .from("wallets")
    .update({
      balance: Number(balance)
    })
    .eq("id", walletId)
    .select("id,user_id,balance")
    .single();

  if (error) {
    throw new Error(
      `Unable to update wallet: ${error.message}`
    );
  }

  return data;
}

async function recordWalletTransaction({
  userId,
  amount,
  balanceBefore,
  balanceAfter,
  description,
  reference
}) {
  const { error } = await supabase
    .from("wallet_transactions")
    .insert({
      user_id: userId,
      amount: Number(amount),
      balance_before: Number(balanceBefore),
      balance_after: Number(balanceAfter),
      description,
      reference
    });

  if (error) {
    console.error(
      "Wallet transaction recording error:",
      error
    );
  }
}

async function findCustomerPrice({
  supabaseCountryId,
  providerCountryId,
  serviceId,
  serviceName,
  server
}) {
  let rows = [];

  /*
   * First use the provider service ID.
   *
   * Example:
   * serviceId = "wa"
   *
   * IMPORTANT:
   * "wa" is NOT a UUID and must never be compared
   * against product_prices.id.
   */

  if (serviceId) {
    let query = supabase
      .from("product_prices")
      .select(
        `
        id,
        country_id,
        country_name,
        service_id,
        service_name,
        selling_price,
        provider_server,
        provider_service_id
        `
      )
      .eq("is_active", true)
      .eq(
        "provider_service_id",
        serviceId
      );

    if (supabaseCountryId) {
      query = query.eq(
        "country_id",
        supabaseCountryId
      );
    }

    if (server) {
      query = query.eq(
        "provider_server",
        server
      );
    }

    const result = await query.limit(1);

    if (result.error) {
      throw new Error(
        `Unable to find customer price: ${result.error.message}`
      );
    }

    rows = result.data || [];
  }

  /*
   * Fallback to service_id ONLY when it is
   * actually a UUID.
   */

  if (!rows.length && isUuid(serviceId)) {
    let query = supabase
      .from("product_prices")
      .select(
        `
        id,
        country_id,
        country_name,
        service_id,
        service_name,
        selling_price,
        provider_server,
        provider_service_id
        `
      )
      .eq("is_active", true)
      .eq("service_id", serviceId);

    if (supabaseCountryId) {
      query = query.eq(
        "country_id",
        supabaseCountryId
      );
    }

    if (server) {
      query = query.eq(
        "provider_server",
        server
      );
    }

    const result = await query.limit(1);

    if (result.error) {
      throw new Error(
        `Unable to find customer price: ${result.error.message}`
      );
    }

    rows = result.data || [];
  }

  /*
   * Final fallback by service name.
   */

  if (!rows.length && serviceName) {
    let query = supabase
      .from("product_prices")
      .select(
        `
        id,
        country_id,
        country_name,
        service_id,
        service_name,
        selling_price,
        provider_server,
        provider_service_id
        `
      )
      .eq("is_active", true)
      .ilike(
        "service_name",
        serviceName
      );

    if (supabaseCountryId) {
      query = query.eq(
        "country_id",
        supabaseCountryId
      );
    }

    if (server) {
      query = query.eq(
        "provider_server",
        server
      );
    }

    const result = await query.limit(1);

    if (result.error) {
      throw new Error(
        `Unable to find customer price: ${result.error.message}`
      );
    }

    rows = result.data || [];
  }

  return rows[0] || null;
}

async function resolveProviderService({
  server,
  providerCountryId,
  serviceId,
  serviceName
}) {
  if (!providerCountryId) {
    throw new Error(
      `${server} requires a provider country_id.`
    );
  }

  const response =
    await sureVerificationRequest(
      `/${server}/services?country_id=${q(
        providerCountryId
      )}`
    );

  const services =
    response?.services ||
    response?.data?.services ||
    [];

  if (!Array.isArray(services)) {
    throw new Error(
      `${server} returned an invalid services response.`
    );
  }

  const wantedId =
    normalize(serviceId);

  const wantedName =
    normalize(serviceName);

  const found =
    services.find(
      (service) =>
        wantedId &&
        normalize(service?.id) === wantedId
    ) ||
    services.find(
      (service) =>
        wantedName &&
        normalize(service?.name) === wantedName
    );

  if (!found) {
    throw new Error(
      `Service "${serviceName || serviceId}" is not available on ${server} for country ${providerCountryId}.`
    );
  }

  return found;
}

async function getProviderPrice({
  server,
  providerCountryId,
  serviceId
}) {
  const response =
    await sureVerificationRequest(
      `/${server}/price?country_id=${q(
        providerCountryId
      )}&service=${q(serviceId)}`
    );

  return response;
}

function extractProviderPrice(response) {
  const possiblePrices = [
    response?.price,
    response?.provider_price,
    response?.data?.price,
    response?.data?.provider_price
  ];

  for (const value of possiblePrices) {
    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !Number.isNaN(Number(value))
    ) {
      return Number(value);
    }
  }

  if (Array.isArray(response?.prices)) {
    const first = response.prices[0];

    if (
      first?.price !== undefined &&
      first?.price !== null
    ) {
      return Number(first.price);
    }
  }

  return null;
}

async function getGlobal2PriceTier({
  serviceId,
  serviceName
}) {
  /*
   * Global Server 2 price endpoint:
   *
   * GET /global-server-2/price
   *
   * It returns:
   *
   * {
   *   prices: [
   *     {
   *       service: {
   *         id: "wa",
   *         name: "Whatsapp",
   *         stocks: 100
   *       },
   *       price: 1604,
   *       id: 1
   *     }
   *   ]
   * }
   */

  const response =
    await sureVerificationRequest(
      "/global-server-2/price"
    );

  const prices =
    response?.prices ||
    response?.data?.prices ||
    [];

  if (!Array.isArray(prices)) {
    throw new Error(
      "Global Server 2 returned an invalid price response."
    );
  }

  const wantedId =
    normalize(serviceId);

  const wantedName =
    normalize(serviceName);

  const matching =
    prices.filter((tier) => {
      const tierService =
        tier?.service || {};

      return (
        (wantedId &&
          normalize(tierService?.id) === wantedId) ||
        (wantedName &&
          normalize(tierService?.name) === wantedName)
      );
    });

  if (!matching.length) {
    throw new Error(
      `Global Server 2 has no price tier for ${serviceName || serviceId}.`
    );
  }

  /*
   * Select a tier that has stock.
   */

  const available =
    matching.find(
      (tier) =>
        Number(tier?.stocks ?? 0) > 0
    );

  return available || matching[0];
}

function extractVerification(purchase) {
  return (
    purchase?.verification ||
    purchase?.data?.verification ||
    purchase?.data ||
    purchase
  );
}

function extractNumber(verification) {
  return (
    verification?.number ||
    verification?.phone_number ||
    verification?.phone ||
    null
  );
}

function extractProviderOrderId(
  verification,
  purchase
) {
  return (
    verification?.request_id ||
    verification?.requestId ||
    purchase?.request_id ||
    purchase?.requestId ||
    verification?.id ||
    purchase?.id ||
    null
  );
}

async function createOrder({
  userId,
  productPrice,
  providerPrice,
  customerPrice,
  providerOrderId,
  phoneNumber,
  status,
  server,
  serviceName,
  countryName
}) {
  const profit =
    Number(customerPrice) -
    Number(providerPrice || 0);

  const { data, error } =
    await supabase
      .from("orders")
      .insert({
        user_id: userId,

        provider_order_id:
          providerOrderId
            ? String(providerOrderId)
            : null,

        service_country_price_id:
          productPrice?.id
            ? String(productPrice.id)
            : null,

        service_name:
          serviceName || null,

        country_name:
          countryName ||
          productPrice?.country_name ||
          null,

        provider_cost:
          Number(providerPrice || 0),

        customer_price:
          Number(customerPrice),

        profit:
          Number(profit),

        status:
          status || "active",

        phone_number:
          phoneNumber || null
      })
      .select("*")
      .single();

  if (error) {
    throw new Error(
      `Unable to create order: ${error.message}`
    );
  }

  return data;
}

async function refundWallet({
  wallet,
  amount,
  userId,
  reason,
  reference
}) {
  const currentBalance =
    Number(wallet.balance || 0);

  const refundAmount =
    Number(amount || 0);

  const newBalance =
    currentBalance + refundAmount;

  await updateWallet(
    wallet.id,
    newBalance
  );

  await recordWalletTransaction({
    userId,
    amount: refundAmount,
    balanceBefore: currentBalance,
    balanceAfter: newBalance,
    description: reason,
    reference
  });

  return newBalance;
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      success: false,
      error:
        "SUPABASE_SERVICE_ROLE_KEY is not configured."
    });
  }

  let charged = false;
  let wallet = null;
  let chargedAmount = 0;
  let userId = null;
  let orderReference = null;

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    /*
     * ----------------------------------------------------
     * AUTHENTICATION
     * ----------------------------------------------------
     */

    const authHeader =
      req.headers.authorization ||
      req.headers.Authorization ||
      "";

    const token =
      authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required."
      });
    }

    const {
      data: {
        user
      },
      error: authError
    } =
      await supabase.auth.getUser(token);

    if (
      authError ||
      !user
    ) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired session."
      });
    }

    userId = user.id;

    /*
     * ----------------------------------------------------
     * INPUT
     * ----------------------------------------------------
     */

    const requestedServer =
      getProviderServer(body);

    const supabaseCountryId =
      getSupabaseCountryId(body);

    const providerCountryId =
      getProviderCountryId(body);

    const requestedServiceId =
      getServiceId(body);

    const requestedServiceName =
      getServiceName(body);

    const requestedCountryName =
      getCountryName(body);

    /*
     * IMPORTANT:
     *
     * The frontend should send:
     *
     * countryId        = Supabase country UUID
     * providerCountryId = SureVerification country ID
     *
     * They are NOT the same thing.
     */

    if (!supabaseCountryId) {
      return res.status(400).json({
        success: false,
        error:
          "countryId is required."
      });
    }

    if (!requestedServiceId &&
        !requestedServiceName) {
      return res.status(400).json({
        success: false,
        error:
          "serviceId or serviceName is required."
      });
    }

    /*
     * ----------------------------------------------------
     * SERVER
     * ----------------------------------------------------
     */

    const server =
      getServerFromCountry(
        requestedCountryName,
        requestedServer
      );

    if (!ALLOWED_SERVERS.includes(server)) {
      return res.status(400).json({
        success: false,
        error:
          `Invalid provider server: ${server}`
      });
    }

    /*
     * ----------------------------------------------------
     * CUSTOMER SELLING PRICE
     * ----------------------------------------------------
     */

    const productPrice =
      await findCustomerPrice({
        supabaseCountryId,
        providerCountryId,
        serviceId: requestedServiceId,
        serviceName: requestedServiceName,
        server
      });

    if (!productPrice) {
      return res.status(404).json({
        success: false,
        error:
          "No selling price has been configured for this country, service and server."
      });
    }

    const customerPrice =
      Number(productPrice.selling_price);

    if (
      !Number.isFinite(customerPrice) ||
      customerPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The selling price for this service is invalid."
      });
    }

    /*
     * ----------------------------------------------------
     * PROVIDER COUNTRY ID
     * ----------------------------------------------------
     */

    /*
     * Prefer the explicit providerCountryId.
     *
     * This is critical for Global Server 2 because
     * SureVerification expects its own country ID,
     * e.g. 236.
     */

    let actualProviderCountryId =
      providerCountryId;

    if (!actualProviderCountryId) {
      /*
       * If the frontend did not send the provider
       * country ID, do NOT send the Supabase UUID
       * to SureVerification.
       *
       * For the current implementation, this must
       * be supplied by the frontend/provider mapping.
       */

      return res.status(400).json({
        success: false,
        error:
          `${server} requires providerCountryId (the SureVerification country ID).`
      });
    }

    /*
     * ----------------------------------------------------
     * RESOLVE PROVIDER SERVICE
     * ----------------------------------------------------
     */

    const providerService =
      await resolveProviderService({
        server,
        providerCountryId:
          actualProviderCountryId,
        serviceId:
          requestedServiceId,
        serviceName:
          requestedServiceName
      });

    const actualServiceId =
      String(providerService.id);

    const actualServiceName =
      providerService.name ||
      requestedServiceName ||
      actualServiceId;

    /*
     * ----------------------------------------------------
     * PROVIDER PRICE
     * ----------------------------------------------------
     */

    let providerCost = 0;
    let global2Tier = null;

    if (server === "global-server-2") {
      /*
       * Global Server 2:
       *
       * GET /global-server-2/price
       *
       * No country_id is supplied to this endpoint
       * according to the documentation.
       */

      global2Tier =
        await getGlobal2PriceTier({
          serviceId:
            actualServiceId,
          serviceName:
            actualServiceName
        });

      providerCost =
        Number(global2Tier?.price || 0);

    } else {
      const priceResponse =
        await getProviderPrice({
          server,
          providerCountryId:
            actualProviderCountryId,
          serviceId:
            actualServiceId
        });

      providerCost =
        Number(
          extractProviderPrice(
            priceResponse
          ) || 0
        );
    }

    /*
     * ----------------------------------------------------
     * WALLET
     * ----------------------------------------------------
     */

    wallet =
      await getWallet(userId);

    const currentBalance =
      Number(wallet.balance || 0);

    if (
      currentBalance < customerPrice
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        balance:
          currentBalance,
        required:
          customerPrice
      });
    }

    /*
     * ----------------------------------------------------
     * DEDUCT WALLET
     * ----------------------------------------------------
     */

    const balanceAfterCharge =
      currentBalance -
      customerPrice;

    await updateWallet(
      wallet.id,
      balanceAfterCharge
    );

    charged = true;
    chargedAmount = customerPrice;

    orderReference =
      `order-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 8)}`;

    await recordWalletTransaction({
      userId,
      amount:
        -customerPrice,
      balanceBefore:
        currentBalance,
      balanceAfter:
        balanceAfterCharge,
      description:
        `Number purchase - ${actualServiceName} - ${requestedCountryName || productPrice.country_name || ""}`,
      reference:
        orderReference
    });

    /*
     * ----------------------------------------------------
     * PURCHASE
     * ----------------------------------------------------
     */

    let purchase;

    if (server === "global-server-2") {
      /*
       * ==================================================
       * GLOBAL SERVER 2
       * ==================================================
       *
       * SureVerification:
       *
       * POST
       * /api/v1/global-server-2/purchase
       *
       * The country ID MUST be the provider country ID.
       *
       * Example:
       *
       * country_id = 236
       * service    = wa
       * id         = 1
       *
       * We send them as query parameters because the
       * provider endpoint is a POST endpoint and the
       * API is validating these fields.
       */

      const purchasePath =
        `/global-server-2/purchase` +
        `?country_id=${q(
          actualProviderCountryId
        )}` +
        `&service=${q(
          actualServiceId
        )}` +
        `&id=${q(
          global2Tier.id
        )}`;

      purchase =
        await sureVerificationRequest(
          purchasePath,
          {
            method: "POST",
            headers: {
              Accept:
                "application/json"
            }
          }
        );

    } else {
      /*
       * ==================================================
       * OTHER THREE SERVERS
       * ==================================================
       */

      purchase =
        await sureVerificationRequest(
          `/${server}/purchase` +
          `?country_id=${q(
            actualProviderCountryId
          )}` +
          `&service=${q(
            actualServiceId
          )}`,
          {
            method: "POST",
            headers: {
              Accept:
                "application/json"
            }
          }
        );
    }

    /*
     * ----------------------------------------------------
     * PROVIDER RESPONSE
     * ----------------------------------------------------
     */

    const verification =
      extractVerification(
        purchase
      );

    const phoneNumber =
      extractNumber(
        verification
      );

    const providerOrderId =
      extractProviderOrderId(
        verification,
        purchase
      );

    const status =
      verification?.status ||
      purchase?.status ||
      "active";

    /*
     * If provider did not actually return a number,
     * treat the purchase as failed and refund.
     */

    if (!phoneNumber) {
      throw new Error(
        purchase?.message ||
        "Provider did not return a phone number."
      );
    }

    /*
     * ----------------------------------------------------
     * SAVE ORDER
     * ----------------------------------------------------
     */

    const order =
      await createOrder({
        userId,

        productPrice,

        providerPrice:
          providerCost,

        customerPrice,

        providerOrderId,

        phoneNumber,

        status,

        server,

        serviceName:
          actualServiceName,

        countryName:
          requestedCountryName ||
          productPrice.country_name
      });

    /*
     * ----------------------------------------------------
     * SUCCESS
     * ----------------------------------------------------
     */

    return res.status(200).json({
      success: true,

      message:
        purchase?.message ||
        "Number purchased successfully.",

      server,

      countryId:
        actualProviderCountryId,

      serviceId:
        actualServiceId,

      serviceName:
        actualServiceName,

      price:
        customerPrice,

      providerPrice:
        providerCost,

      balance:
        balanceAfterCharge,

      order,

      verification
    });

  } catch (error) {
    console.error(
      "Number purchase error:",
      error
    );

    /*
     * ----------------------------------------------------
     * REFUND IF MONEY WAS ALREADY DEDUCTED
     * ----------------------------------------------------
     */

    if (
      charged &&
      wallet &&
      userId &&
      chargedAmount > 0
    ) {
      try {
        const { data: currentWallet } =
          await supabase
            .from("wallets")
            .select(
              "id,user_id,balance"
            )
            .eq(
              "id",
              wallet.id
            )
            .single();

        if (currentWallet) {
          await refundWallet({
            wallet:
              currentWallet,

            amount:
              chargedAmount,

            userId,

            reason:
              "Refund for failed number purchase",

            reference:
              orderReference ||
              `refund-${Date.now()}`
          });
        }
      } catch (refundError) {
        console.error(
          "CRITICAL: Wallet refund failed:",
          refundError
        );
      }
    }

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Unable to purchase number."
    });
  }
}
