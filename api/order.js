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

function token(req) {
  const auth =
    req.headers.authorization ||
    req.headers.Authorization ||
    "";

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  return auth.slice(7).trim();
}

async function user(req) {
  const accessToken = token(req);

  if (!accessToken) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    throw new Error("Unauthorized");
  }

  return await response.json();
}

async function db(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  return fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );
}

function enc(value) {
  return encodeURIComponent(
    String(value ?? "")
  );
}

function isUSA(
  countryId,
  countryCode,
  countryName
) {
  const id = String(countryId ?? "")
    .trim()
    .toLowerCase();

  const code = String(countryCode ?? "")
    .trim()
    .toLowerCase();

  const name = String(countryName ?? "")
    .trim()
    .toLowerCase();

  return (
    id === "236" ||
    code === "us" ||
    code === "usa" ||
    name === "us" ||
    name === "usa" ||
    name === "united states" ||
    name === "united states of america"
  );
}

function services(data) {
  return (
    data?.services ||
    data?.data?.services ||
    data?.result?.services ||
    []
  );
}

function serviceId(item) {
  return (
    item?.id ||
    item?.service_id ||
    item?.serviceId ||
    item?.code ||
    null
  );
}

function serviceName(item) {
  return (
    item?.name ||
    item?.service_name ||
    item?.serviceName ||
    item?.title ||
    ""
  );
}

