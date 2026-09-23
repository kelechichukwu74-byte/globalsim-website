import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function bearer(req) {
  const h =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  return h.startsWith("Bearer ")
    ? h.slice(7).trim()
    : null;
}

async function authUser(req) {
  const token = bearer(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await r.json().catch(() => null);

  if (!r.ok || !data?.id) {
    throw new Error("Unauthorized.");
  }

  return data;
}

async function supabase(path, options = {}) {
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
        Prefer: "return=representation",
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

  const text = await r.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!r.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        data?.hint ||
        (typeof data === "string"
          ? data
          : `Supabase request failed (${r.status}).`)
    );
  }

  return data;
}

function enc(value) {
  return encodeURIComponent(
    String(value ?? "")
  );
}

function norm(value) {
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
  ].map(v =>
    String(v ?? "")
      .trim()
      .toLowerCase()
  );

  return values.some(v =>
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

function providerArray(data) {
  if (Array.isArray(data)) return data;

  const candidates = [
    data?.services,
    data?.results,
    data?.items,
    data?.data,
    data?.data?.services,
    data?.data?.results,
    data?.providerResponse,
    data?.providerResponse?.services,
    data?.providerResponse?.data
  ];

  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
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

async function resolveService(
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

  const services =
    providerArray(data);

  if (!services.length) {
    throw new Error(
      `No services were returned by ${server} for country ${countryId}.`
    );
  }

  const id =
    String(requestedId ?? "").trim();

  const name =
    norm(requestedName);

  let match = null;

  if (id) {
    match = services.find(
      s =>
        String(serviceId(s) ?? "").trim() ===
        id
    );
  }

  if (!match && name) {
    match = services.find(
      s => norm(serviceName(s)) === name
    );
  }

  if (!match && name) {
    match = services.find(s => {
      const n = norm(serviceName(s));

      return (
        n.includes(name) ||
        name.includes(n)
      );
    });
  }

  if (!match) {
    throw new Error(
      `Service "${requestedName || requestedId}" is not available on ${server}.`
    );
  }

  const providerId =
    serviceId(match);

  if (
    providerId === null ||
    providerId === undefined ||
    String(providerId).trim() === ""
  ) {
    throw new Error(
      `Provider returned an invalid service ID on ${server}.`
    );
  }

  return {
    id: String(providerId),
    name:
      serviceName(match) ||
      requestedName ||
      String(requestedId),
    raw: match
  };
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

/*
 * IMPORTANT:
 * verification.id is the ID required for
 * /verifications/sms/:verificationId
 * and
 * /verifications/cancel/:verificationId
 */
function verificationId(data) {
  const v = verification(data);

  return (
    v?.id ??
    v?.verification_id ??
    v?.verificationId ??
    null
  );
}

function requestId(data) {
  const v = verification(data);

  return (
    v?.request_id ??
    v?.requestId ??
    null
  );
}

function phone(data) {
  const v = verification(data);

  return (
    v?.number ??
    v?.phone_number ??
    v?.phoneNumber ??
    v?.phone ??
    null
  );
}

function providerPrice(data) {
  const v = verification(data);

  const value =
    v?.price ??
    v?.amount ??
    data?.price ??
    data?.amount ??
    data?.data?.price ??
    data?.data?.amount;

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

async function wallet(userId) {
  const rows = await supabase(
    `wallets?user_id=eq.${enc(
      userId
    )}&select=user_id,balance&limit=1`
  );

  if (!rows?.[0]) {
    throw new Error(
      "Wallet not found. Please contact support."
    );
  }

  return rows[0];
}

async function changeWallet(
  userId,
  amount
) {
  const rows =
    await wallet(userId);

  const oldBalance =
    Number(rows.balance || 0);

  const newBalance =
    oldBalance + Number(amount);

  const updated =
    await supabase(
      `wallets?user_id=eq.${enc(
        userId
      )}&balance=eq.${enc(
        oldBalance
      )}`,
      {
        method: "PATCH",
        body: {
          balance: newBalance,
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
      "Wallet was changed by another transaction. Please try again."
    );
  }

  return {
    before: oldBalance,
    after: newBalance
  };
}

async function addTransaction(
  userId,
  amount,
  balanceAfter,
  description
) {
  try {
    await supabase(
      "wallet_transactions",
      {
        method: "POST",
        body: {
          user_id: userId,
          type:
            Number(amount) < 0
              ? "purchase"
              : "refund",
          amount: Number(amount),
          balance_after:
            balanceAfter,
          description
        }
      }
    );
  } catch (e) {
    console.error(
      "Transaction history error:",
      e
    );
  }
}

async function debit(
  userId,
  amount
) {
  const price = Number(amount);

  if (
    !Number.isFinite(price) ||
    price <= 0
  ) {
    throw new Error(
      "Invalid purchase price."
    );
  }

  const rows =
    await wallet(userId);

  const balance =
    Number(rows.balance || 0);

  if (balance < price) {
    throw new Error(
      "Insufficient wallet balance."
    );
  }

  const result =
    await changeWallet(
      userId,
      -price
    );

  await addTransaction(
    userId,
    -price,
    result.after,
    "Virtual number purchase"
  );

  return result;
}

async function refund(
  userId,
  amount,
  description
) {
  const value = Number(amount);

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }

  const result =
    await changeWallet(
      userId,
      value
    );

  await addTransaction(
    userId,
    value,
    result.after,
    description ||
      "Virtual number purchase refund"
  );

  return result;
}

async function createOrder(
  userId,
  data
) {
  return await supabase(
    "orders",
    {
      method: "POST",
      body: {
        user_id: userId,

        /*
         * Purchase/request reference.
         */
        provider_order_id:
          data.requestId,

        /*
         * REAL verification ID used by
         * SMS and cancellation.
         */
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
          data.providerCost !== null
            ? Number(data.customerPrice) -
              Number(data.providerCost)
            : null,

        status:
          data.status || "active",

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
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  let user = null;
  let amountDebited = 0;
  let didDebit = false;

  try {
    user =
      await authUser(req);

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
      body.service_country_price_id ??
      body.serviceId ??
      body.service_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error:
          "Country is required."
      });
    }

    if (!serviceCountryPriceId) {
      return res.status(400).json({
        success: false,
        error:
          "Service is required."
      });
    }

    /*
     * Get YOUR selling price from Supabase.
     * The customer cannot choose the price.
     */
    let prices =
      await supabase(
        `product_prices?country_id=eq.${enc(
          countryId
        )}&service_id=eq.${enc(
          serviceCountryPriceId
        )}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`
      );

    /*
     * If service ID differs but service name
     * matches, find the configured price by name.
     */
    if (
      (!prices ||
        !prices.length) &&
      requestedServiceName
    ) {
      const all =
        await supabase(
          `product_prices?country_id=eq.${enc(
            countryId
          )}&select=country_id,country_name,service_id,service_name,selling_price`
        );

      const wanted =
        norm(
          requestedServiceName
        );

      prices =
        Array.isArray(all)
          ? all.filter(
              row =>
                norm(
                  row?.service_name
                ) === wanted
            )
          : [];
    }

    const pricing =
      prices?.[0];

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
     * PROVIDER ROUTING
     *
     * USA:
     * ONLY USA SERVER 2.
     *
     * NON-USA:
     * GLOBAL SERVER 2 first,
     * GLOBAL SERVER 1 second.
     */
    const usa =
      isUSA(
        countryId,
        countryCode,
        countryName
      );

    const servers =
      usa
        ? ["usa-server-2"]
        : [
            "global-server-2",
            "global-server-1"
          ];

    console.log(
      "[order] Routing:",
      {
        countryId,
        countryName,
        countryCode,
        serviceName,
        usa,
        servers
      }
    );

    /*
     * Take money from customer wallet
     * before purchasing.
     */
    await debit(
      user.id,
      sellingPrice
    );

    amountDebited =
      sellingPrice;

    didDebit = true;

    let purchased = null;
    let selectedServer = null;
    let selectedProviderService =
      null;
    let lastError = null;

    for (const server of servers) {
      try {
        /*
         * Resolve the REAL service ID
         * used by that provider server.
         */
        selectedProviderService =
          await resolveService(
            server,
            countryId,
            serviceCountryPriceId,
            serviceName
          );

        console.log(
          "[order] Purchasing:",
          {
            server,
            countryId,
            service:
              selectedProviderService.id,
            serviceName
          }
        );

        const data =
          await sureVerificationRequest(
            `/${server}/purchase?country_id=${enc(
              countryId
            )}&service=${enc(
              selectedProviderService.id
            )}`,
            {
              method: "POST"
            }
          );

        console.log(
          "[order] Provider response:",
          JSON.stringify(data)
        );

        const v =
          verification(data);

        const vId =
          verificationId(data);

        const number =
          phone(data);

        if (
          vId &&
          number
        ) {
          purchased = data;
          selectedServer =
            server;

          break;
        }

        lastError =
          new Error(
            "Provider did not return a valid verification ID and phone number."
          );
      } catch (error) {
        lastError =
          error;

        console.error(
          "[order] Provider attempt failed:",
          {
            server,
            message:
              error?.message
          }
        );

        /*
         * USA must stay on USA Server 2.
         * Never silently switch a USA purchase
         * to USA Server 1.
         */
        if (usa) {
          break;
        }
      }
    }

    /*
     * Provider purchase failed.
     * Return the customer's money.
     */
    if (!purchased) {
      await refund(
        user.id,
        sellingPrice,
        "Refund for failed virtual number purchase"
      );

      amountDebited = 0;
      didDebit = false;

      throw new Error(
        lastError?.message ||
          "No number is currently available from the provider."
      );
    }

    const v =
      verification(
        purchased
      );

    /*
     * VERY IMPORTANT:
     * request_id and verification.id
     * are different values.
     */
    const vId =
      verificationId(
        purchased
      );

    const reqId =
      requestId(
        purchased
      );

    const number =
      phone(
        purchased
      );

    if (
      !vId ||
      !number
    ) {
      await refund(
        user.id,
        sellingPrice,
        "Refund for incomplete provider purchase"
      );

      amountDebited = 0;
      didDebit = false;

      throw new Error(
        "Provider did not return a valid number. Your wallet has been refunded."
      );
    }

    const cost =
      providerPrice(
        purchased
      );

    const orderRows =
      await createOrder(
        user.id,
        {
          requestId:
            reqId || vId,

          verificationId:
            vId,

          serviceCountryPriceId,

          serviceName,

          countryName:
            pricing?.country_name ||
            countryName ||
            String(countryId),

          providerCost:
            cost,

          customerPrice:
            sellingPrice,

          phoneNumber:
            number,

          status:
            v?.status ||
            "active"
        }
      );

    const currentWallet =
      await wallet(
        user.id
      );

    /*
     * The wallet transaction was already
     * created by debit().
     */
    amountDebited = 0;
    didDebit = false;

    return res.status(200).json({
      success: true,

      message:
        "Number purchased successfully.",

      order:
        orderRows?.[0] ||
        null,

      verification: {
        ...v,

        /*
         * request_id = purchase/request reference
         */
        request_id:
          reqId || null,

        /*
         * id = REAL verification ID.
         * This is what SMS and cancel use.
         */
        id:
          vId,

        number:
          number
      },

      provider_server:
        selectedServer,

      provider_service_id:
        selectedProviderService?.id ||
        null,

      provider_price:
        cost,

      selling_price:
        sellingPrice,

      sellingPrice:
        sellingPrice,

      balance:
        Number(
          currentWallet.balance || 0
        )
    });
  } catch (error) {
    console.error(
      "[order] Purchase error:",
      error
    );

    /*
     * Safety refund for an unexpected
     * error occurring after debit.
     */
    if (
      didDebit &&
      user?.id &&
      amountDebited > 0
    ) {
      try {
        await refund(
          user.id,
          amountDebited,
          "Automatic refund after failed virtual number purchase"
        );
      } catch (refundError) {
        console.error(
          "[order] Safety refund failed:",
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
      message === "Unauthorized."
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
