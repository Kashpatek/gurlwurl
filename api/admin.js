export default async function handler(req, res) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'Redis not configured' });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const redis = async (cmd) => { const r = await fetch(`${url}`, { method: 'POST', headers, body: JSON.stringify(cmd) }); return r.json(); };
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { action } = body;
  try {
    if (action === 'reset_password') {
      const id = (body.target || '').toLowerCase().trim();
      const raw = await redis(['GET', `citizen:${id}`]);
      if (!raw.result) return res.json({ ok: false, error: 'Not found' });
      const c = JSON.parse(raw.result); c.emoji = body.newEmoji;
      await redis(['SET', `citizen:${id}`, JSON.stringify(c)]);
      return res.json({ ok: true, message: `Password reset for ${body.target}` });
    }
    if (action === 'award_xp') {
      const id = (body.target || '').toLowerCase().trim();
      const raw = await redis(['GET', `data:${id}:gw_xp`]);
      const cur = parseInt(raw.result ? JSON.parse(raw.result) : '0') || 0;
      await redis(['SET', `data:${id}:gw_xp`, JSON.stringify(String(cur + (body.amount||0)))]);
      return res.json({ ok: true, message: `Awarded ${body.amount} XP to ${body.target}` });
    }
    if (action === 'announce') {
      await redis(['SET', 'gw_announcement', JSON.stringify({ text: body.message, date: new Date().toISOString() })]);
      return res.json({ ok: true });
    }
    const citizensList = await redis(['LRANGE', 'citizens_list', '0', '-1']);
    const citizens = (citizensList.result || []).map(c => typeof c === 'string' ? JSON.parse(c) : c);
    const ann = await redis(['GET', 'gw_announcement']);
    const now = new Date(); const todayStr = now.toLocaleDateString('en-US'); const weekAgo = new Date(now - 7*864e5);
    const stats = { totalCitizens: citizens.length, citizens: [], totals: { xp:0,diary:0,dreams:0,grat:0,vision:0,sleep:0,highlights:0,symptoms:0,periods:0,bucket:0,recipes:0 }, activeToday:0, activeWeek:0, churned:[], gameStats:{}, themeStats:{}, peakHours:new Array(24).fill(0), topFeatures:{}, announcement: ann.result ? JSON.parse(ann.result) : null };
    for (const c of citizens) {
      const id = (c.name||'').toLowerCase().trim(); if (!id) continue;
      const keys = ['gw_xp','gw_xp_log','gw_achievements','gw_streak','gw_diary','gw_dreams','gw_grat','gw_vision','gw_sleep','gw_highlights','gw_symptoms','gw_cycle','gw_bucket','gw_custom_recipes','gw_theme','gw_games_played'];
      const ud = {};
      for (const k of keys) { const v = await redis(['GET',`data:${id}:${k}`]); if(v.result){try{ud[k]=JSON.parse(v.result)}catch(e){ud[k]=v.result}} }
      const xp=parseInt(ud.gw_xp)||0, streak=ud.gw_streak||{count:0,last:''}, achs=Array.isArray(ud.gw_achievements)?ud.gw_achievements:[], xpLog=Array.isArray(ud.gw_xp_log)?ud.gw_xp_log:[];
      const diary=Array.isArray(ud.gw_diary)?ud.gw_diary:[], dreams=Array.isArray(ud.gw_dreams)?ud.gw_dreams:[], grat=Array.isArray(ud.gw_grat)?ud.gw_grat:[];
      const vision=Array.isArray(ud.gw_vision)?ud.gw_vision:[], sleep=Array.isArray(ud.gw_sleep)?ud.gw_sleep:[], highlights=Array.isArray(ud.gw_highlights)?ud.gw_highlights:[];
      const symptoms=Array.isArray(ud.gw_symptoms)?ud.gw_symptoms:[], cycle=ud.gw_cycle||{periods:[]}, bucket=Array.isArray(ud.gw_bucket)?ud.gw_bucket:[];
      const customRecipes=Array.isArray(ud.gw_custom_recipes)?ud.gw_custom_recipes:[], theme=ud.gw_theme||'default', gamesPlayed=ud.gw_games_played||{};
      const lastAct = xpLog.length ? xpLog[xpLog.length-1].date : c.created||'unknown';
      const sLast = typeof streak==='object'?streak.last:'';
      if(sLast===todayStr)stats.activeToday++;
      const ld=xpLog.length?new Date(xpLog[xpLog.length-1].date):null;
      if(ld&&ld>weekAgo)stats.activeWeek++; if(ld&&ld<weekAgo)stats.churned.push(c.name); if(!ld&&c.name!=='Neha'&&c.name!=='Akash')stats.churned.push(c.name);
      xpLog.forEach(e=>{try{const d=new Date(e.date);if(!isNaN(d))stats.peakHours[d.getHours()]++}catch(x){}});
      if(typeof gamesPlayed==='object')for(const[g,cnt]of Object.entries(gamesPlayed))stats.gameStats[g]=(stats.gameStats[g]||0)+(parseInt(cnt)||0);
      xpLog.forEach(e=>{const r=(e.reason||'').split(':')[0].trim();if(r)stats.topFeatures[r]=(stats.topFeatures[r]||0)+1});
      stats.themeStats[theme]=(stats.themeStats[theme]||0)+1;
      stats.citizens.push({ name:c.name, number:c.number, status:c.status||'👩', xp, streak:typeof streak==='object'?streak.count||0:0, achievements:achs.length, theme, lastActivity:lastAct, diary:diary.length, dreams:dreams.length, gratitude:grat.length, vision:vision.length, sleep:sleep.length, highlights:highlights.length, symptoms:symptoms.length, periods:Array.isArray(cycle.periods)?cycle.periods.length:0, bucket:bucket.length, customRecipes:customRecipes.length, gamesPlayed, recentXP:xpLog.slice(-5).reverse(), created:c.created||'unknown', totalActions:xpLog.length });
      stats.totals.xp+=xp; stats.totals.diary+=diary.length; stats.totals.dreams+=dreams.length; stats.totals.grat+=grat.length; stats.totals.vision+=vision.length; stats.totals.sleep+=sleep.length; stats.totals.highlights+=highlights.length; stats.totals.symptoms+=symptoms.length; stats.totals.periods+=Array.isArray(cycle.periods)?cycle.periods.length:0; stats.totals.bucket+=bucket.length; stats.totals.recipes+=customRecipes.length;
    }
    stats.citizens.sort((a,b)=>b.xp-a.xp);
    stats.topFeatures=Object.entries(stats.topFeatures).sort((a,b)=>b[1]-a[1]).slice(0,15).reduce((o,[k,v])=>{o[k]=v;return o},{});
    stats.gameStats=Object.entries(stats.gameStats).sort((a,b)=>b[1]-a[1]).reduce((o,[k,v])=>{o[k]=v;return o},{});
    return res.json({ ok:true, ...stats });
  } catch(e) { return res.status(500).json({ ok:false, error:e.message }); }
}
