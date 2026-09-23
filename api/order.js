import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUPABASE_PUBLIC_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const enc = v =>
  encodeURIComponent(String(v ?? ""));

function authToken(req) {
  const h =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  return h.startsWith("Bearer ")
    ? h.slice(7).trim()
    : null;
}

async function getUser(req) {
  const token = authToken(req);

  if (!token)
    throw new Error("Unauthorized.");

  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_PUBLIC_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data =
    await r.json().catch(() => null);

  if (!r.ok || !data?.id)
    throw new Error("Unauthorized.");

  return data;
}

async function db(path, options = {}) {
  if (!SUPABASE_KEY)
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation"
      },
      ...(options.body
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

  let data;

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
      String(data)
    );
  }

  return data;
}

function isUSA(id, code, name) {
  return [
    id,
    code,
    name
  ]
    .map(x =>
      String(x ?? "")
        .trim()
        .toLowerCase()
    )
    .some(x =>
      [
        "us",
        "usa",
        "united states",
        "united states of america"
      ].includes(x)
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
  const v = getVerification(data);

  return (
    v?.number ||
    v?.phone_number ||
    v?.phoneNumber ||
    v?.phone ||
    null
  );
}

function getVerificationId(data) {
  const v = getVerification(data);

  return (
    v?.id ??
    v?.verification_id ??
    v?.verificationId ??
    null
  );
}

function getRequestId(data) {
  const v = getVerification(data);

  return (
    v?.request_id ??
    v?.requestId ??
    null
  );
}

function getProviderPrice(data) {
  const v = getVerification(data);

  const n = Number(
    v?.price ??
    v?.amount ??
    data?.price ??
    data?.amount
  );

  return Number.isFinite(n)
    ? n
    : null;
}

function serviceId(x) {
  return (
    x?.id ??
    x?.service_id ??
    x?.serviceId ??
    x?.code ??
    x?.key ??
    null
  );
}

function serviceName(x) {
  return (
    x?.name ??
    x?.service_name ??
    x?.serviceName ??
    x?.title ??
    x?.service ??
    ""
  );
}

function normalize(x) {
  return String(x ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");
}

function serviceArray(data) {
  if (Array.isArray(data))
    return data;

  const list = [
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
    list.find(Array.isArray) ||
    []
  );
}

async function findProviderService(
  server,
  countryId,
  internalServiceId,
  serviceNameRequested
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${enc(
        countryId
      )}`
    );

  const services =
    serviceArray(data);

  if (!services.length) {
    throw new Error(
      `No services returned by ${server}.`
    );
  }

  const wantedId =
    String(
      internalServiceId ?? ""
    ).trim();

  const wantedName =
    normalize(
      serviceNameRequested
    );

  let found = null;

  if (wantedId) {
    found =
      services.find(
        x =>
          String(
            serviceId(x) ?? ""
          ).trim() === wantedId
      );
  }

  if (!found && wantedName) {
    found =
      services.find(
        x =>
          normalize(
            serviceName(x)
          ) === wantedName
      );
  }

  if (!found && wantedName) {
    found =
      services.find(x => {
        const n =
          normalize(
            serviceName(x)
          );

        return (
          n.includes(wantedName) ||
          wantedName.includes(n)
        );
      });
  }

  if (!found) {
    throw new Error(
      `Service "${serviceNameRequested}" is not available on ${server}.`
    );
  }

  const id =
    serviceId(found);

  if (
    id === null ||
    id === undefined
  ) {
    throw new Error(
      `Invalid provider service ID on ${server}.`
    );
  }

  return String(id);
}

async function getWallet(userId) {
  const rows =
    await db(
      `wallets?user_id=eq.${enc(
        userId
      )}&select=user_id,balance&limit=1`
    );

  if (!rows?.[0])
    throw new Error(
      "Wallet not found."
    );

  return rows[0];
}

async function changeWallet(
  userId,
  amount
) {
  const w =
    await getWallet(userId);

  const before =
    Number(w.balance || 0);

  const after =
    before + Number(amount);

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
          amount: Number(amount),
          balance_after: balance,
          description
        }
      }
    );
  } catch (e) {
    console.error(
      "Transaction error:",
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

  let user;
  let debited = false;
  let price = 0;

  try {
    user =
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

    const serviceIdInternal =
      body.serviceCountryPriceId ??
      body.service_country_price_id ??
      body.serviceId ??
      body.service_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    if (!countryId)
      throw new Error(
        "Country is required."
      );

    if (!serviceIdInternal)
      throw new Error(
        "Service is required."
      );

    /*
     * Get YOUR selling price.
     */
    let prices =
      await db(
        `product_prices?country_id=eq.${enc(
          countryId
        )}&service_id=eq.${enc(
          serviceIdInternal
        )}&select=*&limit=1`
      );

    /*
     * Try service-name matching if
     * the internal IDs differ.
     */
    if (
      (!prices ||
        !prices.length) &&
      requestedServiceName
    ) {
      const all =
        await db(
          `product_prices?country_id=eq.${enc(
            countryId
          )}&select=*`
        );

      const wanted =
        normalize(
          requestedServiceName
        );

      prices =
        Array.isArray(all)
          ? all.filter(
              x =>
                normalize(
                  x.service_name
                ) === wanted
            )
          : [];
    }

    const pricing =
      prices?.[0];

    price =
      Number(
        pricing?.selling_price
      );

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      throw new Error(
        "This country and service is not currently available for purchase."
      );
    }

    const serviceNameValue =
      pricing?.service_name ||
      requestedServiceName ||
      String(serviceIdInternal);

    const usa =
      isUSA(
        countryId,
        countryCode,
        countryName
      );

    /*
     * USA = USA SERVER 2 ONLY.
     *
     * Other countries =
     * GLOBAL SERVER 2, then GLOBAL SERVER 1.
     */
    const servers =
      usa
        ? ["usa-server-2"]
        : [
            "global-server-2",
            "global-server-1"
          ];

    console.log(
      "[ORDER] Provider routing:",
      {
        countryId,
        countryName,
        countryCode,
        serviceName:
          serviceNameValue,
        servers
      }
    );

    /*
     * Check balance and debit.
     */
    const walletBefore =
      await getWallet(
        user.id
      );

    const balanceBefore =
      Number(
        walletBefore.balance || 0
      );

    if (
      balanceBefore < price
    ) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    const balanceAfter =
      await changeWallet(
        user.id,
        -price
      );

    debited = true;

    await transaction(
      user.id,
      -price,
      balanceAfter,
      `Purchase: ${serviceNameValue}`
    );

    let providerData = null;
    let usedServer = null;
    let providerService = null;
    let lastError = null;

    /*
     * Try provider servers.
     */
    for (
      const server of servers
    ) {
      try {
        providerService =
          await findProviderService(
            server,
            countryId,
            serviceIdInternal,
            serviceNameValue
          );

        console.log(
          "[ORDER] Purchasing:",
          {
            server,
            countryId,
            service:
              providerService
          }
        );

        const result =
          await sureVerificationRequest(
            `/${server}/purchase?country_id=${enc(
              countryId
            )}&service=${enc(
              providerService
            )}`,
            {
              method: "POST"
            }
          );

        console.log(
          "[ORDER] Provider result:",
          JSON.stringify(result)
        );

        const number =
          getNumber(result);

        const verificationID =
          getVerificationId(
            result
          );

        if (
          number &&
          verificationID
        ) {
          providerData =
            result;

          usedServer =
            server;

          break;
        }

        lastError =
          new Error(
            "Provider did not return a number and verification ID."
          );
      } catch (e) {
        lastError = e;

        console.error(
          `[ORDER] ${server} failed:`,
          e?.message
        );

        if (usa)
          break;
      }
    }

    /*
     * Provider failed.
     * Refund customer.
     */
    if (!providerData) {
      await refund(
        user.id,
        price,
        "Refund for failed virtual number purchase"
      );

      debited = false;
      price = 0;

      throw new Error(
        lastError?.message ||
        "No number is currently available from the provider."
      );
    }

    const v =
      getVerification(
        providerData
      );

    const number =
      getNumber(
        providerData
      );

    const verificationID =
      getVerificationId(
        providerData
      );

    const purchaseRequestID =
      getRequestId(
        providerData
      );

    if (
      !number ||
      !verificationID
    ) {
      await refund(
        user.id,
        price,
        "Refund for incomplete provider purchase"
      );

      debited = false;
      price = 0;

      throw new Error(
        "Provider returned an incomplete purchase. Your wallet has been refunded."
      );
    }

    const providerCost =
      getProviderPrice(
        providerData
      );

    /*
     * SAVE THE NUMBER TO YOUR OWN
     * SUPABASE orders TABLE.
     */
    const order =
      await createOrder(
        user.id,
        {
          requestId:
            purchaseRequestID ||
            verificationID,

          verificationId:
            verificationID,

          serviceCountryPriceId:
            serviceIdInternal,

          serviceName:
            serviceNameValue,

          countryName:
            pricing?.country_name ||
            countryName ||
            String(countryId),

          providerCost,

          customerPrice:
            price,

          phoneNumber:
            number,

          status:
            v?.status ||
            "active"
        }
      );

    debited = false;
    price = 0;

    const finalWallet =
      await getWallet(
        user.id
      );

    /*
     * THIS IS THE IMPORTANT PART:
     *
     * The number is explicitly returned
     * to your own website.
     */
    return res.status(200).json({
      success: true,

      message:
        "Number purchased successfully.",

      order:
        order?.[0] || null,

      phone_number:
        number,

      phoneNumber:
        number,

      verification_id:
        verificationID,

      verificationId:
        verificationID,

      request_id:
        purchaseRequestID ||
        null,

      provider_server:
        usedServer,

      provider_service_id:
        providerService,

      provider_price:
        providerCost,

      selling_price:
        Number(
          price || 0
        ),

      balance:
        Number(
          finalWallet?.balance || 0
        ),

      verification: {
        ...v,
        id:
          verificationID,
        request_id:
          purchaseRequestID ||
          null,
        number:
          number
      }
    });
  } catch (error) {
    console.error(
      "[ORDER] ERROR:",
      error
    );

    /*
     * Safety refund if an unexpected
     * error happened after debit.
     */
    if (
      debited &&
      user?.id &&
      price > 0
    ) {
      try {
        await refund(
          user.id,
          price,
          "Automatic refund after failed purchase"
        );
      } catch (refundError) {
        console.error(
          "[ORDER] Safety refund failed:",
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
