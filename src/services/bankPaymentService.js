import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Executes a payment by marking it as paid and creating a bank statement entry
 * @param {string} paymentId - The ID of the payment to execute
 * @param {string} userId - The ID of the user executing the payment
 * @returns {Promise<Object>} The payment and bank statement data
 */
export const executePayment = async (paymentId, userId) => {
  if (!paymentId) {
    throw new Error("Payment ID not provided");
  }

  try {
    // Fetch payment by ID
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      throw new Error("Payment not found");
    }

    // Update the payment status to "PAID"
    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: "PAID" })
      .eq("id", paymentId);

    if (updateError) {
      throw new Error(`Error updating payment status: ${updateError.message}`);
    }

    console.log("userId", userId);

    // Insert the payment data into the "bank_statements" table
    const bankStatementData = {
      bank_account_id: payment.bank_account_id,
      transaction_date: new Date().toISOString().split("T")[0], // Use today's date as the transaction date
      value_date: new Date().toISOString().split("T")[0], // Use today's date for value date
      type: "DEBIT", // Assuming the type is "DEBIT" for payments
      description: `${payment.description} ${
        payment.installments && payment.installment_number
          ? `(${payment.installment_number}/${payment.installments})`
          : ""
      }`,
      beneficiary: payment.supplier_name,
      value: payment.value,
      category_id: payment.category_id,
      status: !payment.category_id ? "PENDING" : "RECONCILED", // Default status for new bank statement entries
      created_by_id: userId,
      payment_id: paymentId,
    };

    const { data: bankStatement, error: bankStatementError } = await supabase
      .from("bank_statements")
      .insert([bankStatementData]);

    if (bankStatementError) {
      throw new Error(`Error inserting bank statement: ${bankStatementError.message}`);
    }

    return {
      message: "Payment marked as PAID and bank statement created",
      payment,
      bankStatement,
    };
  } catch (error) {
    console.error("Error marking payment as PAID:", error);
    throw error;
  }
};

export default { executePayment }; 