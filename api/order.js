import {
  sureVerificationRequest,
  getServersForCountry
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const enc = (v) =>
  encodeURIComponent(String(v ?? ""));

function token(req) {
  const h =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  return h.startsWith("Bearer ")
    ? h.slice(7).trim()
    : null;
}

async function user(req) {
  const t = token(req);

  if (!t) {
    throw new Error("Unauthorized.");
  }

  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${t}`
      }
    }
  );

  const data =
    await r.json().catch(() => null);

  if (!r.ok || !data?.id) {
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

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method: options.method || "GET",

      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation"
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

  const text = await r.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      message: text
    };
  }

  if (!r.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        data?.hint ||
        `Supabase request failed (${r.status}).`
    );
  }

  return data;
}

function norm(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isUSA(id, code, name) {
  return [
    id,
    code,
    name
  ]
    .map((v) =>
      String(v ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
    )
    .some((v) =>
      [
        "us",
        "usa",
        "united states",
        "unitedstates",
        "united states of america",
        "unitedstatesofamerica"
      ].includes(v)
    );
}

function verification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data ||
    {}
  );
}

function number(data) {
  const v = verification(data);

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

function verificationId(data) {
  const v = verification(data);

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

function requestId(data) {
  const v = verification(data);

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

function providerCost(data) {
  const v = verification(data);

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
    const n = Number(value);

    if (
      Number.isFinite(n) &&
      n >= 0
    ) {
      return n;
    }
  }

  return null;
}

function services(data) {
  if (Array.isArray(data)) {
    return data;
  }

  const values = [
    data?.services,
    data?.data,
    data?.data?.services,
    data?.results,
    data?.items,
    data?.providerResponse,
    data?.providerResponse?.services,
    data?.providerResponse?.data
  ];

  return (
    values.find(
      Array.isArray
    ) || []
  );
}

function serviceId(service) {
  return (
    service?.id ??
    service?.service_id ??
    service?.serviceId ??
    service?.code ??
    service?.key ??
    null
  );
}

function serviceName(service) {
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
 * Get the REAL service ID used by the selected provider portal.
 *
 * This is important because:
 *
 * USA Server 2 / Portal 2:
 * WhatsApp = 69c05c2e27c5759c68a8135e
 *
 * Global Server 2:
 * WhatsApp = wa
 *
 * We therefore do NOT hard-code one WhatsApp ID
 * for every portal.
 */
async function providerService(
  server,
  countryId,
  requestedId,
  requestedName
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${enc(
        countryId
      )}`
    );

  const list = services(data);

  if (!list.length) {
    throw new Error(
      `No services returned by ${server}.`
    );
  }

  const id =
    String(requestedId ?? "").trim();

  const name =
    norm(requestedName);

  let found = null;

  /*
   * First try the internal service ID.
   */
  if (id) {
    found = list.find(
      (service) =>
        String(
          serviceId(service) ?? ""
        ).trim() === id
    );
  }

  /*
   * Then try exact service name.
   */
  if (!found && name) {
    found = list.find(
      (service) =>
        norm(
          serviceName(service)
        ) === name
    );
  }

  /*
   * Finally try partial service-name matching.
   */
  if (!found && name) {
    found = list.find(
      (service) => {
        const providerName =
          norm(
            serviceName(service)
          );

        return (
          providerName &&
          (
            providerName.includes(name) ||
            name.includes(providerName)
          )
        );
      }
    );
  }

  if (!found) {
    throw new Error(
      `Service "${requestedName || requestedId}" is not available on ${server}.`
    );
  }

  const providerId =
    serviceId(found);

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

async function wallet(userId) {
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
  const w =
    await wallet(userId);

  const before =
    Number(w.balance || 0);

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

async function transaction(
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
          user_id: userId,

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
  } catch (e) {
    console.error(
      "Wallet transaction error:",
      e
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

  await transaction(
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
        user_id: userId,

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
          Number(data.customerPrice) -
          Number(data.providerCost),

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
    /*
     * Authenticate customer.
     */
    currentUser =
      await user(req);

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
     * Find the customer's selling price.
     */
    let pricing =
      await db(
        `product_prices?country_id=eq.${enc(
          countryId
        )}&service_id=eq.${enc(
          internalServiceId
        )}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`
      );

    /*
     * Fallback by service name.
     */
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
        norm(
          requestedServiceName
        );

      pricing =
        Array.isArray(all)
          ? all.filter(
              (row) =>
                norm(
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

    const serviceNameValue =
      priceRow?.service_name ||
      requestedServiceName ||
      String(
        internalServiceId
      );

    /*
     * ==========================================================
     * PORTAL ROUTING
     * ==========================================================
     *
     * USA:
     *   USA Server 2 / Portal 2
     *
     * Other countries:
     *   Global Server 2 first
     *   Global Server 1 fallback
     *
     * getServersForCountry() in _lib.js is responsible
     * for the actual country routing.
     */
    const unitedStates =
      isUSA(
        countryId,
        countryCode,
        countryName
      );

    const routingCountry =
      unitedStates
        ? "US"
        : countryName;

    const servers =
      getServersForCountry(
        routingCountry
      );

    /*
     * Safety check:
     *
     * A US purchase must NEVER accidentally
     * fall through to a global server.
     */
    if (unitedStates) {
      if (
        !servers.includes(
          "usa-server-2"
        )
      ) {
        throw new Error(
          "USA routing configuration is invalid. USA Server 2 was not selected."
        );
      }
    }

    console.log(
      "[ORDER] ROUTING",
      {
        countryId,
        countryName,
        countryCode,
        isUSA:
          unitedStates,
        serviceName:
          serviceNameValue,
        servers
      }
    );

    /*
     * Check wallet.
     */
    const w =
      await wallet(
        currentUser.id
      );

    const balance =
      Number(
        w.balance || 0
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
     * Debit customer.
     */
    const afterDebit =
      await changeWallet(
        currentUser.id,
        -sellingPrice
      );

    debited = true;

    await transaction(
      currentUser.id,
      -sellingPrice,
      afterDebit,
      `Purchase: ${serviceNameValue}`
    );

    /*
     * ==========================================================
     * PROVIDER PURCHASE
     * ==========================================================
     */
    let providerData = null;

    let selectedServer = null;

    let selectedProviderService = null;

    let lastError = null;

    for (
      const server of servers
    ) {
      try {
        console.log(
          "[ORDER] CHECKING SERVER",
          {
            server,
            countryId,
            service:
              serviceNameValue
          }
        );

        /*
         * Get the REAL service ID from that portal.
         *
         * This is especially important for WhatsApp:
         *
         * USA Server 2:
         * 69c05c2e27c5759c68a8135e
         *
         * Global Server 2:
         * wa
         */
        selectedProviderService =
          await providerService(
            server,
            countryId,
            internalServiceId,
            serviceNameValue
          );

        console.log(
          "[ORDER] PROVIDER SERVICE FOUND",
          {
            server,
            countryId,
            providerService:
              selectedProviderService,
            service:
              serviceNameValue
          }
        );

        /*
         * Purchase the number from the selected portal.
         */
        const purchasePath =
          `/${server}/purchase?country_id=${enc(
            countryId
          )}&service=${enc(
            selectedProviderService
          )}`;

        console.log(
          "[ORDER] PURCHASE REQUEST",
          {
            server,
            path:
              purchasePath
          }
        );

        const result =
          await sureVerificationRequest(
            purchasePath,
            {
              method: "POST"
            }
          );

        console.log(
          "[ORDER] PROVIDER RESPONSE",
          JSON.stringify(result)
        );

        const receivedNumber =
          number(result);

        const receivedVerificationId =
          verificationId(result);

        /*
         * A purchase is only successful when
         * the provider actually gives us BOTH:
         *
         * 1. phone number
         * 2. verification ID
         */
        if (
          receivedNumber &&
          receivedVerificationId
        ) {
          providerData =
            result;

          selectedServer =
            server;

          break;
        }

        lastError =
          new Error(
            `Provider ${server} did not return a valid phone number and verification ID.`
          );
      } catch (e) {
        lastError =
          e;

        console.error(
          "[ORDER] SERVER ERROR",
          {
            server,
            error:
              e?.message
          }
        );

        /*
         * USA only has USA Server 2.
         *
         * For non-USA countries,
         * getServersForCountry() can provide
         * the global fallback server.
         */
      }
    }

    /*
     * No provider successfully supplied
     * a number.
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

    const v =
      verification(
        providerData
      );

    const phoneNumber =
      number(
        providerData
      );

    const realVerificationId =
      verificationId(
        providerData
      );

    const purchaseRequestId =
      requestId(
        providerData
      );

    /*
     * Final validation.
     */
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
     * Get provider cost if the provider returned it.
     */
    let cost =
      providerCost(
        providerData
      );

    /*
     * If the purchase response doesn't contain
     * a price, inspect the selected portal's
     * service list.
     */
    if (cost === null) {
      const providerServiceData =
        await sureVerificationRequest(
          `/${selectedServer}/services?country_id=${enc(
            countryId
          )}`
        ).catch(
          () => null
        );

      const list =
        services(
          providerServiceData
        );

      const matchingService =
        list.find(
          (s) =>
            String(
              serviceId(s) ?? ""
            ) ===
            String(
              selectedProviderService
            )
        ) ||
        list.find(
          (s) =>
            norm(
              serviceName(s)
            ) ===
            norm(
              serviceNameValue
            )
        );

      const possibleCost =
        Number(
          matchingService?.price ??
          matchingService?.cost ??
          matchingService?.amount ??
          matchingService?.selling_price
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

    /*
     * Never allow NaN into the orders table.
     */
    if (
      cost === null ||
      !Number.isFinite(cost) ||
      cost < 0
    ) {
      cost = 0;
    }

    /*
     * Save order in Supabase.
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
            serviceNameValue,

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
            v?.status ||
            "active"
        }
      );

    /*
     * Purchase completed successfully.
     */
    debited = false;

    purchasePrice = 0;

    const finalWallet =
      await wallet(
        currentUser.id
      );

    console.log(
      "[ORDER] SUCCESS",
      {
        country:
          countryName,
        service:
          serviceNameValue,
        server:
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
          ...v,

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
     * If the customer was charged but
     * something failed afterward, refund.
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

    /*
     * Insufficient wallet.
     */
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

    /*
     * Authentication.
     */
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

    /*
     * Provider / purchase failure.
     */
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
