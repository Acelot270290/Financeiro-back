import { OCRService } from "../services/ocrService.js";
import { OpenAIService } from "../services/openApiService.js";
import { createClient } from "@supabase/supabase-js";
import mime from "mime-types";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const checkWords = [
  "boleto",
  "pagamento",
  "valor",
  "vencimento",
  "codigo",
  "barcode",
  "código",
  "multa",
  "juros",
  "documento",
  "número",
  "cpf",
  "cnpj",
  "beneficiário",
  "cedente",
  "sacado",
  "sacador",
  "sacador",
  "receber",
];

export const processDocument = async (req, res) => {
  try {
    console.log("📥 Recebendo requisição para processar documento...");

    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "Nenhum arquivo enviado." });
    }

    console.log("🧾 Arquivo recebido:", file?.originalname, "| Tamanho:", file?.size);

    // Força identificação do mimetype com base na extensão
    const guessedMimeType = mime.lookup(file.originalname) || file.mimetype;
    file.mimetype = guessedMimeType;

    const validMimeTypes = ["application/pdf", "image/png", "image/jpeg"];
    if (!validMimeTypes.includes(guessedMimeType)) {
      console.warn("❌ Tipo de arquivo não suportado:", guessedMimeType, "| Arquivo:", file.originalname);
      return res.status(400).json({ message: "Tipo de arquivo não suportado." });
    }

    const fileExt = file.originalname.slice(file.originalname.lastIndexOf("."));
    console.log("📄 Extensão do arquivo:", fileExt);

    let extractedTextOp1 = "";
    let extractedTextOp2 = "";
    let extractedText = "";

    try {
      console.log("🔍 Extraindo texto via PDF...");
      extractedTextOp1 = await OCRService.extractTextFromPDF(file.buffer);
    } catch (e) {
      console.error("❌ Erro ao extrair texto do PDF:", e);
    }

    try {
      console.log("🖼️ Extraindo texto via imagem...");
      extractedTextOp2 = await OCRService.extractTextFromImage(file.buffer, fileExt);
    } catch (e) {
      console.error("❌ Erro ao extrair texto da imagem:", e);
    }

    const size1 = extractedTextOp1?.length || 0;
    const size2 = extractedTextOp2?.length || 0;
    extractedText = size1 > size2 ? extractedTextOp1 : extractedTextOp2;

    console.log("📃 Texto extraído (100 primeiros caracteres):", extractedText.slice(0, 100));

    if (!extractedText) {
      return res.status(400).json({ message: "Não foi possível extrair texto do documento." });
    }

    let billingData;
    try {
      console.log("🧠 Enviando texto para o OpenAIService...");
      billingData = await OpenAIService.extractBillingData(extractedText);
      console.log("📊 Dados extraídos:", billingData);
    } catch (e) {
      console.error("❌ Erro ao processar texto com OpenAI:", e);
      return res.status(500).json({ message: "Erro ao extrair dados com IA." });
    }

    const result = {
      supplier_name: billingData.beneficiario,
      cpfCnpj: billingData.cnpj_beneficiario,
      value: formatBillCurrency(billingData.valor),
      due_date: formatBillDate(billingData.vencimento),
      barcode: billingData.codigo_barras,
      type: "single",
      payment_method: "boleto",
      status: "PENDING",
      origin: "MANUAL",
      competence: formatBillDate(billingData.vencimento),
      attachment: {
        filename: file.originalname,
        data: {
          type: file.mimetype, // agora corrigido
          data: file.buffer,
        },
      },
    };

    console.log("📦 Dados prontos para inserção:", result);

    const response = await createPaymentRequest(result);

    if (response.error) {
      console.warn("⚠️ Erro ao criar solicitação de pagamento:", response.error);
      return res.status(500).json({ message: response.error });
    }

    console.log("✅ Solicitação de pagamento criada com sucesso!");
    return res.json(response.data || result);
  } catch (error) {
    console.error("🔥 Erro interno ao processar documento:", error.stack || error);
    res.status(500).json({ message: "Erro interno ao processar o documento." });
  }
};


const formatBillCurrency = (value) => {
  //format values likes this R$ 1.619,82 to 1619.82
  if (!value) return 0;
  if (!isNaN(Number(value))) return Number(value);
  const valueWithoutR$ = value.replace("R$", "").trim();
  //if has comma, remove period
  if (valueWithoutR$.includes(",")) {
    return Number(valueWithoutR$.replace(".", "").replace(",", "."));
  }
  return Number(valueWithoutR$);
};

const formatBillDate = (date) => {
  if (!date) return new Date();
  const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
  if (!dateRegex.test(date)) return new Date();
  const formattedDate = date.split("/").reverse().join("-");
  return formattedDate;
};

