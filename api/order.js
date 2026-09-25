// api/order.js

import {
  sureVerificationRequest
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_SERVERS = [
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
];

const SURE_BASE_URL =
  "https://sureverifications.com/api/v1";


function quote(value) {
  return encodeURIComponent(String(value ?? ""));
}


function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}


async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
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


async function supabaseRequest(
  path,
  options = {}
) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
        ...(options.headers || {})
      }
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
      data?.error ||
      data?.hint ||
      data?.details ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}


function getProviderPrice(data) {
  return Number(
    data?.price ??
    data?.data?.price ??
    data?.amount ??
    data?.data?.amount ??
    data?.verification?.price ??
    data?.verification?.amount
  );
}


function getVerification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data
  );
}


/*
 * IMPORTANT:
 *
 * request_id and verification.id are DIFFERENT.
 *
 * request_id:
 *   Used as the provider request reference.
 *
 * verification.id:
 *   Numeric verification ID used by:
 *   /verifications/sms/:verificationId
 *   /verifications/cancel/:verificationId
 */

function getProviderRequestId(data) {
  const verification =
    getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
    null
  );
}


function getProviderVerificationId(data) {
  const verification =
    getVerification(data);

  const id =
    verification?.id ??
    verification?.verification_id ??
    verification?.verificationId ??
    null;

  if (
    id === null ||
    id === undefined ||
    String(id).trim() === ""
  ) {
    return null;
  }

  return String(id).trim();
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


/*
 * ---------------------------------------------------------
 * WALLET
 * ---------------------------------------------------------
 */

async function debitWallet(
  userId,
  amount
) {
  const requiredAmount =
    Number(amount);

  if (
    !Number.isFinite(requiredAmount) ||
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
      Number(wallet.balance || 0);

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
            balance: newBalance,
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
      Number(wallet.balance || 0);

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
            balance: newBalance,
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
          user_id: userId,
          amount,
          balance_after:
            balanceAfter,
          type: "order",
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


/*
 * ---------------------------------------------------------
 * SERVICES
 * ---------------------------------------------------------
 */

async function getServicesFromServer(
  server,
  countryId
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${quote(
        countryId
      )}`
    );

  if (
    Array.isArray(data?.services)
  ) {
    return data.services;
  }

  if (
    Array.isArray(data?.data)
  ) {
    return data.data;
  }

  if (Array.isArray(data)) {
    return data;
  }

  return [];
}


async function resolveServiceOnSelectedServer({
  server,
  countryId,
  serviceId,
  serviceName
}) {
  const services =
    await getServicesFromServer(
      server,
      countryId
    );

  if (!services.length) {
    throw new Error(
      `No services are available on ${server} for this country.`
    );
  }

  const wantedId =
    String(serviceId || "")
      .trim()
      .toLowerCase();

  const wantedName =
    String(serviceName || "")
      .trim()
      .toLowerCase();

  let matched =
    services.find(
      (service) => {
        const id =
          service?.id ??
          service?.service_id ??
          service?.serviceId;

        return (
          String(id || "")
            .trim()
            .toLowerCase() ===
          wantedId
        );
      }
    );

  if (!matched && wantedName) {
    matched =
      services.find(
        (service) => {
          const name =
            service?.name ??
            service?.service_name ??
            service?.serviceName;

          return (
            String(name || "")
              .trim()
              .toLowerCase() ===
            wantedName
          );
        }
      );
  }

  if (!matched) {
    throw new Error(
      `${serviceName || "This service"} is not available on ${server}.`
    );
  }

  return {
    id:
      matched?.id ??
      matched?.service_id ??
      matched?.serviceId,

    name:
      matched?.name ??
      matched?.service_name ??
      matched?.serviceName ??
      serviceName
  };
}


/*
 * ---------------------------------------------------------
 * PURCHASE FROM SELECTED SERVER
 * ---------------------------------------------------------
 */

async function purchaseFromSelectedServer({
  server,
  countryId,
  serviceId,
  serviceName
}) {
  if (
    !ALLOWED_SERVERS.includes(
      server
    )
  ) {
    throw new Error(
      "Invalid server selected."
    );
  }


  /*
   * GLOBAL SERVER 2
   *
   * The documented endpoint is:
   * POST /global-server-2/purchase
   *
   * Some provider responses/account configurations
   * can return "country id is required".
   *
   * We first use the documented request.
   * If that exact validation error occurs,
   * retry using country_id + service.
   */

  if (
    server ===
    "global-server-2"
  ) {
    try {
      return await sureVerificationRequest(
        "/global-server-2/purchase",
        {
          method: "POST"
        }
      );
    } catch (firstError) {
      const firstMessage =
        String(
          firstError?.message ||
          ""
        ).toLowerCase();

      const requiresCountry =
        firstMessage.includes(
          "country"
        ) &&
        (
          firstMessage.includes(
            "required"
          ) ||
          firstMessage.includes(
            "field"
          )
        );

      if (!requiresCountry) {
        throw firstError;
      }

      const providerService =
        await resolveServiceOnSelectedServer({
          server,
          countryId,
          serviceId,
          serviceName
        });

      return await sureVerificationRequest(
        `/global-server-2/purchase?country_id=${quote(
          countryId
        )}&service=${quote(
          providerService.id
        )}`,
        {
          method: "POST"
        }
      );
    }
  }


  /*
   * USA SERVER 1
   * USA SERVER 2
   * GLOBAL SERVER 1
   */

  const providerService =
    await resolveServiceOnSelectedServer({
      server,
      countryId,
      serviceId,
      serviceName
    });

  return await sureVerificationRequest(
    `/${server}/purchase?country_id=${quote(
      countryId
    )}&service=${quote(
      providerService.id
    )}`,
    {
      method: "POST"
    }
  );
}


/*
 * ---------------------------------------------------------
 * CREATE ORDER
 * ---------------------------------------------------------
 */

async function createOrder(
  userId,
  order
) {
  const providerCost =
    Number.isFinite(
      Number(order.providerPrice)
    )
      ? Number(order.providerPrice)
      : 0;

  const sellingPrice =
    Number(order.sellingPrice);

  return await supabaseRequest(
    "orders",
    {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,

        /*
         * KEEP request_id in provider_order_id
         * for compatibility with existing orders.
         */
        provider_order_id:
          order.providerRequestId ||
          null,

        /*
         * THIS is the numeric verification.id
         * used by the SMS and cancel endpoints.
         */
        provider_verification_id:
          order.providerVerificationId ||
          null,

        service_country_price_id:
          order.serviceCountryPriceId ||
          null,

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

        provider_name:
          "SureVerification",

        provider_server:
          order.providerServer,

        provider_base_url:
          SURE_BASE_URL,

        provider_expired_at:
          order.providerExpiredAt ||
          null
      })
    }
  );
}


/*
 * ---------------------------------------------------------
 * MAIN HANDLER
 * ---------------------------------------------------------
 */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  let user = null;
  let debited = false;
  let debitAmount = 0;

  try {
    user =
      await getAuthenticatedUser(
        req
      );

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : (req.body || {});


    const countryId =
      body.countryId ??
      body.country_id;

    const countryName =
      body.countryName ??
      body.country_name ??
      "";


    const serviceId =
      body.serviceId ??
      body.service_id ??
      body.serviceCountryPriceId ??
      body.service_country_price_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";


    const selectedServer =
      body.providerServer ??
      body.provider_server ??
      body.server ??
      "";


    if (!countryId) {
      return res.status(400).json({
        success: false,
        error:
          "The country id field is required."
      });
    }


    if (!serviceId) {
      return res.status(400).json({
        success: false,
        error:
          "The service id field is required."
      });
    }


    if (!selectedServer) {
      return res.status(400).json({
        success: false,
        error:
          "Please select a server."
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
          "Invalid server selected."
      });
    }


    /*
     * -----------------------------------------------------
     * PRICING
     * -----------------------------------------------------
     */

    const pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${quote(
          countryId
        )}&provider_server=eq.${quote(
          selectedServer
        )}&is_active=eq.true&select=*&limit=100`
      );


    if (
      !Array.isArray(
        pricingRows
      ) ||
      pricingRows.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          `This country and service is not configured for ${selectedServer}.`,
        server:
          selectedServer
      });
    }


    const normalizedServiceId =
      String(serviceId)
        .trim()
        .toLowerCase();

    const normalizedServiceName =
      String(
        requestedServiceName
      )
        .trim()
        .toLowerCase();


    let pricing =
      pricingRows.find(
        (row) =>
          String(
            row?.provider_service_id ||
            ""
          )
            .trim()
            .toLowerCase() ===
          normalizedServiceId
      );


    if (!pricing) {
      pricing =
        pricingRows.find(
          (row) =>
            String(
              row?.service_id ||
              ""
            )
              .trim()
              .toLowerCase() ===
            normalizedServiceId
        );
    }


    if (
      !pricing &&
      normalizedServiceName
    ) {
      pricing =
        pricingRows.find(
          (row) =>
            String(
              row?.service_name ||
              ""
            )
              .trim()
              .toLowerCase() ===
            normalizedServiceName
        );
    }


    if (!pricing) {
      pricing =
        pricingRows.find(
          (row) =>
            String(
              row?.id ||
              ""
            )
              .trim()
              .toLowerCase() ===
            normalizedServiceId
        );
    }


    if (!pricing) {
      return res.status(400).json({
        success: false,
        error:
          `${requestedServiceName || "This service"} is not configured for ${selectedServer}.`,
        server:
          selectedServer
      });
    }


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
      String(serviceId);


    /*
     * -----------------------------------------------------
     * DEBIT
     * -----------------------------------------------------
     */

    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited = true;
    debitAmount =
      sellingPrice;


    /*
     * -----------------------------------------------------
     * PROVIDER PURCHASE
     * -----------------------------------------------------
     */

    let providerData;

    try {
      providerData =
        await purchaseFromSelectedServer({
          server:
            selectedServer,

          countryId,

          serviceId:
            pricing?.provider_service_id ||
            pricing?.service_id ||
            serviceId,

          serviceName
        });

    } catch (
      providerError
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
          "Automatic purchase refund failed:",
          refundError
        );
      }

      debited = false;

      throw new Error(
        providerError?.message ||
        `Unable to purchase number from ${selectedServer}.`
      );
    }


    /*
     * -----------------------------------------------------
     * PROVIDER RESPONSE
     * -----------------------------------------------------
     */

    const verification =
      getVerification(
        providerData
      );

    const providerRequestId =
      getProviderRequestId(
        providerData
      );

    const providerVerificationId =
      getProviderVerificationId(
        providerData
      );

    const phoneNumber =
      getPhoneNumber(
        providerData
      );


    if (
      !providerVerificationId ||
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

      debited = false;

      throw new Error(
        "The provider did not return a valid verification ID and number. Your wallet was refunded."
      );
    }


    const providerPrice =
      getProviderPrice(
        providerData
      );


    /*
     * -----------------------------------------------------
     * CREATE ORDER
     * -----------------------------------------------------
     */

    let orderRows;

    try {
      orderRows =
        await createOrder(
          user.id,
          {
            countryId,

            countryName:
              pricing?.country_name ||
              countryName ||
              String(countryId),

            serviceCountryPriceId:
              pricing?.id ||
              null,

            serviceId:
              pricing?.service_id ||
              serviceId,

            serviceName,

            providerRequestId,

            providerVerificationId,

            phoneNumber,

            sellingPrice,

            providerPrice:
              Number.isFinite(
                providerPrice
              )
                ? providerPrice
                : 0,

            providerServer:
              selectedServer,

            providerExpiredAt:
              verification?.expired_at ||
              verification?.expiredAt ||
              null,

            status:
              verification?.status ||
              "active"
          }
        );

    } catch (
      orderError
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
          "Refund after order creation failure failed:",
          refundError
        );
      }

      debited = false;

      throw orderError;
    }


    /*
     * -----------------------------------------------------
     * WALLET TRANSACTION
     * -----------------------------------------------------
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


    await createWalletTransaction({
      userId:
        user.id,

      amount:
        -sellingPrice,

      balanceAfter,

      description:
        `Purchase: ${serviceName} ${phoneNumber} from ${selectedServer}`
    });


    debited = false;


    /*
     * -----------------------------------------------------
     * SUCCESS
     * -----------------------------------------------------
     */

    return res.status(200).json({
      success: true,

      message:
        "Number purchased successfully.",

      server:
        selectedServer,

      provider_server:
        selectedServer,

      seller:
        selectedServer,

      order:
        orderRows?.[0] ||
        null,

      verification: {
        ...verification,

        request_id:
          providerRequestId,

        id:
          providerVerificationId,

        number:
          phoneNumber
      },

      phoneNumber,

      selling_price:
        sellingPrice,

      sellingPrice,

      provider_price:
        Number.isFinite(
          providerPrice
        )
          ? providerPrice
          : null,

      balance:
        balanceAfter
    });

  } catch (error) {
    console.error(
      "Order purchase error:",
      error
    );


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
        .includes("insufficient")
    ) {
      return res.status(400).json({
        success: false,
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
        success: false,
        error: message
      });
    }


    return res.status(500).json({
      success: false,
      error: message,
      message
    });
  }
}
