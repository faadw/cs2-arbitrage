// Vercel serverless function — proxies Steam Market search so we avoid CORS issues
// and can set a browser-like User-Agent to get past Steam's bot protection.

export default async function handler(req, res) {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Missing query parameter' });

    const url = `https://steamcommunity.com/market/search/render/?query=${encodeURIComponent(query)}&start=0&count=5&search_descriptions=0&sort_column=popular&sort_dir=desc&appid=730&norender=1`;

    try {
        const response = await fetch(url, {
            headers: {
                // Pretend to be a regular browser — Steam blocks plain server requests
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://steamcommunity.com/market/',
            },
        });

        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        console.error('Steam search proxy error:', err);
        res.status(500).json({ error: 'Failed to fetch from Steam' });
    }
}
