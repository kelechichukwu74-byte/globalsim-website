/* =========================================================
   CANCEL ACTIVE NUMBER
   ========================================================= */

async function cancelActiveNumber(index) {

  const numbers =
    window.globalSimActiveNumbers || [];

  const item =
    numbers[index];

  if (!item) {
    showToast(
      "Number not found.",
      "error"
    );
    return;
  }

  /*
   * IMPORTANT:
   *
   * provider_verification_id is the REAL
   * SureVerification verification ID.
   *
   * DO NOT use provider_order_id here.
   * provider_order_id is the request_id.
   */

  const verificationId =
    item.provider_verification_id ||
    item.providerVerificationId ||
    item.verification_id ||
    item.verificationId ||
    item.verification?.id ||
    "";

  console.log(
    "Cancel verification ID:",
    verificationId
  );

  if (!verificationId) {

    console.error(
      "Cancel failed: provider_verification_id is missing.",
      item
    );

    showToast(
      "Verification ID not found.",
      "error"
    );

    return;
  }

  const button =
    $(`cancelButton-${index}`);

  if (!button) {
    return;
  }

  if (button.disabled) {

    showToast(
      "Please wait until cancellation is available.",
      "error"
    );

    return;
  }

  const confirmed =
    window.confirm(
      "Are you sure you want to cancel this number? The amount paid for this number will be refunded to your wallet."
    );

  if (!confirmed) {
    return;
  }

  button.disabled = true;

  button.textContent =
    "Cancelling...";

  try {

    /* -----------------------------------------
       GET CURRENT SUPABASE SESSION
    ----------------------------------------- */

    const sessionResult =
      await supabaseClient.auth.getSession();

    const accessToken =
      sessionResult?.data?.session?.access_token ||
      "";

    if (!accessToken) {

      throw new Error(
        "Your session has expired. Please log in again."
      );
    }

    /* -----------------------------------------
       CALL CANCEL API
    ----------------------------------------- */

    const response =
      await fetch(
        `/api/cancel?id=${encodeURIComponent(
          String(verificationId)
        )}`,
        {
          method: "DELETE",

          headers: {
            Authorization:
              `Bearer ${accessToken}`,

            Accept:
              "application/json"
          }
        }
      );

    const result =
      await response
        .json()
        .catch(() => ({}));

    console.log(
      "Cancel API response:",
      result
    );

    if (
      !response.ok ||
      !result?.success
    ) {

      throw new Error(
        result?.error ||
        result?.message ||
        "Unable to cancel number."
      );
    }

    /* -----------------------------------------
       SUCCESS
    ----------------------------------------- */

    showToast(
      result.message ||
      "Number cancelled successfully. Your wallet has been refunded.",
      "success"
    );

    /* -----------------------------------------
       REFRESH ACTIVE NUMBERS
    ----------------------------------------- */

    await loadActiveNumbers();

    /* -----------------------------------------
       REFRESH WALLET
    ----------------------------------------- */

    if (
      typeof loadWallet ===
      "function"
    ) {
      await loadWallet();
    }

    /* -----------------------------------------
       REFRESH DASHBOARD
    ----------------------------------------- */

    if (
      typeof loadDashboard ===
      "function"
    ) {
      await loadDashboard();
    }

    /* -----------------------------------------
       REFRESH ORDER HISTORY
    ----------------------------------------- */

    if (
      typeof loadOrderHistory ===
      "function"
    ) {
      await loadOrderHistory();
    }

  } catch (error) {

    console.error(
      "Cancel number error:",
      error
    );

    showToast(
      error?.message ||
      "Unable to cancel number.",
      "error"
    );

    button.disabled =
      false;

    button.textContent =
      "❌ Cancel Number";
  }
}
