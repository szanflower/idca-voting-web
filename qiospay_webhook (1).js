module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    console.log('Qiospay Webhook received:', JSON.stringify(body));

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const headers = {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    // Ambil order_id dari data callback
    const orderId = body.order_id || (body.data && body.data.order_id) || (body.metadata && body.metadata.order_id);
    const rawStatus = (body.status || (body.data && body.data.status) || '').toLowerCase();
    const isPaid = rawStatus === 'paid' || rawStatus === 'success' || rawStatus === 'lunas' || body.type === 'CR' || (body.data && body.data.type === 'CR');

    if (!isPaid) {
      return res.status(200).json({ status: 'ignored', message: 'Transaksi belum lunas' });
    }

    let targetTrx = null;

    // Cari transaksi di Supabase berdasarkan order_id
    if (orderId) {
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/transactions?order_id=eq.${encodeURIComponent(orderId)}&limit=1`,
        { headers }
      );
      const data = await resp.json();
      if (data && data.length > 0) targetTrx = data[0];
    }

    // Fallback pencarian berdasarkan nominal jika order_id tidak terkirim
    if (!targetTrx) {
      const rawAmount = body.total_amount || body.amount || (body.data && (body.data.amount || body.data.total_amount));
      const nominal = parseInt(rawAmount, 10);
      if (nominal > 0) {
        const resp = await fetch(
          `${supabaseUrl}/rest/v1/transactions?amount=eq.${nominal}&status=eq.PENDING&order=created_at.desc&limit=1`,
          { headers }
        );
        const data = await resp.json();
        if (data && data.length > 0) targetTrx = data[0];
      }
    }

    // Jika transaksi ditemukan dan masih PENDING, perbarui ke PAID dan tambah poin tim
    if (targetTrx && targetTrx.status !== 'PAID') {
      await fetch(`${supabaseUrl}/rest/v1/transactions?id=eq.${targetTrx.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'PAID',
          paid_at: new Date().toISOString()
        })
      });

      const teamRes = await fetch(
        `${supabaseUrl}/rest/v1/teams?id=eq.${targetTrx.team_id}`,
        { headers }
      );
      const teamData = await teamRes.json();

      if (teamData && teamData.length > 0) {
        const currentVotes = teamData[0].total_votes || 0;
        const newVotes = currentVotes + targetTrx.votes_count;

        await fetch(`${supabaseUrl}/rest/v1/teams?id=eq.${targetTrx.team_id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ total_votes: newVotes })
        });

        console.log(`Berhasil update ${targetTrx.votes_count} suara untuk tim ID ${targetTrx.team_id}`);
      }
    }

    return res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: error.message });
  }
};