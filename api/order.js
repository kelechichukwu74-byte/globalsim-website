import { sureVerificationRequest } from "./sms/_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res, status, data) {
  return res.status(status).json(data);
}

function getToken(req) {
  const auth =
    req.headers.authorization ||
    req.headers.Authorization ||
    req.headers["x-authorization"];

  if (!auth) return null;

  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }

  return auth.trim();
}

async function supabaseRequest(
  path,
  options = {}
) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing from Vercel environment variables."
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

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    throw new Error(
      `Supabase HTTP ${response.status}: ${
        data?.message ||
        data?.error ||
        data?.details ||
        data?.raw ||
        "Unknown Supabase error"
      }`
    );
  }

  return data;
}

function isUSA(countryId, countryName) {
  const id =
    String(countryId || "").trim();

  const name =
    String(countryName || "")
      .trim()
      .toLowerCase();

  return (
    id === "236" ||
    name === "us" ||
    name === "usa" ||
    name === "united states" ||
    name === "united states of america"
  );
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function findUSAService(
  countryId,
  serviceName,
  serviceId
) {
  const result =
    await sureVerificationRequest(
      `/usa-server-2/services?country_id=${encodeURIComponent(
        countryId
      )}`
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

  const wantedName =
    normalize(serviceName);

  const wantedId =
    String(serviceId || "").trim();

  let service =
    services.find(
      item =>
        wantedId &&
        String(
          item?.id ||
          item?.service_id ||
          ""
        ) === wantedId
    );

  if (!service && wantedName) {
    service =
      services.find(item => {
        const providerName =
          normalize(
            item?.name ||
            item?.service_name ||
            ""
          );

        return (
          providerName === wantedName ||
          providerName.includes(wantedName) ||
          wantedName.includes(providerName)
        );
      });
  }

  if (!service) {
    throw new Error(
      `USA Server 2 service "${serviceName}" was not found. Available services: ${services
        .map(
          item =>
            `${item?.name || "Unknown"} (${item?.id || "no-id"})`
        )
        .join(", ")}`
    );
  }

  return service;
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return send(res, 405, {
      success: false,
      error: "Method not allowed.",
      message: "Method not allowed."
    });
  }

  let userId = null;
  let walletDebited = false;
  let debitAmount = 0;

  try {
    console.log(
      "========== /api/order START =========="
    );

    console.log(
      "REQUEST BODY:",
      JSON.stringify(req.body)
    );

    /*
     * -----------------------------------------
     * AUTHENTICATION
     * -----------------------------------------
     */

    const token = getToken(req);

    if (!token) {
      console.error(
        "ERROR: Authorization token missing."
      );

      return send(res, 401, {
        success: false,
        error: "Unauthorized.",
        message: "Unauthorized."
      });
    }

    /*
     * -----------------------------------------
     * REQUEST DATA
     * -----------------------------------------
     */

    const body = req.body || {};

    const {
      serviceCountryPriceId,
      quantity = 1,
      countryId,
      countryName,
      serviceName,
      serviceId
    } = body;

    console.log(
      "PURCHASE DATA:",
      JSON.stringify({
        serviceCountryPriceId,
        quantity,
        countryId,
        countryName,
        serviceName,
        serviceId
      })
    );

    if (!serviceCountryPriceId) {
      throw new Error(
        "Missing serviceCountryPriceId."
      );
    }

    if (!countryId) {
      throw new Error(
        "Missing countryId."
      );
    }

    if (!serviceName && !serviceId) {
      throw new Error(
        "Missing serviceName/serviceId."
      );
    }

    const qty =
      Math.max(
        1,
        Number(quantity) || 1
      );

    /*
     * -----------------------------------------
     * VERIFY SUPABASE USER
     * -----------------------------------------
     */

    console.log(
      "Verifying Supabase user..."
    );

    const userResponse =
      await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        {
          method: "GET",
          headers: {
            apikey:
              SUPABASE_SERVICE_ROLE_KEY,
            Authorization:
              `Bearer ${token}`
          }
        }
      );

    const userText =
      await userResponse.text();

    let user;

    try {
      user =
        userText
          ? JSON.parse(userText)
          : null;
    } catch {
      user = null;
    }

    if (
      !userResponse.ok ||
      !user?.id
    ) {
      console.error(
        "AUTH ERROR:",
        userText
      );

      return send(res, 401, {
        success: false,
        error: "Unauthorized.",
        message: "Unauthorized.",
        debug: userText
      });
    }

    userId = user.id;

    console.log(
      "USER VERIFIED:",
      userId
    );

    /*
     * -----------------------------------------
     * FIND SELLING PRICE
     * -----------------------------------------
     */

    console.log(
      "Finding product price..."
    );

    let prices =
      await supabaseRequest(
        `/rest/v1/product_prices?id=eq.${encodeURIComponent(
          serviceCountryPriceId
        )}&select=*`
      );

    if (
      !Array.isArray(prices) ||
      !prices.length
    ) {
      console.log(
        "Exact price ID not found. Trying country."
      );

      prices =
        await supabaseRequest(
          `/rest/v1/product_prices?country_id=eq.${encodeURIComponent(
            countryId
          )}&select=*`
        );
    }

    if (
      !Array.isArray(prices) ||
      !prices.length
    ) {
      throw new Error(
        `No product price exists for country ${countryName || countryId}.`
      );
    }

    /*
     * If there are multiple prices for the country,
     * try to match the requested service.
     */

    let productPrice =
      prices[0];

    if (
      prices.length > 1 &&
      serviceName
    ) {
      const wanted =
        normalize(serviceName);

      const matched =
        prices.find(row => {
          const rowService =
            normalize(
              row.service_name ||
              row.service ||
              row.name ||
              ""
            );

          return (
            rowService === wanted ||
            rowService.includes(wanted) ||
            wanted.includes(rowService)
          );
        });

      if (matched) {
        productPrice =
          matched;
      }
    }

    console.log(
      "SELECTED PRODUCT PRICE:",
      JSON.stringify(productPrice)
    );

    const sellingPrice =
      Number(
        productPrice.selling_price ??
        productPrice.price ??
        productPrice.amount ??
        productPrice.sell_price ??
        0
      );

    if (
      !Number.isFinite(sellingPrice) ||
      sellingPrice <= 0
    ) {
      throw new Error(
        `Invalid selling price: ${sellingPrice}. Product price row: ${JSON.stringify(
          productPrice
        )}`
      );
    }

    const totalPrice =
      sellingPrice * qty;

    /*
     * -----------------------------------------
     * GET WALLET
     * -----------------------------------------
     */

    console.log(
      "Getting wallet..."
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
        "Wallet not found for this account."
      );
    }

    const wallet =
      wallets[0];

    const balance =
      Number(
        wallet.balance ??
        wallet.wallet_balance ??
        wallet.amount ??
        0
      );

    console.log(
      "WALLET BALANCE:",
      balance
    );

    if (
      balance < totalPrice
    ) {
      return send(res, 400, {
        success: false,
        error:
          "Insufficient wallet balance.",
        message:
          "Insufficient wallet balance.",
        balance,
        required:
          totalPrice
      });
    }

    /*
     * -----------------------------------------
     * DEBIT WALLET
     * -----------------------------------------
     */

    const walletId =
      wallet.id;

    if (!walletId) {
      throw new Error(
        "Wallet ID is missing."
      );
    }

    const newBalance =
      balance - totalPrice;

    console.log(
      "DEBITING WALLET:",
      totalPrice
    );

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
            balance:
              newBalance
          }
        }
      );

    if (
      !Array.isArray(updatedWallet) ||
      !updatedWallet.length
    ) {
      throw new Error(
        "Wallet debit failed."
      );
    }

    walletDebited = true;
    debitAmount = totalPrice;

    console.log(
      "WALLET DEBITED."
    );

    /*
     * -----------------------------------------
     * PROVIDER PURCHASE
     * -----------------------------------------
     */

    const usa =
      isUSA(
        countryId,
        countryName
      );

    let providerResponse;
    let provider;
    let verification;

    if (usa) {
      /*
       * USA SERVER 2
       */

      console.log(
        "ROUTING TO USA SERVER 2..."
      );

      const providerService =
        await findUSAService(
          countryId,
          serviceName,
          serviceId
        );

      const providerServiceId =
        providerService.id ||
        providerService.service_id;

      if (!providerServiceId) {
        throw new Error(
          `USA Server 2 returned a service without an ID: ${JSON.stringify(
            providerService
          )}`
        );
      }

      console.log(
        "USA SERVICE:",
        JSON.stringify(
          providerService
        )
      );

      const purchasePath =
        `/usa-server-2/purchase?country_id=${encodeURIComponent(
          countryId
        )}&service=${encodeURIComponent(
          providerServiceId
        )}`;

      console.log(
        "USA PURCHASE PATH:",
        purchasePath
      );

      providerResponse =
        await sureVerificationRequest(
          purchasePath,
          {
            method: "POST"
          }
        );

      provider =
        "usa-server-2";
    } else {
      /*
       * GLOBAL SERVER 2
       */

      console.log(
        "ROUTING TO GLOBAL SERVER 2..."
      );

      providerResponse =
        await sureVerificationRequest(
          "/global-server-2/purchase",
          {
            method: "POST"
          }
        );

      provider =
        "global-server-2";
    }

    console.log(
      "PROVIDER RESPONSE:",
      JSON.stringify(
        providerResponse
      )
    );

    verification =
      providerResponse?.verification;

    if (!verification) {
      throw new Error(
        `Provider returned no verification object. Response: ${JSON.stringify(
          providerResponse
        )}`
      );
    }

    const requestId =
      verification.request_id ??
      verification.verification_id ??
      verification.id;

    const number =
      verification.number ??
      verification.phone ??
      verification.phone_number;

    if (!requestId) {
      throw new Error(
        `Provider did not return request_id. Response: ${JSON.stringify(
          providerResponse
        )}`
      );
    }

    if (!number) {
      throw new Error(
        `Provider did not return a phone number. Response: ${JSON.stringify(
          providerResponse
        )}`
      );
    }

    /*
     * -----------------------------------------
     * SAVE ORDER
     * -----------------------------------------
     */

    const providerCost =
      Number(
        productPrice.provider_price ??
        productPrice.provider_cost ??
        productPrice.cost_price ??
        0
      );

    const profit =
      sellingPrice -
      providerCost;

    const order =
      await supabaseRequest(
        "/rest/v1/orders",
        {
          method: "POST",
          headers: {
            Prefer:
              "return=representation"
          },
          body: {
            user_id:
              userId,

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
              verification.service ||
              null,

            product_price_id:
              productPrice.id ||
              serviceCountryPriceId,

            quantity:
              qty,

            customer_price:
              sellingPrice,

            total_amount:
              totalPrice,

            provider_cost:
              providerCost,

            profit,

            provider,

            provider_order_id:
              requestId,

            verification_id:
              requestId,

            phone_number:
              String(number),

            status:
              verification.status ||
              "active"
          }
        }
      );

    console.log(
      "ORDER SAVED:",
      JSON.stringify(order)
    );

    /*
     * -----------------------------------------
     * SAVE WALLET TRANSACTION
     * -----------------------------------------
     */

    try {
      await supabaseRequest(
        "/rest/v1/wallet_transactions",
        {
          method: "POST",
          body: {
            user_id:
              userId,

            type:
              "purchase",

            amount:
              -totalPrice,

            description:
              `Purchase of ${number}`,

            reference:
              requestId,

            status:
              "completed"
          }
        }
      );

      console.log(
        "WALLET TRANSACTION SAVED."
      );
    } catch (
      transactionError
    ) {
      console.error(
        "WALLET TRANSACTION ERROR:",
        transactionError
      );
    }

    /*
     * -----------------------------------------
     * SUCCESS
     * -----------------------------------------
     */

    console.log(
      "========== ORDER SUCCESS =========="
    );

    return send(res, 200, {
      success: true,

      message:
        "Number purchased successfully.",

      number:
        String(number),

      phoneNumber:
        String(number),

      verificationId:
        requestId,

      requestId,

      provider,

      service:
        verification.service ||
        serviceName ||
        null,

      countryId:
        String(countryId),

      countryName:
        countryName || null,

      status:
        verification.status ||
        "active",

      expiredAt:
        verification.expired_at ||
        null,

      balance:
        newBalance,

      order:
        Array.isArray(order)
          ? order[0]
          : order
    });

  } catch (error) {

    console.error(
      "========== ORDER ERROR =========="
    );

    console.error(
      "ERROR MESSAGE:",
      error?.message
    );

    console.error(
      "ERROR STACK:",
      error?.stack
    );

    /*
     * -----------------------------------------
     * REFUND IF WALLET WAS DEBITED
     * -----------------------------------------
     */

    if (
      walletDebited &&
      debitAmount > 0 &&
      userId
    ) {
      try {
        console.log(
          "Refunding wallet:",
          debitAmount
        );

        const wallets =
          await supabaseRequest(
            `/rest/v1/wallets?user_id=eq.${encodeURIComponent(
              userId
            )}&select=*`
          );

        if (
          Array.isArray(wallets) &&
          wallets.length
        ) {
          const wallet =
            wallets[0];

          const oldBalance =
            Number(
              wallet.balance || 0
            );

          await supabaseRequest(
            `/rest/v1/wallets?id=eq.${encodeURIComponent(
              wallet.id
            )}`,
            {
              method: "PATCH",
              headers: {
                Prefer:
                  "return=representation"
              },
              body: {
                balance:
                  oldBalance +
                  debitAmount
              }
            }
          );

          console.log(
            "WALLET REFUND SUCCESSFUL."
          );
        }
      } catch (
        refundError
      ) {
        console.error(
          "WALLET REFUND FAILED:",
          refundError
        );
      }
    }

    const message =
      error?.message ||
      "Unable to purchase number.";

    console.error(
      "RETURNING ERROR:",
      message
    );

    return send(res, 500, {
      success: false,

      error:
        message,

      message:
        message,

      debug:
        message
    });
  }
}
