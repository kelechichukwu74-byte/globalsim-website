/* =========================================================
   ACTIVE NUMBERS
   ========================================================= */

async function loadActiveNumbers() {

  const container =
    $("activeNumbersContainer");

  container.innerHTML =
    '<div class="loading">Loading active numbers...</div>';

  try {

    const accessToken =
      await getCurrentAccessToken();

    if (!accessToken) {
      throw new Error(
        "Please log in again."
      );
    }

    const response =
      await fetch("/api/active", {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          Accept:
            "application/json"
        }
      });

    const result =
      await response
        .json()
        .catch(() => ({}));

    if (
      !response.ok ||
      result?.success === false
    ) {
      throw new Error(
        result?.error ||
        result?.message ||
        "Unable to load active numbers."
      );
    }

    let numbers =
      Array.isArray(result)
        ? result
        : (
            result?.numbers ||
            result?.activations ||
            result?.data ||
            []
          );

    /*
     * Normalize nested API responses.
     */

    for (
      let i = 0;
      i < 3 &&
      numbers &&
      !Array.isArray(numbers);
      i++
    ) {

      if (
        Array.isArray(numbers?.numbers)
      ) {

        numbers =
          numbers.numbers;

      } else if (
        Array.isArray(numbers?.activations)
      ) {

        numbers =
          numbers.activations;

      } else if (
        Array.isArray(numbers?.data)
      ) {

        numbers =
          numbers.data;

      } else {

        break;
      }
    }

    if (!Array.isArray(numbers)) {
      numbers = [];
    }

    /*
     * IMPORTANT:
     *
     * Preserve the REAL provider verification ID.
     * This is the ID required by SureVerification
     * for SMS and cancellation.
     */

    numbers =
      numbers.map(item => {

        const verificationId =
          item?.provider_verification_id ||
          item?.providerVerificationId ||
          item?.verification_id ||
          item?.verificationId ||
          item?.verification?.id ||
          "";

        return {
          ...item,

          provider_verification_id:
            verificationId,

          providerVerificationId:
            verificationId,

          verification_id:
            verificationId,

          verificationId:
            verificationId
        };
      });

    /*
     * Make the numbers available to
     * cancelActiveNumber().
     */

    window.globalSimActiveNumbers =
      numbers;

    if (!numbers.length) {

      container.innerHTML =
        `
        <div class="empty-state">
          You do not have any active numbers yet.
        </div>
        `;

      return;
    }

    container.innerHTML =
      `
      ${numbers.map((item, index) => {

        const phone =
          item.phone_number ||
          item.phoneNumber ||
          item.number ||
          "—";

        const service =
          item.service_name ||
          item.serviceName ||
          item.service ||
          "—";

        const status =
          item.status ||
          "active";

        const verificationId =
          item.provider_verification_id ||
          item.providerVerificationId ||
          "";

        console.log(
          "Active number:",
          phone,
          "Verification ID:",
          verificationId
        );

        return `
          <div class="active-number-card">

            <div class="active-number-header">

              <div>
                ${escapeHtml(service)}
              </div>

              <span class="status-badge">
                ${escapeHtml(status)}
              </span>

            </div>

            <div class="active-number-phone">
              ${escapeHtml(phone)}
            </div>

            <button
              type="button"
              class="copy-number-btn"
              onclick="copyNumber('${escapeHtml(
                String(phone)
              )}')"
            >
              📋 Copy Number
            </button>

            <div
              class="sms-box"
              id="smsBox-${index}"
            >

              <div class="sms-header">
                <strong>SMS</strong>

                <span
                  id="smsStatus-${index}"
                >
                  Waiting for SMS...
                </span>
              </div>

              <div
                id="smsMessage-${index}"
              >
                Waiting for incoming SMS...
              </div>

            </div>

            <div
              class="cancel-availability"
              id="cancelAvailability-${index}"
            >
              Cancellation is now available.
            </div>

            <button
              type="button"
              id="cancelButton-${index}"
              class="cancel-number-btn"
              onclick="cancelActiveNumber(${index})"
            >
              ❌ Cancel Number
            </button>

            <div class="purchase-date">
              Purchased:
              ${formatDate(
                item.created_at ||
                item.createdAt
              )}
            </div>

          </div>
        `;

      }).join("")}
      `;

  } catch (error) {

    console.error(
      "Active numbers error:",
      error
    );

    container.innerHTML =
      `
      <div class="empty-state">
        ${escapeHtml(
          error?.message ||
          "Unable to load active numbers."
        )}
      </div>
      `;
  }
}


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
   * THIS IS THE IMPORTANT PART.
   *
   * provider_verification_id is the real
   * SureVerification verification ID.
   */

  let verificationId =
    item.provider_verification_id ||
    item.providerVerificationId ||
    item.verification_id ||
    item.verificationId ||
    item.verification?.id ||
    "";

  /*
   * If the API response still doesn't contain
   * the ID, try to retrieve the order directly
   * from Supabase using the phone number.
   */

  if (!verificationId) {

    try {

      const phoneNumber =
        item.phone_number ||
        item.phoneNumber ||
        item.number ||
        "";

      if (phoneNumber) {

        const {
          data,
          error
        } = await supabaseClient
          .from("orders")
          .select(
            "id,provider_verification_id,provider_order_id,phone_number,status"
          )
          .eq(
            "user_id",
            currentUser.id
          )
          .eq(
            "phone_number",
            phoneNumber
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(1)
          .maybeSingle();

        if (!error && data) {

          verificationId =
            data.provider_verification_id ||
            "";
        }
      }

    } catch (lookupError) {

      console.error(
        "Verification ID lookup error:",
        lookupError
      );
    }
  }

  /*
   * Still missing?
   */

  if (!verificationId) {

    console.error(
      "Cancellation failed. Full active number:",
      item
    );

    showToast(
      "Verification ID not found.",
      "error"
    );

    return;
  }

  console.log(
    "Using verification ID for cancellation:",
    verificationId
  );

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

  button.disabled =
    true;

  button.textContent =
    "Cancelling...";

  try {

    const accessToken =
      await getCurrentAccessToken();

    if (!accessToken) {

      throw new Error(
        "Your session has expired. Please log in again."
      );
    }

    /*
     * Your backend cancellation endpoint.
     */

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

    showToast(
      result.message ||
      "Number cancelled successfully. Your wallet has been refunded.",
      "success"
    );

    /*
     * Reload everything after successful
     * cancellation.
     */

    await loadActiveNumbers();

    if (
      typeof loadWallet ===
      "function"
    ) {
      await loadWallet();
    }

    if (
      typeof loadDashboard ===
      "function"
    ) {
      await loadDashboard();
    }

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
