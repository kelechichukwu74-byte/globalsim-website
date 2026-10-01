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
// HELPERS
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

function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header) return null;

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.slice(7).trim() || null;
}


// ============================================================
// AUTH
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
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
    throw new Error(
      data?.message ||
      data?.error_description ||
      data?.error ||
      text ||
      `Supabase returned HTTP ${response.status}.`
    );
  }

  return data;
}


// ============================================================
// PROVIDER RESPONSE
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
  const verification =
    getVerification(data);

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
  const verification =
    getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
    data?.request_id ??
    data?.requestId ??
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
    data?.number ??
    data?.phone_number ??
    data?.phoneNumber ??
    data?.phone ??
    null
  );
}

function getExpiredAt(data) {
  const verification =
    getVerification(data);

  return (
    verification?.expired_at ??
    verification?.expiredAt ??
    data?.expired_at ??
    data?.expiredAt ??
    null
  );
}

function getProviderStatus(data) {
  const verification =
    getVerification(data);

  return (
    verification?.status ||
    data?.status ||
    "active"
  );
}

function getProviderServiceName(data) {
  const verification =
    getVerification(data);

  return (
    verification?.service ||
    data?.service ||
    null
  );
}


// ============================================================
// PROVIDER PRICE
// ============================================================

function getNormalPrice(data) {
  const values = [
    data?.price?.price,
    data?.price,
    data?.data?.price?.price,
    data?.data?.price,
    data?.amount,
    data?.data?.amount
  ];

  for (const value of values) {
    const number = Number(value);

    if (
      Number.isFinite(number) &&
      number >= 0
    ) {
      return number;
    }
  }

  return NaN;
}

function getGlobal2Price(
  data,
  serviceId,
  serviceName
) {
  const prices =
    Array.isArray(data?.prices)
      ? data.prices
      : Array.isArray(data?.data?.prices)
        ? data.data.prices
        : [];

  if (!prices.length) {
    return {
      price: NaN,
      tierId: null,
      stocks: null
    };
  }

  const wantedId =
    normalize(serviceId);

  const wantedName =
    normalize(serviceName);

  let matches =
    prices.filter((row) => {
      const providerService =
        row?.service || {};

      return (
        normalize(providerService?.id) ===
          wantedId ||
        normalize(providerService?.name) ===
          wantedName
      );
    });

  if (!matches.length) {
    matches =
      prices.filter((row) => {
        const name =
          normalize(
            row?.service?.name
          );

        return (
          name.includes(wantedName) ||
          wantedName.includes(name)
        );
      });
  }

  if (!matches.length) {
    return {
      price: NaN,
      tierId: null,
      stocks: null
    };
  }

  const stocked =
    matches.filter((row) => {
      const stocks =
        Number(row?.service?.stocks);

      return (
        Number.isFinite(stocks) &&
        stocks > 0
      );
    });

  const selected =
    stocked.length
      ? stocked[0]
      : matches[0];

  return {
    price: Number(selected?.price),
    tierId:
      selected?.id ?? null,
    stocks:
      selected?.service?.stocks ?? null
  };
}


// ============================================================
// PROVIDER SERVICES
// ============================================================

