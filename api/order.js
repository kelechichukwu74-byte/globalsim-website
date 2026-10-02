// api/order.js

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUREVERIFICATION_API_KEY =
  process.env.SUREVERIFICATION_API_KEY ||
  process.env.SURE_VERIFICATION_API_KEY ||
  process.env.SURE_API_KEY;

const SUREVERIFICATION_BASE_URL =
  "https://sureverifications.com/api/v1";

const supabase =
  SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY
      )
    : null;

const SERVERS = [
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
];

function clean(value) {
  return String(value ?? "").trim();
}

function encode(value) {
  return encodeURIComponent(
    String(value ?? "")
  );
}

function normal(value) {
  return clean(value).toLowerCase();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    clean(value)
  );
}

/*
|--------------------------------------------------------------------------
| SureVerification request
|--------------------------------------------------------------------------
*/

async function sureRequest(
  endpoint,
  options = {}
) {
  if (!SUREVERIFICATION_API_KEY) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is missing from Vercel Environment Variables."
    );
  }

  const url =
    `${SUREVERIFICATION_BASE_URL}` +
    endpoint;

  const headers = {
    Accept: "application/json",
    "x-api-key":
      SUREVERIFICATION_API_KEY,
    ...(options.headers || {})
  };

  let response;

  try {
    response = await fetch(
      url,
      {
        ...options,
        headers
      }
    );
  } catch (error) {
    throw new Error(
      `Unable to connect to SureVerification: ${
        error?.message ||
        "Network error"
      }`
    );
  }

  const text =
    await response.text();

  let data;

  try {
    data = text
      ? JSON.parse(text)
      : {};
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    const providerMessage =
      data?.message ||
      data?.error ||
      data?.errors
        ? JSON.stringify(
            data?.errors ||
              data?.error ||
              data?.message
          )
        : data?.raw ||
          `HTTP ${response.status}`;

    throw new Error(
      `SureVerification ${response.status}: ${providerMessage}`
    );
  }

  return data;
}

/*
|--------------------------------------------------------------------------
| Get values from request
|--------------------------------------------------------------------------
*/

function getServer(body) {
  return clean(
    body?.providerServer ||
      body?.provider_server ||
      body?.server
  );
}

function getSupabaseCountryId(body) {
  return clean(
    body?.countryId ||
      body?.country_id ||
      body?.supabaseCountryId ||
      body?.supabase_country_id
  );
}

function getProviderCountryId(body) {
  return clean(
    body?.providerCountryId ||
      body?.provider_country_id ||
      body?.providerCountryID ||
      body?.countryProviderId ||
      body?.country_provider_id
  );
}

function getServiceId(body) {
  return clean(
    body?.providerServiceId ||
      body?.provider_service_id ||
      body?.serviceId ||
      body?.service_id ||
      body?.serviceCode ||
      body?.service_code
  );
}

function getServiceName(body) {
  return clean(
    body?.serviceName ||
      body?.service_name
  );
}

function getCountryName(body) {
  return clean(
    body?.countryName ||
      body?.country_name
  );
}

/*
|--------------------------------------------------------------------------
| Determine server
|--------------------------------------------------------------------------
*/

function determineServer(
  requestedServer,
  countryName
) {
  if (
    SERVERS.includes(
      requestedServer
    )
  ) {
    return requestedServer;
  }

  const country =
    normal(countryName);

  if (
    country === "usa" ||
    country === "us" ||
    country === "united states" ||
    country ===
      "united states of america"
  ) {
    return "usa-server-1";
  }

  return "global-server-1";
}

/*
|--------------------------------------------------------------------------
| Find customer price
|--------------------------------------------------------------------------
*/

