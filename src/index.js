import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import bankRoutes from "./routes/bankRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import batchPaymentRoutes from "./routes/batchPaymentRoutes.js";
import receivableRoutes from "./routes/receivableRoutes.js";
import cnabRoutes from "./routes/cnabRoutes.js";
import mailRoutes from "./routes/mailRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import path from "path";
import "./crons/paymentCron.js";
import "./crons/receivableCron.js";
import "./crons/transferCron.js";
import "./crons/mailParserCron.js";
import { fileURLToPath } from "url";
dotenv.config();
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_KEY:", process.env.SUPABASE_KEY);


const app = express();
// Middleware
app.use(cors());
app.use(express.json());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILES_DIR = path.resolve(__dirname, "files");

app.use("/files", express.static(FILES_DIR));

// Routes
app.use("/files", express.static(FILES_DIR));
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/bank", bankRoutes);
app.use("/payment", paymentRoutes);
app.use("/batch-payment", batchPaymentRoutes);
app.use("/receivable", receivableRoutes);
app.use("/cnab", cnabRoutes);
app.use("/mail", mailRoutes);
app.use("/ai", aiRoutes);

app.use(express.static(path.join(__dirname, "../app")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../app", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}!!!`);
});
