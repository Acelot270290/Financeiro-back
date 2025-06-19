// paymentCron.js
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import Imap from "imap-simple";
import { simpleParser } from "mailparser";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Common words found in Brazilian payment slips (boletos)
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
  "receber",
];

export async function getEmailsWithAttachments(config) {
  try {
    console.log("Connecting to Gmail IMAP server...");
    const connection = await Imap.connect(config);
    await connection.openBox("INBOX"); // Open inbox

    console.log("Connected to Gmail IMAP server");
    // Search for emails received in the last 24 hours

    const currentDate = new Date();
    const oneDayAgo = new Date(currentDate.setDate(currentDate.getDate() - 1));

    // Convert the date to the format "DD-Mmm-YYYY"
    const formattedDate = oneDayAgo
      .toUTCString()
      .split(" ")
      .slice(1, 4)
      .join(" ");

    console.log(formattedDate);
    console.log(new Date().toISOString());

    const fetchOptions = {
      bodies: ["HEADER", "TEXT", ""],
      struct: true,
      markSeen: false, // Don't mark as read yet
    };

    console.log("Searching for emails...");

    const messages = await connection.search(
      ["ALL", ["SINCE", formattedDate], ["BEFORE", new Date().toISOString()]],
      fetchOptions
    );

    console.log("Found", messages.length, "all emails");

    let emailsWithAttachments = [];

    for (let item of messages) {
      const parts = Imap.getParts(item.attributes.struct);
      const attachments = parts.filter(
        (part) =>
          part.disposition &&
          part.disposition.type.toUpperCase() === "ATTACHMENT"
      );

      if (attachments.length > 0) {
        const allHeaders = item.parts.find(
          (part) => part.which === "HEADER"
        )?.body;
        const subject = allHeaders.subject?.[0] || "No Subject";
        const from = allHeaders.from?.[0] || "Unknown";

        // Get email body
        const bodyPart = item.parts.find((part) => part.which === "");
        let body = "";

        if (bodyPart) {
          const parsed = await simpleParser(bodyPart.body);
          body = parsed.text || parsed.html || "";
        }

        // Download attachments
        const downloadedAttachments = [];
        for (let attachment of attachments) {
          const partData = await connection.getPartData(item, attachment);
          const filename = attachment.disposition.params.filename;

          // Check if the attachment is a PDF
          const isPDF = filename.toLowerCase().endsWith(".pdf");

          downloadedAttachments.push({
            filename: filename,
            data: partData,
            isPDF: isPDF,
          });
        }

        emailsWithAttachments.push({
          subject,
          from,
          body,
          attachments: downloadedAttachments,
          uid: item.attributes.uid,
        });

        // Mark as seen after processing
        await connection.addFlags(item.attributes.uid, ["\\Seen"]);
      }
    }

    console.log("Emails with attachments:", emailsWithAttachments.length);
    connection.end(); // Close connection

    const emails = emailsWithAttachments;
    // Process only PDF attachments
    for (const email of emails) {
      const pdfAttachments = email.attachments.filter((att) => att.isPDF);

      if (pdfAttachments.length > 0) {
        console.log(
          `Processing ${pdfAttachments.length} PDF attachments from email: ${email.subject}`
        );

        for (const pdfAttachment of pdfAttachments) {
          try {
            console.log(`Processing attachment: ${pdfAttachment.filename}`);
            const result = await processDocument(pdfAttachment);

            if (result.error) {
              console.error(`Failed to process attachment: ${result.error}`);
            } else {
              console.log(
                `Successfully processed attachment: ${pdfAttachment.filename}`
              );
              console.log("Payment request ID:", result.data?.id || "Unknown");
            }
          } catch (attachmentError) {
            console.error(
              `Error processing attachment ${pdfAttachment.filename}:`,
              attachmentError
            );
          }
        }
      }
    }

    return emailsWithAttachments;
  } catch (error) {
    console.error("Error fetching emails:", error);
    return [];
  }
}