async function findProductPrice({
  countryId,
  serviceId,
  serviceName,
  server
}) {
  if (!supabase) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing."
    );
  }

  /*
   * provider_service_id = "wa"
   *
   * Do NOT use product_prices.id for "wa".
   */

  if (serviceId) {
    let query =
      supabase
        .from("product_prices")
        .select(
          "id,country_id,country_name,service_id,service_name,selling_price,provider_server,provider_service_id"
        )
        .eq(
          "provider_service_id",
          serviceId
        )
        .eq(
          "is_active",
          true
        )
        .limit(1);

    if (countryId) {
      query =
        query.eq(
          "country_id",
          countryId
        );
    }

    if (server) {
      query =
        query.eq(
          "provider_server",
          server
        );
    }

    const {
      data,
      error
    } = await query;

    if (error) {
      throw new Error(
        `Product price lookup failed: ${error.message}`
      );
    }

    if (data?.length) {
      return data[0];
    }
  }

  /*
   * Only use service_id if the supplied value
   * is actually a UUID.
   */

  if (
    serviceId &&
    isUuid(serviceId)
  ) {
    let query =
      supabase
        .from("product_prices")
        .select(
          "id,country_id,country_name,service_id,service_name,selling_price,provider_server,provider_service_id"
        )
        .eq(
          "service_id",
          serviceId
        )
        .eq(
          "is_active",
          true
        )
        .limit(1);

    if (countryId) {
      query =
        query.eq(
          "country_id",
          countryId
        );
    }

    if (server) {
      query =
        query.eq(
          "provider_server",
          server
        );
    }

    const {
      data,
      error
    } = await query;

    if (error) {
      throw new Error(
        `Product price lookup failed: ${error.message}`
      );
    }

    if (data?.length) {
      return data[0];
    }
  }

  /*
   * Service-name fallback.
   */

  if (serviceName) {
    let query =
      supabase
        .from("product_prices")
        .select(
          "id,country_id,country_name,service_id,service_name,selling_price,provider_server,provider_service_id"
        )
        .ilike(
          "service_name",
          serviceName
        )
        .eq(
          "is_active",
          true
        )
        .limit(1);

    if (countryId) {
      query =
        query.eq(
          "country_id",
          countryId
        );
    }

    if (server) {
      query =
        query.eq(
          "provider_server",
          server
        );
    }

    const {
      data,
      error
    } = await query;

    if (error) {
      throw new Error(
        `Product price lookup failed: ${error.message}`
      );
    }

    if (data?.length) {
      return data[0];
    }
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| Get provider services
|--------------------------------------------------------------------------
*/

async function getProviderServices(
  server,
  providerCountryId
) {
  if (!providerCountryId) {
    throw new Error(
      `${server}: provider country_id is required.`
    );
  }

  return await sureRequest(
    `/${server}/services?country_id=${encode(
      providerCountryId
    )}`
  );
}

/*
|--------------------------------------------------------------------------
| Resolve provider service
|--------------------------------------------------------------------------
*/

async function resolveService({
  server,
  providerCountryId,
  serviceId,
  serviceName
}) {
  const result =
    await getProviderServices(
      server,
      providerCountryId
    );

  const services =
    result?.services ||
    result?.data?.services ||
    [];

  if (
    !Array.isArray(services)
  ) {
    throw new Error(
      `${server}: invalid services response.`
    );
  }

  const wantedId =
    normal(serviceId);

  const wantedName =
    normal(serviceName);

  const service =
    services.find(
      item =>
        wantedId &&
        normal(item?.id) ===
          wantedId
    ) ||
    services.find(
      item =>
        wantedName &&
        normal(item?.name) ===
          wantedName
    );

  if (!service) {
    throw new Error(
      `${server}: service "${
        serviceName ||
        serviceId
      }" was not found for country ${providerCountryId}.`
    );
  }

  return service;
}

/*
|--------------------------------------------------------------------------
| Global Server 2 price
|--------------------------------------------------------------------------
*/

async function getGlobal2Price(
  serviceId,
  serviceName
) {
  const result =
    await sureRequest(
      "/global-server-2/price"
    );

  const prices =
    result?.prices ||
    result?.data?.prices ||
    [];

  if (
    !Array.isArray(prices)
  ) {
    throw new Error(
      "Global Server 2 returned an invalid price response."
    );
  }

  const id =
    normal(serviceId);

  const name =
    normal(serviceName);

  const matching =
    prices.filter(item => {
      const service =
        item?.service || {};

      return (
        (
          id &&
          normal(service.id) === id
        ) ||
        (
          name &&
          normal(service.name) === name
        )
      );
    });

  if (!matching.length) {
    throw new Error(
      `Global Server 2 has no price options for ${
        serviceName ||
        serviceId
      }.`
    );
  }

  /*
   * Prefer a tier with stock.
   */

  return (
    matching.find(
      item =>
        Number(
          item?.stocks ??
            item?.service
              ?.stocks ??
            0
        ) > 0
    ) ||
    matching[0]
  );
}

/*
|--------------------------------------------------------------------------
| Other server price
|--------------------------------------------------------------------------
*/

async function getNormalServerPrice({
  server,
  countryId,
  serviceId
}) {
  const result =
    await sureRequest(
      `/${server}/price?country_id=${encode(
        countryId
      )}&service=${encode(
        serviceId
      )}`
    );

  const price =
    result?.price ??
    result?.provider_price ??
    result?.data?.price ??
    result?.data?.provider_price;

  if (
    price !== undefined &&
    price !== null
  ) {
    return Number(price);
  }

  if (
    Array.isArray(
      result?.prices
    ) &&
    result.prices.length
  ) {
    return Number(
      result.prices[0]?.price || 0
    );
  }

  return 0;
}

/*
|--------------------------------------------------------------------------
| Global Server 2 purchase
|--------------------------------------------------------------------------
*/

async function purchaseGlobal2({
  countryId,
  serviceId,
  tierId
}) {
  if (!countryId) {
    throw new Error(
      "Global Server 2: country_id is required."
    );
  }

  if (!serviceId) {
    throw new Error(
      "Global Server 2: service is required."
    );
  }

  if (
    tierId === undefined ||
    tierId === null
  ) {
    throw new Error(
      "Global Server 2: price tier ID is required."
    );
  }

  /*
   * The provider documentation confirms:
   *
   * POST /global-server-2/purchase
   *
   * We send the values in BOTH the query string
   * and JSON body. This makes the request compatible
   * with validation that expects either location.
   */

  const query =
    `?country_id=${encode(
      countryId
    )}` +
    `&service=${encode(
      serviceId
    )}` +
    `&id=${encode(
      tierId
    )}`;

  return await sureRequest(
    `/global-server-2/purchase${query}`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
        Accept:
          "application/json"
      },

      body: JSON.stringify({
        country_id:
          countryId,

        service:
          serviceId,

        id:
          tierId
      })
    }
  );
}

