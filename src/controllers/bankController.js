import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { executePayment as executePaymentService } from "../services/bankPaymentService.js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const generateToken = async (account) => {
  try {
    const response = await axios.post(
      process.env.OAUTH_URL,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
      }),
      {
        headers: {
          Authorization: `Basic ${process.env.BASIC}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error(
      "Error generating token:",
      error.response ? error.response.data : error.message
    );
    throw error;
  }
};

export const getBankStatement = async (req, res) => {
  const { bankAccountId, userId } = req.body;

  if (!bankAccountId) {
    return res.status(400).json({ message: "Conta bancária não informada" });
  }

  console.log("Fetching bank statement for bank account:", bankAccountId);

  try {
    const { data: bankAccount, error } = await supabase
      .from("bank_accounts")
      .select("*")
      .eq("id", bankAccountId)
      .single();
    if (error) throw error;

    const token = await generateToken(bankAccount);

    await fetchBankStatement(token, bankAccount, userId);

    return res.json({ message: "Extrato bancário atualizado" });
  } catch (error) {
    console.error("Error fetching bank statement");
  }
};

export const getReconciliationStatements = async (req, res) => {
  const { bankAccountId } = req.params;

  if (!bankAccountId) {
    return res.status(400).json({ message: "Bank account ID is required" });
  }

  try {
    // Fetch all bank statements for the given bank account
    const { data: bankStatements, error: bankStatementsError } = await supabase
      .from("bank_statements")
      .select("*")
      .eq("bank_account_id", bankAccountId);

    if (bankStatementsError) {
      console.error("Error fetching bank statements:", bankStatementsError);
      return;
    }

    // Fetch unreconciled statements
    const {
      data: reconciliationStatements,
      error: reconciliationStatementsError,
    } = await supabase
      .from("reconciliation_statements")
      .select("*")
      .eq("bank_account_id", bankAccountId);

    console.log("bankStatements", bankStatements.length);
    console.log("reconciliationStatements", reconciliationStatements.length);

    let notReconciledStatements = [];

    //for each reconciliation statement, check if it not exists in bankStatements, if not, add to notReconciledStatements
    for (const reconciliationStatement of reconciliationStatements) {
      if (
        !bankStatements.some(
          (bankStatement) =>
            bankStatement.transaction_date ===
              reconciliationStatement.transaction_date &&
            bankStatement.description === reconciliationStatement.description &&
            bankStatement.document === reconciliationStatement.document &&
            bankStatement.value === reconciliationStatement.value &&
            bankStatement.type === reconciliationStatement.type
        )
      ) {
        notReconciledStatements.push(reconciliationStatement);
      }
    }

    console.log("Unreconciled statements:", notReconciledStatements.length);

    if (reconciliationStatementsError) throw reconciliationStatementsError;

    return res.json({ data: notReconciledStatements });
  } catch (error) {
    console.error("Error fetching reconciliation statements:", error);
    return res.status(500).json({
      message: "Error fetching reconciliation statements",
      error: error.message,
    });
  }
};

const fetchBankStatement = async (token, account, userId) => {
  try {
    const agencia = account.branch;
    const conta = account.account;
    const numeroPaginaSolicitacao = 1;
    const quantidadeRegistroPaginaSolicitacao = 200;
    const dataInicioSolicitacao = convertToDDMMYYYY(
      account.bb_last_sync || new Date().setDate(new Date().getDate() - 29)
    );
    const dataFimSolicitacao = convertToDDMMYYYY(new Date());

    console.log(agencia, conta, dataInicioSolicitacao, dataFimSolicitacao);

    const response = await axios.get(
      `${process.env.BANK_API_URL}/extratos/v1/conta-corrente/agencia/${agencia}/conta/${conta}`,
      {
        params: {
          "gw-dev-app-key": process.env.DEVELOPER_APPLICATION_KEY,
          numeroPaginaSolicitacao,
          quantidadeRegistroPaginaSolicitacao,
          dataInicioSolicitacao,
          dataFimSolicitacao,
        },
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Br-Com-Bb-Ipa-Mciteste": process.env.MCI_TESTE,
        },
      }
    );

    response.data.listaLancamento.shift();

    const filteredStatements = response.data.listaLancamento.filter(
      (statement) => statement.numeroLote || statement.numeroDocumento
    );

    const statements = filteredStatements.map((statement) => ({
      bank_account_id: account.id,
      transaction_date: convertFromDDMMYYYY(`${statement.dataLancamento}`),
      value_date: convertFromDDMMYYYY(`${statement.dataLancamento}`),
      type: statement.indicadorSinalLancamento === "C" ? "CREDIT" : "DEBIT",
      description: `${statement.textoDescricaoHistorico} ${statement.textoInformacaoComplementar}`,
      document: statement.numeroDocumento,
      value: statement.valorLancamento,
      status: "PENDING",
      api_json: JSON.stringify(statement),
      created_by_id: userId || "b02d6e5f-13b4-452f-9b3d-7753a0145c55",
    }));

    console.log("Bank statement fetched:", statements.length);

    await insertBankStatement(statements, account.bb_last_sync);

    const { data, error } = await supabase
      .from("bank_accounts")
      .update({ bb_last_sync: new Date() })
      .eq("id", account.id);
    if (error) throw error;

    console.log("Bank account updated");
  } catch (error) {
    if (account.account == "1348") console.log(error);
    console.error("Error fetching bank statement for:", account.account);
  }
};

const convertToDDMMYYYY = (dateString) => {
  const date = new Date(dateString);
  const day = date.getUTCDate();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}${month}${year}`;
};

const convertFromDDMMYYYY = (dateString) => {
  if (dateString.length === 7) {
    dateString = `0${dateString}`;
  }
  const day = dateString.substring(0, 2);
  const month = dateString.substring(2, 4);
  const year = dateString.substring(4, 8);
  return `${year}-${month}-${day}`;
};

const getBankAccountsByCnpj = async (cnpjId) => {
  try {
    const { data: accounts, error } = await supabase
      .from("bank_accounts")
      .select("*")
      .eq("cnpjId", cnpjId);
    if (error) throw error;
    return accounts;
  } catch (error) {
    console.error("Error fetching bank accounts:", error.message);
  }
};

const insertBankStatement = async (statements, lastSync) => {
  try {
    if (!statements || statements.length === 0) {
      console.log("No new bank statements to insert");
      return;
    }

    const dateFilter = lastSync
      ? new Date(new Date(lastSync) - 86400000).toISOString().split("T")[0]
      : null;

    const { data: lastStatements, error: lastStatementsError } = await supabase
      .from("reconciliation_statements")
      .select("*")
      .eq("bank_account_id", statements[0].bank_account_id)
      .gte(
        "transaction_date",
        dateFilter ??
          new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0]
      );

    console.log("lastStatements", lastStatements?.length || 0);

    console.log("statements", statements?.length || 0);

    const newStatements =
      lastStatements && lastStatements.length
        ? statements.filter(
            (statement) =>
              !lastStatements.filter(
                (lastStatement) =>
                  lastStatement.transaction_date ===
                    statement.transaction_date &&
                  lastStatement.description === statement.description &&
                  lastStatement.document === statement.document &&
                  lastStatement.value === statement.value
              )
          )
        : statements;

    if (!newStatements || newStatements.length === 0) {
      console.log("No new bank statements to insert");
      return;
    }

    const { data: statement, error } = await supabase
      .from("reconciliation_statements")
      .insert(newStatements);

    if (error) throw error;

    return statement;
  } catch (error) {
    console.error("Error inserting bank statement:", error);
  }
};

