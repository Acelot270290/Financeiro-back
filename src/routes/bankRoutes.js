import express from "express";
import {
  getBankStatement,
  executePayment,
  getReconciliationStatements,
  createBankTransfer,
  compareStatements,
  reconcileStatements,
} from "../controllers/bankController.js";

const router = express.Router();
router.post("/statement", getBankStatement);
router.post("/payment/execute", executePayment);
router.get(
  "/reconciliation/statements/:bankAccountId",
  getReconciliationStatements
);
router.get(
  "/reconciliation/compare/:bankAccountId",
  compareStatements
);
router.post("/reconciliation/reconcile", reconcileStatements);
router.post("/transfer", createBankTransfer);
export default router;