/*
|--------------------------------------------------------------------------
| Normal server purchase
|--------------------------------------------------------------------------
*/

async function purchaseNormalServer({
  server,
  countryId,
  serviceId
}) {
  return await sureRequest(
    `/${server}/purchase?country_id=${encode(
      countryId
    )}&service=${encode(
      serviceId
    )}`,
    {
      method: "POST",

      headers: {
        Accept:
          "application/json"
      }
    }
  );
}

/*
|--------------------------------------------------------------------------
| Extract provider response
|--------------------------------------------------------------------------
*/

function getVerification(
  result
) {
  return (
    result?.verification ||
    result?.data?.verification ||
    result?.data ||
    result
  );
}

function getPhone(
  verification
) {
  return (
    verification?.number ||
    verification?.phone_number ||
    verification?.phone ||
    null
  );
}

function getProviderOrderId(
  result,
  verification
) {
  return (
    verification?.request_id ||
    verification?.requestId ||
    result?.request_id ||
    result?.requestId ||
    verification?.id ||
    result?.id ||
    null
  );
}

/*
|--------------------------------------------------------------------------
| Wallet
|--------------------------------------------------------------------------
*/

async function getWallet(
  userId
) {
  const {
    data,
    error
  } = await supabase
    .from("wallets")
    .select(
      "id,user_id,balance"
    )
    .eq(
      "user_id",
      userId
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `Wallet lookup failed: ${error.message}`
    );
  }

  if (!data) {
    throw new Error(
      "Wallet not found."
    );
  }

  return data;
}

