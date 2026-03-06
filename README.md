# CS2 Arbitrage Hub
#### Video Demo: [Click for YouTube Video!](https://www.youtube.com/watch?v=CRae_stvV1Y)
#### Description:

CS2 Arbitrage Hub is a comprehensive web-based application designed to track, calculate, and manage cross-platform arbitrage opportunities within the Counter-Strike 2 (CS2) skin market. In the highly volatile digital economy of CS2, in-game items (skins) frequently exhibit significant price discrepancies between the official Steam Community Market and third-party platforms like CSFloat. By capitalizing on these margins, buying low on one platform and selling high on the other, traders can generate a profit. 

However, manually managing this process using traditional spreadsheets is exhausting and prone to human error. Traders must constantly factor in fluctuating prices, calculate varying platform fees (a steep 15% on Steam versus a 2% fee on CSFloat), monitor capital tied up in active trades, and manually track Steam's mandatory 7-day trade hold on purchased items. CS2 Arbitrage Hub solves this by providing a unified, automated dashboard that visualizes expected profits, manages wallet balances across multiple platforms, and tracks item lifecycles from purchase to final sale.

## How It Works

The core of the application revolves around a central dashboard that provides a bird's-eye view of the user's financial standing. It dynamically displays the total capital currently in play, the expected profit or loss on active trades, the realized net revenue from completed trades, and the live balances of both the user's Steam and CSFloat simulated wallets.

When a user wishes to log a new potential trade, they utilize the integrated search feature. The application queries the Steam Market in real-time. To prevent excessive API calls while typing, this search input is heavily debounced. Upon selecting a specific skin, the application fetches the lowest available listings from both Steam and CSFloat (the latter requiring an API key). The user selects their intended trade direction (e.g., buying on Steam to sell on CSFloat), and the app instantly prepopulates the buy and sell fields. 

A live preview panel calculates the net revenue. It automatically deducts the respective platform taxes and presents the precise profit margin. Once confirmed, the item enters the "Items in the Cycle" table. This section is crucial as it automatically groups identical purchases to maintain a clean user interface and begins counting down Steam's 7-day trade hold. Once the cooldown expires, the item's status updates to "Ready ✓", visually prompting the user that it can be moved to the next platform.

Finally, when the user completes the sale, a modal prompts them to input the actual realized sale price. The application calculates the final profit, archives the transaction into the "Trade History" log, and seamlessly credits the corresponding wallet balance. A secondary watchlist feature also allows users to bookmark interesting spreads without committing capital.

## Design Choices

During the development of CS2 Arbitrage Hub, several distinct design and architectural choices were made to ensure performance, realism, and a smooth user experience:

**Realistic Portfolio Tracking (Allowing Losses):** Initially, one might assume an arbitrage calculator should only accept entries that yield a positive margin. However, real-world trading is rarely perfect. Markets crash, and sometimes a trader must sell an item at a slight loss to liquidate assets and free up capital for better opportunities. The system was deliberately designed to allow the tracking and logging of trades that result in small losses. This ensures the dashboard acts as a realistic portfolio manager reflecting actual financial health, rather than just an idealized, profit-only calculator.

**The 15-Minute Cache Layer:** One of the biggest hurdles in interacting with the Steam Market is its aggressively strict API rate limiting, which often results in temporary IP bans. To circumvent this without sacrificing data accuracy, a 15-minute cache layer was implemented using a Supabase database table. When a price is requested, the system first checks the cache. If the data is less than 15 minutes old, it serves the cached price instantly. This specific timeframe was chosen as the optimal sweet spot: it is short enough to reflect accurate market trends, yet long enough to drastically reduce the number of outgoing HTTP requests to Steam's servers.

**Single-Page Architecture vs. Complex State Management:** For the frontend, the entire application is built as a Single-Page Application (SPA) using React and Vite. While it was tempting to implement a robust state management library like Redux, I opted to handle the core logic and state within a primary `App.jsx` component. For a project of this specific scale, React's native `useState` and `useEffect` hooks provided more than enough capability to manage the data flow between the search bar, the active inventory table, and the wallet dashboard. Adding Redux would have introduced unnecessary boilerplate and over-engineered a solution that needed to remain lightweight and fast.

## Files

- `src/App.jsx`: The heart of the application. This core React component houses the primary state management, the logic for grouping identical items, the countdown timers for trade holds, and the main user interface rendering.
- `src/App.css`: Contains all the component-specific styles, layout properties (Flexbox/Grid), and responsive media queries to ensure the dashboard looks clean on various screen sizes.
- `src/index.css`: Defines the global design system, including typography choices, background colors, and theme variables used throughout the application.
- `src/supabase.js`: The configuration file that initializes the Supabase client, securely connecting the frontend to the PostgreSQL backend using environment variables.
- `sql files/*.sql`: A collection of raw SQL scripts used to define the database schema. This includes the structure for the user's trade history, the wallet balances table, and the architecture for the custom caching system.
- `vite.config.js` / `vercel.json`: Configuration files crucial for deployment and API proxying. Direct browser requests to external APIs are often blocked by CORS policies. These files establish the proxy routing rules to safely fetch data during both local development (Vite) and production deployment (Vercel).
