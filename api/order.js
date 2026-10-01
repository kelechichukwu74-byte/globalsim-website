// api/order.js

import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const PROVIDER_BASE_URL =
  "https://sureverifications.com/api/v1";


// ============================================================
// BASIC HELPERS
// ============================================================

function quote(value) {
  return encodeURIComponent(String(value ?? ""));
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeServer(value) {
  const server = normalize(value);

  if (
    server === "usa1" ||
    server === "usa server 1" ||
    server === "usa-server-1"
  ) {
    return "usa-server-1";
  }

  if (
    server === "usa2" ||
    server === "usa server 2" ||
    server === "usa-server-2"
  ) {
    return "usa-server-2";
  }

  if (
    server === "global1" ||
    server === "global server 1" ||
    server === "global-server-1"
  ) {
    return "global-server-1";
  }

  if (
    server === "global2" ||
    server === "global server 2" ||
    server === "global-server-2"
  ) {
    return "global-server-2";
  }

  return server;
}

function isUSA(countryId, countryCode, countryName) {
  const id = normalize(countryId);
  const code = normalize(countryCode);
  const name = normalize(countryName);

  return (
    id === "236" ||
    code === "us" ||
    code === "usa" ||
    name === "us" ||
    name === "usa" ||
    name === "united states" ||
    name === "united states of america"
  );
}

function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header) {
    return null;
  }

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();

  return token || null;
}


// ============================================================
// SUPABASE AUTH
// ============================================================

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
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error("Unauthorized.");
  }

  const user = await response.json();

  if (!user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}


// ============================================================
// SUPABASE REST
// ============================================================

async function supabaseRequest(
  path,
  {
    method = "GET",
    body,
    headers = {}
  } = {}
) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers
      },
      ...(body !== undefined
        ? {
            body: JSON.stringify(body)
          }
        : {})
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error_description ||
      data?.error ||
      text ||
      `Supabase returned HTTP ${response.status}.`;

    throw new Error(message);
  }

  return data;
}


// ============================================================
// PROVIDER RESPONSE HELPERS
// ============================================================

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
  const verification = getVerification(data);

  return (
    verification?.id ??
    verification?.verification_id ??
    verification?.verificationId ??
    data?.verification_id ??
    data?.verificationId ??
    data?.id ??
    null
  );
}

function getRequestId(data) {
  const verification = getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
    data?.request_id ??
    data?.requestId ??
    null
  );
}

function getPhoneNumber(data) {
  const verification = getVerification(data);

  return (
    verification?.number ??
    verification?.phone_number ??
    verification?.phoneNumber ??
    verification?.phone ??
    data?.number ??
    data?.phone_number ??
    data?.phoneNumber ??
    data?.phone ??
    null
  );
}

function getExpiredAt(data) {
  const verification = getVerification(data);

  return (
    verification?.expired_at ??
    verification?.expiredAt ??
    data?.expired_at ??
    data?.expiredAt ??
    null
  );
}

function getProviderStatus(data) {
  const verification = getVerification(data);

  return (
    verification?.status ||
    data?.status ||
    "active"
  );
}

function getProviderServiceName(data) {
  const verification = getVerification(data);

  return (
    verification?.service ||
    data?.service ||
    null
  );
}


// ============================================================
// PRICE HELPERS
// ============================================================

function numberValue(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return NaN;
  }

  return number;
}

function getNormalServerPrice(data) {
  const possibleValues = [
    data?.price?.price,
    data?.price,
    data?.data?.price?.price,
    data?.data?.price,
    data?.amount,
    data?.data?.amount
  ];

  for (const value of possibleValues) {
    const number = numberValue(value);

    if (Number.isFinite(number) && number >= 0) {
      return number;
    }
  }

  return NaN;
}

