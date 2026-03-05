// Vercel serverless function — proxies Steam Market price lookup.

export default async function handler(req, res) {
    const { hash_name } = req.query;
    if (!hash_name) return res.status(400).json({ error: 'Missing hash_name parameter' });

    const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(hash_name)}`;

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://steamcommunity.com/market/',
            },
        });

        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        console.error('Steam price proxy error:', err);
        res.status(500).json({ error: 'Failed to fetch from Steam' });
    }
}
