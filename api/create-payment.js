// api/create-payment.js

// Fungsi kalkulasi CRC16-CCITT standar EMVCo / QRIS Bank Indonesia
function getCRC16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  let hex = (crc & 0xFFFF).toString(16).toUpperCase();
  return hex.padStart(4, "0");
}

// Konversi QRIS Statis DANA Bisnis SANNN STORE menjadi QRIS Dinamis (Nominal Terkunci)
function generateDynamicQRIS(amount) {
  const baseStaticQR = "00020101021126610014ID.DANA.WWW0118936009153250533131021000024921660303UMI51440014ID.DANA.WWW02150000000000000000303UMI520458125303360";
  const postPart = "5802ID5911SANNN STORE6006BEKASI61051753062070703A016304";
  
  const amountStr = String(amount);
  const tag54 = "54" + String(amountStr.length).padStart(2, "0") + amountStr;
  
  let dynamicRaw = baseStaticQR.replace("010211", "010212") + tag54 + postPart;
  const crc = getCRC16(dynamicRaw);
  return dynamicRaw + crc;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { team_id, voter_name, votes_count, amount } = body;

    if (!team_id || !voter_name || !votes_count || !amount) {
      return res.status(400).json({ error: "Data transaksi tidak lengkap." });
    }

    const apiKey = (process.env.QIOSPAY_API_KEY || "").trim();
    let rawSupabaseUrl = (process.env.SUPABASE_URL || "https://zdgmskqimgxypihmrywf.supabase.co").trim();
    const urlMatch = rawSupabaseUrl.match(/https?:\/\/[^\s\)\'\"\]]+/);
    const supabaseUrl = urlMatch ? urlMatch[0].replace(/\/+$/, "") : "https://zdgmskqimgxypihmrywf.supabase.co";
    const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!apiKey) {
      return res.status(500).json({ error: "QIOSPAY_API_KEY belum terisi di Vercel." });
    }

    const orderId = "SMESTA7-" + Date.now();
    const siteUrl = "https://smesta-7.vercel.app";
    const callbackUrl = `${siteUrl}/api/qiospay-webhook`;

    // Buat invoice di Qiospay untuk mendapatkan kode unik resmi & tracking mutasi
    const qiospayRes = await fetch("https://my.qiospay.com/v1/invoices", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        order_id: orderId,
        amount: parseInt(amount, 10),
        keterangan: `Dukungan SMESTA 7 - Tim #${team_id} (${voter_name})`,
        customer_name: voter_name,
        callback_url: callbackUrl,
        redirect_url: siteUrl,
        expired_menit: 15,
        metadata: { team_id: parseInt(team_id, 10), voter_name, votes_count: parseInt(votes_count, 10), order_id: orderId }
      })
    });

    const resText = await qiospayRes.text();
    let result;
    try { result = JSON.parse(resText); } catch (_) { result = { message: resText }; }

    if (!qiospayRes.ok || result.status === "error") {
      const errMsg = result.error ? (result.error.message || JSON.stringify(result.error)) : (result.message || resText);
      return res.status(400).json({ error: `Qiospay (HTTP ${qiospayRes.status}): ${errMsg}` });
    }

    const resData = result.data || result;
    const finalAmount = resData.total_amount || resData.amount || amount;

    // Generate string QRIS Dinamis berstandar EMVCo resmi dengan nominal terkunci
    const dynamicQrisContent = generateDynamicQRIS(finalAmount);

    if (supabaseKey) {
      await fetch(`${supabaseUrl}/rest/v1/transactions`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          order_id: orderId,
          team_id: parseInt(team_id, 10),
          voter_name: voter_name,
          votes_count: parseInt(votes_count, 10),
          amount: finalAmount,
          status: "PENDING",
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        })
      });
    }

    return res.status(200).json({
      status: "success",
      order_id: orderId,
      amount: finalAmount,
      qris_content: dynamicQrisContent,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });

  } catch (error) {
    return res.status(500).json({ error: error.message || "Terjadi kesalahan server." });
  }
};
