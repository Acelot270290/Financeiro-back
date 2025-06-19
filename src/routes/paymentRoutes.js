import express from "express";
import {
  approvePaymentRequest,
  rejectPaymentRequest,
  createPayment,
  updatePayment,
} from "../controllers/paymentController.js";

const router = express.Router();
router.post("/request/approve", approvePaymentRequest);
router.post("/request/reject", rejectPaymentRequest);
router.post("/create", createPayment);
router.post("/update", updatePayment);

export default router;
