const crypto = require('crypto');

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { team_id, voter_name, votes_count, amount } = JSON.parse(event.body);

    const merchantCode = process.env.QIOSPAY_MERCHANT_CODE; // Kode Merchant Anda
    const apiKey = process.env.QIOSPAY_API_KEY;             // API Key Anda
    const privateKey = process.env.QIOSPAY_PRIVATE_Key;     // Private Key Anda
    const baseUrl = "https://my.qiospay.com/v1";

    const orderId = "SMESTA7-" + Date.now();
    const redirectUrl = "https://idca-kab-bekasi.netlify.app/";

    // Format string yang ditandatangani sesuai dokumentasi Qiospay:
    // order_id|amount|redirect_url
    const stringToSign = `${orderId}|${amount}|${redirectUrl}`;
    
    // Hitung signature menggunakan HMAC-SHA256 dengan Private Key
    const signature = crypto
      .createHmac('sha256', privateKey)
      .update(stringToSign)
      .digest('hex');

    // Kirim permintaan (request) pembuatan transaksi ke API Qiospay
    const qiospayResponse = await fetch(`${baseUrl}/transaction/create`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        order_id: orderId,
        amount: amount,
        redirect_url: redirectUrl,
        signature: signature,
        keterangan: `Dukungan SMESTA 7 untuk Tim ID ${team_id} oleh ${voter_name}`
      })
    });

    const result = await qiospayResponse.json();

    if (result.status === "success" || result.payment_url) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_url: result.payment_url || result.data.payment_url })
      };
    } else {
      throw new Error(result.message || "Gagal membuat pembayaran di Qiospay");
    }

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
