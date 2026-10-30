module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { team_id, voter_name, votes_count, amount } = body;

    if (!team_id || !voter_name || !votes_count || !amount) {
      return res.status(400).json({ error: 'Data transaksi tidak lengkap.' });
    }

    const apiKey = process.env.QIOSPAY_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'QIOSPAY_API_KEY belum diatur di Vercel.' });
    }
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Kredensial Supabase belum lengkap di Vercel.' });
    }

    const orderId = 'SMESTA7-' + Date.now();
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const siteUrl = `${proto}://${host}`;
    const callbackUrl = `${siteUrl}/api/qiospay-webhook`;

    // Request pembuatan invoice QRIS Dinamis ke API Qiospay v1
    const qiospayRes = await fetch('https://my.qiospay.com/v1/invoices', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
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

    if (!qiospayRes.ok || result.status === 'error') {
      console.error('Qiospay error:', result);
      return res.status(500).json({ error: result.message || 'Gagal membuat invoice QRIS di Qiospay.' });
    }

    const resData = result.data || result;
    const finalAmount = resData.total_amount || resData.amount || amount;
    const qrImageUrl = resData.qr_image_url || null;
    const qrisContent = resData.qris_content || null;
    const payUrl = resData.pay_url || null;

    // Simpan status transaksi PENDING ke Supabase
    await fetch(`${supabaseUrl}/rest/v1/transactions`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        order_id: orderId,
        team_id: parseInt(team_id, 10),
        voter_name: voter_name,
        votes_count: parseInt(votes_count, 10),
        amount: finalAmount,
        status: 'PENDING',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      })
    });

    return res.status(200).json({
      status: 'success',
      order_id: orderId,
      amount: finalAmount,
      qr_image_url: qrImageUrl,
      qris_content: qrisContent,
      pay_url: payUrl,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });

  } catch (error) {
    console.error('Error create-payment:', error);
    return res.status(500).json({ error: error.message || 'Terjadi kesalahan server.' });
  }
};