const createPaymentRequest = async (data) => {
  try {
    // First check if a barcode exists and if there's already a payment request with this barcode
    if (data.barcode) {
      const { data: existingRequests, error: searchError } = await supabase
        .from("payment_requests")
        .select("id")
        .eq("barcode", data.barcode)
        .eq("origin", "MANUAL")
        .eq("payment_method", "boleto")
        .eq("status", "PENDING")
        .limit(1);

      if (searchError) {
        console.error("Error checking for duplicate barcodes:", searchError);
      } else if (existingRequests && existingRequests.length > 0) {
        console.log(
          "Payment request with this barcode already exists:",
          existingRequests[0].id
        );
        return {
          error:
            "Uma solicitação de pagamento com este código de barras já existe no sistema.",
        };
      }
    }

    console.log("📤 Enviando dados ao Supabase:", {
      supplier_name: data.supplier_name,
      value: data.value,
      due_date: data.due_date,
      barcode: data.barcode,
      cpfCnpj: data.cpfCnpj,
    });
    // Create payment request
    const { data: paymentRequest, error: requestError } = await supabase
      .from("payment_requests")
      .insert([
        {
          supplier_name: data.supplier_name,
          description: "Boleto - Email",
          value: data.value,
          due_date: data.due_date,
          status: data.status,
          origin: data.origin || "MANUAL",
          type: data.type,
          payment_method: data.payment_method,
          barcode: data.barcode,
          cpfCnpj: data.cpfCnpj,
          competence: data.due_date,
        },
      ])
      .select()
      .single();

    if (requestError) throw requestError;

    // Get email attachment data
    if (data.attachment && data.attachment.filename) {
      try {
        // Get the buffer data from the attachment
        const bufferData = data.attachment.data.data;

        // Correctly identify the content type
        let contentType = data.attachment.data.type || "application/pdf";
        if (data.attachment.filename.toLowerCase().endsWith(".pdf")) {
          contentType = "application/pdf";
        }

        // Generate unique filename
        const fileExt = data.attachment.filename.split(".").pop() || "pdf";
        const fileName = `${Math.random()
          .toString(36)
          .substring(2)}.${fileExt}`;
        const filePath = `payment-requests/${fileName}`;

        // Handle the buffer data properly
        // First, ensure we have a proper binary representation
        let uint8Array;

        // Check what type of data we're dealing with and convert appropriately
        if (Array.isArray(bufferData)) {
          // If it's an array, convert directly
          uint8Array = new Uint8Array(bufferData);
        } else if (bufferData instanceof Uint8Array) {
          // Already a Uint8Array
          uint8Array = bufferData;
        } else if (typeof bufferData === "object") {
          // If it's an object that looks like an array-like structure
          // Convert object to array
          const bufferValues = Object.values(bufferData);
          uint8Array = new Uint8Array(bufferValues);
        } else {
          // Last resort - try to interpret as array data
          console.warn("Unknown buffer data type:", typeof bufferData);
          uint8Array = new Uint8Array(Array.from(bufferData));
        }

        // Debug log to see what kind of data we're getting
        console.log(
          "Buffer data type:",
          typeof bufferData,
          "Is array?",
          Array.isArray(bufferData),
          "Is Uint8Array?",
          bufferData instanceof Uint8Array
        );

        // Check if we should validate the PDF header
        if (contentType === "application/pdf") {
          // PDF files must start with '%PDF-'
          const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
          const firstFiveBytes = Array.from(uint8Array.slice(0, 5));
          const isPDF = pdfSignature.every(
            (byte, i) => byte === firstFiveBytes[i]
          );

          console.log("PDF validation - Has PDF header?", isPDF);
          if (!isPDF) {
            console.warn(
              "Warning: File doesn't have PDF header but has PDF extension"
            );
            // Continue anyway, as it might still be a valid file
          }
        }

        // For debugging - verify we can read the PDF
        console.log(
          "First 20 bytes of the file:",
          Array.from(uint8Array.slice(0, 20))
        );

        console.log(
          `Uploading file: ${fileName}, type: ${contentType}, size: ${uint8Array.length} bytes`
        );

        // In Node.js, we can directly use the Uint8Array as the buffer for upload
        const buffer = Buffer.from(uint8Array);

        // Upload the buffer to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from("attachments")
          .upload(filePath, buffer, {
            contentType: contentType,
            upsert: false,
          });

        if (uploadError) {
          console.error("Upload error:", uploadError);
          throw uploadError;
        }

        // Get the public URL
        const {
          data: { publicUrl },
        } = supabase.storage.from("attachments").getPublicUrl(filePath);

        console.log("File uploaded successfully:", publicUrl);

        // Save attachment record in database
        const { error: attachmentError } = await supabase
          .from("payment_request_attachments")
          .insert([
            {
              payment_request_id: paymentRequest.id,
              file_name: data.attachment.filename,
              file_type: contentType,
              file_size: uint8Array.length,
              file_url: publicUrl,
            },
          ]);

        if (attachmentError) {
          console.error("Attachment record error:", attachmentError);
          throw attachmentError;
        }

        console.log("Attachment record created successfully");
      } catch (attachmentErr) {
        console.error("Error processing attachment:", attachmentErr);
        // Continue even if attachment upload fails
      }
    }

    console.log("Payment request created successfully:", paymentRequest);
    return { data: paymentRequest };
  } catch (error) {
    console.error("Error creating payment request:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Erro ao criar solicitação de pagamento",
    };
  }
};

export default {
  processDocument,
};
