import express from "express";
import multer from "multer";
import { processDocument } from "../controllers/billController.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });


// Process document for bill creation (OCR)
router.post("/process/bill", upload.single("file"), processDocument);

export default router;
