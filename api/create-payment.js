// api/create-payment.js
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

    // Minta invoice QRIS Dinamis langsung dari gateway Qiospay
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
        metadata: { 
          team_id: parseInt(team_id, 10), 
          voter_name, 
          votes_count: parseInt(votes_count, 10), 
          order_id: orderId 
        }
      })
    });

    const resText = await qiospayRes.text();
    let result;
    try { 
      result = JSON.parse(resText); 
    } catch (_) { 
      result = { message: resText }; 
    }

    if (!qiospayRes.ok || result.status === "error") {
      const errMsg = result.error ? (result.error.message || JSON.stringify(result.error)) : (result.message || resText);
      return res.status(400).json({ error: `Qiospay (HTTP ${qiospayRes.status}): ${errMsg}` });
    }

    const resData = result.data || result;
    const finalAmount = resData.total_amount || resData.amount || amount;
    const qrImageUrl = resData.qr_image_url || null;
    const qrisContent = resData.qris_content || resData.qris_string || null;

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
      qr_image_url: qrImageUrl,
      qris_content: qrisContent,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });

  } catch (error) {
    return res.status(500).json({ error: error.message || "Terjadi kesalahan server." });
  }
};
