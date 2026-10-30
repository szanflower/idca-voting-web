exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body || "{}") : event.body;
    console.log("Qiospay Webhook received:", JSON.stringify(body));

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const headers = {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    };

    // Ambil order_id dari payload webhook Qiospay (bisa di root, data, atau metadata)
    const orderId = body.order_id || (body.data && body.data.order_id) || (body.metadata && body.metadata.order_id);
    const rawStatus = (body.status || (body.data && body.data.status) || "").toLowerCase();
    const isPaid = rawStatus === "paid" || rawStatus === "success" || rawStatus === "lunas" || body.type === "CR" || (body.data && body.data.type === "CR");

    if (!isPaid) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ignored", message: "Status transaksi belum lunas" })
      };
    }

    let targetTrx = null;

    // 1. Prioritas pencarian berdasarkan order_id
    if (orderId) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/transactions?order_id=eq.${encodeURIComponent(orderId)}&limit=1`,
        { headers }
      );
      const data = await res.json();
      if (data && data.length > 0) {
        targetTrx = data[0];
      }
    }

    // 2. Pencarian alternatif berdasarkan nominal unik jika order_id tidak terkirim
    if (!targetTrx) {
      const rawAmount = body.total_amount || body.amount || (body.data && (body.data.amount || body.data.total_amount));
      const nominal = parseInt(rawAmount, 10);
      if (nominal > 0) {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/transactions?amount=eq.${nominal}&status=eq.PENDING&order=created_at.desc&limit=1`,
          { headers }
        );
        const data = await res.json();
        if (data && data.length > 0) {
          targetTrx = data[0];
        }
      }
    }

    // Jika transaksi ditemukan dan belum ditandai PAID
    if (targetTrx && targetTrx.status !== "PAID") {
      // 1. Ubah status transaksi menjadi PAID
      await fetch(`${supabaseUrl}/rest/v1/transactions?id=eq.${targetTrx.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "PAID",
          paid_at: new Date().toISOString()
        })
      });

      // 2. Tambah total_votes ke tim terkait
      const teamRes = await fetch(
        `${supabaseUrl}/rest/v1/teams?id=eq.${targetTrx.team_id}`,
        { headers }
      );
      const teamData = await teamRes.json();

      if (teamData && teamData.length > 0) {
        const currentVotes = teamData[0].total_votes || 0;
        const newVotes = currentVotes + targetTrx.votes_count;

        await fetch(`${supabaseUrl}/rest/v1/teams?id=eq.${targetTrx.team_id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ total_votes: newVotes })
        });

        console.log(`Berhasil update ${targetTrx.votes_count} suara untuk tim ID ${targetTrx.team_id}`);
      }
    }

    // Selalu respon 200 OK ke server Qiospay
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ok" })
    };

  } catch (error) {
    console.error("Webhook processing error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message })
    };
  }
};