export const executePayment = async (req, res) => {
  const { paymentId, userId } = req.body;

  try {
    const result = await executePaymentService(paymentId, userId);
    return res.json(result);
  } catch (error) {
    console.error("Error executing payment:", error);
    return res
      .status(
        error.message === "Payment not provided"
          ? 400
          : error.message === "Payment not found"
          ? 404
          : 500
      )
      .json({ message: error.message || "Internal server error" });
  }
};

export const createBankTransfer = async (req, res) => {
  const { 
    sourceAccountId, 
    destinationAccountId, 
    value, 
    date, 
    description, 
    transferType, 
    userId 
  } = req.body;

  // Validate required fields
  if (!sourceAccountId || !destinationAccountId || !value || !date) {
    return res.status(400).json({ 
      message: "Missing required fields: sourceAccountId, destinationAccountId, value, and date are required" 
    });
  }

  try {
    // Insert the bank transfer record
    const { data: transfer, error } = await supabase
      .from("bank_transfers")
      .insert({
        source_account_id: sourceAccountId,
        destination_account_id: destinationAccountId,
        value: parseFloat(value),
        transfer_date: date,
        description: description || "",
        transfer_type: transferType || "TRANSFER",
        bank_transaction_id: "",
        status: "PENDING",
        created_by_id: userId,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ 
      message: "Bank transfer created successfully", 
      data: transfer 
    });
  } catch (error) {
    console.error("Error creating bank transfer:", error);
    return res.status(500).json({ 
      message: "Error creating bank transfer", 
      error: error.message 
    });
  }
};

