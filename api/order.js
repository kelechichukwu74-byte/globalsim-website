import { sureVerificationRequest } from "./_lib.js";

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

/* =========================================================
   BASIC HELPERS
========================================================= */

function quote(value) {
  return encodeURIComponent(String(value ?? ""));
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

/* =========================================================
   AUTH
========================================================= */

async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
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

  if (!response.ok) {
    throw new Error("Unauthorized.");
  }

  const user =
    await response.json();

  if (!user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}

/* =========================================================
   SUPABASE REST
========================================================= */

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
    data =
      text
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

/* =========================================================
   PROVIDER RESPONSE HELPERS
========================================================= */

function getVerification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data
  );
}

function getVerificationId(data) {
  const verification =
    getVerification(data);

  /*
   * SureVerification SMS/cancel uses verification.id.
   */
  return (
    verification?.id ??
    verification?.verification_id ??
    verification?.verificationId ??
    data?.verification_id ??
    data?.verificationId ??
    null
  );
}

function getRequestId(data) {
  const verification =
    getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
    data?.request_id ??
    data?.requestId ??
    null
  );
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

function getExpiredAt(data) {
  const verification =
    getVerification(data);

  return (
    verification?.expired_at ??
    verification?.expiredAt ??
    data?.expired_at ??
    data?.expiredAt ??
    null
  );
}

function getProviderPrice(data) {
  const value =
    data?.price ??
    data?.data?.price ??
    data?.amount ??
    data?.data?.amount ??
    data?.verification?.price ??
    data?.verification?.amount;

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : NaN;
}

/* =========================================================
   PROVIDER SERVICE HELPERS
========================================================= */

function getProviderArray(
  data
) {
  if (Array.isArray(data)) {
    return data;
  }

  if (
    Array.isArray(data?.services)
  ) {
    return data.services;
  }

  if (
    Array.isArray(data?.items)
  ) {
    return data.items;
  }

  if (
    Array.isArray(data?.results)
  ) {
    return data.results;
  }

  if (
    Array.isArray(data?.data)
  ) {
    return data.data;
  }

  return [];
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

/* =========================================================
   RESOLVE SERVICE FOR THE EXACT SERVER
========================================================= */

async function resolveProviderService(
  server,
  countryId,
  requestedServiceId,
  requestedServiceName
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${quote(
        countryId
      )}`
    );

  const services =
    getProviderArray(data);

  if (!services.length) {
    throw new Error(
      `No services were returned by ${server} for country ${countryId}.`
    );
  }

  const wantedId =
    String(
      requestedServiceId ?? ""
    ).trim();

  const wantedName =
    normalize(
      requestedServiceName
    );

  /*
   * First try exact provider service ID.
   */
  if (wantedId) {
    const direct =
      services.find(
        service =>
          String(
            getServiceId(
              service
            ) ?? ""
          ).trim() ===
          wantedId
      );

    if (direct) {
      return {
        id:
          getServiceId(
            direct
          ),

        name:
          getServiceName(
            direct
          )
      };
    }
  }

  /*
   * Then exact service name.
   */
  if (wantedName) {
    const exact =
      services.find(
        service =>
          normalize(
            getServiceName(
              service
            )
          ) ===
          wantedName
      );

    if (exact) {
      return {
        id:
          getServiceId(
            exact
          ),

        name:
          getServiceName(
            exact
          )
      };
    }
  }

  /*
   * Then partial name.
   */
  if (wantedName) {
    const partial =
      services.find(
        service => {
          const name =
            normalize(
              getServiceName(
                service
              )
            );

          return (
            name.includes(
              wantedName
            ) ||
            wantedName.includes(
              name
            )
          );
        }
      );

    if (partial) {
      return {
        id:
          getServiceId(
            partial
          ),

        name:
          getServiceName(
            partial
          )
      };
    }
  }

  throw new Error(
    `Service "${requestedServiceName || requestedServiceId}" is not available on ${server}.`
  );
}

/* =========================================================
   WALLET DEBIT
========================================================= */

async function debitWallet(
  userId,
  amount
) {
  const required =
    Number(amount);

  if (
    !Number.isFinite(required) ||
    required <= 0
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

    const balance =
      Number(
        wallet.balance || 0
      );

    if (
      !Number.isFinite(balance)
    ) {
      throw new Error(
        "Unable to read wallet balance."
      );
    }

    if (
      balance < required
    ) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    const newBalance =
      balance - required;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${encodeURIComponent(
          balance
        )}`,
        {
          method:
            "PATCH",

          body:
            JSON.stringify({
              balance:
                newBalance,

              updated_at:
                new Date().toISOString()
            })
        }
      );

    if (
      Array.isArray(updated) &&
      updated.length
    ) {
      return {
        previousBalance:
          balance,

        newBalance
      };
    }
  }

  throw new Error(
    "Wallet is being updated by another transaction. Please try again."
  );
}

