# CS2 Arbitrage Hub

#### Video Demo: <URL HERE>

#### Description:

CS2 Arbitrage Hub is a web-based tool for tracking cross-platform arbitrage opportunities in the Counter-Strike 2 (CS2) skin market. Skins are often priced differently on Steam's Community Market and CSFloat, meaning buying low on one platform and selling high on the other can yield a profit. This app helps traders keep track of these trades, visualize expected profits, and manage wallet balances across both platforms in a single dashboard.

I built this as my CS50x final project to combine what I've learned: working with APIs, managing data in a database, building responsive front-ends, and designing for performance and user experience.

## How It Works

The main dashboard shows your current capital in play, expected profit/loss on active trades, realized profit/loss from completed trades, and your Steam and CSFloat wallet balances.

To add a new trade, search for an item name. The app queries the Steam Market in real-time (debounced to avoid rate-limiting) and shows autocomplete results. When you select an item, it fetches the lowest prices from Steam and CSFloat (CSFloat requires an API key) to prepopulate buy and sell fields based on your chosen trade direction (Steam → Float or Float → Steam).

A live preview panel shows estimated net revenue after platform fees (Steam takes ~15%, CSFloat takes 2%) and calculates your potential profit margin.

Once added, the trade appears in the "Items in the Cycle" table, which tracks Steam's standard 7-day trade ban. When the ban expires, the item is marked as "Ready ✓". Identical trades are grouped together automatically to keep the table clean.

When you finally sell the item, a modal asks for the actual sale price, calculates the realized profit, and moves it to your "Trade History". It also automatically credits your chosen wallet balance.

You can also use the watchlist feature to save interesting spreads for later monitoring. 

## Technical Highlights

- **React + Vite:** The entire frontend is a fast, responsive single-page application built with React and Vite. Keeping the logic inside a single `App.jsx` component made state management simpler for a project of this scale.
- **Supabase (PostgreSQL):** Used as a backend-as-a-service to handle database operations for trades, user balances, and price caching without needing a dedicated server.
- **Price Caching:** To avoid strict Steam API rate limits and IP bans, a Supabase table acts as a 15-minute cache layer. If a price was checked recently, the app reuses it instead of pinging Steam again.
- **API Proxying:** Direct browser requests to Steam and CSFloat are blocked by CORS. The app uses Vite's built-in proxy during development and Vercel's rewrite rules in production to route requests safely.

## Files

- `src/App.jsx` — Core React component containing all state, logic, grouping, and UI.
- `src/App.css` — Component styles, layouts, and responsive media queries.
- `src/index.css` — Global typography, colors, and theme variables.
- `src/supabase.js` — Supabase client setup.
- `sql files/*.sql` — Database schema definitions for trades, settings, and cache tables.
- `vite.config.js` / `vercel.json` — Dev and production API proxy configs.
