// paymentCron.js
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const updatePendingPayments = async () => {
  try {
    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select("*")
      .eq("status", "SCHEDULED")
      .lte("due_date", new Date().toISOString());

    if (paymentsError) {
      throw new Error(`Error fetching payments: ${paymentsError.message}`);
    }

    if (payments.length > 0) {
      const updateResults = await supabase
        .from("payments")
        .update({ status: "PENDING" })
        .in(
          "id",
          payments.map((payment) => payment.id)
        );

      if (updateResults.error) {
        throw new Error(
          `Error updating payments: ${updateResults.error.message}`
        );
      }

      console.log(`${payments.length} payments updated to PENDING.`);
    } else {
      console.log("No scheduled payments found.");
    }
  } catch (error) {
    console.error("Error in updatePendingPayments:", error.message);
  }
};

const updateScheduledPayments = async () => {
  try {
    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select("*")
      .eq("status", "PENDING")
      .gte("due_date", new Date().toISOString());

    if (paymentsError) {
      throw new Error(`Error fetching payments: ${paymentsError.message}`);
    }

    if (payments.length > 0) {
      const updateResults = await supabase
        .from("payments")
        .update({ status: "SCHEDULED" })
        .in(
          "id",
          payments.map((payment) => payment.id)
        );

      if (updateResults.error) {
        throw new Error(
          `Error updating payments: ${updateResults.error.message}`
        );
      }

      console.log(`${payments.length} payments updated to SCHEDULED.`);
    } else {
      console.log("No scheduled payments found.");
    }
  } catch (error) {
    console.error("Error in updatePendingPayments:", error.message);
  }
};

cron.schedule("*/20 * * * *", () => {
  console.log("Running cron job to check pending payments...");
  updatePendingPayments();
  //updateScheduledPayments();
});

console.log("Payment cron job started.");
