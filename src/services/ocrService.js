import Tesseract from "tesseract.js";
import { default as pdf } from 'pdf-parse/lib/pdf-parse.js';
import { fromPath } from "pdf2pic";
import fs from "fs";
import path from "path";
import sharp from "sharp";

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class OCRService {

  static async preprocessImage(buffer) {
    return sharp(buffer)
      // 1. Aumenta DPI efetivo: redimensiona para pelo menos 300 DPI
      .resize({ width: 2480 }) // ex: largura de A4 8.27in×300dpi ≈ 2480px
      // 2. Converte para tons de cinza
      .grayscale()
      // 3. Aumenta contraste
      .linear(1.5, -30)
      // 4. Binarização (threshold)
      .threshold(150)
      // 5. Remoção de pequenos ruídos (opening)
      .median(3)
      .toBuffer();
  }
  
  static async extractTextFromImage(buffer, fileExt) {
    try {
      // If file is a PDF, convert it to an image first
      if (fileExt.toLowerCase() === ".pdf") {
        buffer = await this.convertPdfToImage(buffer);
      }

      buffer = await this.preprocessImage(buffer);

      // Run Tesseract OCR on the image buffer
      const {
        data: { text },
      } = await Tesseract.recognize(buffer, "por", {
        logger: (m) => { /*console.log(m)*/ },
        // força o LSTM puro e layout de uma zona uniforme de texto
        config: [
          "--oem 1",           // LSTM only
          "--psm 6",           // assume uma única “block” de texto
          "-c", "tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,-/",
          "-c", "preserve_interword_spaces=1"
        ]
      });
      return text;
    } catch (error) {
      console.error("OCR service error:", error);
      throw new Error("Failed to extract text from image");
    }
  }

  /**
   * Converts a PDF to an image using pdf2pic (first page only).
   * @param {Buffer} pdfBuffer - The PDF file buffer.
   * @returns {Promise<Buffer>} - Buffer of the generated image.
   */
  static async convertPdfToImage(pdfBuffer) {
    try {
      const tempDir = path.join(__dirname, "temp");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

      const pdfPath = path.join(tempDir, "temp.pdf");
      const imagePath = path.join(tempDir, "output.1.png"); // FIXED: Match pdf2pic output

      fs.writeFileSync(pdfPath, pdfBuffer);

      const options = {
        density: 300,
        savePath: tempDir,
        saveFilename: "output",
        format: "png",
        width: 800,
        height: 1000,
        useImagemagick: true // Force ImageMagick if needed
      };

      const converter = fromPath(pdfPath, options);
      await converter(1);

      console.log("PDF converted successfully:", imagePath);

      if (!fs.existsSync(imagePath)) {
        throw new Error(`PDF to image conversion failed, file not found: ${imagePath}`);
      }

      const imageBuffer = fs.readFileSync(imagePath);
      fs.unlinkSync(pdfPath);
      fs.unlinkSync(imagePath);

      return imageBuffer;
    } catch (error) {
      console.error("PDF to image conversion error:", error);
      throw new Error("Failed to convert PDF to image");
    }
  }

  static async extractTextFromPDF(buffer) {
    try {
      const data = await pdf(buffer);
      return data.text;
    } catch (error) {
      console.error("PDF parsing error:", error);
      throw new Error("Failed to extract text from PDF");
    }
  }
}
