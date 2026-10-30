exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { team_id, voter_name, votes_count, amount } = JSON.parse(event.body || "{}");

    if (!team_id || !voter_name || !votes_count || !amount) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Data transaksi tidak lengkap." })
      };
    }

    const apiKey = process.env.QIOSPAY_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey) {
      throw new Error("QIOSPAY_API_KEY belum diatur di environment variable Netlify.");
    }
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Kredensial Supabase (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) belum lengkap di Netlify.");
    }

    const orderId = "SMESTA7-" + Date.now();
    const siteUrl = "https://idca-kab-bekasi.netlify.app";
    const callbackUrl = `${siteUrl}/.netlify/functions/qiospay-webhook`;

    // Request pembuatan QRIS Dinamis ke API resmi Qiospay v1
    const qiospayRes = await fetch("https://my.qiospay.com/v1/invoices", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        order_id: orderId,
        amount: parseInt(amount, 10),
        keterangan: `Dukungan SMESTA 7 - Tim #${team_id} (${voter_name})`,
        customer: {
          name: voter_name
        },
        callback_url: callbackUrl,
        redirect_url: siteUrl,
        expired_menit: 15,
        metadata: {
          team_id: parseInt(team_id, 10),
          voter_name: voter_name,
          votes_count: parseInt(votes_count, 10),
          order_id: orderId
        }
      })
    });

    const result = await qiospayRes.json();

    if (!qiospayRes.ok || result.status === "error") {
      console.error("Qiospay error response:", result);
      throw new Error(result.message || "Gagal membuat invoice QRIS di Qiospay.");
    }

    // Mendukung struktur data respons resmi Qiospay v1
    const resData = result.data || result;
    const finalAmount = resData.total_amount || resData.amount || amount;
    const qrImageUrl = resData.qr_image_url || null;
    const qrisContent = resData.qris_content || null;
    const payUrl = resData.pay_url || null;

    // Simpan data transaksi PENDING ke Supabase
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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "success",
        order_id: orderId,
        amount: finalAmount,
        qr_image_url: qrImageUrl,
        qris_content: qrisContent,
        pay_url: payUrl,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      })
    };

  } catch (error) {
    console.error("Error create-payment:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message || "Terjadi kesalahan server." })
    };
  }
};
