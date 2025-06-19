import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import iconv from "iconv-lite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILES_DIR = path.join(__dirname, "../files");

function padRight(str = "", length) {
  return str.padEnd(length, " ");
}

function padLeft(str = "", length) {
  return str.padStart(length, "0");
}

function gerarHeader(info) {
  return (
    "0" +
    "1" +
    padRight("REMESSA", 7) +
    "01" +
    padRight("COBRANCA", 8) +
    padRight("", 7) +
    padLeft(info.convenio, 4) +
    "0" +
    padLeft(info.conta, 8) +
    "0" +
    padLeft("123456", 6) +
    padRight(info.nomeEmpresa, 30) +
    padRight("001BANCODOBRASIL", 18) +
    padLeft(info.dataGeracao, 6) +
    padLeft(info.sequencialArquivo, 7) +
    padRight("", 287) +
    padLeft(info.sequencialArquivo, 6)
  );
}

function gerarDetalhe(pagamento) {
  const isBoleto = pagamento?.payment_method === "boleto";

  return (
    "1" +
    "02" +
    padLeft(pagamento?.documentoPagador || "00000000000000", 14) +
    padLeft("1234", 4) +
    "0" +
    padLeft("56789012", 8) +
    "0" +
    padLeft(pagamento?.nossoNumero || "000000", 6) +
    padRight("CONTROLE" + pagamento?.index, 25) +
    padLeft(pagamento?.nossoNumero || "00000000000", 11) +
    "0" +
    "00" +
    "00" +
    padRight("", 3) +
    " " +
    "AI" +
    "001" +
    "0" +
    "00000" +
    "00" +
    padRight("", 10) +
    padLeft(pagamento?.vencimento?.replace(/-/g, "").slice(2), 6) +
    padLeft(pagamento?.valor?.toFixed(2).replace(".", ""), 13) +
    "001" +
    "0000" +
    " " +
    "01" +
    "N" +
    padLeft("180224", 6) +
    "00" +
    "00" +
    padLeft("00000000000", 11) +
    padLeft("000000", 6) +
    padLeft("00000000000", 11) +
    padLeft("00000000000", 11) +
    "02" +
    padLeft(pagamento?.documentoPagador || "00000000000000", 14) +
    padRight(pagamento?.nomePagador, 37) +
    padRight("", 3) +
    padRight(pagamento?.enderecoPagador, 52) +
    padLeft(pagamento?.cepPagador, 8) +
    padRight(pagamento?.cidadePagador, 15) +
    pagamento?.ufPagador +
    padRight(
      isBoleto
        ? "BOLETO " + (pagamento?.barcode || "000000").replace(/\s/g, "")
        : "PIX " + (pagamento?.pix_key || "000000"),
      40
    ) +
    "00" +
    " " +
    padLeft((pagamento.index + 1).toString(), 6)
  );
}

function gerarTrailer(totalRegistros) {
  return "9" + padRight("", 393) + padLeft(totalRegistros.toString(), 6);
}

if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

export async function gerarCNAB400(req, res) {
  try {
    const { headerInfo, detalhes } = req.body;

    if (!headerInfo || !detalhes || !Array.isArray(detalhes)) {
      return res
        .status(400)
        .json({ error: "Dados inválidos. Verifique o formato da requisição." });
    }

    const filePath = path.join(FILES_DIR, "cnab400_bb_exemplo.rem");

    const header = gerarHeader(headerInfo);
    const detalhesStr = detalhes.map(gerarDetalhe).join("\n");

    const totalLinhas = 1 + detalhes.length + 1;
    const trailer = gerarTrailer(totalLinhas);

    const cnabContent = `${header}\n${detalhesStr}\n${trailer}`;

    const cnabBuffer = iconv.encode(cnabContent, "win1252");

    fs.writeFileSync(filePath, cnabBuffer);
    return res.status(200).json({
      message: "Arquivo CNAB 400 gerado com sucesso!",
      downloadUrl: `/files/cnab400_bb_exemplo.rem`,
    });
  } catch (error) {
    console.error("Erro ao gerar CNAB 400:", error);
    return res
      .status(500)
      .json({ error: "Erro interno ao gerar o arquivo CNAB." });
  }
}
