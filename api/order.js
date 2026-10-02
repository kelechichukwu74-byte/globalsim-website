import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_SERVERS = new Set([
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
]);

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}

/* =========================================================
   AUTH
   ========================================================= */

function getBearerToken(req) {
  const raw =
    req?.headers?.authorization ||
    req?.headers?.Authorization ||
    "";

  const match =
    String(raw).match(/^Bearer\s+(.+)$/i);

  return match
    ? match[1].trim()
    : "";
}

async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey:
          SUPABASE_PUBLISHABLE_KEY,
        Authorization:
          `Bearer ${token}`,
        Accept:
          "application/json"
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
    data = {};
  }

  if (
    !response.ok ||
    !data?.id
  ) {
    throw new Error("Unauthorized.");
  }

  return data;
}

/* =========================================================
   SUPABASE REST
   ========================================================= */

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
        method:
          options.method ||
          "GET",

        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            "application/json",

          Accept:
            "application/json",

          Prefer:
            options.prefer ||
            "return=representation",

          ...(options.headers || {})
        },

        ...(options.body !== undefined
          ? {
              body:
                options.body
            }
          : {})
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
      data?.error ||
      data?.hint ||
      data?.details ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}

/* =========================================================
   HELPERS
   ========================================================= */

function isUSA(
  countryId,
  countryCode,
  countryName
) {
  const id =
    String(countryId ?? "")
      .trim();

  const code =
    String(countryCode ?? "")
      .trim()
      .toLowerCase();

  const name =
    String(countryName ?? "")
      .trim()
      .toLowerCase();

  return (
    id === "236" ||
    code === "us" ||
    code === "usa" ||
    name === "us" ||
    name === "usa" ||
    name === "united states" ||
    name ===
      "united states of america"
  );
}

function getServices(data) {
  if (
    Array.isArray(
      data?.services
    )
  ) {
    return data.services;
  }

  if (
    Array.isArray(
      data?.data?.services
    )
  ) {
    return data.data.services;
  }

  if (
    Array.isArray(
      data?.data
    )
  ) {
    return data.data;
  }

  return [];
}

function findProviderService(
  data,
  requestedId,
  requestedName
) {
  const services =
    getServices(data);

  if (!services.length) {
    return null;
  }

  const id =
    String(requestedId ?? "")
      .trim()
      .toLowerCase();

  const name =
    String(requestedName ?? "")
      .trim()
      .toLowerCase();

  /* Exact provider service ID */
  if (id) {
    const exactId =
      services.find(
        item =>
          String(
            item?.id ?? ""
          )
            .trim()
            .toLowerCase() === id
      );

    if (exactId) {
      return exactId;
    }
  }

  /* Exact provider service name */
  if (name) {
    const exactName =
      services.find(
        item =>
          String(
            item?.name ?? ""
          )
            .trim()
            .toLowerCase() === name
      );

    if (exactName) {
      return exactName;
    }
  }

  /* Partial name */
  if (name) {
    const partial =
      services.find(
        item => {
          const providerName =
            String(
              item?.name ?? ""
            )
              .trim()
              .toLowerCase();

          return (
            providerName &&
            (
              providerName.includes(
                name
              ) ||
              name.includes(
                providerName
              )
            )
          );
        }
      );

    if (partial) {
      return partial;
    }
  }

  return null;
}

/* =========================================================
   VERIFICATION RESPONSE
   ========================================================= */

function getVerification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data ||
    {}
  );
}

function getVerificationId(data) {
  const verification =
    getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
    verification?.verification_id ??
    verification?.verificationId ??
    verification?.id ??
    null
  );
}

function getPhoneNumber(data) {
  const verification =
    getVerification(data);

  return (
    verification?.number ??
    verification?.phone_number ??
    verification?.phoneNumber ??
    verification?.phone ??
    null
  );
}

function getExpiredAt(data) {
  const verification =
    getVerification(data);

  return (
    verification?.expired_at ??
    verification?.expiredAt ??
    null
  );
}

function getProviderPrice(data) {
  const possibleValues = [
    data?.price,
    data?.data?.price,
    data?.amount,
    data?.data?.amount,
    data?.price?.price,
    data?.data?.price?.price
  ];

  for (
    const value of possibleValues
  ) {
    const number =
      Number(value);

    if (
      Number.isFinite(number)
    ) {
      return number;
    }
  }

  return null;
}

