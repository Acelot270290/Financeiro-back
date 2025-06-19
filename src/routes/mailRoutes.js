import express from "express";
import { getAllEmails, getEmailById } from "../controllers/mailController.js";

const router = express.Router();
router.get("/emails/:emailId", getEmailById);
router.get("/emails", getAllEmails);

export default router;