function getGlobalServer2Price(
  data,
  providerServiceId,
  requestedServiceName
) {
  const prices = Array.isArray(data?.prices)
    ? data.prices
    : Array.isArray(data?.data?.prices)
      ? data.data.prices
      : [];

  if (!prices.length) {
    return {
      price: NaN,
      tierId: null,
      service: null,
      stocks: null
    };
  }

  const wantedId = normalize(providerServiceId);
  const wantedName = normalize(requestedServiceName);

  let matches = prices.filter((row) => {
    const service = row?.service || {};

    const serviceId = normalize(service?.id);
    const serviceName = normalize(service?.name);

    return (
      (wantedId && serviceId === wantedId) ||
      (wantedName && serviceName === wantedName)
    );
  });

  if (!matches.length && wantedName) {
    matches = prices.filter((row) => {
      const serviceName = normalize(
        row?.service?.name
      );

      return (
        serviceName.includes(wantedName) ||
        wantedName.includes(serviceName)
      );
    });
  }

  if (!matches.length) {
    return {
      price: NaN,
      tierId: null,
      service: null,
      stocks: null
    };
  }

  // Prefer a tier that actually has stock.
  const withStock = matches.filter((row) => {
    const stocks = Number(row?.service?.stocks);
    return Number.isFinite(stocks) && stocks > 0;
  });

  const selected =
    withStock.length > 0
      ? withStock[0]
      : matches[0];

  return {
    price: numberValue(selected?.price),
    tierId: selected?.id ?? null,
    service: selected?.service || null,
    stocks:
      selected?.service?.stocks ?? null
  };
}


// ============================================================
// PROVIDER SERVICE RESOLUTION
// ============================================================

async function getProviderServices(
  server,
  countryId
) {
  const path =
    `/${server}/services?country_id=${quote(countryId)}`;

  const data =
    await sureVerificationRequest(path);

  const services =
    Array.isArray(data?.services)
      ? data.services
      : Array.isArray(data?.data?.services)
        ? data.data.services
        : [];

  return services;
}

async function resolveProviderServiceId(
  server,
  countryId,
  requestedServiceId,
  requestedServiceName
) {
  const services =
    await getProviderServices(
      server,
      countryId
    );

  if (!services.length) {
    throw new Error(
      `No services were returned by ${server}.`
    );
  }

  const wantedId =
    normalize(requestedServiceId);

  const wantedName =
    normalize(requestedServiceName);

  // Exact provider service ID.
  if (wantedId) {
    const exactId = services.find(
      (service) =>
        normalize(service?.id) === wantedId
    );

    if (exactId?.id) {
      return {
        id: exactId.id,
        name: exactId.name || requestedServiceName
      };
    }
  }

  // Exact service name.
  if (wantedName) {
    const exactName = services.find(
      (service) =>
        normalize(service?.name) === wantedName
    );

    if (exactName?.id) {
      return {
        id: exactName.id,
        name: exactName.name || requestedServiceName
      };
    }
  }

  // Partial service-name match.
  if (wantedName) {
    const partial = services.find(
      (service) => {
        const providerName =
          normalize(service?.name);

        return (
          providerName.includes(wantedName) ||
          wantedName.includes(providerName)
        );
      }
    );

    if (partial?.id) {
      return {
        id: partial.id,
        name: partial.name || requestedServiceName
      };
    }
  }

  throw new Error(
    `Service "${requestedServiceName || requestedServiceId}" is not available on ${server}.`
  );
}


// ============================================================
// PROVIDER PRICE
// ============================================================

async function getProviderPrice({
  server,
  countryId,
  providerServiceId,
  providerServiceName
}) {
  if (server === "global-server-2") {
    const data =
      await sureVerificationRequest(
        "/global-server-2/price"
      );

    return getGlobalServer2Price(
      data,
      providerServiceId,
      providerServiceName
    );
  }

  const path =
    `/${server}/price` +
    `?country_id=${quote(countryId)}` +
    `&service=${quote(providerServiceId)}`;

  const data =
    await sureVerificationRequest(path);

  const price =
    getNormalServerPrice(data);

  return {
    price,
    tierId: null,
    service:
      data?.price?.service ||
      data?.data?.price?.service ||
      null,
    stocks:
      data?.price?.service?.stocks ??
      data?.data?.price?.service?.stocks ??
      null
  };
}


