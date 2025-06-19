import express from "express";
import { gerarCNAB400 } from "../controllers/cnabController.js";

const router = express.Router();
router.post("/gerar-cnab", gerarCNAB400);

export default router;