async function getProviderServices(
  server,
  countryId
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${quote(
        countryId
      )}`
    );

  return Array.isArray(data?.services)
    ? data.services
    : Array.isArray(data?.data?.services)
      ? data.data.services
      : [];
}

async function resolveProviderService(
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
      `No services available on ${server}.`
    );
  }

  const wantedId =
    normalize(requestedServiceId);

  const wantedName =
    normalize(requestedServiceName);

  let service = null;

  if (wantedId) {
    service =
      services.find(
        (item) =>
          normalize(item?.id) ===
          wantedId
      );
  }

  if (!service && wantedName) {
    service =
      services.find(
        (item) =>
          normalize(item?.name) ===
          wantedName
      );
  }

  if (!service && wantedName) {
    service =
      services.find((item) => {
        const name =
          normalize(item?.name);

        return (
          name.includes(wantedName) ||
          wantedName.includes(name)
        );
      });
  }

  if (!service?.id) {
    throw new Error(
      `Service "${requestedServiceName || requestedServiceId}" is not available on ${server}.`
    );
  }

  return {
    id: service.id,
    name:
      service.name ||
      requestedServiceName
  };
}


// ============================================================
// PROVIDER PRICE LOOKUP
// ============================================================

async function getProviderPrice({
  server,
  countryId,
  providerServiceId,
  providerServiceName
}) {
  if (
    server === "global-server-2"
  ) {
    const data =
      await sureVerificationRequest(
        "/global-server-2/price"
      );

    return getGlobal2Price(
      data,
      providerServiceId,
      providerServiceName
    );
  }

  const data =
    await sureVerificationRequest(
      `/${server}/price?country_id=${quote(
        countryId
      )}&service=${quote(
        providerServiceId
      )}`
    );

  return {
    price:
      getNormalPrice(data),

    tierId: null,

    stocks:
      data?.price?.service?.stocks ??
      data?.data?.price?.service?.stocks ??
      null
  };
}


// ============================================================
// PROVIDER PURCHASE
// ============================================================

async function purchaseNumber({
  server,
  countryId,
  providerServiceId
}) {
  /*
   * USA SERVER 1
   * USA SERVER 2
   * GLOBAL SERVER 1
   */

  if (
    server !== "global-server-2"
  ) {
    return await sureVerificationRequest(
      `/${server}/purchase?country_id=${quote(
        countryId
      )}&service=${quote(
        providerServiceId
      )}`,
      {
        method: "POST"
      }
    );
  }

  /*
   * Global Server 2 documented purchase endpoint.
   */
  return await sureVerificationRequest(
    "/global-server-2/purchase",
    {
      method: "POST"
    }
  );
}


// ============================================================
// WALLET
// IMPORTANT: wallets table uses user_id, NOT id
// ============================================================

async function getWallet(userId) {
  const rows =
    await supabaseRequest(
      `wallets?user_id=eq.${quote(
        userId
      )}&select=user_id,balance&limit=1`
    );

  if (
    Array.isArray(rows) &&
    rows.length
  ) {
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
          Prefer:
            "return=representation"
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

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const wallet =
      await getWallet(userId);

    const balance =
      Number(
        wallet?.balance || 0
      );

    if (balance < debitAmount) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    const newBalance =
      balance - debitAmount;

    /*
     * IMPORTANT:
     * wallets has user_id, not id.
     */
    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${quote(
          balance
        )}`,
        {
          method: "PATCH",
          body: {
            balance: newBalance
          },
          headers: {
            Prefer:
              "return=representation"
          }
        }
      );

    if (
      Array.isArray(updated) &&
      updated.length
    ) {
      return Number(
        updated[0].balance
      );
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

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const wallet =
      await getWallet(userId);

    const balance =
      Number(
        wallet?.balance || 0
      );

    const newBalance =
      balance + refundAmount;

    /*
     * IMPORTANT:
     * wallets has user_id, not id.
     */
    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${quote(
          balance
        )}`,
        {
          method: "PATCH",
          body: {
            balance: newBalance
          },
          headers: {
            Prefer:
              "return=representation"
          }
        }
      );

    if (
      Array.isArray(updated) &&
      updated.length
    ) {
      return Number(
        updated[0].balance
      );
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
  description,
  referenceId
}) {
  try {
    const body = {
      user_id: userId,
      amount: Number(amount),
      type: "order",
      description:
        description || null
    };

    if (referenceId) {
      body.reference_id =
        referenceId;
    }

    return await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",
        body,
        headers: {
          Prefer:
            "return=minimal"
        }
      }
    );
  } catch (error) {
    console.error(
      "Wallet transaction error:",
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
  serviceId,
  serviceName,
  providerServer
}) {
  if (serviceId) {
    const rows =
      await supabaseRequest(
        `product_prices` +
        `?country_id=eq.${quote(
          countryId
        )}` +
        `&service_id=eq.${quote(
          serviceId
        )}` +
        `&provider_server=eq.${quote(
          providerServer
        )}` +
        `&select=*` +
        `&limit=1`
      );

    if (
      Array.isArray(rows) &&
      rows.length
    ) {
      return rows[0];
    }
  }

  const rows =
    await supabaseRequest(
      `product_prices` +
      `?country_id=eq.${quote(
        countryId
      )}` +
      `&provider_server=eq.${quote(
        providerServer
      )}` +
      `&select=*`
    );

  if (!Array.isArray(rows)) {
    return null;
  }

  const wanted =
    normalize(serviceName);

  if (!wanted) {
    return null;
  }

  return (
    rows.find(
      (row) =>
        normalize(
          row?.service_name
        ) === wanted
    ) ||
    rows.find((row) => {
      const name =
        normalize(
          row?.service_name
        );

      return (
        name.includes(wanted) ||
        wanted.includes(name)
      );
    }) ||
    null
  );
}


// ============================================================
// CANCEL PROVIDER NUMBER
// ============================================================

async function cancelProvider(
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
// CREATE ORDER
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
  profit,
  status,
  phoneNumber,
  providerServer,
  providerExpiredAt
}) {
  const order = {
    user_id:
      userId,

    provider_order_id:
      providerOrderId
        ? String(providerOrderId)
        : null,

    provider_verification_id:
      providerVerificationId !== null &&
      providerVerificationId !== undefined
        ? String(
            providerVerificationId
          )
        : null,

    service_country_price_id:
      serviceCountryPriceId !== null &&
      serviceCountryPriceId !== undefined
        ? String(
            serviceCountryPriceId
          )
        : null,

    service_name:
      serviceName || null,

    country_name:
      countryName || null,

    provider_cost:
      Number(providerCost),

    customer_price:
      Number(customerPrice),

    profit:
      Number(profit),

    status:
      status || "active",

    phone_number:
      phoneNumber || null,

    provider_name:
      "SureVerification",

    provider_server:
      providerServer,

    provider_base_url:
      PROVIDER_BASE_URL,

    provider_expired_at:
      providerExpiredAt || null
  };

  const result =
    await supabaseRequest(
      "orders",
      {
        method: "POST",
        body: order,
        headers: {
          Prefer:
            "return=representation"
        }
      }
    );

  return Array.isArray(result)
    ? result[0]
    : result;
}


// ============================================================
// MAIN HANDLER
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
  let purchasedVerificationId =
    null;

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

    const serviceId =
      body.serviceCountryPriceId ??
      body.service_country_price_id ??
      body.serviceId ??
      body.service_id ??
      "";

    const serviceName =
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
        error:
          "Country ID is required."
      });
    }

    if (
      !serviceId &&
      !serviceName
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Service is required."
      });
    }

    // --------------------------------------------------------
    // ALL FOUR SERVERS ARE ALLOWED
    // --------------------------------------------------------

    const allServers = [
      "usa-server-1",
      "usa-server-2",
      "global-server-1",
      "global-server-2"
    ];

    let servers;

    if (requestedServer) {
      if (
        !allServers.includes(
          requestedServer
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            `Invalid provider server "${requestedServer}".`
        });
      }

      /*
       * Use exactly the server selected
       * by the customer/admin.
       */
      servers = [requestedServer];
    } else {
      /*
       * Default fallback order.
       */
      servers = [
        "usa-server-2",
        "usa-server-1",
        "global-server-2",
        "global-server-1"
      ];
    }

    // --------------------------------------------------------
    // FIND SERVER + ADMIN PRICE + PROVIDER PRICE
    // --------------------------------------------------------

    let selectedServer =
      null;

    let pricingRow =
      null;

    let providerService =
      null;

    let providerPrice =
      NaN;

    let providerPriceTierId =
      null;

    for (const server of servers) {
      try {
        const row =
          await findPricingRow({
            countryId,
            serviceId,
            serviceName,
            providerServer:
              server
          });

        if (!row) {
          if (requestedServer) {
            return res.status(400).json({
              success: false,
              error:
                `No price is configured for ${server} for this service.`
            });
          }

          continue;
        }

        const sellingPrice =
          Number(
            row?.selling_price
          );

        if (
          !Number.isFinite(
            sellingPrice
          ) ||
          sellingPrice <= 0
        ) {
          if (requestedServer) {
            return res.status(400).json({
              success: false,
              error:
                `The selling price for ${server} is invalid.`
            });
          }

          continue;
        }

        const resolved =
          await resolveProviderService(
            server,
            countryId,
            row?.provider_service_id ||
              serviceId ||
              row?.service_id,
            serviceName ||
              row?.service_name
          );

        const priceData =
          await getProviderPrice({
            server,
            countryId,
            providerServiceId:
              resolved.id,
            providerServiceName:
              resolved.name
          });

        if (
          !Number.isFinite(
            priceData.price
          )
        ) {
          if (requestedServer) {
            return res.status(400).json({
              success: false,
              error:
                `Provider price is not available for ${server}.`
            });
          }

          continue;
        }

        if (
          server ===
            "global-server-2" &&
          priceData.stocks !== null &&
          Number.isFinite(
            Number(
              priceData.stocks
            )
          ) &&
          Number(
            priceData.stocks
          ) <= 0
        ) {
          if (requestedServer) {
            return res.status(400).json({
              success: false,
              error:
                "No stock is available on Global Server 2 for this service."
            });
          }

          continue;
        }

        selectedServer =
          server;

        pricingRow =
          row;

        providerService =
          resolved;

        providerPrice =
          Number(
            priceData.price
          );

        providerPriceTierId =
          priceData.tierId;

        break;
      } catch (error) {
        console.error(
          `Server ${server} error:`,
          error
        );

        if (requestedServer) {
          return res.status(400).json({
            success: false,
            error:
              error?.message ||
              `Unable to prepare ${server}.`
          });
        }
      }
    }

    if (
      !selectedServer ||
      !pricingRow ||
      !providerService ||
      !Number.isFinite(
        providerPrice
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "No valid provider price is available for this service."
      });
    }

    const customerPrice =
      Number(
        pricingRow.selling_price
      );

    const profit =
      customerPrice -
      providerPrice;

    // --------------------------------------------------------
    // WALLET CHECK
    // --------------------------------------------------------

    const wallet =
      await getWallet(user.id);

    const balance =
      Number(
        wallet?.balance || 0
      );

    if (
      balance < customerPrice
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        message:
          "Insufficient wallet balance.",
        balance,
        required:
          customerPrice
      });
    }

    // --------------------------------------------------------
    // DEBIT WALLET
    // --------------------------------------------------------

    const newBalance =
      await debitWallet(
        user.id,
        customerPrice
      );

    walletDebited = true;
    debitedAmount =
      customerPrice;

    // --------------------------------------------------------
    // PURCHASE NUMBER
    // --------------------------------------------------------

    let providerData;

    try {
      providerData =
        await purchaseNumber({
          server:
            selectedServer,

          countryId,

          providerServiceId:
            providerService.id
        });
    } catch (providerError) {
      console.error(
        "Provider purchase error:",
        providerError
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
          "Refund error:",
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
    // PROVIDER RESPONSE
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

    const returnedService =
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
      try {
        await refundWallet(
          user.id,
          customerPrice
        );

        walletDebited = false;
        debitedAmount = 0;
      } catch (refundError) {
        console.error(
          "Refund error:",
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
      await cancelProvider(
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
          "Refund error:",
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
    // SAVE ORDER
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
            serviceId,

          serviceName:
            serviceName ||
            returnedService ||
            providerService.name ||
            pricingRow?.service_name,

          countryName:
            countryName ||
            pricingRow?.country_name,

          providerCost:
            providerPrice,

          customerPrice,

          profit,

          status:
            providerStatus ||
            "active",

          phoneNumber,

          providerServer:
            selectedServer,

          providerExpiredAt:
            expiredAt
        });
    } catch (databaseError) {
      console.error(
        "Order save error:",
        databaseError
      );

      await cancelProvider(
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
          "Refund error:",
          refundError
        );
      }

      return res.status(500).json({
        success: false,
        error:
          "The number could not be saved. Your wallet has been refunded."
      });
    }

    // --------------------------------------------------------
    // TRANSACTION
    // --------------------------------------------------------

    await createWalletTransaction({
      userId:
        user.id,

      amount:
        customerPrice,

      description:
        `Purchased ${
          serviceName ||
          providerService.name ||
          "number"
        } (${phoneNumber})`,

      referenceId:
        order?.id ||
        requestId ||
        String(
          verificationId
        )
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
          serviceName ||
          returnedService ||
          providerService.name ||
          null,

        provider_server:
          selectedServer,

        provider_cost:
          providerPrice,

        customer_price:
          customerPrice,

        profit,

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
          returnedService ||
          providerService.name ||
          serviceName,

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
        providerPrice,

      selling_price:
        customerPrice,

      profit,

      balance:
        newBalance
    });
  } catch (error) {
    console.error(
      "ORDER API ERROR:",
      error
    );

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
          "Emergency refund error:",
          refundError
        );
      }
    }

    const message =
      error?.message ||
      "Unable to purchase number.";

    if (
      /unauthorized/i.test(
        message
      )
    ) {
      return res.status(401).json({
        success: false,
        error:
          "Unauthorized."
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
