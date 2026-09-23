import {
  sureVerificationRequest,
  getServersForCountry
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbJHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const enc = (v) =>
  encodeURIComponent(String(v ?? ""));

function getToken(req) {
  const h =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  return h.startsWith("Bearer ")
    ? h.slice(7).trim()
    : null;
}

async function getUser(req) {
  const token = getToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data =
    await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    throw new Error("Unauthorized.");
  }

  return data;
}

async function db(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method:
        options.method || "GET",

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
          "return=representation"
      },

      ...(options.body !== undefined
        ? {
            body:
              typeof options.body === "string"
                ? options.body
                : JSON.stringify(
                    options.body
                  )
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
    data = {
      message: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.hint ||
      `Supabase request failed (${response.status}).`
    );
  }

  return data;
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
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
  ].map((value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
  );

  return values.some((value) =>
    [
      "us",
      "usa",
      "united states",
      "unitedstates",
      "united states of america",
      "unitedstatesofamerica"
    ].includes(value)
  );
}

function getVerification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data ||
    {}
  );
}

function getNumber(data) {
  const v =
    getVerification(data);

  return (
    v?.number ||
    v?.phone_number ||
    v?.phoneNumber ||
    v?.phone ||
    data?.number ||
    data?.phone_number ||
    data?.phoneNumber ||
    data?.phone ||
    null
  );
}

function getVerificationId(data) {
  const v =
    getVerification(data);

  return (
    v?.id ??
    v?.verification_id ??
    v?.verificationId ??
    data?.verification_id ??
    data?.verificationId ??
    data?.id ??
    null
  );
}

function getRequestId(data) {
  const v =
    getVerification(data);

  return (
    v?.request_id ??
    v?.requestId ??
    data?.request_id ??
    data?.requestId ??
    data?.order_id ??
    data?.orderId ??
    null
  );
}

function getProviderCost(data) {
  const v =
    getVerification(data);

  const values = [
    v?.price,
    v?.amount,
    v?.cost,
    data?.price,
    data?.amount,
    data?.cost,
    data?.data?.price,
    data?.data?.amount,
    data?.data?.cost
  ];

  for (const value of values) {
    const number =
      Number(value);

    if (
      Number.isFinite(number) &&
      number >= 0
    ) {
      return number;
    }
  }

  return null;
}

function getServices(data) {
  if (Array.isArray(data)) {
    return data;
  }

  const possible =
    [
      data?.services,
      data?.data?.services,
      data?.data,
      data?.results,
      data?.items,
      data?.providerResponse?.services,
      data?.providerResponse?.data
    ];

  return (
    possible.find(
      Array.isArray
    ) || []
  );
}

function getServiceId(service) {
  return (
    service?.id ??
    service?.service_id ??
    service?.serviceId ??
    service?.code ??
    service?.key ??
    null
  );
}

function getServiceName(service) {
  return (
    service?.name ??
    service?.service_name ??
    service?.serviceName ??
    service?.title ??
    service?.service ??
    ""
  );
}

/*
 * Gets the service ID directly from the
 * selected provider portal.
 *
 * USA Server 2:
 * WhatsApp is returned by Portal 2.
 *
 * Global Server 2:
 * WhatsApp is returned by Global Server 2.
 */
