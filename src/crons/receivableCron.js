// paymentCron.js
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const updatePaidReceivables = async () => {
  try {
    const formattedDate = new Date().toISOString().split("T")[0]; // Format as YYYY-MM-DD

    // Buscar registros na tabela receivables com payment_date igual a ontem
    const { data: receivables, error: receivablesError } = await supabase
      .from("receivables")
      .select(
        `
        *,
        payment_method:payment_methods(*)
        `
      )
      .lte("payment_date", formattedDate)
      .eq("status", "PENDING");

    if (receivablesError) {
      throw new Error(
        `Error fetching receivables: ${receivablesError.message}`
      );
    }

    //consider only receivables where payment_date + payment_method.settlementDays = today
    const filteredReceivables = receivables.filter((receivable) => {
      // Calculate the expected payment date by adding settlementDays to payment_date
      const paymentDate = new Date(receivable.payment_date);
      paymentDate.setDate(
        paymentDate.getDate() + receivable.payment_method.settlementDays
      );

      // Format the calculated date and compare with today
      const formattedPaymentDate = paymentDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD

      return formattedPaymentDate === formattedDate;
    });

    if (filteredReceivables.length > 0) {
      // Inserir os registros encontrados na tabela bank_statements
      const bankStatements = filteredReceivables.map((receivable) => ({
        bank_account_id: receivable.bank_account_id,
        transaction_date: new Date().toISOString(), // Data atual
        category_id: receivable.category_id,
        value_date: formattedDate, // Data de ontem
        type: "CREDIT", // Assumindo que o tipo seja "DEBIT" para os recebíveis pagos
        description: receivable.notes || "Pagamento Recebido",
        document: receivable.order_number, // Pode ser o número do pedido ou outro campo relevante
        value: receivable.value,
        status: "PENDING", // Status inicial do banco
        api_json: JSON.stringify(receivable),
        created_by_id: receivable.created_by_id,
        receivable_id: receivable.id,
      }));

      const { data: bankStatementData, error: bankStatementError } =
        await supabase.from("bank_statements").insert(bankStatements);

      if (bankStatementError) {
        throw new Error(
          `Error inserting bank statement: ${bankStatementError.message}`
        );
      }

      // Alterar o status dos receiváveis para "PAID"
      const { error: updateError } = await supabase
        .from("receivables")
        .update({ status: "RECEIVED" })
        .in(
          "id",
          filteredReceivables.map((receivable) => receivable.id)
        );

      if (updateError) {
        throw new Error(
          `Error updating receivables status: ${updateError.message}`
        );
      }

      console.log(
        `${filteredReceivables.length} receivables updated to PAID and inserted into bank statement.`
      );
    } else {
      console.log("No receivables found for today.");
    }
  } catch (error) {
    console.error("Error in updatePaidReceivables:", error.message);
  }
};

// Cron job rodando todos os dias à 1h da manhã
cron.schedule("*/15 * * * *", () => {
  console.log("Running cron job to update receivables and bank statements...");
  updatePaidReceivables();
});