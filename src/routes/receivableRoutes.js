import express from "express";
import {
  approveReceivableRequest,
  rejectReceivableRequest,
  reverseReceivable,
  cancelReceivable,
  list,
  create
} from "../controllers/receivableController.js";

const router = express.Router();
router.post("/request/approve", approveReceivableRequest);
router.post("/request/reject", rejectReceivableRequest);
router.post("/reverse", reverseReceivable);
router.post("/cancel", cancelReceivable);
router.post("/create", create);
router.get("/", list);

export default router;