// ============================================================
// PROVIDER PURCHASE
// ============================================================

async function purchaseFromProvider({
  server,
  countryId,
  providerServiceId,
  providerPriceTierId
}) {
  /*
   * USA Server 1, USA Server 2 and Global Server 1
   * use the documented country_id + service query parameters.
   *
   * Global Server 2 is different: its documented purchase
   * endpoint is POST /global-server-2/purchase.
   *
   * The provider documentation does not document the name
   * of the optional price-tier query/body parameter, so we
   * deliberately do not invent one here.
   */

  if (server === "global-server-2") {
    return await sureVerificationRequest(
      "/global-server-2/purchase",
      {
        method: "POST"
      }
    );
  }

  const path =
    `/${server}/purchase` +
    `?country_id=${quote(countryId)}` +
    `&service=${quote(providerServiceId)}`;

  return await sureVerificationRequest(
    path,
    {
      method: "POST"
    }
  );
}


// ============================================================
// WALLET
// ============================================================

async function getWallet(userId) {
  const rows =
    await supabaseRequest(
      `wallets?user_id=eq.${quote(userId)}&select=id,user_id,balance&limit=1`
    );

  if (Array.isArray(rows) && rows[0]) {
    return rows[0];
  }

  const created =
    await supabaseRequest(
      "wallets",
      {
        method: "POST",
        body: {
          user_id: userId,
          balance: 0
        },
        headers: {
          Prefer: "return=representation"
        }
      }
    );

  return Array.isArray(created)
    ? created[0]
    : created;
}

async function debitWallet(
  userId,
  amount
) {
  const debitAmount =
    Number(amount);

  if (
    !Number.isFinite(debitAmount) ||
    debitAmount <= 0
  ) {
    throw new Error(
      "Invalid customer price."
    );
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const wallet =
      await getWallet(userId);

    const currentBalance =
      Number(wallet?.balance || 0);

    if (currentBalance < debitAmount) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    const newBalance =
      currentBalance - debitAmount;

    const updated =
      await supabaseRequest(
        `wallets?id=eq.${quote(wallet.id)}` +
        `&balance=eq.${quote(currentBalance)}`,
        {
          method: "PATCH",
          body: {
            balance: newBalance
          },
          headers: {
            Prefer: "return=representation"
          }
        }
      );

    if (
      Array.isArray(updated) &&
      updated.length > 0
    ) {
      return Number(updated[0].balance);
    }
  }

  throw new Error(
    "Wallet balance changed. Please try again."
  );
}

async function refundWallet(
  userId,
  amount
) {
  const refundAmount =
    Number(amount);

  if (
    !Number.isFinite(refundAmount) ||
    refundAmount <= 0
  ) {
    return null;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const wallet =
      await getWallet(userId);

    const currentBalance =
      Number(wallet?.balance || 0);

    const newBalance =
      currentBalance + refundAmount;

    const updated =
      await supabaseRequest(
        `wallets?id=eq.${quote(wallet.id)}` +
        `&balance=eq.${quote(currentBalance)}`,
        {
          method: "PATCH",
          body: {
            balance: newBalance
          },
          headers: {
            Prefer: "return=representation"
          }
        }
      );

    if (
      Array.isArray(updated) &&
      updated.length > 0
    ) {
      return Number(updated[0].balance);
    }
  }

  throw new Error(
    "Unable to refund wallet."
  );
}


// ============================================================
// WALLET TRANSACTION
// ============================================================

async function createWalletTransaction({
  userId,
  amount,
  type,
  description,
  referenceId
}) {
  const transaction = {
    user_id: userId,
    amount: Number(amount),
    type,
    description:
      description || null
  };

  if (referenceId) {
    transaction.reference_id =
      referenceId;
  }

  try {
    return await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",
        body: transaction,
        headers: {
          Prefer: "return=minimal"
        }
      }
    );
  } catch (error) {
    /*
     * The order/wallet operation has already completed.
     * Do not make the customer lose the purchased number
     * just because the optional transaction-history insert
     * failed.
     */
    console.error(
      "Wallet transaction insert error:",
      error
    );

    return null;
  }
}


