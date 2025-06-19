import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const createPayment = async (req, res) => {
  const {
    supplier_name,
    description,
    value,
    due_date,
    cnpj_id,
    category_id,
    bank_account_id,
    competence,
    payment_method,
    pix_payment_method,
    cpfCnpj,
    bankCode,
    pix_key,
    barcode,
    branch,
    account,
    digit,
    end_date,
    frequency,
    installments,
    type,
    userId,
  } = req.body;

  // Validate required fields
  if (!supplier_name || !value || !due_date || !type || !userId) {
    return res.status(400).json({
      message:
        "Missing required fields: supplier_name, value, due_date, type, and userId are required.",
    });
  }

  try {
    let paymentData;

    // Prepare payment data based on the provided type
    if (type === "single") {
      paymentData = {
        supplier_name,
        description,
        value,
        due_date,
        status: "SCHEDULED", // Default status for a new payment
        cnpj_id,
        category_id,
        bank_account_id,
        created_by_id: userId,
        competence,
        payment_method,
        pix_payment_method,
        cpfCnpj,
        bankCode,
        pix_key,
        barcode,
        branch,
        account,
        digit,
        end_date,
        frequency,
        installments,
        type,
        created_by: userId,
      };
    } else if (type === "installments") {
      paymentData = generateInstallments(req.body, userId, null);
    } else if (type === "recurring") {
      paymentData = generateRecurringPayments(req.body, userId, null);
    } else {
      return res
        .status(400)
        .json({ message: "Invalid payment type provided." });
    }

    // Insert the payment data into the "payments" table
    const { data: payment, error: paymentInsertError } = await supabase
      .from("payments")
      .insert(Array.isArray(paymentData) ? paymentData : [paymentData]);

    if (paymentInsertError) {
      console.error("Error creating payment:", paymentInsertError);
      return res.status(500).json({
        message: "Error creating payment",
        error: paymentInsertError.message,
      });
    }

    return res.json({
      message: "Payment created successfully",
      payment,
    });
  } catch (error) {
    console.error("Error creating payment:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

export const updatePayment = async (req, res) => {
  const newPaymentData = req.body;

  if (!newPaymentData) {
    return res.status(400).json({
      message:
        "Missing required fields: paymentId and newPaymentData are required.",
    });
  }

  try {
    // Fetch the current payment data by ID
    const { data: currentPayment, error: paymentFetchError } = await supabase
      .from("payments")
      .select("*")
      .eq("id", newPaymentData.id)
      .single();

    if (paymentFetchError || !currentPayment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    const oldType = currentPayment.type;
    const newType = newPaymentData.type;

    console.log("Old type:", oldType);
    console.log("New type:", newType);
    console.log("singleUpdate payment:", newPaymentData.singleUpdate);

    if (
      (oldType === "single" && newType === "single") ||
      (newType !== "single" && newPaymentData.singleUpdate)
    ) {
      const { data: updatedPayment, error } = await supabase
        .from("payments")
        .update({
          supplier_name: newPaymentData.supplierName,
          description: newPaymentData.description,
          value: newPaymentData.value,
          due_date: newPaymentData.dueDate,
          cnpj_id: newPaymentData.cnpjId,
          category_id: newPaymentData.categoryId,
          competence: newPaymentData.competence,
          bank_account_id: newPaymentData.bankAccountId,
          payment_method: newPaymentData.paymentMethod,
          cpfCnpj: newPaymentData.cpfCnpj,
          pix_payment_method: newPaymentData.pix_payment_method,
          pix_key: newPaymentData.pixKey,
          barcode: newPaymentData.barcode,
          branch: newPaymentData.branch,
          account: newPaymentData.account,
          digit: newPaymentData.digit,
          status: "SCHEDULED",
          bankCode: newPaymentData.bankCode,
          cpfCnpj: newPaymentData.cpfCnpj,
        })
        .eq("id", newPaymentData.id);

      if (error) {
        return res.status(500).json({
          message: "Error updating payment",
          error: error.message,
        });
      }
    } else if (
      (oldType === "installments" || oldType === "recurring") &&
      newType === "single"
    ) {
      await updateToSinglePayment(newPaymentData, currentPayment);
    } else if (oldType === "installments" && newType === "installments") {
      await updateInstallments(newPaymentData, currentPayment);
    } else if (oldType === "installments" && newType === "recurring") {
      await updateInstallmentsToRecurrency(newPaymentData, currentPayment);
    } else if (oldType === "recurring" && newType === "recurring") {
      await updateRecurrency(newPaymentData, currentPayment);
    } else if (oldType === "recurring" && newType === "installments") {
      await updateRecurringToInstallment(newPaymentData, currentPayment);
    } else if (oldType === "single" && newType === "installments") {
      await updateSingleToInstallments(newPaymentData, currentPayment);
    } else if (oldType === "single" && newType === "recurring") {
      await updateSingleToRecurring(newPaymentData, currentPayment);
    }

    return res.json({
      message: "Payment updated successfully",
    });
  } catch (error) {
    console.error("Error updating payment:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

export const approvePaymentRequest = async (req, res) => {
  const { paymentRequestId, userId } = req.body;

  if (!paymentRequestId) {
    return res.status(400).json({ message: "Payment Request ID not provided" });
  }

  try {
    // Fetch payment request by ID
    const { data: paymentRequest, error: paymentRequestError } = await supabase
      .from("payment_requests")
      .select("*")
      .eq("id", paymentRequestId)
      .single();

    if (paymentRequestError || !paymentRequest) {
      return res.status(404).json({ message: "Payment Request not found" });
    }

    // Update the payment request status to "APPROVED"
    const { error: updateError } = await supabase
      .from("payment_requests")
      .update({ status: "APPROVED", updated_by: userId })
      .eq("id", paymentRequestId);

    if (updateError) {
      return res.status(500).json({
        message: "Error updating payment request",
        error: updateError.message,
      });
    }

    const { data: payment, error: paymentInsertError } = await supabase
      .from("payments")
      .insert(
        paymentRequest.type === "single"
          ? [
              {
                supplier_name: paymentRequest.supplier_name,
                description: paymentRequest.description,
                value: paymentRequest.value,
                due_date: paymentRequest.due_date,
                status: "SCHEDULED", // Default status for a new payment
                cnpj_id: paymentRequest.cnpj_id,
                category_id: paymentRequest.category_id,
                bank_account_id: paymentRequest.bank_account_id,
                created_by_id: userId,
                competence: paymentRequest.competence,
                payment_request_id: paymentRequest.id,
                payment_method: paymentRequest.payment_method,
                pix_payment_method: paymentRequest.pix_payment_method,
                pix_key: paymentRequest.pix_key,
                barcode: paymentRequest.barcode,
                branch: paymentRequest.branch,
                account: paymentRequest.account,
                digit: paymentRequest.digit,
                end_date: paymentRequest.end_date,
                frequency: paymentRequest.frequency,
                installments: paymentRequest.installments,
                type: paymentRequest.type,
                created_by: userId,
                cpfCnpj: paymentRequest.cpfCnpj,
                bankCode: paymentRequest.bankCode,
              },
            ]
          : paymentRequest.type === "installments"
          ? generateInstallments(paymentRequest, userId, paymentRequestId)
          : generateRecurringPayments(paymentRequest, userId, paymentRequestId)
      );

    if (paymentInsertError) {
      console.log("Error inserting payment:", paymentInsertError);
      return res.status(500).json({
        message: "Error inserting payment",
        error: paymentInsertError.message,
      });
    }

    return res.json({
      message: "Payment request approved and payment created",
      payment,
    });
  } catch (error) {
    console.error("Error approving payment request:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

export const rejectPaymentRequest = async (req, res) => {
  const { paymentRequestId, userId } = req.body;

  if (!paymentRequestId) {
    return res.status(400).json({ message: "Payment Request ID not provided" });
  }

  try {
    // Fetch payment request by ID
    const { data: paymentRequest, error: paymentRequestError } = await supabase
      .from("payment_requests")
      .select("*")
      .eq("id", paymentRequestId)
      .single();

    if (paymentRequestError || !paymentRequest) {
      return res.status(404).json({ message: "Payment Request not found" });
    }

    // Update the payment request status to "REJECTED"
    const { error: updateError } = await supabase
      .from("payment_requests")
      .update({ status: "REJECTED", updated_by: userId })
      .eq("id", paymentRequestId);

    if (updateError) {
      return res.status(500).json({
        message: "Error updating payment request",
        error: updateError.message,
      });
    }

    return res.json({
      message: "Payment request rejected successfully",
    });
  } catch (error) {
    console.error("Error rejecting payment request:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

function generateInstallments(payment, userId, paymentRequestId) {
  const payments = [];
  // Generate payments based on the number of installments
  let currentDate = new Date(payment.due_date);
  const uuid = uuidv4();
  for (let i = 0; i < payment.installments; i++) {
    payments.push({
      supplier_name: payment.supplier_name,
      description: payment.description,
      value: payment.value,
      due_date: currentDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
      status: "SCHEDULED",
      cnpj_id: payment.cnpj_id,
      category_id: payment.category_id,
      bank_account_id: payment.bank_account_id,
      created_by_id: userId,
      competence: payment.competence,
      payment_request_id: paymentRequestId,
      payment_method: payment.payment_method,
      pix_payment_method: payment.pix_payment_method,
      pix_key: payment.pix_key,
      barcode: payment.barcode,
      branch: payment.branch,
      account: payment.account,
      digit: payment.digit,
      end_date: payment.end_date,
      frequency: payment.frequency,
      installments: payment.installments,
      type: payment.type,
      created_by: userId,
      installment_number: i + 1,
      payment_group: uuid,
      bankCode: payment.bankCode,
      cpfCnpj: payment.cpfCnpj,
    });

    // Increment currentDate by one month
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return payments;
}

function generateRecurringPayments(payment, userId, paymentRequestId) {
  const payments = [];
  const endDate = new Date(payment.end_date);
  let currentDate = new Date(payment.due_date);
  const uuid = uuidv4();
  while (currentDate <= endDate) {
    payments.push({
      supplier_name: payment.supplier_name,
      description: payment.description,
      value: payment.value,
      due_date: currentDate.toISOString().split("T")[0],
      status: "SCHEDULED",
      cnpj_id: payment.cnpj_id,
      category_id: payment.category_id,
      bank_account_id: payment.bank_account_id,
      created_by_id: userId,
      competence: payment.competence,
      payment_request_id: paymentRequestId,
      payment_method: payment.payment_method,
      pix_payment_method: payment.pix_payment_method,
      pix_key: payment.pix_key,
      barcode: payment.barcode,
      branch: payment.branch,
      account: payment.account,
      digit: payment.digit,
      end_date: payment.end_date,
      frequency: payment.frequency,
      installments: payment.installments,
      type: payment.type,
      created_by: userId,
      payment_group: uuid,
      bankCode: payment.bankCode,
      cpfCnpj: payment.cpfCnpj,
    });

    // Increment currentDate by the frequency duration
    switch (payment.frequency) {
      case "biweekly":
        currentDate.setDate(currentDate.getDate() + 14);
        break;
      case "monthly":
        currentDate.setMonth(currentDate.getMonth() + 1);
        break;
      case "bimonthly":
        currentDate.setMonth(currentDate.getMonth() + 2);
        break;
      case "quarterly":
        currentDate.setMonth(currentDate.getMonth() + 3);
        break;
      case "yearly":
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        break;
      default:
        break;
    }
  }

  return payments;
}

async function updateToSinglePayment(newPaymentData, currentPayment) {
  // Delete future payments if the payment is updated to a single payment
  const paymentGroup = currentPayment.payment_group;
  let deleteError = null;

  if (paymentGroup) {
    // If payment_group exists, attempt to delete future payments based on the payment_group
    const { error } = await supabase
      .from("payments")
      .delete()
      .eq("payment_group", paymentGroup) // Only query with valid payment_group
      .gt("due_date", currentPayment.due_date); // Delete future payments

    deleteError = error;
  } else {
    // If payment_group does not exist, handle the situation accordingly (e.g., don't attempt to delete)
    console.log(
      "No valid payment_group found, skipping future payment deletion."
    );
  }

  if (deleteError) {
    return res.status(500).json({
      message: "Error deleting future payments",
      error: deleteError.message,
    });
  }

  //if installments, update the previous installments to the quantity of installments
  if (currentPayment.type === "installments") {
    const { data: paymentsInGroup } = await supabase
      .from("payments")
      .select("*")
      .eq("payment_group", paymentGroup);

    const { error: updateError } = await supabase
      .from("payments")
      .update({ installments: paymentsInGroup.length - 1 })
      .eq("payment_group", paymentGroup);

    if (updateError)
      return res.status(500).json({
        message: "Error updating installments",
        error: updateError.message,
      });
  }

  // Update the payment with new data
  const { data: updatedPayment, error: updateError } = await supabase
    .from("payments")
    .update({
      supplier_name: newPaymentData.supplierName,
      description: newPaymentData.description,
      value: newPaymentData.value,
      due_date: newPaymentData.dueDate,
      cnpj_id: newPaymentData.cnpjId,
      category_id: newPaymentData.categoryId,
      competence: newPaymentData.competence,
      bank_account_id: newPaymentData.bankAccountId,
      payment_method: newPaymentData.paymentMethod,
      pix_payment_method: newPaymentData.pix_payment_method,
      pix_key: newPaymentData.pixKey,
      barcode: newPaymentData.barcode,
      branch: newPaymentData.branch,
      account: newPaymentData.account,
      digit: newPaymentData.digit,
      type: newPaymentData.type,
      frequency: null,
      installments: null,
      installment_number: null,
      end_date: null,
      payment_group: null,
      bankCode: newPaymentData.bankCode,
      cpfCnpj: newPaymentData.cpfCnpj,
    })
    .eq("id", newPaymentData.id);

  if (updateError) {
    return res.status(500).json({
      message: "Error updating payment",
      error: updateError.message,
    });
  }
}

async function updateInstallments(newPaymentData, currentPayment) {
  const { installments: newInstallments } = newPaymentData;
  const {
    payment_group,
    installments: oldInstallments,
    due_date: oldDueDate,
  } = currentPayment;

  const installmentDifference =
    newInstallments - currentPayment.installment_number;

  if (
    newInstallments - oldInstallments <
    currentPayment.installment_number - oldInstallments
  ) {
    return {
      status: 400,
      message:
        "O número de parcelas não pode ser menor que o número de parcelas já pagas",
    };
  }

  console.log("Installment difference:", installmentDifference);

  // Delete future installments
  const { error: deleteError } = await supabase
    .from("payments")
    .delete()
    .eq("payment_group", payment_group)
    .eq("type", "installments")
    .gte("due_date", new Date(oldDueDate).toISOString().split("T")[0]);

  if (deleteError) {
    console.error("Error deleting future installments:", deleteError);
    return {
      status: 500,
      message: "Error deleting future installments",
      error: deleteError.message,
    };
  }

  console.log("Deleted future installments");

  // Recreate the installments based on the new number
  const payments = [];
  let currentDate = new Date(oldDueDate);
  for (let i = 0; i <= installmentDifference; i++) {
    currentDate.setMonth(currentDate.getMonth() + 1);
    payments.push({
      supplier_name: newPaymentData.supplierName,
      description: newPaymentData.description,
      value: newPaymentData.value,
      due_date: currentDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
      status: "SCHEDULED",
      cnpj_id: newPaymentData.cnpjId,
      category_id: newPaymentData.categoryId,
      bank_account_id: newPaymentData.bankAccountId,
      created_by_id: currentPayment.created_by_id,
      competence: newPaymentData.competence,
      payment_request_id: currentPayment.payment_request_id,
      payment_method: newPaymentData.paymentMethod,
      pix_payment_method: newPaymentData.pix_payment_method,
      pix_key: newPaymentData.pix_key,
      barcode: newPaymentData.barcode,
      branch: newPaymentData.branch,
      account: newPaymentData.account,
      digit: newPaymentData.digit,
      type: newPaymentData.type,
      installments: newInstallments,
      payment_group: payment_group,
      installment_number: i + currentPayment.installment_number,
      bankCode: newPaymentData.bankCode,
      cpfCnpj: newPaymentData.cpfCnpj,
    });
  }

  console.log("New installments:", payments.length);

  // Insert the new installments
  const { data: newPayments, error: insertError } = await supabase
    .from("payments")
    .insert(payments);

  if (insertError) {
    console.error("Error creating new installments:", insertError);
    return {
      status: 500,
      message: "Error creating new installments",
      error: insertError.message,
    };
  }

  const { data: paymentsInGroup } = await supabase
    .from("payments")
    .select("*")
    .eq("payment_group", currentPayment.payment_group);

  const { error: updateError } = await supabase
    .from("payments")
    .update({ installments: paymentsInGroup.length })
    .eq("payment_group", currentPayment.payment_group);

  if (updateError)
    return res.status(500).json({
      message: "Error updating installments",
      error: updateError.message,
    });

  // Successfully recreated installments
  return {
    status: 200,
    message: "Installments updated successfully",
    newPayments,
  };
}

async function updateInstallmentsToRecurrency(newPaymentData, currentPayment) {
  const { endDate: newEndDate, frequency } = newPaymentData;
  const { payment_group, due_date: oldDueDate } = currentPayment;

  // Step 1: Delete current and future installments
  const { error: deleteError } = await supabase
    .from("payments")
    .delete()
    .eq("payment_group", payment_group)
    .eq("type", "installments")
    .gte("due_date", new Date(oldDueDate).toISOString().split("T")[0]); // Delete installments from current date forward

  if (deleteError) {
    console.error("Error deleting future installments:", deleteError);
    return {
      status: 500,
      message: "Error deleting future installments",
      error: deleteError.message,
    };
  }

  console.log("Deleted current and future installments");

  // Step 2: Create new recurring payments from today to end_date
  const payments = [];
  let currentDate = new Date(); // Start from today
  const endDate = new Date(newEndDate); // The end date for the recurring payments
  const uuid = uuidv4();
  while (currentDate <= endDate) {
    console.log("Current date:", currentDate.toISOString().split("T")[0]);
    payments.push({
      supplier_name: newPaymentData.supplierName,
      description: newPaymentData.description,
      value: newPaymentData.value,
      due_date: currentDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
      status: "SCHEDULED",
      cnpj_id: newPaymentData.cnpjId,
      category_id: newPaymentData.categoryId,
      bank_account_id: newPaymentData.bankAccountId,
      created_by_id: currentPayment.created_by_id,
      competence: currentPayment.competence,
      payment_request_id: currentPayment.payment_request_id,
      payment_method: newPaymentData.paymentMethod,
      pix_payment_method: newPaymentData.pix_payment_method,
      pix_key: currentPayment.pix_key,
      barcode: currentPayment.barcode,
      branch: currentPayment.branch,
      account: currentPayment.account,
      digit: currentPayment.digit,
      frequency: frequency, // frequency of the recurring payments
      type: "recurring",
      installments: null, // Set the previous number of installments here
      end_date: newEndDate,
      payment_group: uuid, // new branch, new group
      bankCode: newPaymentData.bankCode,
      cpfCnpj: newPaymentData.cpfCnpj,
    });

    // Increment currentDate by the frequency duration
    switch (frequency) {
      case "biweekly":
        currentDate.setDate(currentDate.getDate() + 14);
        break;
      case "monthly":
        currentDate.setMonth(currentDate.getMonth() + 1);
        break;
      case "bimonthly":
        currentDate.setMonth(currentDate.getMonth() + 2);
        break;
      case "quarterly":
        currentDate.setMonth(currentDate.getMonth() + 3);
        break;
      case "yearly":
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        break;
      default:
        break;
    }
  }

  console.log("Generated new recurring payments", payments.length);

  // Insert the new recurring payments
  const { data: newPayments, error: insertError } = await supabase
    .from("payments")
    .insert(payments);

  if (insertError) {
    console.error("Error creating new recurring payments:", insertError);
    return {
      status: 500,
      message: "Error creating new recurring payments",
      error: insertError.message,
    };
  }

  console.log("New recurring payments created");

  // Step 3: Update previous installments' number of installments
  const { data: paymentsInGroup, error: fetchPaymentsError } = await supabase
    .from("payments")
    .select("*")
    .eq("payment_group", payment_group);

  if (fetchPaymentsError) {
    console.error("Error fetching previous payments:", fetchPaymentsError);
    return {
      status: 500,
      message: "Error fetching previous payments",
      error: fetchPaymentsError.message,
    };
  }

  // Update the previous installments to reflect the total number of installments
  const totalInstallments = paymentsInGroup.length;
  const { error: updateInstallmentsError } = await supabase
    .from("payments")
    .update({ installments: totalInstallments })
    .eq("payment_group", payment_group)
    .eq("type", "installments");

  if (updateInstallmentsError) {
    console.error("Error updating installments:", updateInstallmentsError);
    return {
      status: 500,
      message: "Error updating installments",
      error: updateInstallmentsError.message,
    };
  }

  console.log(
    "Previous installments updated with the total number of installments"
  );

  // Successfully created new recurring payments and updated previous installments
  return {
    status: 200,
    message: "Installments successfully updated to recurring payments",
    newPayments,
  };
}

async function updateRecurrency(newPaymentData, currentPayment) {
  const {
    frequency,
    dueDate: newDueDate,
    endDate: newEndDate,
  } = newPaymentData;
  const { due_date: oldDueDate } = currentPayment;

  // Step 1: Delete current and future recurring payments
  const { error: deleteError } = await supabase
    .from("payments")
    .delete()
    .eq("payment_group", currentPayment.payment_group) // Identify the recurring payments group
    .gte("due_date", new Date(oldDueDate).toISOString().split("T")[0]); // Delete payments from current date forward

  if (deleteError) {
    console.error(
      "Error deleting current and future recurring payments:",
      deleteError
    );
    return {
      status: 500,
      message: "Error deleting current and future recurring payments",
      error: deleteError.message,
    };
  }

  console.log("Deleted current and future recurring payments");

  // Step 2: Create new recurring payments based on new rules
  const payments = [];
  let currentDate = new Date(newDueDate); // Start with the new due date
  const endDate = new Date(newEndDate); // End date for the recurring payments
  console.log("End date:", endDate);

  // Create new recurring payments from the new due date to the end date
  while (currentDate <= endDate) {
    console.log("Current date:", currentDate);
    payments.push({
      supplier_name: newPaymentData.supplierName,
      description: newPaymentData.description,
      value: newPaymentData.value,
      due_date: currentDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
      status: "SCHEDULED",
      cnpj_id: newPaymentData.cnpjId,
      category_id: newPaymentData.categoryId,
      bank_account_id: newPaymentData.bankAccountId,
      created_by_id: currentPayment.created_by_id,
      competence: currentPayment.competence,
      payment_request_id: currentPayment.payment_request_id,
      payment_method: newPaymentData.paymentMethod,
      pix_payment_method: newPaymentData.pix_payment_method,
      pix_key: currentPayment.pix_key,
      barcode: currentPayment.barcode,
      branch: currentPayment.branch,
      account: currentPayment.account,
      digit: currentPayment.digit,
      frequency: frequency, // frequency of the recurring payments
      type: "recurring",
      installments: null, // Set the previous number of installments here
      end_date: newEndDate,
      payment_group: currentPayment.payment_group, // Keep the same group
      bankCode: newPaymentData.bankCode,
      cpfCnpj: newPaymentData.cpfCnpj,
    });

    // Increment currentDate by the frequency duration
    switch (frequency) {
      case "biweekly":
        currentDate.setDate(currentDate.getDate() + 14);
        break;
      case "monthly":
        currentDate.setMonth(currentDate.getMonth() + 1);
        break;
      case "bimonthly":
        currentDate.setMonth(currentDate.getMonth() + 2);
        break;
      case "quarterly":
        currentDate.setMonth(currentDate.getMonth() + 3);
        break;
      case "yearly":
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        break;
      default:
        break;
    }
  }

  console.log(
    "Generated new recurring payments based on new rules",
    payments.length
  );

  // Step 3: Insert the new recurring payments
  const { data: newPayments, error: insertError } = await supabase
    .from("payments")
    .insert(payments);

  if (insertError) {
    console.error("Error creating new recurring payments:", insertError);
    return {
      status: 500,
      message: "Error creating new recurring payments",
      error: insertError.message,
    };
  }

  console.log("New recurring payments created successfully");

  // Successfully created new recurring payments
  return {
    status: 200,
    message: "Recurring payments successfully updated",
    newPayments,
  };
}

async function updateRecurringToInstallment(newPaymentData, currentPayment) {
  // Step 1: Delete current and future payments in the group
  const { error: deleteError } = await supabase
    .from("payments")
    .delete()
    .eq("payment_group", currentPayment.payment_group) // Identify payments belonging to the same group
    .gte(
      "due_date",
      new Date(currentPayment.due_date).toISOString().split("T")[0]
    ); // Delete payments from current date forward

  if (deleteError) {
    console.error("Error deleting current and future payments:", deleteError);
    return {
      status: 500,
      message: "Error deleting current and future payments",
      error: deleteError.message,
    };
  }

  console.log("Deleted current and future recurring payments");

  // Step 2: Generate a new UUID for the new installment payments
  const newUuid = uuidv4();

  // Step 3: Create new installment payments
  const payments = [];
  let currentDate = new Date(newPaymentData.dueDate); // Start with the new due date
  for (let i = 0; i < newPaymentData.installments; i++) {
    payments.push({
      supplier_name: newPaymentData.supplierName,
      description: currentPayment.description,
      value: newPaymentData.value,
      due_date: currentDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
      status: "SCHEDULED", // Default status for a new installment
      cnpj_id: newPaymentData.cnpjId,
      category_id: newPaymentData.categoryId,
      bank_account_id: newPaymentData.bankAccountId,
      created_by_id: currentPayment.created_by_id,
      competence: newPaymentData.competence,
      payment_request_id: currentPayment.payment_request_id,
      payment_method: newPaymentData.paymentMethod,
      pix_payment_method: newPaymentData.pix_payment_method,
      pix_key: newPaymentData.pix_key,
      barcode: newPaymentData.barcode,
      branch: newPaymentData.branch,
      account: newPaymentData.account,
      digit: newPaymentData.digit,
      frequency: null, // No frequency for installments
      type: "installments",
      installments: newPaymentData.installments, // Set the number of installments
      payment_group: newUuid, // New UUID for the installment group
      installment_number: i + 1, // Set installment number (1-based index)
      bankCode: newPaymentData.bankCode,
      cpfCnpj: newPaymentData.cpfCnpj,
    });

    // Increment currentDate by one month for each installment
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  console.log("Generated new installment payments", payments.length);

  // Step 4: Insert the new installment payments
  const { data: newPayments, error: insertError } = await supabase
    .from("payments")
    .insert(payments);

  if (insertError) {
    console.error("Error creating new installment payments:", insertError);
    return {
      status: 500,
      message: "Error creating new installment payments",
      error: insertError.message,
    };
  }

  console.log("New installment payments created successfully");

  // Successfully created new installment payments
  return {
    status: 200,
    message: "Recurring payments successfully updated to installments",
    newPayments,
  };
}

async function updateSingleToInstallments(newPaymentData, currentPayment) {
  // Step 1: Delete the single payment (since we are converting it to installments)
  const { error: deleteError } = await supabase
    .from("payments")
    .delete()
    .eq("id", currentPayment.id); // Delete the single payment

  if (deleteError) {
    console.error("Error deleting single payment:", deleteError);
    return {
      status: 500,
      message: "Error deleting single payment",
      error: deleteError.message,
    };
  }

  console.log("Deleted single payment");

  // Step 2: Generate a new UUID for the installment payments
  const newUuid = uuidv4();

  // Step 3: Create new installment payments
  const payments = [];
  let currentDate = new Date(newPaymentData.dueDate); // Start with the new due date
  for (let i = 0; i < newPaymentData.installments; i++) {
    payments.push({
      supplier_name: newPaymentData.supplierName,
      description: newPaymentData.description,
      value: newPaymentData.value, // Use the new value
      due_date: currentDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
      status: "SCHEDULED", // Default status for a new installment
      cnpj_id: newPaymentData.cnpjId,
      category_id: newPaymentData.categoryId,
      bank_account_id: newPaymentData.bankAccountId,
      created_by_id: currentPayment.created_by_id,
      competence: newPaymentData.competence,
      payment_request_id: currentPayment.payment_request_id,
      payment_method: newPaymentData.paymentMethod,
      pix_key: newPaymentData.pix_key,
      barcode: newPaymentData.barcode,
      branch: newPaymentData.branch,
      account: newPaymentData.account,
      digit: newPaymentData.digit,
      frequency: null, // No frequency for installments
      type: "installments",
      installments: newPaymentData.installments, // Set the number of installments
      payment_group: newUuid, // New UUID for the installment group
      installment_number: i + 1, // Set installment number (1-based index)
      bankCode: newPaymentData.bankCode,
      cpfCnpj: newPaymentData.cpfCnpj,
      pix_payment_method: newPaymentData.pix_payment_method,
    });

    // Increment currentDate by one month for each installment
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  console.log("Generated new installment payments");

  // Step 4: Insert the new installment payments
  const { data: newPayments, error: insertError } = await supabase
    .from("payments")
    .insert(payments);

  if (insertError) {
    console.error("Error creating new installment payments:", insertError);
    return {
      status: 500,
      message: "Error creating new installment payments",
      error: insertError.message,
    };
  }

  console.log("New installment payments created successfully");

  // Successfully created new installment payments
  return {
    status: 200,
    message: "Single payment successfully updated to installments",
    newPayments,
  };
}

async function updateSingleToRecurring(newPaymentData, currentPayment) {
  // Step 1: Delete the single payment (since we are converting it to recurring)
  const { error: deleteError } = await supabase
    .from("payments")
    .delete()
    .eq("id", currentPayment.id); // Delete the single payment

  if (deleteError) {
    console.error("Error deleting single payment:", deleteError);
    return {
      status: 500,
      message: "Error deleting single payment",
      error: deleteError.message,
    };
  }

  console.log("Deleted single payment");

  // Step 2: Generate a new UUID for the recurring payments
  const newUuid = uuidv4();

  // Step 3: Create new recurring payments
  const payments = [];
  let currentDate = new Date(newPaymentData.dueDate); // Start with the new due date
  const endDate = new Date(newPaymentData.endDate); // End date for the recurring payments

  // Create new recurring payments from the new due date to the end date
  while (currentDate <= endDate) {
    payments.push({
      supplier_name: newPaymentData.supplierName,
      description: newPaymentData.description,
      value: newPaymentData.value, // Use the new value
      due_date: currentDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
      status: "SCHEDULED", // Default status for a new installment
      cnpj_id: newPaymentData.cnpjId,
      category_id: newPaymentData.categoryId,
      bank_account_id: newPaymentData.bankAccountId,
      created_by_id: currentPayment.created_by_id,
      competence: newPaymentData.competence,
      payment_request_id: currentPayment.payment_request_id,
      payment_method: newPaymentData.paymentMethod,
      pix_payment_method: newPaymentData.pix_payment_method,
      pix_key: newPaymentData.pix_key,
      barcode: newPaymentData.barcode,
      branch: newPaymentData.branch,
      account: newPaymentData.account,
      digit: newPaymentData.digit,
      frequency: newPaymentData.frequency, // frequency of the recurring payments
      type: "recurring",
      installments: null, // Set the number of installments
      payment_group: newUuid, // New UUID for the installment group
      installment_number: null,
      end_date: newPaymentData.endDate,
      bankCode: newPaymentData.bankCode,
      cpfCnpj: newPaymentData.cpfCnpj,
    });
    // Increment currentDate by the frequency duration
    switch (newPaymentData.frequency) {
      case "biweekly":
        currentDate.setDate(currentDate.getDate() + 14);
        break;
      case "monthly":
        currentDate.setMonth(currentDate.getMonth() + 1);
        break;
      case "bimonthly":
        currentDate.setMonth(currentDate.getMonth() + 2);
        break;
      case "quarterly":
        currentDate.setMonth(currentDate.getMonth() + 3);
        break;
      case "yearly":
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        break;
      default:
        break;
    }
  }

  console.log("Generated new recurring payments", payments.length);

  // Step 4: Insert the new recurring payments
  const { data: newPayments, error: insertError } = await supabase
    .from("payments")
    .insert(payments);

  if (insertError) {
    console.error("Error creating new recurring payments:", insertError);
    return {
      status: 500,
      message: "Error creating new recurring payments",
      error: insertError.message,
    };
  }

  console.log("New recurring payments created successfully");

  // Successfully created new recurring payments
  return {
    status: 200,
    message: "Single payment successfully updated to recurring",
    newPayments,
  };
}

export default {
  approvePaymentRequest,
  rejectPaymentRequest,
  createPayment,
  updatePayment,
};
