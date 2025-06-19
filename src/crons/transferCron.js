// paymentCron.js
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { createTransferBatchPaymentHelper } from "../controllers/batchPaymentController.js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const getNumReq = async () => {
  const { data: settings, error: settingsError } = await supabase
    .from("settings")
    .select("num_req")
    .single();
  if (settingsError) throw settingsError;
  const numReq = settings.num_req;

  //increment num_req
  const { data: updatedSettings, error: updatedSettingsError } = await supabase
    .from("settings")
    .update({ num_req: numReq + 1 })
    .eq("id", 1);
  if (updatedSettingsError) throw updatedSettingsError;

  return numReq;
};

// Function to check and process pending bank transfers
async function processPendingTransfers() {
  try {
    console.log("Checking for pending bank transfers...");

    // Get current date in YYYY-MM-DD format
    const today = new Date().toISOString().split("T")[0];

    // Query for pending bank transfers scheduled for today
    const { data: pendingTransfers, error } = await supabase
      .from("bank_transfers")
      .select("*")
      .eq("status", "PENDING")
      .eq("transfer_date", today);

    if (error) {
      console.error("Error fetching pending transfers:", error);
      return;
    }

    if (!pendingTransfers || pendingTransfers.length === 0) {
      console.log("No pending transfers found for today.");
      return;
    }

    console.log(
      `Found ${pendingTransfers.length} pending transfers for today.`
    );

    // Process each pending transfer
    for (const transfer of pendingTransfers) {
      try {
        const numReq = await getNumReq();

        const { data: sourceAccount, error: sourceAccountError } =
          await supabase
            .from("bank_accounts")
            .select("*")
            .eq("id", transfer.source_account_id)
            .single();

        const { data: destinationAccount, error: destinationAccountError } =
          await supabase
            .from("bank_accounts")
            .select("*")
            .eq("id", transfer.destination_account_id)
            .single();

        const { cnpjId } = destinationAccount;

        const { data: cnpj, error: cnpjError } = await supabase
          .from("cnpjs")
          .select("*")
          .eq("id", cnpjId)
          .single();

        console.log(cnpj);

        const date = new Date(transfer.transfer_date)
          .toISOString()
          .split("T")[0]
          .split("-")
          .reverse()
          .join("");
        const value = transfer.value;
        const transferId = transfer.id;
        const userId = transfer.user_id;

        const transferPayload = {
          numeroRequisicao: numReq,
          agenciaDebito: sourceAccount.branch,
          contaCorrenteDebito: sourceAccount.account,
          digitoVerificadorContaCorrente: sourceAccount.digit || "X",
          tipoPagamento: 128,
          listaTransferencias: [
            {
              agenciaCredito: destinationAccount.branch,
              contaCorrenteCredito: destinationAccount.account,
              digitoVerificadorContaCorrente: destinationAccount.digit || "X",
              dataTransferencia: date,
              numeroCOMPE: "12",
              codigoFinalidadeTED: 1,
              valorTransferencia: value,
              cnpjBeneficiario: "83645297000170", //83645297000170 TODO: change to cnpj
              paymentId: transferId,
              userId: userId || "",
            },
          ],
        };

        //Todo - Remover depois
        await createStatement({
          bank_account_id: sourceAccount.id,
          type: "DEBIT",
          notes: transfer.description + " - Transferência TESTE",
          customer_name: transfer.customer_name,
          valueWithDiscounts: transfer.value,
          userId: transfer.created_by_id,
        });

        const { message } = await createTransferBatchPaymentHelper(
          transferPayload,
          sourceAccount
        );

        console.log(message);

        // Update transfer status to 'processing'
        const { error: updateError } = await supabase
          .from("bank_transfers")
          .update({ status: "COMPLETED" })
          .eq("id", transfer.id);

        if (updateError) {
          console.error(
            `Error updating transfer status for ID ${transfer.id}:`,
            updateError
          );
        } else {
          await createStatement({
            bank_account_id: destinationAccount.id,
            type: "CREDIT",
            notes: transfer.description,
            customer_name: transfer.customer_name,
            valueWithDiscounts: transfer.value,
            userId: transfer.created_by_id,
          });


          await createStatement({
            bank_account_id: sourceAccount.id,
            type: "DEBIT",
            notes: transfer.description,
            customer_name: transfer.customer_name,
            valueWithDiscounts: transfer.value,
            userId: transfer.created_by_id,
          });
        }
      } catch (err) {
        console.error(`Error processing transfer ID ${transfer.id}:`, err);
      }
    }
  } catch (error) {
    console.error("Error in processPendingTransfers:", error);
  }
}

const createStatement = async ({
  bank_account_id,
  type,
  notes,
  customer_name,
  valueWithDiscounts,
  userId,
}) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("bank_statements")
      .insert({
        created_at: new Date(),
        bank_account_id,
        transaction_date: today,
        value_date: today,
        type,
        description: notes,
        beneficiary: customer_name,
        value: valueWithDiscounts,
        status: "RECONCILED",
        created_by_id: userId,
      })
      .select(); 

    if (error) {
      console.error("Error creating bank statement:", error);
      return { error };
    }

    return { data };
  } catch (err) {
    console.error("Unexpected error in createStatement:", err);
    return { error: err };
  }
};

// Schedule the cron job to run every 10 minutes
cron.schedule("*/2 * * * *", async () => {
  console.log("Running transfer cron job at", new Date().toISOString());
  await processPendingTransfers();
});
