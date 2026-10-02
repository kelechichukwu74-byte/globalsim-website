import { createClient } from "@supabase/supabase-js";
import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY;

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

function quote(value) {
  return encodeURIComponent(String(value ?? ""));
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function extractUserToken(req) {
  const auth =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!auth.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return auth.slice(7).trim() || null;
}

async function getUser(req) {
  const token = extractUserToken(req);

  if (!token) {
    return null;
  }

  const client = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  const {
    data: { user },
    error
  } = await client.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user;
}

/* =========================================================
   PROVIDER SERVICES
========================================================= */

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

  const services =
    Array.isArray(data?.services)
      ? data.services
      : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
      ? data
      : [];

  if (!services.length) {
    throw new Error(
      `No services were returned by ${server} for country ${countryId}.`
    );
  }

  return services;
}

/* =========================================================
   RESOLVE PROVIDER SERVICE
========================================================= */

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

  const wantedId =
    normalize(requestedServiceId);

  const wantedName =
    normalize(requestedServiceName);

  let match = null;

  if (wantedId) {
    match = services.find(
      service =>
        normalize(service?.id) ===
        wantedId
    );
  }

  if (!match && wantedName) {
    match = services.find(
      service =>
        normalize(service?.name) ===
        wantedName
    );
  }

  if (!match && wantedName) {
    match = services.find(service => {
      const name =
        normalize(service?.name);

      return (
        name.includes(wantedName) ||
        wantedName.includes(name)
      );
    });
  }

  if (!match) {
    throw new Error(
      `Service "${
        requestedServiceName ||
        requestedServiceId
      }" is not available on ${server}.`
    );
  }

  return {
    id: match.id,
    name: match.name,
    service: match
  };
}

/* =========================================================
   FIND PRODUCT PRICE
========================================================= */

async function getSellingPrice({
  countryId,
  countryName,
  serviceId,
  serviceName,
  server
}) {
  let query =
    supabase
      .from("product_prices")
      .select("*")
      .eq(
        "provider_server",
        server
      )
      .eq(
        "is_active",
        true
      );

  if (countryId) {
    query = query.eq(
      "country_id",
      String(countryId)
    );
  }

  const {
    data: rows,
    error
  } = await query;

  if (error) {
    throw new Error(
      `Unable to load selling price: ${error.message}`
    );
  }

  if (!rows?.length) {
    throw new Error(
      `No selling price has been configured for this service on ${server}.`
    );
  }

  const requestedId =
    normalize(serviceId);

  const requestedName =
    normalize(serviceName);

  let row = rows.find(item => {
    const providerId =
      normalize(
        item.provider_service_id
      );

    const serviceIdValue =
      normalize(item.service_id);

    return (
      (
        requestedId &&
        providerId === requestedId
      ) ||
      (
        requestedId &&
        serviceIdValue === requestedId
      )
    );
  });

  if (!row && requestedName) {
    row = rows.find(
      item =>
        normalize(
          item.service_name
        ) === requestedName
    );
  }

  if (!row && requestedName) {
    row = rows.find(item => {
      const name =
        normalize(
          item.service_name
        );

      return (
        name.includes(requestedName) ||
        requestedName.includes(name)
      );
    });
  }

  /*
   * If country_id was missing from the frontend request,
   * try matching the country name here.
   */
  if (!row && countryName) {
    const wantedCountry =
      normalize(countryName);

    row = rows.find(item => {
      return (
        normalize(
          item.country_name
        ) === wantedCountry
      );
    });
  }

  if (!row) {
    throw new Error(
      `No selling price has been configured for "${
        serviceName || serviceId
      }" on ${server}.`
    );
  }

  const sellingPrice =
    Number(row.selling_price);

  if (
    !Number.isFinite(
      sellingPrice
    ) ||
    sellingPrice <= 0
  ) {
    throw new Error(
      `The selling price for "${
        serviceName || serviceId
      }" on ${server} is invalid.`
    );
  }

  return {
    id: row.id,

    countryId:
      row.country_id ||
      countryId ||
      null,

    countryName:
      row.country_name ||
      countryName ||
      "",

    sellingPrice,

    providerCost:
      Number.isFinite(
        Number(row.provider_cost)
      )
        ? Number(row.provider_cost)
        : 0,

    providerServiceId:
      row.provider_service_id ||
      row.service_id ||
      serviceId ||
      "",

    serviceName:
      row.service_name ||
      serviceName ||
      ""
  };
}