// ============================================================
// ORDER INSERT
// ============================================================

async function createOrder({
  userId,
  providerOrderId,
  providerVerificationId,
  serviceCountryPriceId,
  serviceName,
  countryName,
  providerCost,
  customerPrice,
  providerServer,
  providerBaseUrl,
  providerExpiredAt,
  phoneNumber,
  status
}) {
  const providerCostNumber =
    Number(providerCost);

  const customerPriceNumber =
    Number(customerPrice);

  if (
    !Number.isFinite(providerCostNumber)
  ) {
    throw new Error(
      "Provider price is unavailable."
    );
  }

  if (
    !Number.isFinite(customerPriceNumber)
  ) {
    throw new Error(
      "Customer price is invalid."
    );
  }

  const profit =
    customerPriceNumber -
    providerCostNumber;

  const order = {
    user_id: userId,

    provider_order_id:
      providerOrderId
        ? String(providerOrderId)
        : null,

    provider_verification_id:
      providerVerificationId != null
        ? String(providerVerificationId)
        : null,

    service_country_price_id:
      serviceCountryPriceId != null
        ? String(serviceCountryPriceId)
        : null,

    service_name:
      serviceName || null,

    country_name:
      countryName || null,

    provider_cost:
      providerCostNumber,

    customer_price:
      customerPriceNumber,

    profit,

    status:
      status || "active",

    phone_number:
      phoneNumber
        ? String(phoneNumber)
        : null,

    provider_name:
      "SureVerification",

    provider_server:
      providerServer,

    provider_base_url:
      providerBaseUrl,

    provider_expired_at:
      providerExpiredAt || null
  };

  const inserted =
    await supabaseRequest(
      "orders",
      {
        method: "POST",
        body: order,
        headers: {
          Prefer: "return=representation"
        }
      }
    );

  return Array.isArray(inserted)
    ? inserted[0]
    : inserted;
}


// ============================================================
// PROVIDER CANCELLATION
// ============================================================

async function cancelProviderVerification(
  verificationId
) {
  if (
    verificationId === null ||
    verificationId === undefined ||
    verificationId === ""
  ) {
    return null;
  }

  try {
    return await sureVerificationRequest(
      `/verifications/cancel/${quote(
        verificationId
      )}`,
      {
        method: "DELETE"
      }
    );
  } catch (error) {
    console.error(
      "Provider cancellation failed:",
      error
    );

    return null;
  }
}


// ============================================================
// PRICING ROW
// ============================================================

async function findPricingRow({
  countryId,
  requestedServiceId,
  requestedServiceName,
  providerServer
}) {
  /*
   * First try the exact service ID.
   */

  if (requestedServiceId) {
    const rows =
      await supabaseRequest(
        `product_prices` +
        `?country_id=eq.${quote(countryId)}` +
        `&service_id=eq.${quote(requestedServiceId)}` +
        `&provider_server=eq.${quote(providerServer)}` +
        `&select=*` +
        `&limit=1`
      );

    if (
      Array.isArray(rows) &&
      rows.length > 0
    ) {
      return rows[0];
    }
  }

  /*
   * If the frontend supplied a service name,
   * search all prices for that country/server.
   */

  const rows =
    await supabaseRequest(
      `product_prices` +
      `?country_id=eq.${quote(countryId)}` +
      `&provider_server=eq.${quote(providerServer)}` +
      `&select=*`
    );

  if (!Array.isArray(rows)) {
    return null;
  }

  const wantedName =
    normalize(requestedServiceName);

  if (!wantedName) {
    return null;
  }

  const exact =
    rows.find(
      (row) =>
        normalize(row?.service_name) ===
        wantedName
    );

  if (exact) {
    return exact;
  }

  return (
    rows.find((row) => {
      const name =
        normalize(row?.service_name);

      return (
        name.includes(wantedName) ||
        wantedName.includes(name)
      );
    }) || null
  );
}


