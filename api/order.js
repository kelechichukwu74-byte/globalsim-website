import {
  sureVerificationRequest
} from "./_lib.js";

/*
 * =========================================================
 * SUPABASE CONFIG
 * =========================================================
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/*
 * =========================================================
 * AUTHENTICATION
 * =========================================================
 */

function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (
    typeof header !== "string" ||
    !header.startsWith("Bearer ")
  ) {
    return null;
  }

  const token =
    header.slice(7).trim();

  return token || null;
}


async function getAuthenticatedUser(req) {
  const token =
    getBearerToken(req);

  if (!token) {
    const error =
      new Error("Unauthorized.");

    error.status = 401;

    throw error;
  }

  if (!SUPABASE_URL) {
    throw new Error(
      "SUPABASE_URL is not configured."
    );
  }

  if (!SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY is not configured."
    );
  }

  const response =
    await fetch(
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
    data = text
      ? JSON.parse(text)
      : {};
  } catch {
    const error =
      new Error("Unauthorized.");

    error.status = 401;

    throw error;
  }

  if (
    !response.ok ||
    !data?.id
  ) {
    const error =
      new Error("Unauthorized.");

    error.status = 401;

    throw error;
  }

  return data;
}


/*
 * =========================================================
 * SUPABASE REST
 * =========================================================
 */

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
        ...options,

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
            "return=representation",

          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  let data = {};

  try {
    data = text
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
      data?.hint ||
      data?.details ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}


/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

function quote(value) {
  return encodeURIComponent(
    String(value ?? "")
  );
}


function normalizeServiceName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}


function isUSA(
  countryId,
  countryCode,
  countryName
) {
  const values = [
    countryId,
    countryCode,
    countryName
  ].map(
    (value) =>
      String(value ?? "")
        .trim()
        .toLowerCase()
  );

  return (
    values.includes("us") ||
    values.includes("usa") ||
    values.includes("united states") ||
    values.includes(
      "united states of america"
    )
  );
}


/*
 * =========================================================
 * PROVIDER RESPONSE EXTRACTION
 *
 * Provider documentation returns:
 *
 * {
 *   data: {
 *     id,
 *     invoiceNo,
 *     status,
 *     totalPrice,
 *     orderDetail: [
 *       {
 *         id,
 *         phoneNumber,
 *         status,
 *         price,
 *         service: {...},
 *         country: {...}
 *       }
 *     ]
 *   },
 *   statusCode: 201,
 *   message: "success"
 * }
 * =========================================================
 */

function getProviderData(response) {
  return (
    response?.data?.data ||
    response?.data ||
    response
  );
}


function getOrderDetail(response) {
  const data =
    getProviderData(response);

  if (
    Array.isArray(
      data?.orderDetail
    ) &&
    data.orderDetail.length
  ) {
    return data.orderDetail[0];
  }

  if (
    Array.isArray(
      data?.orderDetails
    ) &&
    data.orderDetails.length
  ) {
    return data.orderDetails[0];
  }

  if (
    Array.isArray(
      data?.activations
    ) &&
    data.activations.length
  ) {
    return data.activations[0];
  }

  if (
    Array.isArray(
      data?.activation
    )
  ) {
    return data.activation[0];
  }

  if (
    data?.activation &&
    typeof data.activation === "object"
  ) {
    return data.activation;
  }

  return null;
}


function getActivationId(response) {
  const data =
    getProviderData(response);

  const detail =
    getOrderDetail(response);

  return (
    detail?.id ||
    detail?.activationId ||
    detail?.activation_id ||
    data?.activationId ||
    data?.activation_id ||
    data?.id ||
    null
  );
}


function getPhoneNumber(response) {
  const data =
    getProviderData(response);

  const detail =
    getOrderDetail(response);

  return (
    detail?.phoneNumber ||
    detail?.phone_number ||
    detail?.number ||
    data?.phoneNumber ||
    data?.phone_number ||
    data?.number ||
    null
  );
}


