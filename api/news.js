export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  try {
    const feeds = [
      'https://feeds.npr.org/1065/rss.xml',
      'https://www.theguardian.com/world/women/rss',
      'https://feeds.bbci.co.uk/news/world/rss.xml',
    ];
    
    const articles = [];
    
    for (const feed of feeds) {
      try {
        const r = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}&count=10`);
        const data = await r.json();
        if (data.status === 'ok' && data.items) {
          data.items.forEach(item => {
            articles.push({
              title: item.title,
              url: item.link,
              source: data.feed?.title || 'News',
              date: item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today',
              image: item.thumbnail || item.enclosure?.link || null,
              desc: item.description ? item.description.replace(/<[^>]*>/g, '').slice(0, 120) : ''
            });
          });
        }
      } catch (e) { /* skip failed feed */ }
    }

    if (!articles.length) {
      return res.json({ ok: false, error: 'No articles found' });
    }

    const seen = new Set();
    const unique = articles.filter(a => {
      if (seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    }).slice(0, 20);

    return res.json({ ok: true, articles: unique });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
