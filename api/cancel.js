async function cancelActiveNumber(index) {
  try {
    const item =
      Array.isArray(activeNumbers)
        ? activeNumbers[index]
        : null;

    if (!item) {
      alert("Active number not found.");
      return;
    }

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

    const button = document.activeElement;

    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = "Cancelling...";
    }

    const session = await supabaseClient.auth.getSession();

    const accessToken =
      session?.data?.session?.access_token;

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

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
      throw new Error(
        data.error ||
        data.message ||
        `Cancellation failed (HTTP ${response.status})`
      );
    }

    alert(
      data.message ||
      "Number cancelled successfully. Your money has been returned to your wallet."
    );

    await loadActiveNumbers();

    if (typeof loadWallet === "function") {
      await loadWallet();
    }

    if (typeof loadBalance === "function") {
      await loadBalance();
    }

  } catch (error) {
    console.error("Cancel number error:", error);

    alert(
      error?.message ||
      "Unable to cancel number."
    );

  } finally {
    const button = document.activeElement;

    if (button) {
      button.disabled = false;

      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  }
}