function getProviderPrice(response) {
  const data =
    getProviderData(response);

  const detail =
    getOrderDetail(response);

  const value =
    detail?.price ??
    data?.totalPrice ??
    data?.price ??
    null;

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}


/*
 * =========================================================
 * WALLET DEBIT
 * =========================================================
 */

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
        `wallets?user_id=eq.${quote(
          userId
        )}&select=user_id,balance&limit=1`
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
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${encodeURIComponent(
          currentBalance
        )}`,
        {
          method: "PATCH",

          body: JSON.stringify({
            balance:
              newBalance,

            updated_at:
              new Date().toISOString()
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


/*
 * =========================================================
 * WALLET REFUND
 * =========================================================
 */

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
        `wallets?user_id=eq.${quote(
          userId
        )}&select=user_id,balance&limit=1`
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
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${encodeURIComponent(
          currentBalance
        )}`,
        {
          method: "PATCH",

          body: JSON.stringify({
            balance:
              newBalance,

            updated_at:
              new Date().toISOString()
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


/*
 * =========================================================
 * WALLET TRANSACTION
 * =========================================================
 */

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

        body: JSON.stringify({
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
    /*
     * Do not undo a successful purchase merely
     * because history logging failed.
     */
    console.error(
      "Wallet transaction history error:",
      error
    );
  }
}


/*
 * =========================================================
 * CREATE ORDER IN SUPABASE
 * =========================================================
 */

async function createOrder(
  userId,
  order
) {
  /*
   * IMPORTANT:
   *
   * provider_cost and profit are NOT NULL
   * in your current orders table.
   *
   * Therefore we always send numbers,
   * never null.
   */

  const providerCost =
    Number.isFinite(
      Number(order.providerPrice)
    )
      ? Number(
          order.providerPrice
        )
      : 0;

  const customerPrice =
    Number(order.sellingPrice);

  const profit =
    customerPrice -
    providerCost;

  return await supabaseRequest(
    "orders",
    {
      method: "POST",

      body: JSON.stringify({
        user_id:
          userId,

        provider_order_id:
          order.providerOrderId,

        provider_verification_id:
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
          customerPrice,

        profit:
          profit,

        status:
          order.status || "pending",

        phone_number:
          order.phoneNumber
      })
    }
  );
}


/*
 * =========================================================
 * MAIN API
 * =========================================================
 */

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "POST"
  ) {
    return res.status(405).json({
      success: false,
      error:
        "Method not allowed"
    });
  }

  let user = null;

  let debited = false;

  let debitAmount = 0;

  try {
    /*
     * -------------------------------------------------------
     * 1. AUTHENTICATE USER
     * -------------------------------------------------------
     */

    user =
      await getAuthenticatedUser(
        req
      );

    /*
     * -------------------------------------------------------
     * 2. READ REQUEST
     * -------------------------------------------------------
     */

    const body =
      req.body || {};

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

    const serviceCountryPriceId =
      body.serviceCountryPriceId ??
      body.service_country_price_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    const quantity =
      Number(body.quantity || 1);

    const autoSearchServer =
      body.autoSearchServer !== false;

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error:
          "Country is required."
      });
    }

    if (
      !serviceCountryPriceId
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Service is required."
      });
    }

    if (
      !Number.isInteger(quantity) ||
      quantity !== 1
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Only one number can be purchased at a time."
      });
    }

    /*
     * -------------------------------------------------------
     * 3. FIND YOUR SELLING PRICE
     * -------------------------------------------------------
     */

    let pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${quote(
          countryId
        )}&service_id=eq.${quote(
          serviceCountryPriceId
        )}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`
      );

    /*
     * Fallback:
     * if your product_prices service_id doesn't equal
     * the provider serviceCountryPriceId, match by
     * service name.
     */

    if (
      (!Array.isArray(
        pricingRows
      ) ||
        !pricingRows.length) &&
      requestedServiceName
    ) {
      const countryRows =
        await supabaseRequest(
          `product_prices?country_id=eq.${quote(
            countryId
          )}&select=country_id,country_name,service_id,service_name,selling_price`
        );

      const wanted =
        normalizeServiceName(
          requestedServiceName
        );

      pricingRows =
        Array.isArray(
          countryRows
        )
          ? countryRows.filter(
              (row) =>
                normalizeServiceName(
                  row?.service_name
                ) === wanted
            )
          : [];
    }

    const pricing =
      pricingRows?.[0];

    const sellingPrice =
      Number(
        pricing?.selling_price
      );

    if (
      !Number.isFinite(
        sellingPrice
      ) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "This country and service is not currently available for purchase."
      });
    }

    const serviceName =
      pricing?.service_name ||
      requestedServiceName ||
      String(
        serviceCountryPriceId
      );

    /*
     * -------------------------------------------------------
     * 4. IDENTIFY COUNTRY
     * -------------------------------------------------------
     */

    const usa =
      isUSA(
        countryId,
        countryCode,
        countryName
      );

    /*
     * We deliberately DO NOT create:
     *
     * /usa-server-2/purchase
     *
     * because that is not part of the documented API.
     *
     * autoSearchServer is the provider-supported
     * mechanism for moving between available server
     * price tiers.
     */

    console.log(
      "Purchase request:",
      {
        userId:
          user.id,

        countryId,

        countryName,

        countryCode,

        usa,

        serviceCountryPriceId,

        serviceName,

        quantity,

        autoSearchServer
      }
    );

    /*
     * -------------------------------------------------------
     * 5. DEBIT CUSTOMER
     * -------------------------------------------------------
     */

    await debitWallet(
      user.id,
      sellingPrice
    );

    debited = true;

    debitAmount =
      sellingPrice;

    /*
     * -------------------------------------------------------
     * 6. PLACE REAL PROVIDER ORDER
     *
     * DOCUMENTED PROVIDER ROUTE:
     *
     * POST /v1/orders/request-single-service
     *
     * Body:
     * {
     *   serviceCountryPriceId,
     *   quantity,
     *   autoSearchServer
     * }
     * -------------------------------------------------------
     */

    let providerResponse;

    try {
      providerResponse =
        await sureVerificationRequest(
          "/orders/request-single-service",
          {
            method: "POST",

            body: {
              serviceCountryPriceId:
                String(
                  serviceCountryPriceId
                ),

              quantity:
                quantity,

              autoSearchServer:
                autoSearchServer
            }
          }
        );
    } catch (providerError) {
      console.error(
        "SureVerification order failed:",
        {
          message:
            providerError?.message,

          status:
            providerError?.status,

          code:
            providerError?.code,

          providerResponse:
            providerError?.providerResponse
        }
      );

      throw providerError;
    }

    console.log(
      "SureVerification order response:",
      JSON.stringify(
        providerResponse
      )
    );

    /*
     * -------------------------------------------------------
     * 7. EXTRACT ACTIVATION
     * -------------------------------------------------------
     */

    const providerData =
      getProviderData(
        providerResponse
      );

    const detail =
      getOrderDetail(
        providerResponse
      );

    const verificationId =
      getActivationId(
        providerResponse
      );

    const phoneNumber =
      getPhoneNumber(
        providerResponse
      );

    const providerPrice =
      getProviderPrice(
        providerResponse
      );

    /*
     * Provider's top-level order ID.
     */

    const providerOrderId =
      providerData?.id ||
      providerData?.orderId ||
      providerData?.order_id ||
      verificationId;

    if (
      !verificationId ||
      !phoneNumber
    ) {
      throw new Error(
        "The provider did not return a valid activation number."
      );
    }

    /*
     * -------------------------------------------------------
     * 8. SAVE ORDER
     * -------------------------------------------------------
     */

    const orderRows =
      await createOrder(
        user.id,
        {
          providerOrderId:
            providerOrderId,

          verificationId:
            verificationId,

          serviceCountryPriceId:
            serviceCountryPriceId,

          serviceName:
            serviceName,

          countryName:
            pricing?.country_name ||
            countryName ||
            String(countryId),

          providerPrice:
            providerPrice,

          sellingPrice:
            sellingPrice,

          phoneNumber:
            phoneNumber,

          /*
           * Provider status 0 means PENDING.
           * We use pending until the activation
           * status endpoint confirms it is ready.
           */
          status:
            "pending"
        }
      );

    /*
     * -------------------------------------------------------
     * 9. READ REMAINING WALLET
     * -------------------------------------------------------
     */

    const walletRows =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          user.id
        )}&select=balance&limit=1`
      );

    const balanceAfter =
      Number(
        walletRows?.[0]?.balance ||
        0
      );

    /*
     * -------------------------------------------------------
     * 10. TRANSACTION HISTORY
     * -------------------------------------------------------
     */

    await createWalletTransaction({
      userId:
        user.id,

      amount:
        -sellingPrice,

      balanceAfter:
        balanceAfter,

      description:
        `Purchase: ${serviceName} ${phoneNumber}`
    });

    /*
     * The purchase is completely recorded.
     * Disable the safety refund.
     */

    debited = false;

    /*
     * -------------------------------------------------------
     * 11. RETURN TO FRONTEND
     * -------------------------------------------------------
     */

    return res.status(200).json({
      success:
        true,

      message:
        "Number purchased successfully.",

      order:
        orderRows?.[0] ||
        null,

      verification: {
        id:
          verificationId,

        verification_id:
          verificationId,

        request_id:
          providerOrderId,

        number:
          phoneNumber,

        phone_number:
          phoneNumber,

        phoneNumber:
          phoneNumber,

        status:
          detail?.status ??
          providerData?.status ??
          0
      },

      provider_order_id:
        providerOrderId,

      provider_verification_id:
        verificationId,

      provider_price:
        providerPrice,

      selling_price:
        sellingPrice,

      country_id:
        countryId,

      country_name:
        pricing?.country_name ||
        countryName,

      country_code:
        countryCode,

      service_name:
        serviceName,

      /*
       * This tells you which country routing was used.
       * It does NOT pretend that the provider API has a
       * custom /usa-server-2 endpoint.
       */
      provider_routing:
        usa
          ? "USA"
          : "GLOBAL",

      balance:
        balanceAfter
    });

  } catch (error) {
    console.error(
      "Order purchase error:",
      error
    );

    /*
     * -------------------------------------------------------
     * SAFETY REFUND
     * -------------------------------------------------------
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

        console.log(
          "Purchase refunded:",
          {
            userId:
              user.id,

            amount:
              debitAmount
          }
        );
      } catch (refundError) {
        console.error(
          "Safety refund failed:",
          refundError
        );
      }
    }

    const message =
      error?.message ||
      "Unable to purchase number.";

    const lower =
      String(message)
        .toLowerCase();

    /*
     * Wallet
     */

    if (
      lower.includes(
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

    /*
     * Authentication
     */

    if (
      error?.status === 401 ||
      message ===
        "Unauthorized."
    ) {
      return res.status(401).json({
        success:
          false,

        error:
          "Your login session has expired. Please log in again.",

        message:
          "Your login session has expired. Please log in again."
      });
    }

    /*
     * Provider no-number / service errors
     */

    if (
      lower.includes(
        "no_numbers"
      ) ||
      lower.includes(
        "no numbers"
      )
    ) {
      return res.status(409).json({
        success:
          false,

        error:
          "No numbers are currently available for this service and country.",

        message:
          "No numbers are currently available for this service and country."
      });
    }

    /*
     * Provider authentication
     */

    if (
      lower.includes(
        "api key"
      ) ||
      lower.includes(
        "authentication failed"
      ) ||
      lower.includes(
        "invalid api"
      )
    ) {
      return res.status(502).json({
        success:
          false,

        error:
          "The number provider authentication failed. Please contact support.",

        message:
          "The number provider authentication failed. Please contact support."
      });
    }

    /*
     * Everything else
     */

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
