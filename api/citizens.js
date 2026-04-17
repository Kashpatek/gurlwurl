export default async function handler(req, res) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'Redis not configured' });

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const redis = async (cmd) => {
    const r = await fetch(`${url}`, { method: 'POST', headers, body: JSON.stringify(cmd) });
    return r.json();
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auto-seed founders on first use
  const seeded = await redis(['GET', 'gw_seeded']);
  if (!seeded.result) {
    const neha = { name: 'Neha', emoji: '🦋', number: 1, status: '👸', title: 'Supreme Visionary', created: new Date().toISOString() };
    const akash = { name: 'Akash', emoji: '🪩', number: 2, status: '🫡', title: 'Chief Architect', created: new Date().toISOString() };
    await redis(['SET', 'citizen:neha', JSON.stringify(neha)]);
    await redis(['SET', 'citizen:akash', JSON.stringify(akash)]);
    await redis(['SET', 'citizen_count', '2']);
    await redis(['RPUSH', 'citizens_list', JSON.stringify(neha)]);
    await redis(['RPUSH', 'citizens_list', JSON.stringify(akash)]);
    await redis(['SET', 'gw_seeded', '1']);
  }

  const { action, name, emoji, data, key } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

  try {
    // Register new citizen
    if (action === 'register') {
      if (!name || !emoji) return res.status(400).json({ error: 'Name and emoji required' });
      const id = name.toLowerCase().trim();
      const existing = await redis(['GET', `citizen:${id}`]);
      if (existing.result) return res.status(409).json({ error: 'Name taken' });
      const num = await redis(['INCR', 'citizen_count']);
      const citizen = { name: name.trim(), emoji, number: num.result, status: '👩', title: 'Certified Citizen', created: new Date().toISOString() };
      await redis(['SET', `citizen:${id}`, JSON.stringify(citizen)]);
      await redis(['LPUSH', 'citizens_list', JSON.stringify(citizen)]);
      return res.json({ ok: true, citizen });
    }

    // Login (verify name + emoji)
    if (action === 'login') {
      const id = (name || '').toLowerCase().trim();
      const r = await redis(['GET', `citizen:${id}`]);
      if (!r.result) return res.status(404).json({ error: 'Citizen not found' });
      const c = JSON.parse(r.result);
      if (c.emoji !== emoji) return res.status(401).json({ error: 'Wrong passcode' });
      return res.json({ ok: true, citizen: c });
    }

    // Get all citizens (returns status emoji, NOT password emoji)
    if (action === 'citizens') {
      const r = await redis(['LRANGE', 'citizens_list', 0, 99]);
      const citizens = (r.result || []).map(s => {
        const c = JSON.parse(s);
        return { name: c.name, number: c.number, status: c.status || '👩', title: c.title || 'Certified Citizen' };
      });
      return res.json({ ok: true, citizens });
    }

    // Save user data
    if (action === 'save') {
      const id = (name || '').toLowerCase().trim();
      if (!id || !key) return res.status(400).json({ error: 'Name and key required' });
      await redis(['SET', `data:${id}:${key}`, JSON.stringify(data)]);
      return res.json({ ok: true });
    }

    // Load user data
    if (action === 'load') {
      const id = (name || '').toLowerCase().trim();
      if (!id || !key) return res.status(400).json({ error: 'Name and key required' });
      const r = await redis(['GET', `data:${id}:${key}`]);
      return res.json({ ok: true, data: r.result ? JSON.parse(r.result) : null });
    }

    // Load all user data keys
    if (action === 'loadall') {
      const id = (name || '').toLowerCase().trim();
      const keys = ['grat', 'ratings', 'bucket', 'shop', 'skincare', 'countdown', 'xp', 'xp_log', 'spend_log', 'achievements', 'games_played', 'flappy_best', 'wheel', 'stamps', 'diary', 'dreams', 'vision', 'sleep', 'highlights', 'symptoms', 'cycle', 'custom_recipes', 'theme', 'streak'];
      const result = {};
      for (const k of keys) {
        const r = await redis(['GET', `data:${id}:${k}`]);
        if (r.result) {
          try { result[k] = JSON.parse(r.result); } catch (e) { result[k] = r.result; }
        }
      }
      // Also load today's habits, water, mood, energy
      const today = new Date().toDateString();
      const habR = await redis(['GET', `data:${id}:habits_${today}`]);
      if (habR.result) result['habits_today'] = JSON.parse(habR.result);
      const watR = await redis(['GET', `data:${id}:water_${today}`]);
      if (watR.result) result['water_today'] = JSON.parse(watR.result);
      const moodR = await redis(['GET', `data:${id}:mood_${today}`]);
      if (moodR.result) { try { result['mood_today'] = JSON.parse(moodR.result); } catch (e) { result['mood_today'] = moodR.result; } }
      const enR = await redis(['GET', `data:${id}:energy_${today}`]);
      if (enR.result) { try { result['energy_today'] = JSON.parse(enR.result); } catch (e) { result['energy_today'] = enR.result; } }
      return res.json({ ok: true, data: result });
    }

    // Update password (emoji)
    if (action === 'update_password') {
      const id = (name || '').toLowerCase().trim();
      if (!id || !emoji) return res.status(400).json({ error: 'Name and new emoji required' });
      const r = await redis(['GET', `citizen:${id}`]);
      if (!r.result) return res.status(404).json({ error: 'Citizen not found' });
      const c = JSON.parse(r.result);
      c.emoji = emoji;
      await redis(['SET', `citizen:${id}`, JSON.stringify(c)]);
      return res.json({ ok: true });
    }

    // Change password
    if (action === 'changepassword') {
      const id = (name || '').toLowerCase().trim();
      const { oldEmoji, newEmoji } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (!id || !oldEmoji || !newEmoji) return res.status(400).json({ error: 'Missing fields' });
      const r = await redis(['GET', `citizen:${id}`]);
      if (!r.result) return res.status(404).json({ error: 'Citizen not found' });
      const c = JSON.parse(r.result);
      if (c.emoji !== oldEmoji) return res.status(401).json({ error: 'Wrong current passcode' });
      c.emoji = newEmoji;
      await redis(['SET', `citizen:${id}`, JSON.stringify(c)]);
      return res.json({ ok: true, citizen: c });
    }

    // Save ALL user data at once (bulk sync)
    if (action === 'syncall') {
      const id = (name || '').toLowerCase().trim();
      if (!id || !data) return res.status(400).json({ error: 'Name and data required' });
      for (const [k, v] of Object.entries(data)) {
        await redis(['SET', `data:${id}:${k}`, JSON.stringify(v)]);
      }
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