async function setWalletBalance(
  walletId,
  balance
) {
  const {
    data,
    error
  } = await supabase
    .from("wallets")
    .update({
      balance:
        Number(balance)
    })
    .eq(
      "id",
      walletId
    )
    .select(
      "id,user_id,balance"
    )
    .single();

  if (error) {
    throw new Error(
      `Wallet update failed: ${error.message}`
    );
  }

  return data;
}

/*
|--------------------------------------------------------------------------
| Wallet transaction
|--------------------------------------------------------------------------
*/

async function createWalletTransaction({
  userId,
  amount,
  before,
  after,
  description,
  reference
}) {
  const {
    error
  } = await supabase
    .from(
      "wallet_transactions"
    )
    .insert({
      user_id:
        userId,

      amount:
        Number(amount),

      balance_before:
        Number(before),

      balance_after:
        Number(after),

      description:
        description,

      reference:
        reference
    });

  if (error) {
    /*
     * The wallet has already been updated.
     * Don't make a successful number purchase fail
     * just because transaction history failed.
     */
    console.error(
      "Wallet transaction insert failed:",
      error
    );
  }
}

/*
|--------------------------------------------------------------------------
| Save order
|--------------------------------------------------------------------------
*/

async function saveOrder({
  userId,
  product,
  providerOrderId,
  serviceName,
  countryName,
  providerCost,
  customerPrice,
  phone,
  status
}) {
  const profit =
    Number(customerPrice) -
    Number(providerCost || 0);

  const {
    data,
    error
  } = await supabase
    .from("orders")
    .insert({
      user_id:
        userId,

      provider_order_id:
        providerOrderId
          ? String(
              providerOrderId
            )
          : null,

      service_country_price_id:
        product?.id
          ? String(
              product.id
            )
          : null,

      service_name:
        serviceName || null,

      country_name:
        countryName ||
        product?.country_name ||
        null,

      provider_cost:
        Number(
          providerCost || 0
        ),

      customer_price:
        Number(
          customerPrice
        ),

      profit:
        Number(profit),

      status:
        status || "active",

      phone_number:
        phone || null
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Order save failed: ${error.message}`
    );
  }

  return data;
}

/*
|--------------------------------------------------------------------------
| MAIN HANDLER
|--------------------------------------------------------------------------
*/

export default async function handler(
  req,
  res
) {
  try {
    /*
     * --------------------------------------------------
     * METHOD
     * --------------------------------------------------
     */

    if (
      req.method !==
      "POST"
    ) {
      return res.status(405).json({
        success: false,
        error:
          "Method not allowed."
      });
    }

    /*
     * --------------------------------------------------
     * CONFIGURATION
     * --------------------------------------------------
     */

    if (
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      return res.status(500).json({
        success: false,
        error:
          "SUPABASE_SERVICE_ROLE_KEY is missing from Vercel."
      });
    }

    if (
      !SUREVERIFICATION_API_KEY
    ) {
      return res.status(500).json({
        success: false,
        error:
          "SUREVERIFICATION_API_KEY is missing from Vercel."
      });
    }

    /*
     * --------------------------------------------------
     * BODY
     * --------------------------------------------------
     */

    let body =
      req.body || {};

    if (
      typeof body ===
      "string"
    ) {
      try {
        body =
          JSON.parse(body);
      } catch {
        return res.status(400).json({
          success: false,
          error:
            "Invalid JSON request body."
        });
      }
    }

    /*
     * --------------------------------------------------
     * AUTH
     * --------------------------------------------------
     */

    const authorization =
      req.headers.authorization ||
      "";

    if (
      !authorization.startsWith(
        "Bearer "
      )
    ) {
      return res.status(401).json({
        success: false,
        error:
          "Authentication required."
      });
    }

    const token =
      authorization.substring(
        7
      );

    const {
      data: authData,
      error: authError
    } =
      await supabase.auth.getUser(
        token
      );

    if (
      authError ||
      !authData?.user
    ) {
      return res.status(401).json({
        success: false,
        error:
          "Invalid or expired session."
      });
    }

    const user =
      authData.user;

    /*
     * --------------------------------------------------
     * INPUTS
     * --------------------------------------------------
     */

    const server =
      getServer(
        body
      );

    const countryId =
      getSupabaseCountryId(
        body
      );

    const providerCountryId =
      getProviderCountryId(
        body
      );

    const serviceId =
      getServiceId(
        body
      );

    const serviceName =
      getServiceName(
        body
      );

    const countryName =
      getCountryName(
        body
      );

    /*
     * --------------------------------------------------
     * VALIDATION
     * --------------------------------------------------
     */

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error:
          "countryId is required."
      });
    }

    if (
      !providerCountryId
    ) {
      return res.status(400).json({
        success: false,
        error:
          "providerCountryId is required."
      });
    }

    if (
      !serviceId &&
      !serviceName
    ) {
      return res.status(400).json({
        success: false,
        error:
          "serviceId or serviceName is required."
      });
    }

    const actualServer =
      determineServer(
        server,
        countryName
      );

    if (
      !SERVERS.includes(
        actualServer
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          `Invalid provider server: ${actualServer}`
      });
    }

    /*
     * --------------------------------------------------
     * FIND SELLING PRICE
     * --------------------------------------------------
     */

    const product =
      await findProductPrice({
        countryId,
        serviceId,
        serviceName,
        server:
          actualServer
      });

    if (!product) {
      return res.status(404).json({
        success: false,
        error:
          "No selling price is configured for this service, country and server."
      });
    }

    const customerPrice =
      Number(
        product.selling_price
      );

    if (
      !Number.isFinite(
        customerPrice
      ) ||
      customerPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The configured selling price is invalid."
      });
    }

    /*
     * --------------------------------------------------
     * PROVIDER SERVICE
     * --------------------------------------------------
     */

    const providerService =
      await resolveService({
        server:
          actualServer,

        providerCountryId,

        serviceId,

        serviceName
      });

    const actualServiceId =
      clean(
        providerService.id
      );

    const actualServiceName =
      clean(
        providerService.name
      ) ||
      serviceName ||
      actualServiceId;

    /*
     * --------------------------------------------------
     * PROVIDER PRICE
     * --------------------------------------------------
     */

    let providerCost =
      0;

    let global2Tier =
      null;

    if (
      actualServer ===
      "global-server-2"
    ) {
      global2Tier =
        await getGlobal2Price(
          actualServiceId,
          actualServiceName
        );

      providerCost =
        Number(
          global2Tier?.price ||
            0
        );

    } else {
      providerCost =
        await getNormalServerPrice({
          server:
            actualServer,

          countryId:
            providerCountryId,

          serviceId:
            actualServiceId
        });
    }

    /*
     * --------------------------------------------------
     * WALLET
     * --------------------------------------------------
     */

    const wallet =
      await getWallet(
        user.id
      );

    const balanceBefore =
      Number(
        wallet.balance || 0
      );

    if (
      balanceBefore <
      customerPrice
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",

        balance:
          balanceBefore,

        required:
          customerPrice
      });
    }

    /*
     * --------------------------------------------------
     * DEDUCT MONEY
     * --------------------------------------------------
     */

    const balanceAfter =
      balanceBefore -
      customerPrice;

    await setWalletBalance(
      wallet.id,
      balanceAfter
    );

    const reference =
      `ORDER-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()}`;

    await createWalletTransaction({
      userId:
        user.id,

      amount:
        -customerPrice,

      before:
        balanceBefore,

      after:
        balanceAfter,

      description:
        `Number purchase - ${actualServiceName}`,

      reference
    });

    /*
     * --------------------------------------------------
     * PURCHASE NUMBER
     * --------------------------------------------------
     */

    let purchase;

    try {
      if (
        actualServer ===
        "global-server-2"
      ) {
        purchase =
          await purchaseGlobal2({
            countryId:
              providerCountryId,

            serviceId:
              actualServiceId,

            tierId:
              global2Tier.id
          });
      } else {
        purchase =
          await purchaseNormalServer({
            server:
              actualServer,

            countryId:
              providerCountryId,

            serviceId:
              actualServiceId
          });
      }

    } catch (purchaseError) {
      /*
       * ------------------------------------------------
       * PROVIDER PURCHASE FAILED
       * REFUND CUSTOMER
       * ------------------------------------------------
       */

      const latestWallet =
        await getWallet(
          user.id
        );

      const refundBefore =
        Number(
          latestWallet.balance ||
            0
        );

      const refundAfter =
        refundBefore +
        customerPrice;

      await setWalletBalance(
        latestWallet.id,
        refundAfter
      );

      await createWalletTransaction({
        userId:
          user.id,

        amount:
          customerPrice,

        before:
          refundBefore,

        after:
          refundAfter,

        description:
          "Refund - number purchase failed",

        reference:
          `${reference}-REFUND`
      });

      throw purchaseError;
    }

    /*
     * --------------------------------------------------
     * PROVIDER RESPONSE
     * --------------------------------------------------
     */

    const verification =
      getVerification(
        purchase
      );

    const phone =
      getPhone(
        verification
      );

    const providerOrderId =
      getProviderOrderId(
        purchase,
        verification
      );

    const status =
      verification?.status ||
      purchase?.status ||
      "active";

    /*
     * If provider didn't return a number,
     * refund the customer.
     */

    if (!phone) {
      const latestWallet =
        await getWallet(
          user.id
        );

      const refundBefore =
        Number(
          latestWallet.balance ||
            0
        );

      const refundAfter =
        refundBefore +
        customerPrice;

      await setWalletBalance(
        latestWallet.id,
        refundAfter
      );

      await createWalletTransaction({
        userId:
          user.id,

        amount:
          customerPrice,

        before:
          refundBefore,

        after:
          refundAfter,

        description:
          "Refund - provider returned no number",

        reference:
          `${reference}-REFUND`
      });

      throw new Error(
        purchase?.message ||
          "Provider did not return a phone number."
      );
    }

    /*
     * --------------------------------------------------
     * SAVE ORDER
     * --------------------------------------------------
     */

    const order =
      await saveOrder({
        userId:
          user.id,

        product,

        providerOrderId,

        serviceName:
          actualServiceName,

        countryName:
          countryName ||
          product.country_name,

        providerCost,

        customerPrice,

        phone,

        status
      });

    /*
     * --------------------------------------------------
     * SUCCESS
     * --------------------------------------------------
     */

    return res.status(200).json({
      success: true,

      message:
        purchase?.message ||
        "Number purchased successfully.",

      server:
        actualServer,

      providerCountryId:
        providerCountryId,

      serviceId:
        actualServiceId,

      serviceName:
        actualServiceName,

      number:
        phone,

      providerOrderId:
        providerOrderId,

      providerPrice:
        providerCost,

      customerPrice:
        customerPrice,

      balance:
        balanceAfter,

      order,

      verification
    });

  } catch (error) {
    console.error(
      "ORDER API ERROR:",
      error
    );

    /*
     * IMPORTANT:
     * Return the actual error instead of allowing
     * Vercel to display FUNCTION_INVOCATION_FAILED.
     */

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Number purchase failed.",

      details:
        process.env.NODE_ENV !==
        "production"
          ? String(error?.stack || "")
          : undefined
    });
  }
}