/* =========================================================
   PROVIDER SERVICES
   ========================================================= */

async function resolveProviderService({
  server,
  countryId,
  serviceId,
  serviceName
}) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${q(countryId)}`,
      {
        method: "GET"
      }
    );

  const service =
    findProviderService(
      data,
      serviceId,
      serviceName
    );

  if (!service?.id) {
    throw new Error(
      `${server} does not have the selected service for country ${countryId}.`
    );
  }

  return service;
}

/* =========================================================
   GLOBAL SERVER 2 PRICE TIERS
   ========================================================= */

async function getGlobal2PriceTier({
  serviceId,
  serviceName
}) {
  const data =
    await sureVerificationRequest(
      "/global-server-2/price",
      {
        method: "GET"
      }
    );

  const prices =
    Array.isArray(
      data?.prices
    )
      ? data.prices
      : Array.isArray(
          data?.data?.prices
        )
        ? data.data.prices
        : [];

  if (!prices.length) {
    throw new Error(
      "Global Server 2 returned no price tiers."
    );
  }

  const wantedId =
    String(serviceId ?? "")
      .trim()
      .toLowerCase();

  const wantedName =
    String(serviceName ?? "")
      .trim()
      .toLowerCase();

  let matches =
    prices.filter(
      row => {
        const providerId =
          String(
            row?.service?.id ??
            ""
          )
            .trim()
            .toLowerCase();

        const providerName =
          String(
            row?.service?.name ??
            ""
          )
            .trim()
            .toLowerCase();

        return (
          (
            wantedId &&
            providerId ===
              wantedId
          ) ||
          (
            wantedName &&
            providerName ===
              wantedName
          )
        );
      }
    );

  if (!matches.length) {
    matches =
      prices.filter(
        row => {
          const providerName =
            String(
              row?.service?.name ??
              ""
            )
              .trim()
              .toLowerCase();

          return (
            wantedName &&
            providerName &&
            (
              providerName.includes(
                wantedName
              ) ||
              wantedName.includes(
                providerName
              )
            )
          );
        }
      );
  }

  if (!matches.length) {
    throw new Error(
      `Global Server 2 has no price tier for "${serviceName || serviceId}".`
    );
  }

  const available =
    matches.filter(
      row => {
        const stock =
          Number(
            row?.service?.stocks
          );

        return (
          !Number.isFinite(stock) ||
          stock > 0
        );
      }
    );

  const selected =
    available[0] ||
    matches[0];

  if (
    selected?.id ===
      undefined ||
    selected?.id ===
      null
  ) {
    throw new Error(
      "Global Server 2 returned an invalid price-tier ID."
    );
  }

  return selected;
}

/* =========================================================
   PROVIDER PURCHASE
   ========================================================= */

async function purchaseFromProvider({
  providerServer,
  countryId,
  serviceId,
  serviceName
}) {
  const server =
    String(
      providerServer || ""
    )
      .trim()
      .toLowerCase();

  if (
    !ALLOWED_SERVERS.has(
      server
    )
  ) {
    throw new Error(
      `Invalid provider server "${providerServer}".`
    );
  }

  /*
   * =======================================================
   * GLOBAL SERVER 2
   * =======================================================
   *
   * Global Server 2 uses a price-tier ID.
   *
   * The official documentation shows:
   *
   * POST /global-server-2/purchase
   *
   * with optional price-tier "id".
   */

  if (
    server ===
    "global-server-2"
  ) {
    const providerService =
      await resolveProviderService({
        server,
        countryId,
        serviceId,
        serviceName
      });

    const priceTier =
      await getGlobal2PriceTier({
        serviceId:
          providerService.id,
        serviceName:
          providerService.name
      });

    const tierId =
      priceTier.id;

    /*
     * Primary documented request.
     *
     * Do NOT send country_id/service here.
     */
    const response =
      await sureVerificationRequest(
        `/global-server-2/purchase?id=${q(tierId)}`,
        {
          method: "POST"
        }
      );

    return {
      data:
        response,

      providerServiceId:
        providerService.id,

      providerServiceName:
        providerService.name,

      providerPrice:
        Number.isFinite(
          Number(
            priceTier.price
          )
        )
          ? Number(
              priceTier.price
            )
          : getProviderPrice(
              response
            ),

      priceTierId:
        tierId
    };
  }

  /*
   * =======================================================
   * USA 1
   * USA 2
   * GLOBAL 1
   * =======================================================
   *
   * These use:
   *
   * /services?country_id=...
   * /price?country_id=...&service=...
   * /purchase?country_id=...&service=...
   */

  const providerService =
    await resolveProviderService({
      server,
      countryId,
      serviceId,
      serviceName
    });

  let providerPrice =
    null;

  try {
    const priceData =
      await sureVerificationRequest(
        `/${server}/price` +
        `?country_id=${q(countryId)}` +
        `&service=${q(providerService.id)}`,
        {
          method: "GET"
        }
      );

    providerPrice =
      getProviderPrice(
        priceData
      );
  } catch (
    priceError
  ) {
    console.warn(
      `${server} price lookup failed:`,
      priceError?.message ||
        priceError
    );
  }

  const response =
    await sureVerificationRequest(
      `/${server}/purchase` +
      `?country_id=${q(countryId)}` +
      `&service=${q(providerService.id)}`,
      {
        method: "POST"
      }
    );

  return {
    data:
      response,

    providerServiceId:
      providerService.id,

    providerServiceName:
      providerService.name,

    providerPrice:
      providerPrice ??
      getProviderPrice(
        response
      )
  };
}

/* =========================================================
   PRODUCT PRICE LOOKUP
   ========================================================= */

async function findCustomerPrice({
  pricingId,
  countryName,
  providerServer,
  providerServiceId,
  serviceName
}) {
  const server =
    String(
      providerServer || ""
    ).trim();

  const country =
    String(
      countryName || ""
    ).trim();

  const providerId =
    String(
      providerServiceId || ""
    ).trim();

  const service =
    String(
      serviceName || ""
    ).trim();

  /*
   * -------------------------------------------------------
   * 1. If frontend supplied the actual product_prices ID,
   *    use it first.
   * -------------------------------------------------------
   */

  if (pricingId) {
    const rows =
      await supabaseRequest(
        `product_prices` +
        `?id=eq.${q(pricingId)}` +
        `&is_active=eq.true` +
        `&select=*` +
        `&limit=1`
      );

    const row =
      rows?.[0];

    if (row) {
      /*
       * Do not accidentally use another server's
       * selling price.
       */
      if (
        row.provider_server &&
        server &&
        String(
          row.provider_server
        )
          .trim()
          .toLowerCase() !==
          server.toLowerCase()
      ) {
        throw new Error(
          "The selected price belongs to a different provider server."
        );
      }

      return row;
    }
  }

  /*
   * -------------------------------------------------------
   * 2. Match country + server + provider service ID
   * -------------------------------------------------------
   */

  if (
    country &&
    server &&
    providerId
  ) {
    let rows =
      await supabaseRequest(
        `product_prices` +
        `?country_name=ilike.${q(country)}` +
        `&provider_server=eq.${q(server)}` +
        `&provider_service_id=eq.${q(providerId)}` +
        `&is_active=eq.true` +
        `&select=*` +
        `&limit=1`
      );

    if (rows?.[0]) {
      return rows[0];
    }

    /*
     * Older database rows may use service_id.
     */
    rows =
      await supabaseRequest(
        `product_prices` +
        `?country_name=ilike.${q(country)}` +
        `&provider_server=eq.${q(server)}` +
        `&service_id=eq.${q(providerId)}` +
        `&is_active=eq.true` +
        `&select=*` +
        `&limit=1`
      );

    if (rows?.[0]) {
      return rows[0];
    }
  }

  /*
   * -------------------------------------------------------
   * 3. Match country + server + service name
   * -------------------------------------------------------
   */

  if (
    country &&
    server &&
    service
  ) {
    const rows =
      await supabaseRequest(
        `product_prices` +
        `?country_name=ilike.${q(country)}` +
        `&provider_server=eq.${q(server)}` +
        `&service_name=ilike.${q(service)}` +
        `&is_active=eq.true` +
        `&select=*` +
        `&limit=1`
      );

    if (rows?.[0]) {
      return rows[0];
    }
  }

  /*
   * -------------------------------------------------------
   * 4. Last legacy fallback
   * -------------------------------------------------------
   */

  if (
    country &&
    service
  ) {
    const rows =
      await supabaseRequest(
        `product_prices` +
        `?country_name=ilike.${q(country)}` +
        `&service_name=ilike.${q(service)}` +
        `&is_active=eq.true` +
        `&select=*` +
        `&limit=1`
      );

    if (rows?.[0]) {
      return rows[0];
    }
  }

  return null;
}

/* =========================================================
   WALLET DEBIT
   ========================================================= */

async function debitWallet(
  userId,
  amount
) {
  const requiredAmount =
    Number(amount);

  if (
    !Number.isFinite(
      requiredAmount
    ) ||
    requiredAmount <= 0
  ) {
    throw new Error(
      "Invalid purchase amount."
    );
  }

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const rows =
      await supabaseRequest(
        `wallets?user_id=eq.${q(userId)}` +
        `&select=user_id,balance` +
        `&limit=1`
      );

    const wallet =
      rows?.[0];

    if (!wallet) {
      throw new Error(
        "Wallet not found. Please contact support."
      );
    }

    const currentBalance =
      Number(
        wallet.balance || 0
      );

    if (
      !Number.isFinite(
        currentBalance
      )
    ) {
      throw new Error(
        "Unable to read wallet balance."
      );
    }

    if (
      currentBalance <
      requiredAmount
    ) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    const newBalance =
      currentBalance -
      requiredAmount;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${q(userId)}` +
        `&balance=eq.${q(currentBalance)}`,
        {
          method: "PATCH",

          body:
            JSON.stringify({
              balance:
                newBalance,

              updated_at:
                new Date()
                  .toISOString()
            })
        }
      );

    if (
      Array.isArray(updated) &&
      updated.length > 0
    ) {
      return {
        previousBalance:
          currentBalance,

        newBalance
      };
    }
  }

  throw new Error(
    "Wallet is being updated by another transaction. Please try again."
  );
}