/*
 * Finds the service ID from the selected provider.
 *
 * USA Server 2:
 * WhatsApp has its own provider ID.
 *
 * This is intentionally NOT hard-coded.
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

  if (
    !Array.isArray(list) ||
    list.length === 0
  ) {
    throw new Error(
      `No services returned by ${server}.`
    );
  }

  const wantedId =
    String(requestedId ?? "")
      .trim()
      .toLowerCase();

  const wantedName =
    String(requestedName ?? "")
      .trim()
      .toLowerCase();

  let match = null;

  if (wantedId) {
    match = list.find(
      item =>
        String(
          serviceId(item) ?? ""
        )
          .trim()
          .toLowerCase() === wantedId
    );
  }

  if (!match && wantedName) {
    match = list.find(
      item =>
        String(
          serviceName(item) ?? ""
        )
          .trim()
          .toLowerCase() === wantedName
    );
  }

  if (!match && wantedName) {
    match = list.find(item =>
      String(
        serviceName(item) ?? ""
      )
        .trim()
        .toLowerCase()
        .includes(wantedName)
    );
  }

  if (!match) {
    throw new Error(
      `Service "${requestedName || requestedId}" is not available on ${server}.`
    );
  }

  const id = serviceId(match);

  if (!id) {
    throw new Error(
      `Provider service ID is missing on ${server}.`
    );
  }

  return {
    id,
    name: serviceName(match)
  };
}

async function getPrice(
  countryId,
  serviceIdValue,
  serviceNameValue
) {
  let response = await db(
    `product_prices?country_id=eq.${enc(
      countryId
    )}&service_id=eq.${enc(
      serviceIdValue
    )}&select=*`
  );

  if (response.ok) {
    const rows = await response.json();

    if (
      Array.isArray(rows) &&
      rows.length > 0
    ) {
      return rows[0];
    }
  }

  if (serviceNameValue) {
    response = await db(
      `product_prices?country_id=eq.${enc(
        countryId
      )}&service_name=ilike.${enc(
        serviceNameValue
      )}&select=*`
    );

    if (response.ok) {
      const rows =
        await response.json();

      if (
        Array.isArray(rows) &&
        rows.length > 0
      ) {
        return rows[0];
      }
    }
  }

  return null;
}

async function walletBalance(userId) {
  const response = await db(
    `profiles?id=eq.${enc(
      userId
    )}&select=balance`
  );

  if (!response.ok) {
    throw new Error(
      "Unable to read wallet balance."
    );
  }

  const rows =
    await response.json();

  if (!rows.length) {
    throw new Error(
      "User profile not found."
    );
  }

  return Number(
    rows[0].balance || 0
  );
}

async function debitWallet(
  userId,
  amount
) {
  const balance =
    await walletBalance(userId);

  if (balance < amount) {
    throw new Error(
      "Insufficient wallet balance."
    );
  }

  const newBalance =
    balance - amount;

  const response = await db(
    `profiles?id=eq.${enc(
      userId
    )}`,
    {
      method: "PATCH",
      headers: {
        Prefer:
          "return=minimal"
      },
      body: JSON.stringify({
        balance: newBalance
      })
    }
  );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      text ||
        "Unable to debit wallet."
    );
  }

  return newBalance;
}

async function refundWallet(
  userId,
  amount
) {
  const balance =
    await walletBalance(userId);

  const newBalance =
    balance + amount;

  const response = await db(
    `profiles?id=eq.${enc(
      userId
    )}`,
    {
      method: "PATCH",
      headers: {
        Prefer:
          "return=minimal"
      },
      body: JSON.stringify({
        balance: newBalance
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      "Unable to refund wallet."
    );
  }

  return newBalance;
}

async function createOrder({
  userId,
  countryId,
  countryCode,
  countryName,
  serviceIdValue,
  serviceNameValue,
  providerServer,
  providerServiceId,
  providerServiceName,
  providerOrderId,
  providerVerificationId,
  phone,
  providerCost,
  sellingPrice
}) {
  const profit =
    Number(sellingPrice) -
    Number(providerCost);

  const payload = {
    user_id: userId,
    country_id:
      String(countryId),
    country_code:
      countryCode || null,
    country_name:
      countryName || null,
    service_id:
      serviceIdValue || null,
    service_name:
      serviceNameValue || null,
    provider_server:
      providerServer,
    provider_service_id:
      providerServiceId || null,
    provider_service_name:
      providerServiceName || null,
    provider_order_id:
      providerOrderId || null,
    verification_id:
      providerVerificationId || null,
    phone_number:
      phone || null,
    provider_cost:
      Number(providerCost || 0),
    selling_price:
      Number(sellingPrice || 0),
    profit:
      Number(profit || 0),
    status: "active"
  };

  const response =
    await db(
      "orders",
      {
        method: "POST",
        headers: {
          Prefer:
            "return=representation"
        },
        body: JSON.stringify(
          payload
        )
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      text ||
        "Unable to save order."
    );
  }

  const rows =
    await response.json();

  return Array.isArray(rows)
    ? rows[0]
    : rows;
}

export default async function handler(
  req,
  res
) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error:
          "Method not allowed"
      });
    }

    /*
     * AUTHENTICATION
     */
    const currentUser =
      await user(req);

    if (!currentUser?.id) {
      throw new Error(
        "Unauthorized"
      );
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const countryId =
      body.country_id ??
      body.countryId ??
      body.country;

    const countryCode =
      body.country_code ??
      body.countryCode ??
      "";

    const countryName =
      body.country_name ??
      body.countryName ??
      "";

    const internalServiceId =
      body.service_id ??
      body.serviceId ??
      body.service;

    const serviceNameValue =
      body.service_name ??
      body.serviceName ??
      "";

    if (!countryId) {
      return res.status(400).json({
        error:
          "Country is required."
      });
    }

    if (
      !internalServiceId &&
      !serviceNameValue
    ) {
      return res.status(400).json({
        error:
          "Service is required."
      });
    }

    /*
     * SELLING PRICE
     */
    const priceRow =
      await getPrice(
        countryId,
        internalServiceId,
        serviceNameValue
      );

    if (!priceRow) {
      return res.status(400).json({
        error:
          "Price not available for this country/service."
      });
    }

    const sellingPrice =
      Number(
        priceRow.selling_price ??
        priceRow.price ??
        priceRow.amount ??
        0
      );

    if (
      !Number.isFinite(
        sellingPrice
      ) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        error:
          "Price not available for this country/service."
      });
    }

    /*
     * USA = USA SERVER 2
     * OTHER COUNTRIES = GLOBAL SERVER 2
     */
    const unitedStates =
      isUSA(
        countryId,
        countryCode,
        countryName
      );

    /*
     * CHECK WALLET
     */
    const startingBalance =
      await walletBalance(
        currentUser.id
      );

    if (
      startingBalance <
      sellingPrice
    ) {
      return res.status(400).json({
        error:
          "Insufficient wallet balance.",
        balance:
          startingBalance,
        required:
          sellingPrice
      });
    }

    /*
     * DEBIT WALLET
     */
    await debitWallet(
      currentUser.id,
      sellingPrice
    );

    try {
      let result;
      let providerServer;
      let providerServiceId = null;
      let providerServiceName =
        serviceNameValue;
      let providerOrderId = null;

      /*
       * =========================================
       * USA SERVER 2
       * =========================================
       *
       * Documented endpoint:
       *
       * POST /usa-server-2/purchase
       *
       * Required:
       * country_id
       * service
       */
      if (unitedStates) {
        providerServer =
          "usa-server-2";

        const selectedService =
          await providerService(
            "usa-server-2",
            countryId,
            internalServiceId,
            serviceNameValue
          );

        providerServiceId =
          selectedService.id;

        providerServiceName =
          selectedService.name;

        result =
          await sureVerificationRequest(
            `/usa-server-2/purchase?country_id=${enc(
              countryId
            )}&service=${enc(
              selectedService.id
            )}`,
            {
              method: "POST"
            }
          );
      }

      /*
       * =========================================
       * GLOBAL SERVER 2
       * =========================================
       *
       * Documented endpoint:
       *
       * POST /global-server-2/purchase
       *
       * NO country_id
       * NO service query parameter
       */
      else {
        providerServer =
          "global-server-2";

        result =
          await sureVerificationRequest(
            "/global-server-2/purchase",
            {
              method: "POST"
            }
          );

        providerServiceName =
          result?.verification
            ?.service ||
          serviceNameValue;
      }

      /*
       * PROVIDER RESPONSE
       */
      const verification =
        result?.verification || {};

      const phone =
        verification.number ||
        null;

      const providerVerificationId =
        verification.request_id ||
        null;

      const providerVerificationNumericId =
        verification.id ??
        null;

      providerOrderId =
        providerVerificationId ||
        providerVerificationNumericId ||
        null;

      if (!phone) {
        throw new Error(
          result?.message ||
            "Provider did not return a phone number."
        );
      }

      if (!providerVerificationId) {
        throw new Error(
          result?.message ||
            "Provider did not return a verification ID."
        );
      }

      /*
       * SAVE ORDER
       */
      const savedOrder =
        await createOrder({
          userId:
            currentUser.id,
          countryId,
          countryCode,
          countryName,
          serviceIdValue:
            internalServiceId,
          serviceNameValue:
            providerServiceName,
          providerServer,
          providerServiceId,
          providerServiceName,
          providerOrderId,
          providerVerificationId,
          phone,
          providerCost: 0,
          sellingPrice
        });

      const balanceAfter =
        await walletBalance(
          currentUser.id
        );

      return res.status(200).json({
        success: true,
        message:
          result?.message ||
          "Number purchased successfully",
        order: savedOrder,
        provider_server:
          providerServer,
        provider_service_id:
          providerServiceId,
        provider_service_name:
          providerServiceName,
        phone,
        number: phone,
        verification_id:
          providerVerificationId,
        request_id:
          providerVerificationId,
        provider_verification_id:
          providerVerificationNumericId,
        status:
          verification.status ||
          "active",
        expired_at:
          verification.expired_at ||
          null,
        balance:
          balanceAfter
      });
    } catch (providerError) {
      /*
       * REFUND IF PURCHASE FAILS
       */
      try {
        await refundWallet(
          currentUser.id,
          sellingPrice
        );
      } catch (refundError) {
        console.error(
          "REFUND ERROR:",
          refundError
        );
      }

      throw providerError;
    }
  } catch (error) {
    console.error(
      "ORDER ERROR:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    if (
      message === "Unauthorized" ||
      message
        .toLowerCase()
        .includes("unauthorized")
    ) {
      return res.status(401).json({
        error:
          "Unauthorized"
      });
    }

    return res.status(400).json({
      error:
        message ||
        "Unable to purchase number."
    });
  }
}