/* =========================================================
   WALLET REFUND
========================================================= */

async function refundWallet(
  userId,
  amount
) {
  const refund =
    Number(amount);

  if (
    !Number.isFinite(refund) ||
    refund <= 0
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

    const balance =
      Number(
        wallet.balance || 0
      );

    const newBalance =
      balance + refund;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${encodeURIComponent(
          balance
        )}`,
        {
          method:
            "PATCH",

          body:
            JSON.stringify({
              balance:
                newBalance,

              updated_at:
                new Date().toISOString()
            })
        }
      );

    if (
      Array.isArray(updated) &&
      updated.length
    ) {
      return {
        previousBalance:
          balance,

        newBalance
      };
    }
  }

  throw new Error(
    "Unable to complete wallet refund automatically."
  );
}

/* =========================================================
   WALLET TRANSACTION
========================================================= */

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
        method:
          "POST",

        body:
          JSON.stringify({
            user_id:
              userId,

            amount,

            balance_after:
              balanceAfter,

            type:
              "order",

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

/* =========================================================
   CREATE ORDER
========================================================= */

async function createOrder(
  userId,
  order
) {
  const providerCost =
    Number(
      order.providerPrice
    );

  const customerPrice =
    Number(
      order.sellingPrice
    );

  if (
    !Number.isFinite(
      providerCost
    )
  ) {
    throw new Error(
      "Provider cost is unavailable. Order was not saved."
    );
  }

  const rows =
    await supabaseRequest(
      "orders",
      {
        method:
          "POST",

        body:
          JSON.stringify({
            user_id:
              userId,

            provider_order_id:
              order.requestId,

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
              customerPrice -
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
              "https://sureverifications.com/api/v1",

            provider_expired_at:
              order.providerExpiredAt ||
              null
          })
      }
    );

  return rows;
}

/* =========================================================
   PROVIDER PRICE
========================================================= */

async function getProviderPriceFromServer({
  server,
  countryId,
  providerServiceId,
  serviceName,
  fallbackCost
}) {
  /*
   * Global Server 2 has its own price endpoint.
   */
  if (
    server ===
    "global-server-2"
  ) {
    try {
      const data =
        await sureVerificationRequest(
          "/global-server-2/price"
        );

      const prices =
        Array.isArray(
          data?.prices
        )
          ? data.prices
          : [];

      const wantedId =
        normalize(
          providerServiceId
        );

      const wantedName =
        normalize(
          serviceName
        );

      const matches =
        prices.filter(
          item => {
            const id =
              normalize(
                item?.service?.id
              );

            const name =
              normalize(
                item?.service?.name
              );

            return (
              id === wantedId ||
              name === wantedName ||
              name.includes(
                wantedName
              ) ||
              wantedName.includes(
                name
              )
            );
          }
        );

      const usable =
        matches
          .filter(
            item => {
              const stock =
                item?.service
                  ?.stocks;

              return (
                stock === null ||
                stock === undefined ||
                Number(stock) > 0
              );
            }
          )
          .sort(
            (a, b) =>
              Number(
                a?.price || 0
              ) -
              Number(
                b?.price || 0
              )
          );

      const price =
        Number(
          usable?.[0]?.price
        );

      if (
        Number.isFinite(price) &&
        price > 0
      ) {
        return price;
      }
    } catch (error) {
      console.error(
        "Global Server 2 price lookup failed:",
        error
      );
    }
  } else {
    /*
     * USA Server 1
     * USA Server 2
     * Global Server 1
     */
    try {
      const data =
        await sureVerificationRequest(
          `/${server}/price?country_id=${quote(
            countryId
          )}&service=${quote(
            providerServiceId
          )}`
        );

      const price =
        Number(
          data?.price ??
          data?.data?.price ??
          data?.amount ??
          data?.data?.amount
        );

      if (
        Number.isFinite(price) &&
        price > 0
      ) {
        return price;
      }
    } catch (error) {
      console.error(
        `${server} price lookup failed:`,
        error
      );
    }
  }

  /*
   * Admin-configured provider cost.
   */
  const fallback =
    Number(
      fallbackCost
    );

  if (
    Number.isFinite(fallback) &&
    fallback >= 0
  ) {
    return fallback;
  }

  return NaN;
}

/* =========================================================
   PURCHASE FROM EXACT SERVER
========================================================= */

async function purchaseFromExactServer({
  server,
  countryId,
  providerServiceId
}) {
  /*
   * GLOBAL SERVER 2
   *
   * Send country_id and service
   * in the request body as well as
   * the query string.
   */
  if (
    server ===
    "global-server-2"
  ) {
    return await sureVerificationRequest(
      `/${server}/purchase?country_id=${quote(
        countryId
      )}&service=${quote(
        providerServiceId
      )}`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            country_id:
              String(
                countryId
              ),

            service:
              String(
                providerServiceId
              )
          })
      }
    );
  }

  /*
   * USA Server 1
   * USA Server 2
   * Global Server 1
   */
  return await sureVerificationRequest(
    `/${server}/purchase?country_id=${quote(
      countryId
    )}&service=${quote(
      providerServiceId
    )}`,
    {
      method:
        "POST"
    }
  );
}

/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method !==
    "POST"
  ) {
    return res.status(405).json({
      success:
        false,

      error:
        "Method not allowed."
    });
  }

  let user =
    null;

  let debited =
    false;

  let debitAmount =
    0;

  try {
    /* =====================================================
       AUTH
    ===================================================== */

    user =
      await getAuthenticatedUser(
        req
      );

    const body =
      typeof req.body ===
      "string"
        ? JSON.parse(
            req.body
          )
        : req.body || {};

    /* =====================================================
       REQUEST VALUES
    ===================================================== */

    const countryId =
      body.countryId ??
      body.country_id ??
      "";

    const countryName =
      body.countryName ??
      body.country_name ??
      "";

    const countryCode =
      body.countryCode ??
      body.country_code ??
      "";

    /*
     * This is the internal service/pricing ID
     * sent by your existing frontend.
     */
    const serviceId =
      body.serviceCountryPriceId ??
      body.service_country_price_id ??
      body.serviceId ??
      body.service_id ??
      "";

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    /*
     * THIS IS THE IMPORTANT PART.
     *
     * The exact server selected by the customer
     * comes from the Buy Number dropdown.
     */
    const requestedProviderServer =
      String(
        body.providerServer ??
        body.provider_server ??
        body.server ??
        ""
      ).trim();

    if (!countryId) {
      return res.status(400).json({
        success:
          false,

        error:
          "Country is required."
      });
    }

    if (!serviceId && !requestedServiceName) {
      return res.status(400).json({
        success:
          false,

        error:
          "Service is required."
      });
    }

    /* =====================================================
       EXACT SERVER VALIDATION
    ===================================================== */

    if (
      requestedProviderServer &&
      !ALLOWED_SERVERS.includes(
        requestedProviderServer
      )
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          `Invalid provider server "${requestedProviderServer}".`
      });
    }

    /*
     * If the customer selected a server,
     * ONLY that server will ever be called.
     */
    const explicitServer =
      requestedProviderServer ||
      null;

    /* =====================================================
       LOAD ADMIN PRICE
    ===================================================== */

    let pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${quote(
          countryId
        )}` +
        `&service_id=eq.${quote(
          serviceId
        )}` +
        (
          explicitServer
            ? `&provider_server=eq.${quote(
                explicitServer
              )}`
            : ""
        ) +
        `&select=country_id,country_name,service_id,service_name,selling_price,provider_cost,provider_server,provider_service_id,is_active&limit=1`
      );

    /*
     * Fallback to service name, but STILL restricted
     * to the selected server.
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
          )}` +
          (
            explicitServer
              ? `&provider_server=eq.${quote(
                  explicitServer
                )}`
              : ""
          ) +
          `&select=country_id,country_name,service_id,service_name,selling_price,provider_cost,provider_server,provider_service_id,is_active`
        );

      const wanted =
        normalize(
          requestedServiceName
        );

      pricingRows =
        Array.isArray(
          countryRows
        )
          ? countryRows.filter(
              row =>
                row?.is_active !==
                  false &&
                normalize(
                  row?.service_name
                ) === wanted
            )
          : [];
    }

    const pricing =
      pricingRows?.[0] ||
      null;

    /*
     * NEVER use another server's price.
     */
    if (
      explicitServer &&
      pricing &&
      pricing.provider_server &&
      pricing.provider_server !==
        explicitServer
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          `No price is configured for ${explicitServer} for this service.`
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
        success:
          false,

        error:
          "This country and service is not currently available for purchase on the selected server."
      });
    }

    const serviceName =
      pricing?.service_name ||
      requestedServiceName ||
      String(serviceId);

    /* =====================================================
       SERVER ROUTING
    ===================================================== */

    /*
     * If explicit server exists:
     *
     * USA Server 1 -> USA Server 1 ONLY
     * USA Server 2 -> USA Server 2 ONLY
     * Global Server 1 -> Global Server 1 ONLY
     * Global Server 2 -> Global Server 2 ONLY
     *
     * NO SILENT FALLBACK.
     */
    const servers =
      explicitServer
        ? [explicitServer]
        : [
            "usa-server-2",
            "usa-server-1",
            "global-server-2",
            "global-server-1"
          ];

    /* =====================================================
       DEBIT WALLET
    ===================================================== */

    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited =
      true;

    debitAmount =
      sellingPrice;

    /* =====================================================
       PURCHASE
    ===================================================== */

    let providerData =
      null;

    let selectedServer =
      null;

    let providerServiceId =
      null;

    let providerError =
      null;

    for (
      const server of servers
    ) {
      try {
        /*
         * Use the provider service ID configured for
         * this exact server when available.
         */
        providerServiceId =
          pricing?.provider_service_id ||
          null;

        /*
         * Otherwise resolve the service from
         * THIS exact server's service catalogue.
         */
        if (
          !providerServiceId
        ) {
          const providerService =
            await resolveProviderService(
              server,
              countryId,
              pricing?.service_id ||
                serviceId,
              serviceName
            );

          providerServiceId =
            providerService.id;
        }

        console.log(
          "PURCHASE EXACT SERVER",
          {
            server,
            countryId,
            providerServiceId,
            serviceName,
            explicitServer
          }
        );

        /*
         * Purchase ONLY from this server.
         */
        const candidate =
          await purchaseFromExactServer({
            server,

            countryId,

            providerServiceId
          });

        console.log(
          "PROVIDER RESPONSE",
          {
            server,
            response:
              candidate
          }
        );

        const verificationId =
          getVerificationId(
            candidate
          );

        const phoneNumber =
          getPhoneNumber(
            candidate
          );

        /*
         * Only accept the number if THIS SAME
         * server returned it.
         */
        if (
          verificationId &&
          phoneNumber
        ) {
          providerData =
            candidate;

          selectedServer =
            server;

          break;
        }

        providerError =
          new Error(
            `${server} did not return a valid number.`
          );

        /*
         * Never switch servers when the user
         * explicitly selected one.
         */
        if (
          explicitServer
        ) {
          break;
        }

      } catch (error) {
        providerError =
          error;

        console.error(
          "EXACT SERVER PURCHASE ERROR",
          {
            server,

            countryId,

            providerServiceId,

            message:
              error?.message
          }
        );

        /*
         * Explicit selection means:
         * NO OTHER SERVER MAY BE TRIED.
         */
        if (
          explicitServer
        ) {
          break;
        }
      }
    }

    /* =====================================================
       PURCHASE FAILED
    ===================================================== */

    if (!providerData) {
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (
        refundError
      ) {
        console.error(
          "Automatic refund failed:",
          refundError
        );
      }

      debited =
        false;

      throw new Error(
        providerError?.message ||
        `No number was returned by ${explicitServer || "the provider"}.`
      );
    }

    /* =====================================================
       PROVIDER DATA
    ===================================================== */

    const verification =
      getVerification(
        providerData
      );

    const verificationId =
      getVerificationId(
        providerData
      );

    const requestId =
      getRequestId(
        providerData
      );

    const phoneNumber =
      getPhoneNumber(
        providerData
      );

    const expiredAt =
      getExpiredAt(
        providerData
      );

    if (
      !verificationId ||
      !phoneNumber
    ) {
      await refundWallet(
        user.id,
        sellingPrice
      );

      debited =
        false;

      throw new Error(
        `The selected server ${selectedServer} did not return a valid number. Your wallet was refunded.`
      );
    }

    /* =====================================================
       PROVIDER COST
    ===================================================== */

    const responseProviderCost =
      getProviderPrice(
        providerData
      );

    const providerCost =
      Number.isFinite(
        responseProviderCost
      )
        ? responseProviderCost
        : await getProviderPriceFromServer({
            server:
              selectedServer,

            countryId,

            providerServiceId,

            serviceName,

            fallbackCost:
              pricing?.provider_cost
          });

    if (
      !Number.isFinite(
        providerCost
      )
    ) {
      await refundWallet(
        user.id,
        sellingPrice
      );

      debited =
        false;

      throw new Error(
        `Provider cost is unavailable for ${selectedServer}. Your wallet was refunded.`
      );
    }

    /* =====================================================
       SAVE ORDER
    ===================================================== */

    let orderRows;

    try {
      orderRows =
        await createOrder(
          user.id,
          {
            requestId:
              requestId ||
              verificationId,

            verificationId,

            serviceCountryPriceId:
              serviceId,

            serviceName,

            countryName:
              pricing?.country_name ||
              countryName ||
              String(countryId),

            providerPrice:
              providerCost,

            sellingPrice,

            phoneNumber,

            status:
              verification?.status ||
              "active",

            providerServer:
              selectedServer,

            providerExpiredAt:
              expiredAt
          }
        );
    } catch (orderError) {
      /*
       * The provider already gave us a number but our
       * database failed. Refund the customer's wallet.
       */
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (
        refundError
      ) {
        console.error(
          "Order-save refund failed:",
          refundError
        );
      }

      debited =
        false;

      throw orderError;
    }

    /* =====================================================
       BALANCE AFTER PURCHASE
    ===================================================== */

    const walletRows =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          user.id
        )}&select=balance&limit=1`
      );

    const balanceAfter =
      Number(
        walletRows?.[0]
          ?.balance || 0
      );

    await createWalletTransaction({
      userId:
        user.id,

      amount:
        -sellingPrice,

      balanceAfter,

      description:
        `Purchase: ${serviceName} ${phoneNumber} (${selectedServer})`
    });

    debited =
      false;

    /* =====================================================
       SUCCESS
    ===================================================== */

    return res.status(200).json({
      success:
        true,

      message:
        "Number purchased successfully.",

      order:
        orderRows?.[0] ||
        null,

      verification: {
        ...verification,

        id:
          verificationId,

        request_id:
          requestId ||
          null,

        number:
          phoneNumber,

        expired_at:
          expiredAt ||
          null
      },

      /*
       * This tells the frontend exactly which
       * provider supplied the number.
       */
      provider_server:
        selectedServer,

      provider_service_id:
        providerServiceId,

      provider_price:
        providerCost,

      selling_price:
        sellingPrice,

      profit:
        sellingPrice -
        providerCost,

      balance:
        balanceAfter
    });

  } catch (error) {
    console.error(
      "Order purchase error:",
      error
    );

    /*
     * Safety refund.
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
      message
        .toLowerCase()
        .includes(
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

    if (
      message ===
      "Unauthorized."
    ) {
      return res.status(401).json({
        success:
          false,

        error:
          "Unauthorized."
      });
    }

    return res.status(500).json({
      success:
        false,

      error:
        message,

      message
    });
  }
}