export const compareStatements = async (req, res) => {
  const { bankAccountId } = req.params;

  if (!bankAccountId) {
    return res.status(400).json({ message: "Bank account ID is required" });
  }

  try {
    // Fetch all pending bank statements for the given bank account
    const { data: pendingBankStatements, error: bankStatementsError } = await supabase
      .from("bank_statements")
      .select("*")
      .eq("bank_account_id", bankAccountId)
      .eq("status", "PENDING");

    if (bankStatementsError) {
      console.error("Error fetching pending bank statements:", bankStatementsError);
      return res.status(500).json({
        message: "Error fetching pending bank statements",
        error: bankStatementsError.message,
      });
    }

    // Fetch all pending reconciliation statements
    const {
      data: pendingReconciliationStatements,
      error: reconciliationStatementsError,
    } = await supabase
      .from("reconciliation_statements")
      .select("*")
      .eq("bank_account_id", bankAccountId)
      .eq("status", "PENDING");

    if (reconciliationStatementsError) {
      console.error("Error fetching pending reconciliation statements:", reconciliationStatementsError);
      return res.status(500).json({
        message: "Error fetching pending reconciliation statements",
        error: reconciliationStatementsError.message,
      });
    }

    // Match reconciliation statements with possible bank statements
    const matchedStatements = pendingReconciliationStatements.map(reconciliation => {
      // Find all possible matches from bank statements with one day tolerance and small value differences
      const possibleMatches = pendingBankStatements.filter((bank) => {
        // Calculate date range (one day before and after)
        const reconciliationDate = new Date(reconciliation.transaction_date);
        const oneDayBefore = new Date(reconciliationDate);
        oneDayBefore.setDate(reconciliationDate.getDate() - 1);
        const oneDayAfter = new Date(reconciliationDate);
        oneDayAfter.setDate(reconciliationDate.getDate() + 1);
        
        const bankDate = new Date(bank.transaction_date);
        
        // Check if date is within tolerance range
        const isDateMatch = 
          bankDate >= oneDayBefore && 
          bankDate <= oneDayAfter;
        
        // Check type
        const isTypeMatch = bank.type === reconciliation.type;
        
        // Check value with small difference tolerance (up to 1 monetary unit, e.g., 1 BRL)
        const valueDifference = Math.abs(bank.value - reconciliation.value);
        const isValueMatch = valueDifference <= 1;
        
        return isDateMatch && isTypeMatch && isValueMatch;
      });

      return {
        reconciliation_statement: reconciliation,
        possible_matches: possibleMatches
      };
    });

    return res.json({
      data: matchedStatements,
      pendingBankStatements
    });
  } catch (error) {
    console.error("Error comparing statements:", error);
    return res.status(500).json({
      message: "Error comparing statements",
      error: error.message,
    });
  }
};

export const reconcileStatements = async (req, res) => {
  const { reconciliationStatementId, bankStatementId } = req.body;

  if (!reconciliationStatementId || !bankStatementId) {
    return res.status(400).json({ 
      message: "Reconciliation statement ID and bank statement ID are required" 
    });
  }

  try {
    // Start a transaction
    const transaction = async () => {
      // Update reconciliation statement
      const { data: updatedReconciliation, error: reconciliationError } = await supabase
        .from("reconciliation_statements")
        .update({ 
          status: "RECONCILED", 
          bank_statement_id: bankStatementId 
        })
        .eq("id", reconciliationStatementId)
        .select()
        .single();

      if (reconciliationError) throw reconciliationError;

      // Update bank statement
      const { data: updatedBankStatement, error: bankStatementError } = await supabase
        .from("bank_statements")
        .update({ status: "RECONCILED" })
        .eq("id", bankStatementId)
        .select()
        .single();

      if (bankStatementError) throw bankStatementError;

      return { 
        reconciliationStatement: updatedReconciliation, 
        bankStatement: updatedBankStatement 
      };
    };

    const result = await transaction();

    return res.json({
      message: "Statements reconciled successfully",
      data: result
    });
  } catch (error) {
    console.error("Error reconciling statements:", error);
    return res.status(500).json({
      message: "Error reconciling statements",
      error: error.message
    });
  }
};

export default {
  getBankStatement,
  executePayment,
  getReconciliationStatements,
  createBankTransfer,
  compareStatements,
  reconcileStatements,
};
