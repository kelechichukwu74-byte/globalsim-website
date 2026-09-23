async function cancelActiveNumber(index) {
  try {
    const item = activeNumbers?.[index];

    if (!item) {
      throw new Error("Active number not found.");
    }

    const identifier =
      item.order_id ||
      item.orderId ||
      item.id ||
      item.phone_number ||
      item.phoneNumber ||
      item.number;

    if (!identifier) {
      throw new Error("Order information not found.");
    }

    const confirmed = confirm(
      "Are you sure you want to cancel this number? If it has expired, the money will be returned to your wallet."
    );

    if (!confirmed) return;

    const { data, error } = await supabaseClient.rpc(
      "cancel_virtual_number",
      {
        p_identifier: String(identifier)
      }
    );

    if (error) {
      console.error("Supabase cancellation error:", error);
      throw new Error(error.message || "Cancellation failed.");
    }

    if (!data?.success) {
      throw new Error(
        data?.error || "Unable to cancel this number."
      );
    }

    alert(
      data.message ||
      "Number cancelled and your money has been returned."
    );

    await loadActiveNumbers();

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
