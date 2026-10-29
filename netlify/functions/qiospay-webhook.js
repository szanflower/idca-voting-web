exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);

    if (body.status === "success" && body.data && body.data.type === "CR") {
      const nominalMasuk = parseInt(body.data.amount);

      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      const headers = {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      };

      // Cari transaksi PENDING yang sesuai nominal
      const checkRes = await fetch(
        `${supabaseUrl}/rest/v1/transactions?amount=eq.${nominalMasuk}&status=eq.PENDING&order=created_at.desc&limit=1`,
        { headers }
      );
      const pendingTrx = await checkRes.json();

      if (pendingTrx && pendingTrx.length > 0) {
        const trx = pendingTrx[0];

        // Ubah status menjadi PAID
        await fetch(`${supabaseUrl}/rest/v1/transactions?id=eq.${trx.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status: "PAID" })
        });

        // Ambil data tim untuk menambah total vote
        const teamRes = await fetch(
          `${supabaseUrl}/rest/v1/teams?id=eq.${trx.team_id}`,
          { headers }
        );
        const teamData = await teamRes.json();

        if (teamData && teamData.length > 0) {
          const currentVotes = teamData[0].total_votes || 0;
          const newVotes = currentVotes + trx.votes_count;

          await fetch(`${supabaseUrl}/rest/v1/teams?id=eq.${trx.team_id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ total_votes: newVotes })
          });
        }
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ok" })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