/* =========================================================
   WALLET
========================================================= */

async function getWallet(userId) {
  const {
    data,
    error
  } = await supabase
    .from("wallets")
    .select("user_id,balance")
    .eq(
      "user_id",
      userId
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load wallet: ${error.message}`
    );
  }

  if (data) {
    return data;
  }

  const {
    data: created,
    error: createError
  } = await supabase
    .from("wallets")
    .insert({
      user_id: userId,
      balance: 0
    })
    .select("user_id,balance")
    .single();

  if (createError) {
    throw new Error(
      `Unable to create wallet: ${createError.message}`
    );
  }

  return created;
}

/* =========================================================
   DEBIT WALLET

   IMPORTANT:
   No wallets.id is used.
========================================================= */

async function debitWallet(
  userId,
  amount,
  referenceId
) {
  const wallet =
    await getWallet(userId);

  const balance =
    Number(wallet.balance || 0);

  if (
    !Number.isFinite(balance) ||
    balance < amount
  ) {
    return {
      success: false,
      balance
    };
  }

  const newBalance =
    balance - amount;

  const {
    data: updatedWallet,
    error: walletError
  } = await supabase
    .from("wallets")
    .update({
      balance: newBalance,
      updated_at:
        new Date().toISOString()
    })
    .eq(
      "user_id",
      userId
    )
    .select("user_id,balance")
    .single();

  if (walletError) {
    throw new Error(
      `Unable to debit wallet: ${walletError.message}`
    );
  }

  if (!updatedWallet) {
    throw new Error(
      "Unable to confirm wallet debit."
    );
  }

  const {
    error: transactionError
  } = await supabase
    .from("wallet_transactions")
    .insert({
      user_id: userId,
      type: "purchase",
      amount: -amount,
      reference_id:
        referenceId || null,
      description:
        "Virtual number purchase"
    });

  if (transactionError) {
    await supabase
      .from("wallets")
      .update({
        balance,
        updated_at:
          new Date().toISOString()
      })
      .eq(
        "user_id",
        userId
      );

    throw new Error(
      `Unable to record wallet transaction: ${transactionError.message}`
    );
  }

  return {
    success: true,
    balance: newBalance
  };
}

/* =========================================================
   REFUND WALLET
========================================================= */

async function refundWallet(
  userId,
  amount,
  referenceId
) {
  const wallet =
    await getWallet(userId);

  const balance =
    Number(wallet.balance || 0);

  const newBalance =
    balance + amount;

  const {
    error: walletError
  } = await supabase
    .from("wallets")
    .update({
      balance: newBalance,
      updated_at:
        new Date().toISOString()
    })
    .eq(
      "user_id",
      userId
    );

  if (walletError) {
    throw new Error(
      `Unable to refund wallet: ${walletError.message}`
    );
  }

  const {
    error: transactionError
  } = await supabase
    .from("wallet_transactions")
    .insert({
      user_id: userId,
      type: "refund",
      amount,
      reference_id:
        referenceId || null,
      description:
        "Virtual number purchase refund"
    });

  if (transactionError) {
    console.error(
      "Refund transaction record failed:",
      transactionError
    );
  }

  return newBalance;
}

/* =========================================================
   PROVIDER PRICE
========================================================= */

async function getProviderPrice({
  server,
  countryId,
  serviceId,
  serviceName,
  fallback
}) {
  try {
    /*
     * Global Server 2 has a different price endpoint.
     */
    if (
      server ===
      "global-server-2"
    ) {
      const data =
        await sureVerificationRequest(
          "/global-server-2/price"
        );

      const prices =
        Array.isArray(data?.prices)
          ? data.prices
          : Array.isArray(data?.data)
          ? data.data
          : [];

      const wantedId =
        normalize(serviceId);

      const wantedName =
        normalize(serviceName);

      let matches =
        prices.filter(item => {
          const providerId =
            normalize(
              item?.service?.id
            );

          const providerName =
            normalize(
              item?.service?.name
            );

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
        });

      if (!matches.length) {
        matches =
          prices.filter(item => {
            const providerName =
              normalize(
                item?.service?.name
              );

            return (
              wantedName &&
              (
                providerName.includes(
                  wantedName
                ) ||
                wantedName.includes(
                  providerName
                )
              )
            );
          });
      }

      /*
       * Prefer available stock.
       */
      const available =
        matches.filter(item => {
          const stock =
            item?.service?.stocks;

          if (
            stock === null ||
            stock === undefined ||
            stock === ""
          ) {
            return true;
          }

          return (
            Number(stock) > 0
          );
        });

      const usable =
        available.length
          ? available
          : matches;

      usable.sort(
        (a, b) =>
          Number(a?.price || 0) -
          Number(b?.price || 0)
      );

      const price =
        Number(
          usable?.[0]?.price
        );

      if (
        Number.isFinite(price) &&
        price > 0
      ) {
        return price;
      }
    }

    /*
     * USA Server 1
     * USA Server 2
     * Global Server 1
     */
    const data =
      await sureVerificationRequest(
        `/${server}/price?country_id=${quote(
          countryId
        )}&service=${quote(
          serviceId
        )}`
      );

    const candidates = [
      data?.price,
      data?.data?.price,
      data?.amount,
      data?.data?.amount
    ];

    for (const candidate of candidates) {
      const value =
        Number(candidate);

      if (
        Number.isFinite(value) &&
        value > 0
      ) {
        return value;
      }
    }
  } catch (error) {
    console.error(
      `Provider price lookup failed for ${server}:`,
      error
    );
  }

  /*
   * Use the admin/provider cost saved
   * in product_prices as fallback.
   */
  const fallbackPrice =
    Number(fallback);

  if (
    Number.isFinite(
      fallbackPrice
    ) &&
    fallbackPrice > 0
  ) {
    return fallbackPrice;
  }

  return 0;
}

/* =========================================================
   VERIFICATION RESPONSE
========================================================= */

function extractVerification(data) {
  const verification =
    data?.verification ||
    data?.data?.verification ||
    data?.result?.verification ||
    data?.result ||
    data;

  return {
    verificationId:
      verification?.request_id ||
      verification?.verification_id ||
      verification?.verificationId ||
      verification?.id ||
      data?.request_id ||
      data?.verification_id ||
      data?.verificationId ||
      data?.id ||
      null,

    requestId:
      verification?.request_id ||
      data?.request_id ||
      null,

    phoneNumber:
      verification?.number ||
      verification?.phone_number ||
      verification?.phoneNumber ||
      verification?.phone ||
      data?.number ||
      data?.phone_number ||
      data?.phoneNumber ||
      null,

    status:
      verification?.status ||
      data?.status ||
      "active",

    expiredAt:
      verification?.expired_at ||
      verification?.expiredAt ||
      data?.expired_at ||
      data?.expiredAt ||
      null
  };
}

/* =========================================================
   SAVE ORDER
========================================================= */

async function createOrder({
  userId,
  providerOrderId,
  providerVerificationId,
  serviceCountryPriceId,
  serviceName,
  countryName,
  providerPrice,
  sellingPrice,
  phoneNumber,
  status,
  providerServer,
  providerExpiredAt
}) {
  const safeProviderCost =
    Number.isFinite(
      Number(providerPrice)
    )
      ? Number(providerPrice)
      : 0;

  const safeSellingPrice =
    Number.isFinite(
      Number(sellingPrice)
    )
      ? Number(sellingPrice)
      : 0;

  const safeProfit =
    safeSellingPrice -
    safeProviderCost;

  const insertData = {
    user_id:
      userId,

    provider_order_id:
      providerOrderId || null,

    service_country_price_id:
      serviceCountryPriceId ||
      null,

    service_name:
      serviceName || null,

    country_name:
      countryName || null,

    provider_cost:
      safeProviderCost,

    customer_price:
      safeSellingPrice,

    profit:
      safeProfit,

    status:
      status || "active",

    phone_number:
      phoneNumber || null,

    provider_name:
      "SureVerification",

    provider_server:
      providerServer || null,

    provider_base_url:
      "https://sureverifications.com/api/v1",

    provider_expired_at:
      providerExpiredAt || null
  };

  const {
    data,
    error
  } = await supabase
    .from("orders")
    .insert(insertData)
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Unable to save order: ${error.message}`
    );
  }

  return data;
}

