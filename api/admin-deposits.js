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

async function supabaseRequest(path, options = {}) {
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

  const text = await response.text();

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

function quote(value) {
  return encodeURIComponent(
    String(value)
  );
}

async function verifyAdmin(req) {
  const user =
    await getAuthenticatedUser(req);

  const profiles =
    await supabaseRequest(
      `profiles?id=eq.${quote(
        user.id
      )}&select=id,role&limit=1`
    );

  const profile =
    profiles?.[0];

  if (
    !profile ||
    String(profile.role)
      .toLowerCase() !==
      "admin"
  ) {
    throw new Error(
      "Administrator access is required."
    );
  }

  return user;
}

async function addWalletBalance(
  userId,
  amount
) {
  const depositAmount =
    Number(amount);

  if (
    !Number.isFinite(
      depositAmount
    ) ||
    depositAmount <= 0
  ) {
    throw new Error(
      "Invalid deposit amount."
    );
  }

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const wallets =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&select=user_id,balance&limit=1`
      );

    const wallet =
      wallets?.[0];

    if (!wallet) {
      throw new Error(
        "Customer wallet was not found."
      );
    }

    const currentBalance =
      Number(
        wallet.balance || 0
      );

    if (
      !Number.isFinite(
        currentBalance
      )
    ) {
      throw new Error(
        "Unable to read customer wallet balance."
      );
    }

    const newBalance =
      currentBalance +
      depositAmount;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${encodeURIComponent(
          currentBalance
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
      Array.isArray(
        updated
      ) &&
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
    "Unable to update the customer wallet. Please try again."
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
        method:
          "POST",
        body:
          JSON.stringify({
            user_id:
              userId,
            amount:
              Number(amount),
            balance_after:
              Number(balanceAfter),
            type:
              "deposit",
            description:
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

export default async function handler(
  req,
  res
) {
  try {
    await verifyAdmin(req);

    if (
      req.method === "GET"
    ) {
      const deposits =
        await supabaseRequest(
          "deposits?select=*&order=created_at.desc"
        );

      return res.status(200).json({
        success:
          true,
        deposits:
          deposits || []
      });
    }

    if (
      req.method !== "POST"
    ) {
      return res.status(405).json({
        success:
          false,
        error:
          "Method not allowed"
      });
    }

    const body =
      req.body || {};

    const depositId =
      body.depositId ??
      body.deposit_id ??
      body.id;

    const action =
      String(
        body.action ||
        body.status ||
        ""
      )
        .trim()
        .toLowerCase();

    if (!depositId) {
      return res.status(400).json({
        success:
          false,
        error:
          "Deposit ID is required."
      });
    }

    if (
      action !== "approve" &&
      action !== "reject"
    ) {
      return res.status(400).json({
        success:
          false,
        error:
          "Action must be approve or reject."
      });
    }

    const deposits =
      await supabaseRequest(
        `deposits?id=eq.${quote(
          depositId
        )}&select=*&limit=1`
      );

    const deposit =
      deposits?.[0];

    if (!deposit) {
      return res.status(404).json({
        success:
          false,
        error:
          "Deposit not found."
      });
    }

    const currentStatus =
      String(
        deposit.status ||
        ""
      ).toLowerCase();

    if (
      currentStatus ===
        "approved" ||
      currentStatus ===
        "completed"
    ) {
      return res.status(400).json({
        success:
          false,
        error:
          "This deposit has already been approved."
      });
    }

    if (
      currentStatus ===
        "rejected"
    ) {
      return res.status(400).json({
        success:
          false,
        error:
          "This deposit has already been rejected."
      });
    }

    if (
      action === "reject"
    ) {
      const rejected =
        await supabaseRequest(
          `deposits?id=eq.${quote(
            depositId
          )}&status=eq.${quote(
            deposit.status || "pending"
          )}`,
          {
            method:
              "PATCH",
            body:
              JSON.stringify({
                status:
                  "rejected",
                updated_at:
                  new Date().toISOString()
              })
          }
        );

      if (
        !Array.isArray(
          rejected
        ) ||
        rejected.length === 0
      ) {
        return res.status(409).json({
          success:
            false,
          error:
            "This deposit is already being processed."
        });
      }

      return res.status(200).json({
        success:
          true,
        message:
          "Deposit rejected successfully.",
        deposit:
          rejected[0]
      });
    }

    const amount =
      Number(
        deposit.amount
      );

    if (
      !Number.isFinite(
        amount
      ) ||
      amount <= 0
    ) {
      return res.status(400).json({
        success:
          false,
        error:
          "Invalid deposit amount."
      });
    }

    if (!deposit.user_id) {
      return res.status(400).json({
        success:
          false,
        error:
          "This deposit is not linked to a customer."
      });
    }

    /*
      Lock the deposit first so two admin requests
      cannot credit the same deposit twice.
    */
    const locked =
      await supabaseRequest(
        `deposits?id=eq.${quote(
          depositId
        )}&status=eq.${quote(
          deposit.status || "pending"
        )}`,
        {
          method:
            "PATCH",
          body:
            JSON.stringify({
              status:
                "processing",
              updated_at:
                new Date().toISOString()
            })
        }
      );

    if (
      !Array.isArray(
        locked
      ) ||
      locked.length === 0
    ) {
      return res.status(409).json({
        success:
          false,
        error:
          "This deposit is already being processed."
      });
    }

    try {
      const wallet =
        await addWalletBalance(
          deposit.user_id,
          amount
        );

      await createWalletTransaction({
        userId:
          deposit.user_id,
        amount:
          amount,
        balanceAfter:
          wallet.newBalance,
        description:
          `Approved deposit: ₦${amount.toLocaleString(
            "en-NG"
          )}`
      });

      const approved =
        await supabaseRequest(
          `deposits?id=eq.${quote(
            depositId
          )}&status=eq.processing`,
          {
            method:
              "PATCH",
            body:
              JSON.stringify({
                status:
                  "approved",
                updated_at:
                  new Date().toISOString()
              })
          }
        );

      return res.status(200).json({
        success:
          true,
        message:
          "Deposit approved and wallet credited successfully.",
        deposit:
          approved?.[0] ||
          null,
        credited:
          amount,
        balance:
          wallet.newBalance
      });

    } catch (processingError) {
      console.error(
        "Deposit approval processing error:",
        processingError
      );

      try {
        await supabaseRequest(
          `deposits?id=eq.${quote(
            depositId
          )}&status=eq.processing`,
          {
            method:
              "PATCH",
            body:
              JSON.stringify({
                status:
                  "pending",
                updated_at:
                  new Date().toISOString()
              })
          }
        );
      } catch (unlockError) {
        console.error(
          "Unable to reset deposit status:",
          unlockError
        );
      }

      throw processingError;
    }

  } catch (error) {
    console.error(
      "Admin deposits API error:",
      error
    );

    const message =
      error?.message ||
      "Unable to manage deposits.";

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

    if (
      message ===
      "Administrator access is required."
    ) {
      return res.status(403).json({
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
        message
    });
  }
}
