import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbJHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function getToken(req) {
  const authorization =
    req.headers.authorization ||
    req.headers.Authorization ||
    "";

  if (authorization.startsWith("Bearer ")) {
    return authorization.slice(7).trim();
  }

  const fallback =
    req.headers["x-supabase-access-token"];

  return fallback ? String(fallback).trim() : null;
}

async function getUser(req) {
  const accessToken = getToken(req);

  if (!accessToken) {
    return null;
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
    return null;
  }

  return await response.json();
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
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      ...(options.body !== undefined
        ? {
            body: JSON.stringify(options.body)
          }
        : {})
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Database returned invalid JSON (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        data?.details ||
        `Database request failed (${response.status}).`
    );
  }

  return data;
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
  const id = String(countryId || "")
    .trim()
    .toLowerCase();

  const code = String(countryCode || "")
    .trim()
    .toLowerCase();

  const name = String(countryName || "")
    .trim()
    .toLowerCase();

  return (
    id === "236" ||
    code === "us" ||
    code === "usa" ||
    name === "us" ||
    name === "usa" ||
    name === "united states" ||
    name ===
      "united states of america"
  );
}

async function getProviderService(
  countryId,
  serviceId,
  serviceName
) {
  const result =
    await sureVerificationRequest(
      `/usa-server-2/services?country_id=${enc(
        countryId
      )}`
    );

  const services =
    Array.isArray(result?.services)
      ? result.services
      : [];

  if (!services.length) {
    throw new Error(
      "USA Server 2 returned no services."
    );
  }

  const wantedId = String(
    serviceId || ""
  )
    .trim()
    .toLowerCase();

  const wantedName = String(
    serviceName || ""
  )
    .trim()
    .toLowerCase();

  let match = null;

  if (wantedId) {
    match = services.find(
      item =>
        String(item?.id || "")
          .trim()
          .toLowerCase() === wantedId
    );
  }

  if (!match && wantedName) {
    match = services.find(
      item =>
        String(item?.name || "")
          .trim()
          .toLowerCase() === wantedName
    );
  }

  if (!match && wantedName) {
    match = services.find(item => {
      const name = String(
        item?.name || ""
      )
        .trim()
        .toLowerCase();

      return (
        name.includes(wantedName) ||
        wantedName.includes(name)
      );
    });
  }

  if (!match) {
    throw new Error(
      `Service "${serviceName || serviceId}" is not available on USA Server 2.`
    );
  }

  return match;
}

async function getProfile(userId) {
  const rows = await db(
    `profiles?id=eq.${enc(
      userId
    )}&select=*`
  );

  return Array.isArray(rows)
    ? rows[0]
    : null;
}