/* =========================================================
   WALLET REFUND
   ========================================================= */

async function refundWallet(
  userId,
  amount
) {
  const refundAmount =
    Number(amount);

  if (
    !Number.isFinite(
      refundAmount
    ) ||
    refundAmount <= 0
  ) {
    return null;
  }

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const rows =
      await supabaseRequest(
        `wallets?user_id=eq.${q(userId)}` +
        `&select=user_id,balance` +
        `&limit=1`
      );

    const wallet =
      rows?.[0];

    if (!wallet) {
      throw new Error(
        "Wallet not found while processing refund."
      );
    }

    const currentBalance =
      Number(
        wallet.balance || 0
      );

    const newBalance =
      currentBalance +
      refundAmount;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${q(userId)}` +
        `&balance=eq.${q(currentBalance)}`,
        {
          method: "PATCH",

          body:
            JSON.stringify({
              balance:
                newBalance,

              updated_at:
                new Date()
                  .toISOString()
            })
        }
      );

    if (
      Array.isArray(updated) &&
      updated.length > 0
    ) {
      return {
        previousBalance:
          currentBalance,

        newBalance
      };
    }
  }

  throw new Error(
    "Unable to complete wallet refund automatically."
  );
}

/* =========================================================
   WALLET TRANSACTION
   ========================================================= */

async function createWalletTransaction({
  userId,
  amount,
  balanceAfter,
  description
}) {
  try {
    await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",

        body:
          JSON.stringify({
            user_id:
              userId,

            amount:
              amount,

            balance_after:
              balanceAfter,

            type:
              "order",

            description:
              description
          })
      }
    );
  } catch (error) {
    console.error(
      "Wallet transaction history error:",
      error
    );
  }
}

/* =========================================================
   ORDER
   ========================================================= */

async function createOrder(
  userId,
  order
) {
  const providerCost =
    Number.isFinite(
      Number(
        order.providerPrice
      )
    )
      ? Number(
          order.providerPrice
        )
      : 0;

  const sellingPrice =
    Number(
      order.sellingPrice
    );

  const row = {
    user_id:
      userId,

    provider_order_id:
      order.verificationId,

    service_country_price_id:
      order.serviceCountryPriceId,

    service_name:
      order.serviceName,

    country_name:
      order.countryName,

    provider_cost:
      providerCost,

    customer_price:
      sellingPrice,

    profit:
      sellingPrice -
      providerCost,

    status:
      order.status ||
      "active",

    phone_number:
      order.phoneNumber,

    provider_server:
      order.providerServer
  };

  return await supabaseRequest(
    "orders",
    {
      method: "POST",

      body:
        JSON.stringify(row)
    }
  );
}

/* =========================================================
   MAIN HANDLER
   ========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method !==
    "POST"
  ) {
    return res.status(405).json({
      success:
        false,

      error:
        "Method not allowed."
    });
  }

  let user =
    null;

  let debited =
    false;

  let debitAmount =
    0;

  try {
    user =
      await getAuthenticatedUser(
        req
      );

    const body =
      req.body || {};

    /*
     * Provider country ID.
     *
     * Example:
     * 236 = United States
     *
     * This is NOT the Supabase
     * product_prices.country_id UUID.
     */

    const providerCountryId =
      String(
        body.countryId ??
        body.country_id ??
        ""
      ).trim();

    const countryName =
      String(
        body.countryName ??
        body.country_name ??
        ""
      ).trim();

    const countryCode =
      String(
        body.countryCode ??
        body.country_code ??
        ""
      ).trim();

    const providerServer =
      String(
        body.providerServer ??
        body.provider_server ??
        ""
      )
        .trim()
        .toLowerCase();

    /*
     * IMPORTANT:
     *
     * These are deliberately separate.
     *
     * pricingId =
     *    Supabase product_prices.id
     *
     * serviceId =
     *    SureVerification provider service ID
     */

    const pricingId =
      String(
        body.serviceCountryPriceId ??
        body.productPriceId ??
        body.priceId ??
        ""
      ).trim();

    const requestedServiceId =
      String(
        body.providerServiceId ??
        body.serviceId ??
        body.service_id ??
        ""
      ).trim();

    const requestedServiceName =
      String(
        body.serviceName ??
        body.service_name ??
        ""
      ).trim();

    if (!providerCountryId) {
      return res.status(400).json({
        success:
          false,

        error:
          "Country is required.",

        message:
          "Country is required."
      });
    }

    if (
      !requestedServiceId &&
      !requestedServiceName
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "Service is required.",

        message:
          "Service is required."
      });
    }

    /*
     * Determine server.
     */

    let server =
      providerServer;

    if (!server) {
      server =
        isUSA(
          providerCountryId,
          countryCode,
          countryName
        )
          ? "usa-server-2"
          : "global-server-2";
    }

    if (
      !ALLOWED_SERVERS.has(
        server
      )
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          `Invalid provider server "${server}".`
      });
    }

    /*
     * -------------------------------------------------------
     * STEP 1
     * Resolve the actual provider service.
     *
     * This prevents a Supabase price-row UUID from being
     * accidentally sent as the provider service ID.
     * -------------------------------------------------------
     */

    const providerService =
      await resolveProviderService({
        server,

        countryId:
          providerCountryId,

        serviceId:
          requestedServiceId,

        serviceName:
          requestedServiceName
      });

    const actualProviderServiceId =
      String(
        providerService.id
      ).trim();

    const actualProviderServiceName =
      String(
        providerService.name ||
        requestedServiceName ||
        requestedServiceId
      ).trim();

    /*
     * -------------------------------------------------------
     * STEP 2
     * Find the customer selling price.
     * -------------------------------------------------------
     */

    const pricing =
      await findCustomerPrice({
        pricingId,

        countryName,

        providerServer:
          server,

        providerServiceId:
          actualProviderServiceId,

        serviceName:
          actualProviderServiceName
      });

    if (!pricing) {
      return res.status(400).json({
        success:
          false,

        error:
          "This country and service is not currently available for purchase.",

        message:
          "No active selling price was found for this country, service and provider."
      });
    }

    const sellingPrice =
      Number(
        pricing.selling_price
      );

    if (
      !Number.isFinite(
        sellingPrice
      ) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "This country and service does not have a valid selling price.",

        message:
          "The administrator must set a selling price before this number can be purchased."
      });
    }

    /*
     * -------------------------------------------------------
     * STEP 3
     * Debit customer wallet.
     * -------------------------------------------------------
     */

    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited =
      true;

    debitAmount =
      sellingPrice;

    /*
     * -------------------------------------------------------
     * STEP 4
     * Purchase from provider.
     * -------------------------------------------------------
     */

    let providerResult;

    try {
      providerResult =
        await purchaseFromProvider({
          providerServer:
            server,

          countryId:
            providerCountryId,

          serviceId:
            actualProviderServiceId,

          serviceName:
            actualProviderServiceName
        });
    } catch (
      providerError
    ) {
      console.error(
        "SureVerification purchase error:",
        providerError
      );

      /*
       * Provider failed.
       * Refund customer immediately.
       */

      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (
        refundError
      ) {
        console.error(
          "Automatic refund failed:",
          refundError
        );
      }

      debited =
        false;

      throw providerError;
    }

    const providerData =
      providerResult?.data ||
      {};

    const verification =
      getVerification(
        providerData
      );

    const verificationId =
      getVerificationId(
        providerData
      );

    const phoneNumber =
      getPhoneNumber(
        providerData
      );

    const expiredAt =
      getExpiredAt(
        providerData
      );

    /*
     * Provider must return both request ID
     * and number.
     */

    if (
      !verificationId ||
      !phoneNumber
    ) {
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (
        refundError
      ) {
        console.error(
          "Refund after incomplete provider response failed:",
          refundError
        );
      }

      debited =
        false;

      throw new Error(
        "The provider did not return a valid number. Your wallet was refunded."
      );
    }

    const providerPrice =
      Number.isFinite(
        Number(
          providerResult?.providerPrice
        )
      )
        ? Number(
            providerResult.providerPrice
          )
        : getProviderPrice(
            providerData
          );

    /*
     * -------------------------------------------------------
     * STEP 5
     * Save order.
     * -------------------------------------------------------
     */

    const orderRows =
      await createOrder(
        user.id,
        {
          verificationId,

          serviceCountryPriceId:
            pricing.id ||
            pricingId,

          serviceName:
            pricing.service_name ||
            actualProviderServiceName,

          countryName:
            pricing.country_name ||
            countryName,

          providerPrice,

          sellingPrice,

          providerServer:
            server,

          phoneNumber,

          status:
            verification.status ||
            "active",

          expiredAt
        }
      );

    /*
     * -------------------------------------------------------
     * STEP 6
     * Read final wallet balance.
     * -------------------------------------------------------
     */

    const walletRows =
      await supabaseRequest(
        `wallets?user_id=eq.${q(user.id)}` +
        `&select=balance` +
        `&limit=1`
      );

    const balanceAfter =
      Number(
        walletRows?.[0]?.balance ||
        0
      );

    /*
     * -------------------------------------------------------
     * STEP 7
     * Save wallet transaction.
     * -------------------------------------------------------
     */

    await createWalletTransaction({
      userId:
        user.id,

      amount:
        -sellingPrice,

      balanceAfter,

      description:
        `Purchase: ${
          actualProviderServiceName
        } ${
          phoneNumber
        }`
    });

    /*
     * Purchase completed.
     */

    debited =
      false;

    return res.status(200).json({
      success:
        true,

      message:
        "Number purchased successfully.",

      order:
        orderRows?.[0] ||
        null,

      verification: {
        ...verification,

        request_id:
          verificationId,

        number:
          phoneNumber,

        expired_at:
          expiredAt
      },

      provider_server:
        server,

      provider_service_id:
        actualProviderServiceId,

      provider_service_name:
        actualProviderServiceName,

      provider_price:
        providerPrice,

      selling_price:
        sellingPrice,

      balance:
        balanceAfter
    });

  } catch (error) {
    console.error(
      "Order purchase error:",
      error
    );

    /*
     * Safety refund if something failed after
     * the initial debit.
     */

    if (
      debited &&
      user?.id &&
      debitAmount > 0
    ) {
      try {
        await refundWallet(
          user.id,
          debitAmount
        );
      } catch (
        refundError
      ) {
        console.error(
          "Safety refund failed:",
          refundError
        );
      }
    }

    const message =
      error?.message ||
      "Unable to purchase number.";

    if (
      String(message)
        .toLowerCase()
        .includes(
          "insufficient"
        )
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "Insufficient wallet balance.",

        message:
          "Insufficient wallet balance."
      });
    }

    if (
      message ===
      "Unauthorized."
    ) {
      return res.status(401).json({
        success:
          false,

        error:
          "Unauthorized.",

        message:
          "Unauthorized."
      });
    }

    return res.status(500).json({
      success:
        false,

      error:
        message,

      message:
        message
    });
  }
}
