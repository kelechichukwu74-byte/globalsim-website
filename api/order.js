import { sureVerificationRequest } from "./sms/_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, data) {
  return res.status(status).json(data);
}

function getBearerToken(req) {
  const authorization =
    req.headers.authorization ||
    req.headers.Authorization ||
    req.headers["x-authorization"];

  if (!authorization) return null;

  if (authorization.startsWith("Bearer ")) {
    return authorization.substring(7).trim();
  }

  return authorization.trim();
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured in Vercel."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}${path}`,
    {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...(options.body !== undefined
        ? {
            body:
              typeof options.body === "string"
                ? options.body
                : JSON.stringify(options.body)
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
      data?.details ||
      text ||
      `Supabase request failed with HTTP ${response.status}.`;

    throw new Error(
      `Supabase HTTP ${response.status}: ${message}`
    );
  }

  return data;
}

function isUSA(countryId, countryName) {
  const id = String(countryId ?? "").trim();

  const name =
    String(countryName ?? "")
      .trim()
      .toLowerCase();

  return (
    id === "236" ||
    name === "us" ||
    name === "usa" ||
    name === "united states" ||
    name === "united states of america" ||
    name.includes("united states")
  );
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function serviceMatches(service, selected) {
  const selectedId = String(
    selected?.id ??
    selected?.serviceId ??
    ""
  ).trim();

  const selectedName = normalize(
    selected?.name ||
    selected?.serviceName ||
    ""
  );

  const providerId = String(
    service?.id ??
    service?.service_id ??
    ""
  ).trim();

  const providerName = normalize(
    service?.name ||
    service?.service_name ||
    ""
  );

  if (
    selectedId &&
    providerId &&
    selectedId === providerId
  ) {
    return true;
  }

  if (
    selectedName &&
    providerName &&
    selectedName === providerName
  ) {
    return true;
  }

  if (
    selectedName &&
    providerName &&
    (
      selectedName.includes(providerName) ||
      providerName.includes(selectedName)
    )
  ) {
    return true;
  }

  return false;
}

async function getUSAService(countryId, serviceName, serviceId) {
  const country =
    encodeURIComponent(
      String(countryId)
    );

  const result =
    await sureVerificationRequest(
      `/usa-server-2/services?country_id=${country}`
    );

  const services =
    Array.isArray(result?.services)
      ? result.services
      : [];

  if (!services.length) {
    throw new Error(
      `USA Server 2 returned no services for country ${countryId}.`
    );
  }

  const selected = {
    id: serviceId,
    name: serviceName
  };

  let match =
    services.find((service) =>
      serviceMatches(service, selected)
    );

  if (!match && serviceName) {
    const wanted = normalize(serviceName);

    match =
      services.find((service) => {
        const providerName =
          normalize(
            service?.name ||
            service?.service_name ||
            ""
          );

        return (
          providerName.includes(wanted) ||
          wanted.includes(providerName)
        );
      });
  }

  if (!match && serviceId) {
    match =
      services.find(
        (service) =>
          String(
            service?.id ??
            service?.service_id ??
            ""
          ) === String(serviceId)
      );
  }

  if (!match) {
    throw new Error(
      `USA Server 2 does not have the requested service. Requested service: "${serviceName}", service ID: "${serviceId}". Available services: ${services
        .map(
          (service) =>
            `${service?.name || "Unknown"} (${service?.id || "no-id"})`
        )
        .join(", ")}`
    );
  }

  return match;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Method not allowed.",
      message: "Method not allowed."
    });
  }

  let walletDebited = false;
  let debitedAmount = 0;
  let userId = null;

  try {
    console.log(
      "========== ORDER REQUEST START =========="
    );

    console.log(
      "ORDER BODY:",
      JSON.stringify(req.body)
    );

    const token = getBearerToken(req);

    if (!token) {
      console.error(
        "ORDER ERROR: Missing Authorization token."
      );

      return json(res, 401, {
        success: false,
        error: "Unauthorized.",
        message: "Unauthorized."
      });
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is not configured in Vercel."
      );
    }

    const {
      serviceCountryPriceId,
      quantity = 1,
      autoSearchServer = true,
      countryId,
      countryName,
      serviceName,
      serviceId
    } = req.body || {};

    console.log(
      "ORDER INPUT:",
      JSON.stringify({
        serviceCountryPriceId,
        quantity,
        autoSearchServer,
        countryId,
        countryName,
        serviceName,
        serviceId
      })
    );

    if (!serviceCountryPriceId) {
      throw new Error(
        "serviceCountryPriceId is missing from the purchase request."
      );
    }

    if (!countryId) {
      throw new Error(
        "countryId is missing from the purchase request."
      );
    }

    if (!serviceName && !serviceId) {
      throw new Error(
        "serviceName/serviceId is missing from the purchase request."
      );
    }

    const requestedQuantity =
      Math.max(
        1,
        Number(quantity) || 1
      );

    /*
     * ------------------------------------------------
     * 1. VERIFY SUPABASE USER
     * ------------------------------------------------
     */

    console.log(
      "Checking Supabase authenticated user..."
    );

    const userResponse =
      await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        {
          method: "GET",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization:
              `Bearer ${token}`
          }
        }
      );

    const userText =
      await userResponse.text();

    let userData = null;

    try {
      userData =
        userText
          ? JSON.parse(userText)
          : null;
    } catch {
      userData = null;
    }

    if (!userResponse.ok || !userData?.id) {
      console.error(
        "SUPABASE USER ERROR:",
        userText
      );

      return json(res, 401, {
        success: false,
        error: "Unauthorized.",
        message: "Unauthorized."
      });
    }

    userId = userData.id;

    console.log(
      "Authenticated user:",
      userId
    );

    /*
     * ------------------------------------------------
     * 2. GET PRODUCT PRICE
     * ------------------------------------------------
     */

    console.log(
      "Looking up product price..."
    );

    let priceRows =
      await supabaseRequest(
        `/rest/v1/product_prices?id=eq.${encodeURIComponent(
          serviceCountryPriceId
        )}&select=*`
      );

    /*
     * Fallback if the supplied value isn't the
     * product_prices primary key.
     */

    if (
      !Array.isArray(priceRows) ||
      !priceRows.length
    ) {
      console.log(
        "Direct product price lookup returned no row. Trying country/service lookup..."
      );

      let fallbackQuery =
        `/rest/v1/product_prices?country_id=eq.${encodeURIComponent(
          countryId
        )}&select=*`;

      if (serviceId) {
        fallbackQuery +=
          `&service_id=eq.${encodeURIComponent(
            serviceId
          )}`;
      }

      priceRows =
        await supabaseRequest(
          fallbackQuery
        );
    }

    /*
     * Final fallback by service name.
     */

    if (
      !Array.isArray(priceRows) ||
      !priceRows.length
    ) {
      console.log(
        "Country/service lookup returned no row. Trying service-name lookup..."
      );

      priceRows =
        await supabaseRequest(
          `/rest/v1/product_prices?country_id=eq.${encodeURIComponent(
            countryId
          )}&select=*`
        );

      if (
        Array.isArray(priceRows) &&
        priceRows.length &&
        serviceName
      ) {
        const wanted =
          normalize(serviceName);

        priceRows =
          priceRows.filter((row) => {
            const rowName =
              normalize(
                row.service_name ||
                row.name ||
                row.service ||
                ""
              );

            return (
              rowName === wanted ||
              rowName.includes(wanted) ||
              wanted.includes(rowName)
            );
          });
      }
    }

    if (
      !Array.isArray(priceRows) ||
      !priceRows.length
    ) {
      throw new Error(
        `No product price found for country "${countryName || countryId}" and service "${serviceName || serviceId}". serviceCountryPriceId: "${serviceCountryPriceId}".`
      );
    }

    const productPrice =
      priceRows[0];

    console.log(
      "PRODUCT PRICE ROW:",
      JSON.stringify(productPrice)
    );

    const customerPrice =
      Number(
        productPrice.selling_price ??
        productPrice.price ??
        productPrice.amount ??
        productPrice.sell_price ??
        0
      );

    if (
      !Number.isFinite(customerPrice) ||
      customerPrice <= 0
    ) {
      throw new Error(
        `Invalid selling price in product_prices. Received: ${JSON.stringify(
          productPrice
        )}`
      );
    }

    const totalCustomerPrice =
      customerPrice *
      requestedQuantity;

    console.log(
      "CUSTOMER PRICE:",
      totalCustomerPrice
    );

    /*
     * ------------------------------------------------
     * 3. GET WALLET
     * ------------------------------------------------
     */

    console.log(
      "Loading customer wallet..."
    );

    const wallets =
      await supabaseRequest(
        `/rest/v1/wallets?user_id=eq.${encodeURIComponent(
          userId
        )}&select=*`
      );

    if (
      !Array.isArray(wallets) ||
      !wallets.length
    ) {
      throw new Error(
        "Customer wallet was not found."
      );
    }

    const wallet =
      wallets[0];

    const currentBalance =
      Number(
        wallet.balance ??
        wallet.amount ??
        wallet.wallet_balance ??
        0
      );

    if (
      !Number.isFinite(currentBalance)
    ) {
      throw new Error(
        `Invalid wallet balance: ${JSON.stringify(
          wallet
        )}`
      );
    }

    console.log(
      "CURRENT WALLET BALANCE:",
      currentBalance
    );

    if (
      currentBalance <
      totalCustomerPrice
    ) {
      return json(res, 400, {
        success: false,
        error: "Insufficient wallet balance.",
        message: "Insufficient wallet balance.",
        balance: currentBalance,
        required: totalCustomerPrice
      });
    }

    /*
     * ------------------------------------------------
     * 4. DEBIT WALLET
     * ------------------------------------------------
     */

    const newBalance =
      currentBalance -
      totalCustomerPrice;

    console.log(
      "Debiting wallet:",
      totalCustomerPrice
    );

    const walletId =
      wallet.id;

    if (!walletId) {
      throw new Error(
        "Wallet record does not contain an id."
      );
    }

    const updatedWallet =
      await supabaseRequest(
        `/rest/v1/wallets?id=eq.${encodeURIComponent(
          walletId
        )}`,
        {
          method: "PATCH",
          headers: {
            Prefer:
              "return=representation"
          },
          body: {
            balance: newBalance
          }
        }
      );

    if (
      !Array.isArray(updatedWallet) ||
      !updatedWallet.length
    ) {
      throw new Error(
        "Wallet debit failed: Supabase did not update the wallet."
      );
    }

    walletDebited = true;
    debitedAmount =
      totalCustomerPrice;

    console.log(
      "WALLET DEBIT SUCCESSFUL."
    );

    /*
     * ------------------------------------------------
     * 5. PURCHASE NUMBER FROM PROVIDER
     * ------------------------------------------------
     */

    let providerResult;
    let providerName;
    let providerVerificationId;
    let phoneNumber;

    const usa =
      isUSA(
        countryId,
        countryName
      );

    console.log(
      "PROVIDER ROUTING:",
      usa
        ? "USA SERVER 2"
        : "GLOBAL SERVER 2"
    );

    if (usa) {
      /*
       * USA SERVER 2
       *
       * First get the provider's service list.
       */

      const providerService =
        await getUSAService(
          countryId,
          serviceName,
          serviceId
        );

      console.log(
        "USA PROVIDER SERVICE:",
        JSON.stringify(
          providerService
        )
      );

      const providerServiceId =
        providerService.id ||
        providerService.service_id;

      if (!providerServiceId) {
        throw new Error(
          `USA Server 2 service "${providerService.name}" has no provider service ID.`
        );
      }

      const encodedCountry =
        encodeURIComponent(
          String(countryId)
        );

      const encodedService =
        encodeURIComponent(
          String(providerServiceId)
        );

      console.log(
        "Purchasing from USA Server 2..."
      );

      providerResult =
        await sureVerificationRequest(
          `/usa-server-2/purchase?country_id=${encodedCountry}&service=${encodedService}`,
          {
            method: "POST"
          }
        );

      providerName =
        "usa-server-2";
    } else {
      /*
       * GLOBAL SERVER 2
       *
       * IMPORTANT:
       * Provider documentation specifies that this
       * purchase endpoint takes NO country/service
       * query parameters.
       */

      console.log(
        "Purchasing from Global Server 2..."
      );

      providerResult =
        await sureVerificationRequest(
          "/global-server-2/purchase",
          {
            method: "POST"
          }
        );

      providerName =
        "global-server-2";
    }

    console.log(
      "PROVIDER PURCHASE RESPONSE:",
      JSON.stringify(
        providerResult
      )
    );

    const verification =
      providerResult?.verification;

    if (!verification) {
      throw new Error(
        `Provider purchase succeeded without a verification object. Provider response: ${JSON.stringify(
          providerResult
        )}`
      );
    }

    providerVerificationId =
      verification.request_id ??
      verification.id ??
      verification.verification_id ??
      null;

    phoneNumber =
      verification.number ??
      verification.phone ??
      verification.phone_number ??
      null;

    if (!providerVerificationId) {
      throw new Error(
        `Provider did not return a verification/request ID. Response: ${JSON.stringify(
          providerResult
        )}`
      );
    }

    if (!phoneNumber) {
      throw new Error(
        `Provider did not return a phone number. Response: ${JSON.stringify(
          providerResult
        )}`
      );
    }

    /*
     * ------------------------------------------------
     * 6. SAVE ORDER
     * ------------------------------------------------
     */

    console.log(
      "Saving order..."
    );

    const providerCost =
      Number(
        productPrice.provider_price ??
        productPrice.cost_price ??
        productPrice.buy_price ??
        productPrice.provider_cost ??
        0
      );

    const profit =
      customerPrice -
      providerCost;

    const orderPayload = {
      user_id: userId,

      country_id:
        String(countryId),

      country_name:
        countryName || null,

      service_id:
        serviceId ||
        productPrice.service_id ||
        null,

      service_name:
        serviceName ||
        productPrice.service_name ||
        null,

      product_price_id:
        productPrice.id ||
        serviceCountryPriceId,

      quantity:
        requestedQuantity,

      customer_price:
        customerPrice,

      total_amount:
        totalCustomerPrice,

      provider_cost:
        providerCost,

      profit,

      provider:
        providerName,

      provider_order_id:
        providerVerificationId,

      verification_id:
        providerVerificationId,

      phone_number:
        String(phoneNumber),

      status:
        verification.status ||
        "active"
    };

    console.log(
      "ORDER PAYLOAD:",
      JSON.stringify(
        orderPayload
      )
    );

    let savedOrders;

    try {
      savedOrders =
        await supabaseRequest(
          "/rest/v1/orders",
          {
            method: "POST",
            headers: {
              Prefer:
                "return=representation"
            },
            body: orderPayload
          }
        );
    } catch (orderInsertError) {
      /*
       * If the order table has slightly different
       * column names, expose the exact Supabase
       * error instead of hiding it.
       */

      console.error(
        "ORDER DATABASE INSERT ERROR:",
        orderInsertError
      );

      throw new Error(
        `Number purchased successfully from provider, but saving the order failed: ${orderInsertError.message}`
      );
    }

    console.log(
      "ORDER SAVED:",
      JSON.stringify(
        savedOrders
      )
    );

    /*
     * ------------------------------------------------
     * 7. SAVE WALLET TRANSACTION
     * ------------------------------------------------
     *
     * This should not make a successful purchase
     * fail if the transaction-history table has
     * a schema issue. The error is logged.
     */

    try {
      await supabaseRequest(
        "/rest/v1/wallet_transactions",
        {
          method: "POST",
          body: {
            user_id: userId,

            type: "purchase",

            amount:
              -totalCustomerPrice,

            description:
              `Purchase of ${phoneNumber} (${serviceName || "number"})`,

            reference:
              providerVerificationId,

            status:
              "completed"
          }
        }
      );

      console.log(
        "WALLET TRANSACTION SAVED."
      );
    } catch (transactionError) {
      console.error(
        "WALLET TRANSACTION SAVE ERROR:",
        transactionError
      );
    }

    /*
     * ------------------------------------------------
     * 8. SUCCESS
     * ------------------------------------------------
     */

    console.log(
      "========== ORDER SUCCESS =========="
    );

    return json(res, 200, {
      success: true,

      message:
        "Number purchased successfully.",

      order:
        Array.isArray(savedOrders)
          ? savedOrders[0]
          : savedOrders,

      number:
        String(phoneNumber),

      phoneNumber:
        String(phoneNumber),

      verificationId:
        providerVerificationId,

      requestId:
        providerVerificationId,

      provider:
        providerName,

      countryId:
        String(countryId),

      countryName:
        countryName || null,

      serviceName:
        serviceName ||
        verification.service ||
        null,

      status:
        verification.status ||
        "active",

      expiredAt:
        verification.expired_at ||
        null,

      balance:
        newBalance
    });

  } catch (error) {

    /*
     * ------------------------------------------------
     * REAL ERROR REPORTING
     * ------------------------------------------------
     */

    console.error(
      "========== ORDER ENDPOINT ERROR =========="
    );

    console.error(
      "ORDER ERROR MESSAGE:",
      error?.message
    );

    console.error(
      "ORDER ERROR STACK:",
      error?.stack
    );

    /*
     * ------------------------------------------------
     * REFUND WALLET IF IT WAS ALREADY DEBITED
     * ------------------------------------------------
     */

    if (
      walletDebited &&
      debitedAmount > 0 &&
      userId
    ) {
      try {
        console.log(
          "Attempting wallet refund:",
          debitedAmount
        );

        const refundWallets =
          await supabaseRequest(
            `/rest/v1/wallets?user_id=eq.${encodeURIComponent(
              userId
            )}&select=*`
          );

        if (
          Array.isArray(
            refundWallets
          ) &&
          refundWallets.length
        ) {
          const refundWallet =
            refundWallets[0];

          const refundBalance =
            Number(
              refundWallet.balance ??
              0
            ) +
            debitedAmount;

          await supabaseRequest(
            `/rest/v1/wallets?id=eq.${encodeURIComponent(
              refundWallet.id
            )}`,
            {
              method: "PATCH",
              headers: {
                Prefer:
                  "return=representation"
              },
              body: {
                balance:
                  refundBalance
              }
            }
          );

          console.log(
            "WALLET REFUND SUCCESSFUL."
          );
        }
      } catch (refundError) {
        console.error(
          "WALLET REFUND ERROR:",
          refundError
        );
      }
    }

    const rawMessage =
      error?.message ||
      "Unable to purchase number.";

    const lowerMessage =
      String(rawMessage)
        .toLowerCase();

    if (
      lowerMessage.includes(
        "unauthorized"
      )
    ) {
      return json(res, 401, {
        success: false,
        error: "Unauthorized.",
        message: "Unauthorized.",
        debug: rawMessage
      });
    }

    if (
      lowerMessage.includes(
        "insufficient wallet"
      )
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Insufficient wallet balance.",
        message:
          "Insufficient wallet balance."
      });
    }

    /*
     * IMPORTANT:
     * Return the real backend error so the frontend
     * displays it instead of the generic message.
     */

    return json(res, 500, {
      success: false,

      error:
        rawMessage,

      message:
        rawMessage,

      debug:
        rawMessage
    });
  }
}