function profileBalance(profile) {
  const value =
    profile?.wallet_balance ??
    profile?.balance ??
    0;

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

async function updateBalance(
  userId,
  newBalance,
  profile
) {
  const update = {};

  if (
    Object.prototype.hasOwnProperty.call(
      profile || {},
      "wallet_balance"
    )
  ) {
    update.wallet_balance =
      newBalance;
  } else {
    update.balance = newBalance;
  }

  await db(
    `profiles?id=eq.${enc(userId)}`,
    {
      method: "PATCH",
      body: update
    }
  );
}

async function debit(
  userId,
  amount
) {
  const profile =
    await getProfile(userId);

  if (!profile) {
    throw new Error(
      "Customer profile not found."
    );
  }

  const balance =
    profileBalance(profile);

  if (balance < amount) {
    throw new Error(
      "Insufficient wallet balance."
    );
  }

  const newBalance =
    balance - amount;

  await updateBalance(
    userId,
    newBalance,
    profile
  );

  return newBalance;
}

async function refund(
  userId,
  amount
) {
  if (!amount || amount <= 0) {
    return;
  }

  const profile =
    await getProfile(userId);

  if (!profile) {
    return;
  }

  const balance =
    profileBalance(profile);

  await updateBalance(
    userId,
    balance + amount,
    profile
  );
}

async function getSellingPrice(
  countryId,
  serviceId,
  serviceName
) {
  let rows = await db(
    `product_prices?country_id=eq.${enc(
      countryId
    )}&select=*`
  );

  if (!Array.isArray(rows)) {
    rows = [];
  }

  const wantedId = String(
    serviceId || ""
  )
    .trim()
    .toLowerCase();

  const wantedName = String(
    serviceName || ""
  )
    .trim()
    .toLowerCase();

  let row = rows.find(item => {
    const id = String(
      item?.service_id || ""
    )
      .trim()
      .toLowerCase();

    const name = String(
      item?.service_name ||
        item?.service ||
        ""
    )
      .trim()
      .toLowerCase();

    return (
      (wantedId && id === wantedId) ||
      (wantedName && name === wantedName)
    );
  });

  if (!row && wantedName) {
    row = rows.find(item => {
      const name = String(
        item?.service_name ||
          item?.service ||
          ""
      )
        .trim()
        .toLowerCase();

      return (
        name.includes(wantedName) ||
        wantedName.includes(name)
      );
    });
  }

  const price = Number(
    row?.selling_price ??
      row?.customer_price ??
      row?.price ??
      0
  );

  return Number.isFinite(price)
    ? price
    : 0;
}

async function saveOrder(data) {
  const rows = await db(
    "orders",
    {
      method: "POST",
      body: {
        user_id: data.userId,
        provider_order_id:
          data.verificationId,
        verification_id:
          data.verificationId,
        country_id:
          data.countryId,
        country_code:
          data.countryCode,
        country_name:
          data.countryName,
        service:
          data.serviceName,
        service_id:
          data.serviceId,
        phone_number:
          data.phone,
        provider:
          data.provider,
        provider_cost:
          data.providerCost,
        customer_price:
          data.customerPrice,
        profit:
          data.profit,
        status: "active"
      }
    }
  );

  return Array.isArray(rows)
    ? rows[0]
    : rows;
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    /*
     * AUTHENTICATION
     */
    const currentUser =
      await getUser(req);

    if (!currentUser?.id) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const body = req.body || {};

    const countryId =
      body.country_id ??
      body.countryId ??
      body.country?.id ??
      "";

    const countryCode =
      body.country_code ??
      body.countryCode ??
      body.country?.code ??
      "";

    const countryName =
      body.country_name ??
      body.countryName ??
      body.country?.name ??
      "";

    const serviceId =
      body.service_id ??
      body.serviceId ??
      body.service?.id ??
      "";

    const serviceName =
      body.service_name ??
      body.serviceName ??
      body.service?.name ??
      "";

    if (!countryId && !countryName) {
      return res.status(400).json({
        error: "Country is required."
      });
    }

    if (!serviceId && !serviceName) {
      return res.status(400).json({
        error: "Service is required."
      });
    }

    /*
     * CUSTOMER PRICE
     */
    const sellingPrice =
      await getSellingPrice(
        countryId,
        serviceId,
        serviceName
      );

    if (
      !sellingPrice ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        error:
          "Price not available for this service."
      });
    }

    /*
     * DEBIT WALLET
     */
    let newBalance;

    try {
      newBalance =
        await debit(
          currentUser.id,
          sellingPrice
        );
    } catch (error) {
      return res.status(400).json({
        error:
          error?.message ||
          "Unable to debit wallet."
      });
    }

    try {
      let provider;
      let providerServiceId =
        serviceId;

      let providerServiceName =
        serviceName;

      let result;

      /*
       * USA
       * USA SERVER 2
       */
      if (
        isUSA(
          countryId,
          countryCode,
          countryName
        )
      ) {
        provider = "usa-server-2";

        const service =
          await getProviderService(
            countryId,
            serviceId,
            serviceName
          );

        providerServiceId =
          service.id;

        providerServiceName =
          service.name;

        result =
          await sureVerificationRequest(
            `/usa-server-2/purchase?country_id=${enc(
              countryId
            )}&service=${enc(
              providerServiceId
            )}`,
            {
              method: "POST"
            }
          );
      }

      /*
       * ALL OTHER COUNTRIES
       * GLOBAL SERVER 2
       *
       * IMPORTANT:
       * This endpoint accepts NO
       * country_id/service parameters.
       */
      else {
        provider =
          "global-server-2";

        result =
          await sureVerificationRequest(
            "/global-server-2/purchase",
            {
              method: "POST"
            }
          );

        providerServiceName =
          result?.verification?.service ||
          providerServiceName;
      }

      const verification =
        result?.verification || {};

      const phone =
        verification.number ||
        result?.number ||
        result?.phone ||
        null;

      const verificationId =
        verification.request_id ||
        verification.verification_id ||
        result?.request_id ||
        result?.verification_id ||
        null;

      if (!phone) {
        throw new Error(
          "Provider did not return a phone number."
        );
      }

      if (!verificationId) {
        throw new Error(
          "Provider did not return a verification ID."
        );
      }

      const providerCost =
        Number(
          verification.price ??
            verification.cost ??
            result?.price ??
            result?.cost ??
            0
        ) || 0;

      const profit =
        sellingPrice -
        providerCost;

      const savedOrder =
        await saveOrder({
          userId:
            currentUser.id,
          provider,
          countryId,
          countryCode,
          countryName,
          serviceId:
            providerServiceId,
          serviceName:
            providerServiceName,
          phone,
          verificationId,
          providerCost,
          customerPrice:
            sellingPrice,
          profit
        });

      return res.status(200).json({
        success: true,
        message:
          "Number purchased successfully.",
        order: savedOrder,
        provider,
        provider_service_id:
          providerServiceId,
        provider_service_name:
          providerServiceName,
        number: phone,
        phone,
        verification_id:
          verificationId,
        request_id:
          verificationId,
        provider_cost:
          providerCost,
        selling_price:
          sellingPrice,
        profit,
        balance:
          newBalance
      });
    } catch (error) {
      await refund(
        currentUser.id,
        sellingPrice
      );

      console.error(
        "Provider/order error:",
        error
      );

      return res.status(400).json({
        error:
          error?.message ||
          "Unable to purchase number."
      });
    }
  } catch (error) {
    console.error(
      "ORDER API ERROR:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Internal server error."
    });
  }
}
