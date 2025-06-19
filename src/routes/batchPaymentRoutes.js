import express from "express";
import {
  createInvoiceBatchPayment,
  createPixBatchPayment,
  createTransferBatchPayment,
} from "../controllers/batchPaymentController.js";

const router = express.Router();
router.post("/create-lote-boleto", createInvoiceBatchPayment);
router.post("/create-lote-pix", createPixBatchPayment);
router.post("/create-lote-transferencia", createTransferBatchPayment);

export default router;
