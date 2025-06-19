import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const create = async (req, res) => {
  const { rec, userId } = req.body;

  if (!rec) {
    console.log("Receivable not provided");
    return res.status(400).json({ message: "Receivable not provided" });
  }

  try {
    const uuid = uuidv4();
    const { data: paymentMethod, error } = await supabase
      .from("payment_methods")
      .select("*")
      .eq("id", rec.payment_method_id)
      .single();

    if (error || !paymentMethod) {
      console.log("Payment method not found");
      return res.status(404).json({ message: "Payment method not found" });
    }

    console.log("Payment method ID:", paymentMethod);
    const valueWithDiscounts =
      rec.value * (1 - paymentMethod.aliquot / 100) -
      paymentMethod.fixedAliquot;

    console.log(
      valueWithDiscounts,
      rec.value,
      paymentMethod.aliquot,
      paymentMethod.fixedAliquot
    );

    if (paymentMethod.paymentCondition === "immediate") {
      const isPaymentToday =
        new Date(rec.payment_date).toISOString().split("T")[0] ===
        new Date().toISOString().split("T")[0];

      //descontar aliquotas e inserir na tabela de recebiveis como recebido
      await createReceivable(
        rec,
        rec.payment_date,
        isPaymentToday ? "RECEIVED" : "PENDING",
        userId,
        valueWithDiscounts,
        uuid
      );

      const { data: receivable, error: receivableError } = await supabase
        .from("receivables")
        .select("*")
        .eq("receivable_group", uuid)
        .single();

      if (receivableError || !receivable) {
        console.log("Receivable not found");
        return res.status(404).json({ message: "Receivable not found" });
      }

      const { error: insertBankStatementError } = await supabase
        .from("bank_statements")
        .insert({
          created_at: new Date(),
          bank_account_id: rec.bank_account_id,
          transaction_date: new Date().toISOString().split("T")[0],
          value_date: new Date().toISOString().split("T")[0],
          type: "CREDIT",
          description: rec.notes,
          beneficiary: rec.customer_name,
          value: valueWithDiscounts,
          category_id: rec.category_id,
          status: !rec.category_id ? "PENDING" : "RECONCILED",
          created_by_id: userId,
          receivable_id: receivable.id,
        });

      if (insertBankStatementError) {
        console.error(
          "Error inserting bank statement:",
          insertBankStatementError
        );
        return res.status(500).json({
          message: "Error inserting bank statement",
          error: insertBankStatementError.message,
        });
      }
    }

    if (paymentMethod.paymentCondition.endsWith("x")) {
      // Extrai o número de parcelas, removendo o "x" e convertendo para inteiro
      const installments = parseInt(
        paymentMethod.paymentCondition.replace("x", "")
      );

      // Opcional: limitar o número máximo de parcelas (até 12)
      if (installments < 1 || installments > 12) {
        console.log("Invalid number of installments");
        throw new Error(
          "Número de parcelas inválido. O máximo permitido é 12x."
        );
      }

      // Cria cada parcela com vencimentos mensais (30 dias de intervalo)
      for (let i = 1; i <= installments; i++) {
        const paymentDate = new Date(rec.payment_date);
        paymentDate.setDate(paymentDate.getDate() + 30 * i);

        const installmentValue = valueWithDiscounts / installments;
        console.log(installmentValue, valueWithDiscounts, installments);

        // Cria o recebível para a parcela atual
        createReceivable(
          rec,
          paymentDate.toISOString().split("T")[0],
          "PENDING",
          userId,
          installmentValue,
          uuid
        );
      }
    }

    if (paymentMethod.paymentCondition === "30/60/90") {
      // Cria cada parcela com vencimentos mensais (30 dias de intervalo)
      for (let i = 1; i <= 3; i++) {
        const paymentDate = new Date();
        paymentDate.setDate(paymentDate.getDate() + 30 * i);

        const installmentValue = valueWithDiscounts / 3;

        // Cria o recebível para a parcela atual
        createReceivable(
          rec,
          paymentDate.toISOString().split("T")[0],
          "PENDING",
          userId,
          installmentValue,
          uuid
        );
      }
    }

    return res.json({
      message: "Receivable request approved and receivable created",
    });
  } catch (error) {
    console.log("Error approving receivable request:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

export const list = async (req, res) => {
  try {
    //add attachment from the receivable_approval_requests table with left join
    const { data: receivables, error } = await supabase
      .from("receivables")
      .select(
        `
        *,
        receivable_approval_request:receivable_approval_requests!left(*),
        payment_method:payment_methods!left(*)
      `
      )
      .order("payment_date", { ascending: true });

    if (error) {
      console.error("Error fetching receivables:", error);
      return res.status(500).json({
        message: "Error fetching receivables",
        error: error.message,
      });
    }

    return res.json({ receivables });
  } catch (error) {
    console.error("Error fetching receivables:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

// Approve a receivable request
export const approveReceivableRequest = async (req, res) => {
  const { receivableRequestId, userId } = req.body;

  console.log("Approving receivable request:", receivableRequestId, userId);

  if (!receivableRequestId) {
    return res
      .status(400)
      .json({ message: "Receivable Request ID not provided" });
  }

  try {
    // Fetch receivable request by ID
    const uuid = uuidv4();
    const { data: rec, error: receivableRequestError } = await supabase
      .from("receivable_approval_requests")
      //get payment method
      .select(
        `
          *,
          payment_method:payment_methods(*)
          `
      )
      .eq("id", receivableRequestId)
      .single();

    if (receivableRequestError || !rec) {
      return res.status(404).json({ message: "Receivable Request not found" });
    }

    const paymentMethod = rec.payment_method;
    console.log("Payment method ID:", paymentMethod);
    const valueWithDiscounts =
      rec.value * (1 - paymentMethod.aliquot / 100) -
      paymentMethod.fixedAliquot;

    console.log(
      valueWithDiscounts,
      rec.value,
      paymentMethod.aliquot,
      paymentMethod.fixedAliquot
    );

    if (paymentMethod.paymentCondition === "immediate") {
      //descontar aliquotas e inserir na tabela de recebiveis como recebido
      await createReceivable(
        rec,
        new Date().toISOString().split("T")[0],
        "RECEIVED",
        userId,
        valueWithDiscounts,
        uuid
      );

      const { data: receivable, error: receivableError } = await supabase
        .from("receivables")
        .select("*")
        .eq("receivable_approval_request_id", receivableRequestId)
        .single();

      if (receivableError || !receivable) {
        return res.status(404).json({ message: "Receivable not found" });
      }

      const { error: insertBankStatementError } = await supabase
        .from("bank_statements")
        .insert({
          created_at: new Date(),
          bank_account_id: rec.bank_account_id,
          transaction_date: new Date().toISOString().split("T")[0],
          value_date: new Date().toISOString().split("T")[0],
          type: "CREDIT",
          description: rec.notes,
          beneficiary: rec.customer_name,
          value: valueWithDiscounts,
          category_id: rec.category_id,
          status: !rec.category_id ? "PENDING" : "RECONCILED",
          created_by_id: userId,
          receivable_id: receivable.id,
        });

      if (insertBankStatementError) {
        console.error(
          "Error inserting bank statement:",
          insertBankStatementError
        );
        return res.status(500).json({
          message: "Error inserting bank statement",
          error: insertBankStatementError.message,
        });
      }
    }

    if (paymentMethod.paymentCondition.endsWith("x")) {
      // Extrai o número de parcelas, removendo o "x" e convertendo para inteiro
      const installments = parseInt(
        paymentMethod.paymentCondition.replace("x", "")
      );

      // Opcional: limitar o número máximo de parcelas (até 12)
      if (installments < 1 || installments > 12) {
        throw new Error(
          "Número de parcelas inválido. O máximo permitido é 12x."
        );
      }

      // Cria cada parcela com vencimentos mensais (30 dias de intervalo)
      for (let i = 1; i <= installments; i++) {
        const paymentDate = new Date();
        paymentDate.setDate(paymentDate.getDate() + 30 * i);

        const installmentValue = valueWithDiscounts / installments;
        console.log(installmentValue, valueWithDiscounts, installments);

        // Cria o recebível para a parcela atual
        createReceivable(
          rec,
          paymentDate.toISOString().split("T")[0],
          "PENDING",
          userId,
          installmentValue,
          uuid
        );
      }
    }

    if (paymentMethod.paymentCondition === "30/60/90") {
      // Cria cada parcela com vencimentos mensais (30 dias de intervalo)
      for (let i = 1; i <= 3; i++) {
        const paymentDate = new Date();
        paymentDate.setDate(paymentDate.getDate() + 30 * i);

        const installmentValue = valueWithDiscounts / 3;

        // Cria o recebível para a parcela atual
        createReceivable(
          rec,
          paymentDate.toISOString().split("T")[0],
          "PENDING",
          userId,
          installmentValue,
          uuid
        );
      }
    }

    // Update the receivable request status to "APPROVED"
    const { error: updateError } = await supabase
      .from("receivable_approval_requests")
      .update({
        status: "APPROVED",
        approved_by_id: userId,
        approved_at: new Date(),
      })
      .eq("id", receivableRequestId);

    if (updateError) {
      return res.status(500).json({
        message: "Error updating receivable request",
        error: updateError.message,
      });
    }

    return res.json({
      message: "Receivable request approved and receivable created",
    });
  } catch (error) {
    console.error("Error approving receivable request:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

// Reject a receivable request
export const rejectReceivableRequest = async (req, res) => {
  const { receivableRequestId, userId } = req.body;

  if (!receivableRequestId) {
    return res
      .status(400)
      .json({ message: "Receivable Request ID not provided" });
  }

  try {
    // Fetch receivable request by ID
    const { data: receivableRequest, error: receivableRequestError } =
      await supabase
        .from("receivable_approval_requests")
        .select("*")
        .eq("id", receivableRequestId)
        .single();

    if (receivableRequestError || !receivableRequest) {
      return res.status(404).json({ message: "Receivable Request not found" });
    }

    // Update the receivable request status to "REJECTED"
    const { error: updateError } = await supabase
      .from("receivable_approval_requests")
      .update({
        status: "REJECTED",
        approved_by_id: userId,
        approved_at: new Date(),
      })
      .eq("id", receivableRequestId);

    if (updateError) {
      return res.status(500).json({
        message: "Error rejecting receivable request",
        error: updateError.message,
      });
    }

    return res.json({
      message: "Receivable request rejected successfully",
    });
  } catch (error) {
    console.error("Error rejecting receivable request:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

// Reverse a receivable
export const reverseReceivable = async (req, res) => {
  //DELETE FROM BANK STATEMENT AND FROM CONCILIATION

  const { receivableId, userId } = req.body;

  if (!receivableId) {
    return res.status(400).json({ message: "Receivable ID not provided" });
  }

  try {
    // Fetch receivable by ID
    const { data: receivable, error: receivableError } = await supabase
      .from("receivables")
      .select("*")
      .eq("id", receivableId)
      .single();

    if (receivableError || !receivable) {
      return res.status(404).json({ message: "Receivable not found" });
    }

    // Update the receivable status to "REVERSED"
    const { error: updateError } = await supabase
      .from("receivables")
      .update({
        status: "REVERSED",
        reversed_by_id: userId,
        updated_at: new Date(),
      })
      .eq("id", receivableId);

    if (updateError) {
      console.error("Error reversing receivable:", updateError);
      return res.status(500).json({
        message: "Error reversing receivable",
        error: updateError.message,
      });
    }

    //find bank statement and set status to CANCELED
    const { data: bankStatement, error: bankStatementError } = await supabase
      .from("bank_statements")
      .select("*")
      .eq("receivable_id", receivableId)
      .single();

    if (bankStatementError || !bankStatement) {
      return res.status(404).json({ message: "Bank statement not found" });
    }

    const { error: updateBankStatementError } = await supabase
      .from("bank_statements")
      .update({
        status: "REVERSED",
        updated_at: new Date(),
      })
      .eq("id", bankStatement.id);

    if (updateBankStatementError) {
      console.error("Error updating bank statement:", updateBankStatementError);
      return res.status(500).json({
        message: "Error updating bank statement",
        error: updateBankStatementError.message,
      });
    }

    return res.json({
      message: "Receivable reversed successfully",
    });
  } catch (error) {
    console.error("Error reversing receivable:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

//cancel receivable, set status to canceled and remove it from bank statement
export const cancelReceivable = async (req, res) => {
  const { receivableId, userId } = req.body;

  if (!receivableId) {
    return res.status(400).json({ message: "Receivable ID not provided" });
  }

  try {
    // Fetch receivable by ID
    const { data: receivable, error: receivableError } = await supabase
      .from("receivables")
      .select("*")
      .eq("id", receivableId)
      .single();

    if (receivableError || !receivable) {
      return res.status(404).json({ message: "Receivable not found" });
    }

    // Update the receivable status to "CANCELED"
    const { error: updateError } = await supabase
      .from("receivables")
      .update({
        status: "CANCELED",
        updated_at: new Date(),
      })
      .eq("id", receivableId);

    if (updateError) {
      console.error("Error canceling receivable:", updateError);
      return res.status(500).json({
        message: "Error canceling receivable",
        error: updateError.message,
      });
    }

    //bank statement delete
    const { data: bankStatement, error: bankStatementError } = await supabase
      .from("bank_statements")
      .delete()
      .eq("receivable_id", receivableId)
      .single();

    return res.json({
      message: "Receivable canceled successfully",
    });
  } catch (error) {
    console.error("Error canceling receivable:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

const createReceivable = async (
  rec,
  paymentDate,
  status,
  userId,
  value,
  uuid
) => {

  const { error: insertError } = await supabase.from("receivables").insert({
    order_number: rec.order_number,
    customer_name: rec.customer_name,
    customer_document: rec.customer_document,
    notes: rec.notes,
    value: value,
    payment_method_id: rec.payment_method_id,
    bank_account_id: rec.bank_account_id,
    cnpj_id: rec.cnpj_id,
    category_id: rec.category_id,
    competence: rec.competence,
    status: status,
    created_by_id: userId,
    total_installments: 1,
    created_at: new Date(),
    payment_date: paymentDate,
    receivable_approval_request_id: rec.id || null,
    receivable_group: uuid,
  });

  if (insertError) {
    console.error("Error inserting receivable:", insertError);
    return res.status(500).json({
      message: "Error inserting receivable",
      error: insertError.message,
    });
  }
};

export default {
  approveReceivableRequest,
  rejectReceivableRequest,
  reverseReceivable,
  cancelReceivable,
  list,
};
