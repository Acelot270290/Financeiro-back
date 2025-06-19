import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { executePayment as executePaymentService } from "../services/bankPaymentService.js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

let accessToken = null;
let tokenExpiration = null;

const generateToken = async (account) => {
  if (accessToken && tokenExpiration && new Date() < tokenExpiration) {
    return accessToken;
  }

  try {
    const response = await axios.post(
      process.env.OAUTH_URL2,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.CLIENT_ID2,
        client_secret: process.env.CLIENT_SECRET2,
      }),
      {
        headers: {
          Authorization: `Basic ${process.env.BASIC2}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    accessToken = response.data.access_token;
    tokenExpiration = new Date(
      new Date().getTime() + response.data.expires_in * 1000
    );

    return accessToken;
  } catch (error) {
    console.error(
      "Erro ao gerar token de autenticação:",
      error.response ? error.response.data : error.message
    );
    throw error;
  }
};

export const createInvoiceBatchPayment = async (req, res) => {
  try {
    let { payload } = req.body;

    if (
      !payload ||
      !Array.isArray(payload.lancamentos) ||
      payload.lancamentos.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "A lista de pagamentos é obrigatória." });
    }

    let account = null;
    let accessToken = null;

    if (payload.sourceAccountId) {
      const accountData = await supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", payload.sourceAccountId)
        .single();

      account = accountData.data;
      accessToken = await generateToken(account);
    }

    const batchId = uuidv4();

    let userId = null;
    let paymentIds = [];

    if (
      payload.lancamentos.length > 1 ||
      (payload.lancamentos.length === 1 && !payload.paymentId)
    ) {
      userId = payload.lancamentos[0].userId;
      const sourceAccountId = payload.lancamentos[0].sourceAccountId;

      const accountData = await supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", sourceAccountId)
        .single();

      account = accountData.data;
      accessToken = await generateToken(account);

      paymentIds = payload.lancamentos.map((l) => l.paymentId);
      payload.lancamentos = payload.lancamentos.map((l) => {
        const { userId, paymentId, ...rest } = l;
        return rest;
      });
    } else {
      userId = payload.userId;
      paymentIds = [payload.paymentId];
      payload = { ...payload, userId: undefined, paymentId: undefined };
    }

    console.log("\n# payload:");
    console.log(payload);

    const response = await axios.post(
      `${process.env.BANK_API_URL2}/pagamentos-lote/v1/lotes-boletos`,
      { ...payload },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "gw-dev-app-key": process.env.DEVELOPER_APPLICATION_KEY2,
        },
      }
    );

    console.log("\n# response:");
    console.log(response.data);

    const numeroRequisicao = response.data.numeroRequisicao;
    if (!numeroRequisicao) {
      return res
        .status(400)
        .json({ message: "Número de requisição não encontrado na resposta." });
    }

    const releaseResponse = await axios.post(
      `${process.env.BANK_API_URL2}/pagamentos-lote/v1/liberar-pagamentos`,
      { numeroRequisicao, indicadorFloat: "N" },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "gw-dev-app-key": process.env.DEVELOPER_APPLICATION_KEY2,
        },
      }
    );

    if (releaseResponse.status === 200) {
      await supabase
        .from("payments")
        .update({ bb_payment_status: "COMPLETED" })
        .in("id", paymentIds);

      for (const paymentId of paymentIds) {
        await executePaymentService(paymentId, userId);
      }
    }

    res.json({
      message: "Pagamento de boleto realizado com sucesso",
      batchId,
      data: releaseResponse.data,
    });
  } catch (error) {
    console.error(
      "Erro ao criar e liberar lote de pagamentos:",
      error.response?.data || error.message
    );

    if (error?.response?.data?.erros) {
      return res.status(200).json({
        error: true,
        data: error.response.data.erros,
      });
    }

    res.status(500).json({
      message: "Erro ao processar pagamentos",
      error: error.message,
    });
  }
};

export const createPixBatchPayment = async (req, res) => {
  try {
    let { payload } = req.body;

    if (
      !payload ||
      !Array.isArray(payload.listaTransferencias) ||
      payload.listaTransferencias.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "A lista de pagamentos Pix é obrigatória." });
    }

    let account = null;
    let accessToken = null;

    if (payload.sourceAccountId) {
      const accountData = await supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", payload.sourceAccountId)
        .single();

      account = accountData.data;
      accessToken = await generateToken(account);
    }

    const batchId = uuidv4();

    let userId = null;
    let paymentIds = [];

    if (
      payload.listaTransferencias.length > 1 ||
      (payload.listaTransferencias.length === 1 && !payload.paymentId)
    ) {
      userId = payload.listaTransferencias[0].userId;
      const sourceAccountId = payload.listaTransferencias[0].sourceAccountId;

      const accountData = await supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", sourceAccountId)
        .single();

      account = accountData.data;
      accessToken = await generateToken(account);

      paymentIds = payload.listaTransferencias.map((t) => t.paymentId);
      payload.listaTransferencias = payload.listaTransferencias.map((t) => {
        const { userId, paymentId, ...rest } = t;
        return rest;
      });
    } else {
      userId = payload.userId;
      paymentIds = [payload.paymentId];
      payload = { ...payload, userId: undefined, paymentId: undefined };
    }

    const response = await axios.post(
      `${process.env.BANK_API_URL2}/pagamentos-lote/v1/lotes-transferencias-pix`,
      { ...payload },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "gw-dev-app-key": process.env.DEVELOPER_APPLICATION_KEY2,
        },
      }
    );

    console.log("\n# response:");
    console.log(response.data);

    const numeroRequisicao = response.data.numeroRequisicao;
    if (!numeroRequisicao) {
      return res
        .status(400)
        .json({ message: "Número de requisição não encontrado na resposta." });
    }

    const releaseResponse = await axios.post(
      `${process.env.BANK_API_URL2}/pagamentos-lote/v1/liberar-pagamentos`,
      { numeroRequisicao, indicadorFloat: "N" },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "gw-dev-app-key": process.env.DEVELOPER_APPLICATION_KEY2,
        },
      }
    );

    if (releaseResponse.status === 200) {
      await supabase
        .from("payments")
        .update({ bb_payment_status: "COMPLETED" })
        .in("id", paymentIds);

      for (const paymentId of paymentIds) {
        await executePaymentService(paymentId, userId);
      }
    }

    res.json({
      message: "Lote de pagamentos Pix enviado e liberado com sucesso",
      batchId,
      data: releaseResponse.data,
    });
  } catch (error) {
    console.error(
      "Erro ao criar e liberar lote de pagamentos Pix:",
      error.response?.data || error.message
    );

    if (error.response.data.erros) {
      return res.status(200).json({
        error: true,
        data: error.response.data.erros,
      });
    }

    res.status(500).json({
      message: "Erro ao processar pagamentos Pix",
      error: error.message,
    });
  }
};

export const createTransferBatchPayment = async (req, res) => {
  try {
    let { payload } = req.body;

    if (
      !payload ||
      !Array.isArray(payload.listaTransferencias) ||
      payload.listaTransferencias.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "A lista de transferências é obrigatória." });
    }

    let account = null;
    let accessToken = null;

    if (payload.sourceAccountId) {
      const accountData = await supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", payload.sourceAccountId)
        .single();

      account = accountData.data;
      accessToken = await generateToken(account);
    }

    const batchId = uuidv4();

    let userId = null;
    let paymentIds = [];

    if (
      payload.listaTransferencias.length > 1 ||
      (payload.listaTransferencias.length === 1 && !payload.paymentId)
    ) {
      userId = payload.listaTransferencias[0].userId;
      const sourceAccountId = payload.listaTransferencias[0].sourceAccountId;

      const accountData = await supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", sourceAccountId)
        .single();

      account = accountData.data;
      accessToken = await generateToken(account);
      paymentIds = payload.listaTransferencias.map((t) => t.paymentId);
      payload.listaTransferencias = payload.listaTransferencias.map((t) => {
        const { userId, paymentId, ...rest } = t;
        return rest;
      });
    } else {
      userId = payload.userId;
      paymentIds = [payload.paymentId];
      payload = { ...payload, userId: undefined, paymentId: undefined };
    }

    console.log("\n# payload:");
    console.log(payload);

    const response = await axios.post(
      `${process.env.BANK_API_URL2}/pagamentos-lote/v1/lotes-transferencias`,
      { ...payload },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "gw-dev-app-key": process.env.DEVELOPER_APPLICATION_KEY2,
        },
      }
    );

    console.log("\n# response:");
    console.log(response.data);

    const numeroRequisicao = payload.numeroRequisicao;
    if (!numeroRequisicao) {
      return res
        .status(400)
        .json({ message: "Número de requisição não encontrado na resposta." });
    }

    const releaseResponse = await axios.post(
      `${process.env.BANK_API_URL2}/pagamentos-lote/v1/liberar-pagamentos`,
      { numeroRequisicao, indicadorFloat: "N" },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "gw-dev-app-key": process.env.DEVELOPER_APPLICATION_KEY2,
        },
      }
    );

    if (releaseResponse.status === 200) {
      await supabase
        .from("payments")
        .update({ bb_payment_status: "COMPLETED" })
        .in("id", paymentIds);

      for (const paymentId of paymentIds) {
        await executePaymentService(paymentId, userId);
      }
    }

    res.json({
      message: "Lote de transferências enviado e liberado com sucesso",
      batchId,
      data: releaseResponse.data,
    });
  } catch (error) {
    console.error(
      "Erro ao criar e liberar lote de transferências:",
      error.response?.data || error.message
    );

    if (error?.response?.data?.erros) {
      return res.status(200).json({
        error: true,
        data: error.response.data.erros,
      });
    } else if (error?.response?.data?.erros) {
      console.log(error.response.data);
    }

    res.status(500).json({
      message: "Erro ao processar transferências",
      error: error.message,
    });
  }
};

export const createTransferBatchPaymentHelper = async (payload, account) => {
  try {
    if (
      !payload ||
      !Array.isArray(payload.listaTransferencias) ||
      payload.listaTransferencias.length === 0
    ) {
      throw new Error("A lista de transferências é obrigatória.");
    }

    const accessToken = await generateToken(account);
    const batchId = uuidv4();

    let userId = null;
    let paymentIds = [];

    if (
      payload.listaTransferencias.length > 1 ||
      (payload.listaTransferencias.length === 1 && !payload.paymentId)
    ) {
      userId = payload.listaTransferencias[0].userId;
      paymentIds = payload.listaTransferencias.map((t) => t.paymentId);
      payload.listaTransferencias = payload.listaTransferencias.map((t) => {
        const { userId, paymentId, ...rest } = t;
        return rest;
      });
    } else {
      userId = payload.userId;
      paymentIds = [payload.paymentId];
      payload = { ...payload, userId: undefined, paymentId: undefined };
    }

    console.log("\n# payload:");
    console.log(payload);

    const response = await axios.post(
      `${process.env.BANK_API_URL2}/pagamentos-lote/v1/lotes-transferencias`,
      { ...payload },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "gw-dev-app-key": process.env.DEVELOPER_APPLICATION_KEY2,
        },
      }
    );

    console.log("\n# response:");
    console.log(response.data);

    const numeroRequisicao = payload.numeroRequisicao;
    if (!numeroRequisicao) {
      throw new Error("Número de requisição não encontrado na resposta.");
    }

    const releaseResponse = await axios.post(
      `${process.env.BANK_API_URL2}/pagamentos-lote/v1/liberar-pagamentos`,
      { numeroRequisicao, indicadorFloat: "N" },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "gw-dev-app-key": process.env.DEVELOPER_APPLICATION_KEY2,
        },
      }
    );

    if (releaseResponse.status === 200) {
      await supabase
        .from("bank_transfers")
        .update({ status: "COMPLETED" })
        .in("id", paymentIds);
    }

    return {
      message: "Lote de transferências enviado e liberado com sucesso",
      batchId,
      data: releaseResponse.data,
    };
  } catch (error) {
    console.error(
      "Erro ao criar e liberar lote de transferências:",
      error.response?.data || error.message
    );

    if (error?.response?.data?.erros) {
      throw new Error(error.response.data.erros);
    }

    console.log(error);
    throw new Error("Erro ao processar transferências");
  }
};
