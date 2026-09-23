async function cancelActiveNumber(index) {
  try {
    const item = activeNumbers?.[index];

    if (!item) {
      alert("Active number not found.");
      return;
    }

    // Use the order ID first, then fall back to phone number.
    const identifier =
      item.order_id ||
      item.orderId ||
      item.id ||
      item.phone_number ||
      item.phoneNumber ||
      item.number;

    if (!identifier) {
      alert("Order information not found.");
      return;
    }

    const confirmed = confirm(
      "Are you sure you want to cancel this number? If cancellation is successful, your money will be returned to your wallet."
    );

    if (!confirmed) return;

    const sessionResult = await supabaseClient.auth.getSession();
    const accessToken =
      sessionResult?.data?.session?.access_token;

    if (!accessToken) {
      throw new Error("Please log in again.");
    }

    const response = await fetch(
      `/api/cancel?id=${encodeURIComponent(identifier)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      throw new Error(
        result.error ||
        result.message ||
        `Cancellation failed (HTTP ${response.status})`
      );
    }

    alert(
      result.message ||
      "Number cancelled successfully. Your money has been returned to your wallet."
    );

    // Reload the active numbers after cancellation.
    if (typeof loadActiveNumbers === "function") {
      await loadActiveNumbers();
    }

    // Refresh wallet balance if your dashboard has either function.
    if (typeof loadWallet === "function") {
      await loadWallet();
    }

    if (typeof loadBalance === "function") {
      await loadBalance();
    }

  } catch (error) {
    console.error("Cancel Number Error:", error);

    alert(
      error?.message ||
      "Unable to cancel number."
    );
  }
}