// Schedule the cron job to run daily at 00:00
cron.schedule("0 0 * * *", async () => {
  console.log("Running mail parser cron job at", new Date().toISOString());
  try {
    const { data: emails, error: emailError } = await supabase
      .from("email_configs")
      .select("*")
      .eq("active", true);

    if (emailError) {
      console.error("Error fetching emails:", emailError);
    }

    for (const email of emails) {
      const config = {
        imap: {
          user: email.email,
          password: email.password, // App password for Gmail
          host: email.imap_host, // Correct host for Gmail IMAP
          port: email.imap_port, // Correct port for Gmail IMAP with SSL
          tls: email.use_ssl,
          tlsOptions: { rejectUnauthorized: false },
          authTimeout: 30000, // Increased timeout
        },
      };

      await getEmailsWithAttachments(config);
    }
  } catch (error) {
    console.error("Error in mail parser cron job:", error);
  }
});

export const processDocument = async (attachment) => {
  try {
    console.log("Processing email attachment...");

    if (!attachment) {
      console.error("No attachment provided");
      return { error: "No attachment provided" };
    }

    // Import the services needed for processing
    const { OCRService } = await import("../services/ocrService.js");
    const { OpenAIService } = await import("../services/openApiService.js");

    // Setup the attachment data
    const filename = attachment.filename || "unknown.pdf";
    const fileExt = filename.slice(filename.lastIndexOf(".")).toLowerCase();

    // For PDF processing, we need to convert the data to a buffer
    let buffer;
    if (Buffer.isBuffer(attachment)) {
      buffer = attachment;
    } else if (Buffer.isBuffer(attachment.data)) {
      buffer = attachment.data;
    } else if (attachment.data) {
      // Handle different data types
      if (Array.isArray(attachment.data)) {
        buffer = Buffer.from(attachment.data);
      } else if (typeof attachment.data === "object") {
        // If it's an object-like structure, try to convert it
        try {
          buffer = Buffer.from(Object.values(attachment.data));
        } catch (bufferError) {
          console.error(
            "Failed to convert attachment data to buffer:",
            bufferError
          );
          return { error: "Invalid attachment data format" };
        }
      } else {
        console.error(
          "Unsupported attachment data type:",
          typeof attachment.data
        );
        return { error: "Unsupported attachment data type" };
      }
    } else {
      console.error("Invalid attachment format");
      return { error: "Invalid attachment format" };
    }

    // Extract text from the document
    let extractedText = "";
    let extractedTextOp1 = "";
    let extractedTextOp2 = "";
    try {
      extractedTextOp1 = await OCRService.extractTextFromPDF(buffer);
      extractedTextOp2 = await OCRService.extractTextFromImage(buffer, fileExt);
      const size1 = extractedTextOp1.length || 0;
      const size2 = extractedTextOp2.length || 0;

      if (size1 > size2) {
        extractedText = extractedTextOp1;
      } else {
        extractedText = extractedTextOp2;
      }
    } catch (ocrError) {
      console.error("OCR processing error:", ocrError);
      return { error: "Failed to process document with OCR" };
    }

    // Process the extracted text with OpenAI
    try {
      console.log("Extracted text:", extractedText);
      const billingData = await OpenAIService.extractBillingData(extractedText);

      // Prepare the payment request data
      const result = {
        supplier_name: billingData.beneficiario,
        cpfCnpj: billingData.cnpj_beneficiario,
        value: formatBillCurrency(billingData.valor),
        due_date: formatBillDate(billingData.vencimento),
        barcode: billingData.codigo_barras,
        type: "single",
        payment_method: "boleto",
        status: "PENDING",
        origin: "EMAIL",
        competence: formatBillDate(billingData.vencimento),
        attachment: {
          filename: filename,
          data: {
            type: "application/pdf",
            data: buffer,
          },
        },
      };

      console.log("Extracted billing data:", {
        supplier_name: result.supplier_name,
        value: result.value,
        due_date: result.due_date,
        barcode: result.barcode
          ? result.barcode.substring(0, 10) + "..."
          : "none",
      });

      // Create the payment request
      const response = await createPaymentRequest(result);

      if (response.error) {
        console.error("Payment request error:", response.error);
        return { error: response.error };
      }

      console.log("Payment request created successfully from email attachment");
      return { success: true, data: response.data };
    } catch (aiError) {
      console.error("AI processing error:", aiError);
      return { error: "Failed to extract billing information" };
    }
  } catch (error) {
    console.error("Document processing error:", error);
    return { error: error.message || "Failed to process document" };
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
        .eq("origin", "EMAIL")
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
