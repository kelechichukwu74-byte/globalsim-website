const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  const token =
    getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
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

async function supabaseRequest(
  path
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
        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Accept:
            "application/json"
        }
      }
    );

  const text =
    await response.text();

  let data = [];

  try {
    data =
      text
        ? JSON.parse(text)
        : [];
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

function quote(value) {
  return encodeURIComponent(
    String(value)
  );
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET"
  ) {
    return res.status(405).json({
      success:
        false,
      error:
        "Method not allowed"
    });
  }

  try {
    const user =
      await getAuthenticatedUser(
        req
      );

    /*
     * ORDER HISTORY
     *
     * Only return orders belonging
     * to the authenticated customer.
     */
    const orders =
      await supabaseRequest(
        `orders?user_id=eq.${quote(
          user.id
        )}&select=*&order=created_at.desc`
      );

    /*
     * WALLET TRANSACTION HISTORY
     *
     * Includes:
     * - purchases
     * - refunds
     * - deposits
     * - other wallet transactions
     */
    let walletTransactions =
      [];

    try {
      walletTransactions =
        await supabaseRequest(
          `wallet_transactions?user_id=eq.${quote(
            user.id
          )}&select=*&order=created_at.desc`
        );
    } catch (walletError) {
      console.error(
        "Wallet transaction history error:",
        walletError
      );

      walletTransactions =
        [];
    }

    /*
     * DEPOSIT HISTORY
     */
    let deposits = [];

    try {
      deposits =
        await supabaseRequest(
          `deposits?user_id=eq.${quote(
            user.id
          )}&select=*&order=created_at.desc`
        );
    } catch (depositError) {
      console.error(
        "Deposit history error:",
        depositError
      );

      deposits = [];
    }

    /*
     * Combine the available history
     * into a simple response for the frontend.
     */
    const orderHistory =
      Array.isArray(orders)
        ? orders.map(order => ({
            ...order,

            history_type:
              "order",

            purchased_at:
              order.created_at ||
              null,

            amount:
              Number(
                order.price || 0
              ),

            display_status:
              order.status ||
              "active"
          }))
        : [];

    const transactionHistory =
      Array.isArray(
        walletTransactions
      )
        ? walletTransactions.map(
            transaction => ({
              ...transaction,

              history_type:
                "wallet",

              amount:
                Number(
                  transaction.amount ||
                    0
                ),

              transaction_date:
                transaction.created_at ||
                null
            })
          )
        : [];

    const depositHistory =
      Array.isArray(deposits)
        ? deposits.map(
            deposit => ({
              ...deposit,

              history_type:
                "deposit",

              amount:
                Number(
                  deposit.amount ||
                    0
                ),

              transaction_date:
                deposit.created_at ||
                null
            })
          )
        : [];

    /*
     * Return everything separately so
     * the frontend can display tabs/sections
     * without having to guess the record type.
     */
    return res.status(200).json({
      success:
        true,

      orders:
        orderHistory,

      order_history:
        orderHistory,

      transactions:
        transactionHistory,

      wallet_transactions:
        transactionHistory,

      deposits:
        depositHistory,

      deposit_history:
        depositHistory,

      /*
       * A combined timeline is also provided.
       */
      history:
        [
          ...orderHistory,
          ...transactionHistory,
          ...depositHistory
        ].sort(
          (a, b) =>
            new Date(
              b.created_at ||
              b.transaction_date ||
              b.purchased_at ||
              0
            ).getTime() -
            new Date(
              a.created_at ||
              a.transaction_date ||
              a.purchased_at ||
              0
            ).getTime()
        )
    });

  } catch (error) {
    console.error(
      "History API error:",
      error
    );

    const message =
      error?.message ||
      "Unable to load history.";

    if (
      message ===
      "Unauthorized."
    ) {
      return res.status(401).json({
        success:
          false,
        error:
          message
      });
    }

    return res.status(500).json({
      success:
        false,
      error:
        message,

      orders: [],
      order_history: [],
      transactions: [],
      wallet_transactions: [],
      deposits: [],
      deposit_history: [],
      history: []
    });
  }
}