async function getProviderService(
  server,
  countryId,
  internalServiceId,
  serviceName
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${enc(
        countryId
      )}`
    );

  const list =
    getServices(data);

  if (!list.length) {
    throw new Error(
      `No services returned by ${server}.`
    );
  }

  const requestedId =
    String(
      internalServiceId ?? ""
    ).trim();

  const requestedName =
    normalize(serviceName);

  let found = null;

  if (requestedId) {
    found =
      list.find(
        (service) =>
          String(
            getServiceId(service) ?? ""
          ).trim() === requestedId
      );
  }

  if (
    !found &&
    requestedName
  ) {
    found =
      list.find(
        (service) =>
          normalize(
            getServiceName(service)
          ) === requestedName
      );
  }

  if (
    !found &&
    requestedName
  ) {
    found =
      list.find(
        (service) => {
          const providerName =
            normalize(
              getServiceName(service)
            );

          return (
            providerName &&
            (
              providerName.includes(
                requestedName
              ) ||
              requestedName.includes(
                providerName
              )
            )
          );
        }
      );
  }

  if (!found) {
    throw new Error(
      `Service "${serviceName || internalServiceId}" is not available on ${server}.`
    );
  }

  const providerId =
    getServiceId(found);

  if (
    providerId === null ||
    providerId === undefined ||
    String(providerId).trim() === ""
  ) {
    throw new Error(
      `Invalid provider service ID on ${server}.`
    );
  }

  return String(providerId);
}

async function getWallet(userId) {
  const rows =
    await db(
      `wallets?user_id=eq.${enc(
        userId
      )}&select=user_id,balance&limit=1`
    );

  if (!rows?.[0]) {
    throw new Error(
      "Wallet not found."
    );
  }

  return rows[0];
}

async function changeWallet(
  userId,
  amount
) {
  const current =
    await getWallet(userId);

  const before =
    Number(
      current.balance || 0
    );

  const change =
    Number(amount);

  if (!Number.isFinite(change)) {
    throw new Error(
      "Invalid wallet amount."
    );
  }

  const after =
    before + change;

  if (after < 0) {
    throw new Error(
      "Insufficient wallet balance."
    );
  }

  const updated =
    await db(
      `wallets?user_id=eq.${enc(
        userId
      )}&balance=eq.${enc(
        before
      )}`,
      {
        method: "PATCH",

        body: {
          balance: after,
          updated_at:
            new Date().toISOString()
        }
      }
    );

  if (
    !Array.isArray(updated) ||
    !updated.length
  ) {
    throw new Error(
      "Wallet update failed. Please try again."
    );
  }

  return after;
}

async function createTransaction(
  userId,
  amount,
  balance,
  description
) {
  try {
    await db(
      "wallet_transactions",
      {
        method: "POST",

        body: {
          user_id:
            userId,

          type:
            Number(amount) < 0
              ? "purchase"
              : "refund",

          amount:
            Number(amount),

          balance_after:
            balance,

          description
        }
      }
    );
  } catch (error) {
    console.error(
      "[ORDER] TRANSACTION ERROR:",
      error
    );
  }
}

async function refund(
  userId,
  amount,
  description
) {
  const balance =
    await changeWallet(
      userId,
      Number(amount)
    );

  await createTransaction(
    userId,
    Number(amount),
    balance,
    description
  );

  return balance;
}

async function createOrder(
  userId,
  data
) {
  return db(
    "orders",
    {
      method: "POST",

      body: {
        user_id:
          userId,

        provider_order_id:
          data.requestId,

        provider_verification_id:
          data.verificationId,

        service_country_price_id:
          data.serviceCountryPriceId,

        service_name:
          data.serviceName,

        country_name:
          data.countryName,

        provider_cost:
          data.providerCost,

        customer_price:
          data.customerPrice,

        profit:
          Number(
            data.customerPrice
          ) -
          Number(
            data.providerCost
          ),

        status:
          data.status ||
          "active",

        phone_number:
          data.phoneNumber
      }
    }
  );
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({
        success: false,
        error:
          "Method not allowed"
      });
  }

  let currentUser = null;
  let debited = false;
  let purchasePrice = 0;

  try {
    currentUser =
      await getUser(req);

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

    const internalServiceId =
      body.serviceCountryPriceId ??
      body.serviceCountryPriceID ??
      body.service_country_price_id ??
      body.serviceId ??
      body.service_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    if (!countryId) {
      throw new Error(
        "Country is required."
      );
    }

    if (!internalServiceId) {
      throw new Error(
        "Service is required."
      );
    }

    /*
     * Get customer selling price.
     */
    let pricing =
      await db(
        `product_prices?country_id=eq.${enc(
          countryId
        )}&service_id=eq.${enc(
          internalServiceId
        )}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`
      );

    if (
      (!pricing ||
        !pricing.length) &&
      requestedServiceName
    ) {
      const all =
        await db(
          `product_prices?country_id=eq.${enc(
            countryId
          )}&select=country_id,country_name,service_id,service_name,selling_price`
        );

      const wanted =
        normalize(
          requestedServiceName
        );

      pricing =
        Array.isArray(all)
          ? all.filter(
              (row) =>
                normalize(
                  row?.service_name
                ) === wanted
            )
          : [];
    }

    const priceRow =
      pricing?.[0];

    const sellingPrice =
      Number(
        priceRow?.selling_price
      );

    if (
      !Number.isFinite(
        sellingPrice
      ) ||
      sellingPrice <= 0
    ) {
      throw new Error(
        "This country and service is not currently available for purchase."
      );
    }

    purchasePrice =
      sellingPrice;

    const serviceName =
      priceRow?.service_name ||
      requestedServiceName ||
      String(
        internalServiceId
      );

    /*
     * =====================================================
     * COUNTRY → PROVIDER PORTAL
     * =====================================================
     *
     * USA MUST go to USA Server 2.
     */
    const unitedStates =
      isUSA(
        countryId,
        countryCode,
        countryName
      );

    let servers;

    if (unitedStates) {
      /*
       * Explicit Portal 2 routing.
       *
       * Do not allow the USA purchase to use
       * Global Server 1 or Global Server 2.
       */
      servers = [
        "usa-server-2"
      ];
    } else {
      /*
       * Other countries use the routing
       * configured in _lib.js.
       */
      servers =
        getServersForCountry(
          countryName
        );
    }

    console.log(
      "[ORDER] PORTAL ROUTING",
      {
        countryId,
        countryName,
        countryCode,
        service:
          serviceName,
        isUSA:
          unitedStates,
        servers
      }
    );

    /*
     * Check wallet.
     */
    const currentWallet =
      await getWallet(
        currentUser.id
      );

    const balance =
      Number(
        currentWallet.balance || 0
      );

    if (
      balance <
      sellingPrice
    ) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    /*
     * Debit wallet.
     */
    const afterDebit =
      await changeWallet(
        currentUser.id,
        -sellingPrice
      );

    debited = true;

    await createTransaction(
      currentUser.id,
      -sellingPrice,
      afterDebit,
      `Purchase: ${serviceName}`
    );

    /*
     * =====================================================
     * PURCHASE FROM PROVIDER
     * =====================================================
     */
    let providerData = null;
    let selectedServer = null;
    let selectedProviderService = null;
    let lastError = null;

    for (
      const server of servers
    ) {
      try {
        /*
         * Get service ID from the selected portal.
         */
        const providerServiceId =
          await getProviderService(
            server,
            countryId,
            internalServiceId,
            serviceName
          );

        selectedProviderService =
          providerServiceId;

        console.log(
          "[ORDER] PROVIDER SERVICE",
          {
            server,
            countryId,
            service:
              serviceName,
            providerServiceId
          }
        );

        /*
         * Purchase number from that portal.
         */
        const purchasePath =
          `/${server}/purchase?country_id=${enc(
            countryId
          )}&service=${enc(
            providerServiceId
          )}`;

        console.log(
          "[ORDER] PURCHASE",
          {
            server,
            purchasePath
          }
        );

        const result =
          await sureVerificationRequest(
            purchasePath,
            {
              method:
                "POST"
            }
          );

        console.log(
          "[ORDER] PROVIDER RESPONSE",
          JSON.stringify(result)
        );

        const phone =
          getNumber(result);

        const verification =
          getVerificationId(
            result
          );

        /*
         * Only accept a purchase when
         * both number and verification ID
         * are returned.
         */
        if (
          phone &&
          verification
        ) {
          providerData =
            result;

          selectedServer =
            server;

          break;
        }

        lastError =
          new Error(
            `Provider ${server} did not return a valid number and verification ID.`
          );

      } catch (error) {
        lastError =
          error;

        console.error(
          "[ORDER] PROVIDER ERROR",
          {
            server,
            error:
              error?.message
          }
        );
      }
    }

    /*
     * Provider failed.
     */
    if (!providerData) {
      await refund(
        currentUser.id,
        sellingPrice,
        "Refund for failed virtual number purchase"
      );

      debited = false;
      purchasePrice = 0;

      throw new Error(
        lastError?.message ||
        "No number is currently available from the provider."
      );
    }

    const verificationData =
      getVerification(
        providerData
      );

    const phoneNumber =
      getNumber(
        providerData
      );

    const realVerificationId =
      getVerificationId(
        providerData
      );

    const purchaseRequestId =
      getRequestId(
        providerData
      );

    if (
      !phoneNumber ||
      !realVerificationId
    ) {
      await refund(
        currentUser.id,
        sellingPrice,
        "Refund for incomplete provider purchase"
      );

      debited = false;
      purchasePrice = 0;

      throw new Error(
        "Provider returned an incomplete purchase. Your wallet has been refunded."
      );
    }

    /*
     * Provider cost.
     */
    let cost =
      getProviderCost(
        providerData
      );

    if (cost === null) {
      const serviceResponse =
        await sureVerificationRequest(
          `/${selectedServer}/services?country_id=${enc(
            countryId
          )}`
        ).catch(
          () => null
        );

      const providerServices =
        getServices(
          serviceResponse
        );

      const matching =
        providerServices.find(
          (service) =>
            String(
              getServiceId(
                service
              ) ?? ""
            ) ===
            String(
              selectedProviderService
            )
        ) ||
        providerServices.find(
          (service) =>
            normalize(
              getServiceName(
                service
              )
            ) ===
            normalize(
              serviceName
            )
        );

      const possibleCost =
        Number(
          matching?.price ??
          matching?.cost ??
          matching?.amount ??
          matching?.selling_price
        );

      if (
        Number.isFinite(
          possibleCost
        ) &&
        possibleCost >= 0
      ) {
        cost =
          possibleCost;
      }
    }

    if (
      cost === null ||
      !Number.isFinite(cost) ||
      cost < 0
    ) {
      cost = 0;
    }

    /*
     * Save order.
     */
    const order =
      await createOrder(
        currentUser.id,
        {
          requestId:
            purchaseRequestId ||
            realVerificationId,

          verificationId:
            realVerificationId,

          serviceCountryPriceId:
            internalServiceId,

          serviceName:
            serviceName,

          countryName:
            priceRow?.country_name ||
            countryName ||
            String(
              countryId
            ),

          providerCost:
            cost,

          customerPrice:
            sellingPrice,

          phoneNumber:
            phoneNumber,

          status:
            verificationData?.status ||
            "active"
        }
      );

    debited = false;
    purchasePrice = 0;

    const finalWallet =
      await getWallet(
        currentUser.id
      );

    console.log(
      "[ORDER] PURCHASE SUCCESS",
      {
        country:
          countryName,
        service:
          serviceName,
        provider:
          selectedServer,
        providerService:
          selectedProviderService,
        phoneNumber,
        verificationId:
          realVerificationId
      }
    );

    return res
      .status(200)
      .json({
        success: true,

        message:
          "Number purchased successfully.",

        order:
          order?.[0] ||
          null,

        phone_number:
          phoneNumber,

        phoneNumber:
          phoneNumber,

        verification_id:
          realVerificationId,

        verificationId:
          realVerificationId,

        request_id:
          purchaseRequestId ||
          null,

        provider_server:
          selectedServer,

        provider_service_id:
          selectedProviderService,

        provider_cost:
          cost,

        provider_price:
          cost,

        selling_price:
          sellingPrice,

        sellingPrice:
          sellingPrice,

        balance:
          Number(
            finalWallet?.balance ||
            0
          ),

        verification: {
          ...verificationData,

          id:
            realVerificationId,

          request_id:
            purchaseRequestId ||
            null,

          number:
            phoneNumber
        }
      });

  } catch (error) {
    console.error(
      "[ORDER] ERROR:",
      error
    );

    /*
     * Automatic refund if money was
     * taken but purchase failed.
     */
    if (
      debited &&
      currentUser?.id &&
      purchasePrice > 0
    ) {
      try {
        await refund(
          currentUser.id,
          purchasePrice,
          "Automatic refund after failed purchase"
        );

        debited = false;
        purchasePrice = 0;

      } catch (refundError) {
        console.error(
          "[ORDER] REFUND ERROR:",
          refundError
        );
      }
    }

    const message =
      error?.message ||
      "Unable to purchase number.";

    if (
      message
        .toLowerCase()
        .includes(
          "insufficient"
        )
    ) {
      return res
        .status(400)
        .json({
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
      return res
        .status(401)
        .json({
          success: false,
          error:
            message,
          message
        });
    }

    return res
      .status(500)
      .json({
        success: false,
        error:
          message,
        message
      });
  }
}