/* =========================================================
   PROVIDER PURCHASE
========================================================= */

async function purchaseFromProvider({
  server,
  countryId,
  serviceId
}) {
  const purchasePath =
    `/${server}/purchase?country_id=${quote(
      countryId
    )}&service=${quote(
      serviceId
    )}`;

  /*
   * GLOBAL SERVER 2
   *
   * Send country_id and service BOTH:
   * - in query string
   * - in JSON request body
   *
   * This handles the provider validation that was
   * returning:
   *
   * "The country id field is required."
   */
  if (
    server ===
    "global-server-2"
  ) {
    return await sureVerificationRequest(
      purchasePath,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          country_id:
            String(countryId),

          service:
            String(serviceId)
        })
      }
    );
  }

  /*
   * USA SERVER 1
   * USA SERVER 2
   * GLOBAL SERVER 1
   */
  return await sureVerificationRequest(
    purchasePath,
    {
      method: "POST"
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
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error:
        "Method not allowed."
    });
  }

  let walletDebited =
    false;

  let debitAmount =
    0;

  let userId =
    null;

  let providerVerificationId =
    null;

  try {
    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    const user =
      await getUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error:
          "Unauthorized."
      });
    }

    userId =
      user.id;

    const body =
      typeof req.body ===
      "string"
        ? JSON.parse(req.body)
        : req.body || {};

    /* =====================================================
       REQUEST VALUES
    ===================================================== */

    let countryId =
      body.countryId ??
      body.country_id ??
      body.country?.id ??
      "";

    let countryName =
      body.countryName ??
      body.country_name ??
      body.country?.name ??
      "";

    const serviceId =
      body.serviceId ??
      body.service_id ??
      body.serviceCountryPriceId ??
      body.service_country_price_id ??
      "";

    const serviceName =
      body.serviceName ??
      body.service_name ??
      "";

    const serviceCountryPriceId =
      body.serviceCountryPriceId ??
      body.service_country_price_id ??
      "";

    const providerServer =
      body.providerServer ??
      body.provider_server ??
      body.server ??
      "";

    const selectedServer =
      String(
        providerServer
      ).trim();

    /* =====================================================
       BASIC VALIDATION
    ===================================================== */

    if (
      !selectedServer
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Please select a seller/server."
      });
    }

    if (
      !ALLOWED_SERVERS.includes(
        selectedServer
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid seller/server selected."
      });
    }

    /*
     * Try to obtain country ID from the
     * product_prices table if the frontend
     * did not send it.
     */
    if (
      !String(countryId).trim()
    ) {
      let countryQuery =
        supabase
          .from("product_prices")
          .select(
            "country_id,country_name"
          )
          .eq(
            "provider_server",
            selectedServer
          )
          .eq(
            "is_active",
            true
          )
          .limit(50);

      if (
        countryName
      ) {
        countryQuery =
          countryQuery.eq(
            "country_name",
            countryName
          );
      }

      if (
        serviceName
      ) {
        countryQuery =
          countryQuery.eq(
            "service_name",
            serviceName
          );
      }

      const {
        data: countryRows
      } =
        await countryQuery;

      if (
        countryRows?.length
      ) {
        countryId =
          countryRows[0].country_id;

        if (
          !countryName
        ) {
          countryName =
            countryRows[0].country_name ||
            "";
        }
      }
    }

    const normalizedCountryId =
      String(
        countryId || ""
      ).trim();

    if (
      !normalizedCountryId
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The country id field is required."
      });
    }

    if (
      !serviceId &&
      !serviceName
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The service field is required."
      });
    }

    /* =====================================================
       RESOLVE PROVIDER SERVICE
    ===================================================== */

    const providerService =
      await resolveProviderServiceId(
        selectedServer,
        normalizedCountryId,
        serviceId,
        serviceName
      );

    /* =====================================================
       GET CUSTOMER SELLING PRICE
    ===================================================== */

    const pricing =
      await getSellingPrice({
        countryId:
          normalizedCountryId,

        countryName,

        serviceId:
          providerService.id,

        serviceName:
          providerService.name,

        server:
          selectedServer
      });

    /*
     * If product_prices has the actual provider
     * service ID, use it.
     */
    const finalProviderServiceId =
      pricing.providerServiceId ||
      providerService.id;

    /* =====================================================
       GET PROVIDER COST
    ===================================================== */

    const providerCost =
      await getProviderPrice({
        server:
          selectedServer,

        countryId:
          normalizedCountryId,

        serviceId:
          finalProviderServiceId,

        serviceName:
          providerService.name,

        fallback:
          pricing.providerCost
      });

    /*
     * provider_cost is NOT NULL in orders.
     * If we still don't know the provider cost,
     * use the saved product price.
     */
    const safeProviderCost =
      Number.isFinite(
        Number(providerCost)
      )
        ? Number(providerCost)
        : Number(
            pricing.providerCost
          );

    if (
      !Number.isFinite(
        safeProviderCost
      ) ||
      safeProviderCost < 0
    ) {
      throw new Error(
        "Provider price is unavailable for the selected server and service."
      );
    }

    /* =====================================================
       SELLING PRICE
    ===================================================== */

    const sellingPrice =
      Number(
        pricing.sellingPrice
      );

    if (
      !Number.isFinite(
        sellingPrice
      ) ||
      sellingPrice <= 0
    ) {
      throw new Error(
        "The selling price is invalid."
      );
    }

    debitAmount =
      sellingPrice;

    /* =====================================================
       CHECK WALLET BEFORE PROVIDER PURCHASE
    ===================================================== */

    const wallet =
      await getWallet(userId);

    const currentBalance =
      Number(
        wallet.balance || 0
      );

    if (
      !Number.isFinite(
        currentBalance
      ) ||
      currentBalance <
        sellingPrice
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        balance:
          currentBalance,
        required:
          sellingPrice
      });
    }

    /* =====================================================
       DEBIT WALLET FIRST
    ===================================================== */

    /*
     * Reserve the customer's money before purchasing
     * from the provider.
     *
     * The transaction is temporarily referenced by the
     * selected service/server. A final provider reference
     * is recorded after purchase.
     */
    const debitReference =
      `purchase-${Date.now()}-${userId}`;

    const debit =
      await debitWallet(
        userId,
        sellingPrice,
        debitReference
      );

    if (
      !debit.success
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        balance:
          debit.balance,
        required:
          sellingPrice
      });
    }

    walletDebited =
      true;

    /* =====================================================
       PURCHASE FROM SELECTED SERVER
    ===================================================== */

    let providerResponse;

    try {
      providerResponse =
        await purchaseFromProvider({
          server:
            selectedServer,

          countryId:
            normalizedCountryId,

          serviceId:
            finalProviderServiceId
        });
    } catch (
      providerError
    ) {
      /*
       * Provider purchase failed.
       * Return the customer's money immediately.
       */
      await refundWallet(
        userId,
        sellingPrice,
        debitReference
      );

      walletDebited =
        false;

      return res.status(502).json({
        success: false,
        error:
          providerError?.message ||
          "Unable to purchase number from the selected server.",

        server:
          selectedServer
      });
    }

    /* =====================================================
       READ PROVIDER RESPONSE
    ===================================================== */

    const verification =
      extractVerification(
        providerResponse
      );

    if (
      !verification.verificationId
    ) {
      await refundWallet(
        userId,
        sellingPrice,
        debitReference
      );

      walletDebited =
        false;

      return res.status(502).json({
        success: false,
        error:
          "The selected server did not return a verification ID.",

        server:
          selectedServer
      });
    }

    if (
      !verification.phoneNumber
    ) {
      await refundWallet(
        userId,
        sellingPrice,
        verification.verificationId
      );

      walletDebited =
        false;

      return res.status(502).json({
        success: false,
        error:
          "The selected server did not return a phone number.",

        server:
          selectedServer
      });
    }

    providerVerificationId =
      verification.verificationId;

    /* =====================================================
       SAVE ORDER
    ===================================================== */

    let order;

    try {
      order =
        await createOrder({
          userId,

          providerOrderId:
            verification.requestId ||
            providerResponse?.order_id ||
            providerResponse?.provider_order_id ||
            verification.verificationId,

          providerVerificationId:
            verification.verificationId,

          serviceCountryPriceId:
            serviceCountryPriceId ||
            pricing.id,

          serviceName:
            pricing.serviceName ||
            providerService.name ||
            serviceName,

          countryName:
            pricing.countryName ||
            countryName ||
            "",

          providerPrice:
            safeProviderCost,

          sellingPrice,

          phoneNumber:
            verification.phoneNumber,

          status:
            verification.status ||
            "active",

          providerServer:
            selectedServer,

          providerExpiredAt:
            verification.expiredAt ||
            null
        });
    } catch (
      orderError
    ) {
      /*
       * Local database failed after provider purchase.
       *
       * Refund customer so the customer's wallet
       * is not permanently lost.
       */
      try {
        await refundWallet(
          userId,
          sellingPrice,
          verification.verificationId
        );
      } catch (
        refundError
      ) {
        console.error(
          "Order-save refund failed:",
          refundError
        );
      }

      walletDebited =
        false;

      throw orderError;
    }

    /* =====================================================
       SUCCESS
    ===================================================== */

    walletDebited =
      false;

    return res.status(200).json({
      success:
        true,

      message:
        "Number purchased successfully.",

      order,

      number:
        verification.phoneNumber,

      phoneNumber:
        verification.phoneNumber,

      verificationId:
        verification.verificationId,

      requestId:
        verification.requestId ||
        verification.verificationId,

      status:
        verification.status ||
        "active",

      expiredAt:
        verification.expiredAt ||
        null,

      countryId:
        normalizedCountryId,

      countryName:
        pricing.countryName ||
        countryName ||
        "",

      serviceId:
        finalProviderServiceId,

      serviceName:
        providerService.name ||
        serviceName,

      server:
        selectedServer,

      seller:
        selectedServer,

      providerServer:
        selectedServer,

      providerCost:
        safeProviderCost,

      price:
        sellingPrice,

      profit:
        sellingPrice -
        safeProviderCost,

      balance:
        debit.balance
    });

  } catch (error) {
    console.error(
      "Virtual number purchase error:",
      error
    );

    /*
     * If money was still marked as debited,
     * return it to the customer.
     */
    if (
      walletDebited &&
      userId &&
      debitAmount > 0
    ) {
      try {
        await refundWallet(
          userId,
          debitAmount,
          providerVerificationId
        );
      } catch (
        refundError
      ) {
        console.error(
          "Automatic refund failed:",
          refundError
        );
      }
    }

    return res.status(500).json({
      success:
        false,

      error:
        error?.message ||
        "Unable to purchase number."
    });
  }
}