// ============================================================
// REQUEST HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  let user = null;
  let walletDebited = false;
  let debitedAmount = 0;
  let purchasedVerificationId = null;

  try {
    // --------------------------------------------------------
    // AUTH
    // --------------------------------------------------------

    user =
      await getAuthenticatedUser(req);

    // --------------------------------------------------------
    // BODY
    // --------------------------------------------------------

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const countryId =
      body.countryId ??
      body.country_id;

    const countryName =
      body.countryName ??
      body.country_name ??
      "";

    const countryCode =
      body.countryCode ??
      body.country_code ??
      "";

    const requestedServiceId =
      body.serviceCountryPriceId ??
      body.service_country_price_id ??
      body.serviceId ??
      body.service_id ??
      "";

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    const requestedServer =
      normalizeServer(
        body.providerServer ??
        body.provider_server ??
        ""
      );

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "Country ID is required."
      });
    }

    if (
      !requestedServiceId &&
      !requestedServiceName
    ) {
      return res.status(400).json({
        success: false,
        error: "Service is required."
      });
    }

    // --------------------------------------------------------
    // SERVER SELECTION
    // --------------------------------------------------------

    const usa =
      isUSA(
        countryId,
        countryCode,
        countryName
      );

    const allowedServers = usa
      ? [
          "usa-server-2",
          "usa-server-1"
        ]
      : [
          "global-server-2",
          "global-server-1"
        ];

    let servers;

    if (requestedServer) {
      if (
        !allowedServers.includes(
          requestedServer
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            `Invalid provider server "${requestedServer}" for this country.`
        });
      }

      /*
       * When the admin/user explicitly selected a server,
       * use that server only.
       */
      servers = [requestedServer];
    } else {
      /*
       * Default order when no server was explicitly supplied.
       */
      servers = allowedServers;
    }

    // --------------------------------------------------------
    // FIND A VALID ADMIN PRICE + PROVIDER PRICE
    // --------------------------------------------------------

    let selectedServer = null;
    let pricingRow = null;
    let providerService = null;
    let providerPriceInfo = null;

    const serverErrors = [];

    for (const server of servers) {
      try {
        const row =
          await findPricingRow({
            countryId,
            requestedServiceId,
            requestedServiceName,
            providerServer: server
          });

        if (!row) {
          serverErrors.push(
            `${server}: no active admin price found`
          );

          /*
           * If the server was explicitly selected,
           * do not silently switch to another server.
           */
          if (requestedServer) {
            break;
          }

          continue;
        }

        const customerPrice =
          Number(row?.selling_price);

        if (
          !Number.isFinite(customerPrice) ||
          customerPrice <= 0
        ) {
          serverErrors.push(
            `${server}: customer selling price is invalid`
          );

          if (requestedServer) {
            break;
          }

          continue;
        }

        const resolvedService =
          await resolveProviderServiceId(
            server,
            countryId,
            row?.provider_service_id ||
              requestedServiceId ||
              row?.service_id,
            requestedServiceName ||
              row?.service_name
          );

        const priceInfo =
          await getProviderPrice({
            server,
            countryId,
            providerServiceId:
              resolvedService.id,
            providerServiceName:
              resolvedService.name
          });

        if (
          !Number.isFinite(
            priceInfo.price
          ) ||
          priceInfo.price < 0
        ) {
          serverErrors.push(
            `${server}: provider price unavailable`
          );

          if (requestedServer) {
            break;
          }

          continue;
        }

        /*
         * Global Server 2 returns stock levels.
         * If the matched tier has zero stock, do not buy it.
         */
        if (
          server === "global-server-2" &&
          priceInfo.stocks !== null &&
          Number.isFinite(
            Number(priceInfo.stocks)
          ) &&
          Number(priceInfo.stocks) <= 0
        ) {
          serverErrors.push(
            `${server}: selected service has no stock`
          );

          if (requestedServer) {
            break;
          }

          continue;
        }

        selectedServer = server;
        pricingRow = row;
        providerService =
          resolvedService;
        providerPriceInfo =
          priceInfo;

        break;
      } catch (error) {
        console.error(
          `Server preparation error for ${server}:`,
          error
        );

        serverErrors.push(
          `${server}: ${error.message}`
        );

        if (requestedServer) {
          break;
        }
      }
    }

    if (
      !selectedServer ||
      !pricingRow ||
      !providerService ||
      !providerPriceInfo
    ) {
      return res.status(400).json({
        success: false,
        error:
          "No valid provider/server price is available for this service.",
        debug:
          process.env.NODE_ENV === "production"
            ? undefined
            : serverErrors
      });
    }

    const customerPrice =
      Number(
        pricingRow.selling_price
      );

    const providerCost =
      Number(
        providerPriceInfo.price
      );

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

    if (
      !Number.isFinite(providerCost) ||
      providerCost < 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Provider price is unavailable."
      });
    }

    // --------------------------------------------------------
    // CHECK WALLET BEFORE DEBIT
    // --------------------------------------------------------

    const wallet =
      await getWallet(user.id);

    const walletBalance =
      Number(wallet?.balance || 0);

    if (
      walletBalance <
      customerPrice
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        message:
          "Insufficient wallet balance.",
        balance:
          walletBalance,
        required:
          customerPrice
      });
    }

    // --------------------------------------------------------
    // DEBIT CUSTOMER
    // --------------------------------------------------------

    const newBalance =
      await debitWallet(
        user.id,
        customerPrice
      );

    walletDebited = true;
    debitedAmount = customerPrice;

    // --------------------------------------------------------
    // PURCHASE NUMBER
    // --------------------------------------------------------

    let providerData;

    try {
      providerData =
        await purchaseFromProvider({
          server: selectedServer,
          countryId,
          providerServiceId:
            providerService.id,
          providerPriceTierId:
            providerPriceInfo.tierId
        });
    } catch (providerError) {
      /*
       * Provider did not successfully purchase a number.
       * Return the customer's money.
       */
      try {
        await refundWallet(
          user.id,
          customerPrice
        );

        walletDebited = false;
        debitedAmount = 0;
      } catch (refundError) {
        console.error(
          "Provider failed AND wallet refund failed:",
          refundError
        );
      }

      return res.status(502).json({
        success: false,
        error:
          providerError?.message ||
          "Unable to purchase number from provider."
      });
    }

    // --------------------------------------------------------
    // READ PURCHASE RESPONSE
    // --------------------------------------------------------

    const verification =
      getVerification(
        providerData
      );

    const verificationId =
      getVerificationId(
        providerData
      );

    const requestId =
      getRequestId(
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

    const providerStatus =
      getProviderStatus(
        providerData
      );

    const providerServiceName =
      getProviderServiceName(
        providerData
      );

    purchasedVerificationId =
      verificationId;

    if (
      verificationId === null ||
      verificationId === undefined ||
      verificationId === ""
    ) {
      /*
       * Provider responded but did not give us
       * a usable verification ID.
       *
       * Attempt cancellation, then refund.
       */
      await cancelProviderVerification(
        verificationId
      );

      try {
        await refundWallet(
          user.id,
          customerPrice
        );

        walletDebited = false;
        debitedAmount = 0;
      } catch (refundError) {
        console.error(
          "Refund after invalid provider response failed:",
          refundError
        );
      }

      return res.status(502).json({
        success: false,
        error:
          "Provider did not return a verification ID."
      });
    }

    if (!phoneNumber) {
      /*
       * A verification without a number is not usable.
       */
      await cancelProviderVerification(
        verificationId
      );

      try {
        await refundWallet(
          user.id,
          customerPrice
        );

        walletDebited = false;
        debitedAmount = 0;
      } catch (refundError) {
        console.error(
          "Refund after missing number failed:",
          refundError
        );
      }

      return res.status(502).json({
        success: false,
        error:
          "Provider did not return a phone number."
      });
    }

    // --------------------------------------------------------
    // CREATE ORDER
    // --------------------------------------------------------

    let order;

    try {
      order =
        await createOrder({
          userId:
            user.id,

          providerOrderId:
            requestId,

          providerVerificationId:
            verificationId,

          serviceCountryPriceId:
            pricingRow?.id ??
            requestedServiceId,

          serviceName:
            requestedServiceName ||
            providerServiceName ||
            providerService.name ||
            pricingRow?.service_name,

          countryName:
            countryName ||
            pricingRow?.country_name,

          providerCost,

          customerPrice,

          providerServer:
            selectedServer,

          providerBaseUrl:
            PROVIDER_BASE_URL,

          providerExpiredAt:
            expiredAt,

          phoneNumber,

          status:
            providerStatus ||
            "active"
        });
    } catch (databaseError) {
      /*
       * We already purchased a provider number.
       *
       * Try to cancel it and return the customer's money.
       */
      console.error(
        "Order database insert failed:",
        databaseError
      );

      const cancellation =
        await cancelProviderVerification(
          verificationId
        );

      try {
        await refundWallet(
          user.id,
          customerPrice
        );

        walletDebited = false;
        debitedAmount = 0;
      } catch (refundError) {
        console.error(
          "Refund after order insert failure failed:",
          refundError
        );
      }

      return res.status(500).json({
        success: false,
        error:
          "The number was purchased but the order could not be saved. Your wallet has been refunded.",
        debug:
          process.env.NODE_ENV === "production"
            ? undefined
            : databaseError.message,
        provider_cancelled:
          Boolean(cancellation)
      });
    }

    // --------------------------------------------------------
    // RECORD WALLET TRANSACTION
    // --------------------------------------------------------

    await createWalletTransaction({
      userId:
        user.id,

      amount:
        customerPrice,

      type:
        "order",

      description:
        `Purchased ${requestedServiceName || providerService.name || "number"} (${phoneNumber})`,

      referenceId:
        order?.id ||
        requestId ||
        String(verificationId)
    });

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,

      message:
        "Number purchased successfully.",

      order: {
        id:
          order?.id || null,

        provider_order_id:
          requestId || null,

        provider_verification_id:
          verificationId,

        phone_number:
          phoneNumber,

        country_id:
          countryId,

        country_name:
          countryName ||
          pricingRow?.country_name ||
          null,

        service_name:
          requestedServiceName ||
          providerServiceName ||
          providerService.name ||
          pricingRow?.service_name ||
          null,

        provider_server:
          selectedServer,

        provider_cost:
          providerCost,

        customer_price:
          customerPrice,

        profit:
          customerPrice -
          providerCost,

        status:
          providerStatus ||
          "active",

        expired_at:
          expiredAt
      },

      verification: {
        id:
          verificationId,

        request_id:
          requestId,

        number:
          phoneNumber,

        service:
          providerServiceName ||
          providerService.name ||
          requestedServiceName,

        status:
          providerStatus ||
          "active",

        expired_at:
          expiredAt
      },

      provider_server:
        selectedServer,

      provider_service_id:
        providerService.id,

      provider_price:
        providerCost,

      selling_price:
        customerPrice,

      profit:
        customerPrice -
        providerCost,

      balance:
        newBalance
    });
  } catch (error) {
    console.error(
      "ORDER API ERROR:",
      error
    );

    /*
     * This is only reached when the provider number
     * has NOT already been successfully purchased,
     * or when an unexpected error occurs before purchase.
     */
    if (
      walletDebited &&
      debitedAmount > 0 &&
      !purchasedVerificationId
    ) {
      try {
        await refundWallet(
          user?.id,
          debitedAmount
        );
      } catch (refundError) {
        console.error(
          "Emergency wallet refund failed:",
          refundError
        );
      }
    }

    const message =
      error?.message ||
      "Unable to purchase number.";

    if (
      /unauthorized/i.test(message)
    ) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized."
      });
    }

    if (
      /insufficient wallet|insufficient funds/i.test(
        message
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        message:
          "Insufficient wallet balance."
      });
    }

    return res.status(500).json({
      success: false,
      error: message
    });
  }
}
