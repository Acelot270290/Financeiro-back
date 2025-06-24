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

export const getAllEmails = async (req, res) => {
  const { data, error } = await supabase.from("email_configs").select("*");

  for (const email of data) {
    const result = await getEmailsWithAttachments(email.id);
    return res.status(200).json(result);
  }

  return res.status(200).json({ data });
};

export const getEmailById = async (req, res) => {
  const { emailId } = req.params;

  const result = await getEmailsWithAttachments(emailId);

  if (result.error) {
    return res.status(500).json({ error: result.error });
  }

  return res.status(200).json(result);
};

export const getEmailsWithAttachments = async (emailId) => {
  try {
    console.log("Connecting to Gmail IMAP server...");

    const { data: email, error: emailError } = await supabase
      .from("email_configs")
      .select("*")
      .eq("id", emailId);

    console.log(email);

    if (emailError) {
      return { error: emailError.message };
    }

    const config = {
      imap: {
        user: email[0].email,
        password: email[0].password, // App password for Gmail
        host: email[0].imap_host, // Correct host for Gmail IMAP
        port: email[0].imap_port, // Correct port for Gmail IMAP with SSL
        tls: email[0].use_ssl,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 30000, // Increased timeout
      },
    };

    const connection = await Imap.connect(config);
    await connection.openBox("INBOX"); // Open inbox

    console.log("Connected to Gmail IMAP server");
    // Search for emails received in the last 24 hours

    const currentDate = new Date();
    const oneDayAgo = new Date(currentDate.setDate(currentDate.getDate() - 4)); //TODO: change to -1 day

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
      ["ALL", ["SINCE", formattedDate]], // and ["BEFORE", new Date().toISOString()]
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
          try {
            const partData = await connection.getPartData(item, attachment);
            const rawFilename =
              attachment?.disposition?.params?.filename || attachment?.params?.name || "";

            const filename = rawFilename !== ""
              ? rawFilename.replace(/\s/g, "_")
              : `anexo-${Date.now()}.pdf`;

            const isPDF = filename.toLowerCase().endsWith(".pdf");

            downloadedAttachments.push({
              filename,
              data: partData,
              isPDF,
            });
          } catch (err) {
            console.error("Erro ao baixar anexo:", err);
          }
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
        // Here you can add code to process the PDF attachments
        // For example, save them to Supabase or process them further
      }
    }

    return { emailsWithAttachments };
  } catch (error) {
    console.error("Error fetching emails:", error);
    return { error: error.message };
  }
};

export default {
  getEmailsWithAttachments,
  getAllEmails,
  getEmailById,
};
