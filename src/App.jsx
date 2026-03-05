import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import AuthScreen from './AuthScreen';
import './App.css';

const STEAM_REVENUE_RATE = 0.85;
const CSFLOAT_REVENUE_RATE = 0.98;

function App() {
  const [trades, setTrades] = useState([]);

  // user auth status
  const [user, setUser] = useState(undefined); // undefined means it's loading

  // check auth initially and listen to changes
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user ?? null));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // form inputs
  const [itemName, setItemName] = useState('');
  const [direction, setDirection] = useState('SteamToFloat');
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [quantity, setQuantity] = useState(1);

  // popup states
  const [modalData, setModalData] = useState({ isOpen: false, type: '', group: null, inputVal: '', actualPriceVal: '' });

  // load watchlist from local storage so it persists
  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem('cs2_watchlist');
    return saved ? JSON.parse(saved) : [];
  });

  // platform balances
  const [balance, setBalance] = useState({ steam: 0, csfloat: 0 });
  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [balanceInput, setBalanceInput] = useState({ steam: '', csfloat: '' });

  // search dropdown stuff
  const [searchResults, setSearchResults] = useState([]);
  const [searchActive, setSearchActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const searchTimer = useRef(null);

  // fetch stuff when user logs in
  useEffect(() => {
    if (user) {
      fetchTrades();
      fetchBalance();
    } else {
      // reset lists on logout so data doesn't leak
      setTrades([]);
      setBalance({ steam: 0, csfloat: 0 });
    }
  }, [user]);

  // storing current prices locally so we don't hit apis too hard
  const [livePrices, setLivePrices] = useState({});

  // load up recent prices from the db
  // called shortly after sync and then every 5 mins
  async function fetchLivePrices(currentTrades) {
    const activeItems = [...new Set(
      currentTrades.filter(t => t.status === 'active').map(t => t.item_name)
    )];
    if (activeItems.length === 0) return;

    console.log('[LivePrice] Looking up cache for:', activeItems);

    const { data, error } = await supabase
      .from('price_cache')
      .select('hash_name, steam_price, float_price, updated_at')
      .in('hash_name', activeItems);

    console.log('[LivePrice] Cache result:', { data, error });

    if (error) { console.error('Error fetching live prices:', error); return; }

    const map = {};
    data.forEach(row => { map[row.hash_name] = row; });
    console.log('[LivePrice] Map built:', map);
    setLivePrices(map);
  }

  // instantly refresh prices on trade update
  useEffect(() => {
    if (trades.length > 0) fetchLivePrices(trades);
  }, [trades]);

  // auto ping prices so they stay fresh
  useEffect(() => {
    const interval = setInterval(() => {
      if (trades.length > 0) fetchLivePrices(trades);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [trades]);

  // save watchlist changes locally
  useEffect(() => {
    localStorage.setItem('cs2_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  // save balance records per user
  async function saveBalance(newBalance) {
    if (!user) return;
    await supabase
      .from('user_settings')
      .upsert({
        id: user.id,
        steam_balance: newBalance.steam,
        csfloat_balance: newBalance.csfloat,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
  }

  async function fetchTrades() {
    if (!user) return;
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) console.error("Error fetching trades:", error);
    else setTrades(data);
  }

  async function fetchBalance() {
    if (!user) return;
    const { data, error } = await supabase
      .from('user_settings')
      .select('steam_balance, csfloat_balance')
      .eq('id', user.id)
      .single();

    if (data) {
      setBalance({ steam: Number(data.steam_balance), csfloat: Number(data.csfloat_balance) });
    } else if (error && error.code !== 'PGRST116') {
      console.error("Error fetching balance:", error);
    }
  }

  // search autocomplete stuff
  const handleSearchChange = (e) => {
    const text = e.target.value;
    setItemName(text);

    if (searchTimer.current) clearTimeout(searchTimer.current);

    if (text.length < 3) {
      setSearchResults([]);
      setSearchActive(false);
      return;
    }

    setLoading(true);
    setSearchActive(true);

    // waiting 800ms before search to avoid steam bans
    searchTimer.current = setTimeout(async () => {
      try {
        const query = encodeURIComponent(text);
        const response = await fetch(`/api/steam-search?query=${query}`);

        if (!response.ok) throw new Error("Network request failed");
        const data = await response.json();

        if (data.success && data.results) {
          setSearchResults(data.results);
        } else {
          setSearchResults([]);
        }
      } catch (error) {
        console.error("Search error:", error);
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    }, 800);
  };

  const selectItem = async (item) => {
    setItemName(item.hash_name);
    setSearchActive(false);
    setSearchResults([]);

    setPriceLoading(true);
    try {
      const hashNameEncoded = encodeURIComponent(item.hash_name);

      let steamPrice = null;
      let floatPrice = null;

      // try to grab cached price first
      const { data: cacheData } = await supabase
        .from('price_cache')
        .select('*')
        .eq('hash_name', item.hash_name)
        .single();

      let needsApiCall = true;

      if (cacheData) {
        const updatedAt = new Date(cacheData.updated_at);
        const now = new Date();
        const minutesOld = (now - updatedAt) / 1000 / 60;

        // reuse recently cached prices to skip steam apis
        if (minutesOld < 15) {
          console.log("CACHE HIT", item.hash_name, minutesOld.toFixed(1) + " min old");
          steamPrice = typeof cacheData.steam_price === 'number' ? cacheData.steam_price : null;
          floatPrice = typeof cacheData.float_price === 'number' ? cacheData.float_price : null;
          needsApiCall = false;
        } else {
          console.log("CACHE STALE", item.hash_name, "hitting API...");
        }
      }

      // grabbing fresh prices from both markets at once
      if (needsApiCall) {
        await Promise.allSettled([
          // get steam price
          fetch(`/api/steam-price?hash_name=${hashNameEncoded}`)
            .then(res => res.json())
            .then(data => {
              if (data.success && data.lowest_price) {
                steamPrice = parseFloat(data.lowest_price.replace(/[^0-9.-]+/g, ""));
              }
            }).catch(err => console.error("Failed to fetch Steam price:", err)),

          // get float price (in cents, so div by 100)
          fetch(`/api/csfloat/api/v1/listings?market_hash_name=${hashNameEncoded}&sort_by=lowest_price&limit=1`)
            .then(res => res.json())
            .then(data => {
              if (data && data.length > 0 && data[0].price) {
                floatPrice = data[0].price / 100;
              }
            }).catch(err => console.error("Failed to fetch CSFloat price:", err))
        ]);

        // save the new numbers so we don't bother the APIs again
        if (steamPrice || floatPrice) {
          await supabase
            .from('price_cache')
            .upsert({
              hash_name: item.hash_name,
              steam_price: steamPrice,
              float_price: floatPrice,
              updated_at: new Date().toISOString()
            }, { onConflict: 'hash_name' });

          console.log("CACHE UPDATED", item.hash_name);
        }
      }

      // prefill prices based on user's selected path
      if (direction === 'SteamToFloat') {
        if (steamPrice) setBuyPrice(steamPrice);
        if (floatPrice) setSellPrice(floatPrice);
      } else if (direction === 'FloatToSteam') {
        if (floatPrice) setBuyPrice(floatPrice);
        if (steamPrice) setSellPrice(steamPrice);
      }
    } catch (error) {
      console.error("Price fetch error:", error);
    } finally {
      setPriceLoading(false);
    }
  };

  // realtime profit logic
  const buy = parseFloat(buyPrice);
  const sell = parseFloat(sellPrice);
  const isBuyValid = !isNaN(buy) && buy > 0;  // saving only requires a buy price
  const isSellValid = isBuyValid && !isNaN(sell) && sell > 0;

  let netRevenue = 0;
  if (isSellValid) {
    netRevenue = direction === 'SteamToFloat' ? sell * CSFLOAT_REVENUE_RATE : sell * STEAM_REVENUE_RATE;
  }
  const liveProfit = isSellValid ? netRevenue - buy : 0;
  const liveROI = isSellValid ? (liveProfit / buy) * 100 : 0;

  // stats logic
  const activeTrades = trades.filter(t => t.status === 'active');
  const soldTrades = trades.filter(t => t.status === 'sold');

  const capitalInPlay = activeTrades.reduce((sum, t) => sum + Number(t.buy_price), 0);
  const expectedProfit = activeTrades.reduce((sum, t) => sum + Number(t.expected_profit), 0);
  const realizedProfit = soldTrades.reduce((sum, t) => sum + Number(t.expected_profit), 0);

  // stack identical trades together
  const groupedActiveTrades = [];
  activeTrades.forEach(trade => {
    const existing = groupedActiveTrades.find(g =>
      g.item_name === trade.item_name &&
      g.buy_price === trade.buy_price &&
      g.target_sell_price === trade.target_sell_price &&
      g.trade_direction === trade.trade_direction &&
      g.ban_end_date === trade.ban_end_date
    );

    if (existing) {
      existing.qty += 1;
      existing.ids.push(trade.id);
      existing.total_expected_profit += Number(trade.expected_profit);
    } else {
      groupedActiveTrades.push({
        ...trade,
        qty: 1,
        ids: [trade.id],
        total_expected_profit: Number(trade.expected_profit)
      });
    }
  });

  // stack sold trades
  const groupedSoldTrades = [];
  soldTrades.forEach(trade => {
    const existing = groupedSoldTrades.find(g =>
      g.item_name === trade.item_name &&
      g.buy_price === trade.buy_price &&
      g.target_sell_price === trade.target_sell_price &&
      g.trade_direction === trade.trade_direction
    );
    if (existing) {
      existing.qty += 1;
      existing.ids.push(trade.id);
      existing.total_profit += Number(trade.expected_profit);
    } else {
      groupedSoldTrades.push({
        ...trade,
        qty: 1,
        ids: [trade.id],
        total_profit: Number(trade.expected_profit)
      });
    }
  });

  // db operations
  async function saveTrade() {
    const buyVal = parseFloat(buyPrice);
    if (!buyPrice || isNaN(buyVal) || buyVal <= 0) return alert("Please enter a valid buy price.");

    const banEnd = new Date();
    banEnd.setDate(banEnd.getDate() + 7);

    const qty = parseInt(quantity) || 1;

    // if they left sell empty, put buy price. they can fix it when selling.
    const sellVal = (sellPrice && parseFloat(sellPrice) > 0) ? parseFloat(sellPrice) : buyVal;
    const feeRate = direction === 'SteamToFloat' ? CSFLOAT_REVENUE_RATE : STEAM_REVENUE_RATE;
    const calculatedProfit = (sellVal * feeRate) - buyVal;
    const calculatedROI = (calculatedProfit / buyVal) * 100;

    const newTrades = [];

    // split multiple quantities into single records
    for (let i = 0; i < qty; i++) {
      newTrades.push({
        user_id: user.id,
        item_name: itemName || 'Unknown Item',
        trade_direction: direction,
        buy_price: buyVal,
        target_sell_price: sellVal,
        expected_profit: calculatedProfit,
        profit_margin: calculatedROI,
        ban_end_date: banEnd.toISOString(),
        status: 'active'
      });
    }

    // slap em all in the db at once
    const { error } = await supabase.from('trades').insert(newTrades);

    if (!error) {
      // remove spent cash from balance
      const totalSpent = buyVal * qty;
      const newBalance = { ...balance };
      if (direction === 'SteamToFloat') {
        newBalance.steam = Math.max(0, balance.steam - totalSpent);
      } else {
        newBalance.csfloat = Math.max(0, balance.csfloat - totalSpent);
      }
      setBalance(newBalance);
      saveBalance(newBalance);
      setItemName(''); setBuyPrice(''); setSellPrice(''); setQuantity(1);
      fetchTrades();
    }
  }

  // watchlist handling
  function addToWatchlist() {
    if (!itemName || (!buyPrice && !sellPrice)) {
      alert("Please enter an item name and at least one reference price.");
      return;
    }

    if (watchlist.some(w => w.item_name === itemName)) {
      alert("This item is already on your watchlist.");
      return;
    }

    const newEntry = {
      item_name: itemName,
      buy_price: buy || 0,
      target_sell_price: sell || 0,
      added_at: new Date().toISOString()
    };

    setWatchlist([...watchlist, newEntry]);
    setItemName(''); setBuyPrice(''); setSellPrice(''); setQuantity(1);
  }

  function removeFromWatchlist(nameToRemove) {
    setWatchlist(watchlist.filter(w => w.item_name !== nameToRemove));
  }

  function loadWatchlistItem(item) {
    // drop item in the form and reload price
    setItemName(item.item_name);
    setSearchActive(false);
    setPriceLoading(true);
    selectItem({ hash_name: item.item_name }); // spoof the select via name
  }

  async function markAsSoldGroup(ids, countToSell, actualSalePrice) {
    if (countToSell <= 0 || countToSell > ids.length) return;

    const idsToSell = ids.slice(0, countToSell);

    // read just one item block because the group shares the same price
    // saves pulling everyone
    const { data: sample } = await supabase.from('trades').select('*').eq('id', ids[0]).single();
    if (!sample) return;

    const buyAmt = Number(sample.buy_price);
    const dir = sample.trade_direction;
    const salePrice = Number(actualSalePrice);

    let net = 0;
    if (dir === 'SteamToFloat') {
      net = salePrice * CSFLOAT_REVENUE_RATE;
    } else {
      net = salePrice * STEAM_REVENUE_RATE;
    }
    const newProfit = net - buyAmt;
    const newROI = (newProfit / buyAmt) * 100;

    const { error } = await supabase
      .from('trades')
      .update({
        status: 'sold',
        target_sell_price: salePrice,
        expected_profit: newProfit,
        profit_margin: newROI
      })
      .in('id', idsToSell);

    if (!error) {
      // refund the cash back to the stash
      const totalNet = net * countToSell;
      const newBalance = { ...balance };
      if (dir === 'SteamToFloat') {
        // profit moved to csfloat
        newBalance.csfloat = balance.csfloat + totalNet;
      } else {
        // profit moved to steam
        newBalance.steam = balance.steam + totalNet;
      }
      setBalance(newBalance);
      saveBalance(newBalance);
      fetchTrades();
    }
  }

  const handleSellClick = (group) => {
    // force open modal to get the real sale tag
    setModalData({ isOpen: true, type: 'sell', group, inputVal: '1', actualPriceVal: String(group.target_sell_price) });
  }

  // undo a sale
  async function restoreTradeGroup(ids, count) {
    const idsSlice = ids.slice(0, count);
    const { error } = await supabase
      .from('trades')
      .update({ status: 'active' })
      .in('id', idsSlice);

    if (!error) fetchTrades();
  }

  async function executeDelete(ids, countToDelete) {
    if (countToDelete <= 0 || countToDelete > ids.length) return;

    const idsToDelete = ids.slice(0, countToDelete);

    const { error } = await supabase.from('trades').delete().in('id', idsToDelete);
    if (!error) fetchTrades();
  }

  const handleModalConfirm = () => {
    if (modalData.type === 'sell') {
      const countInt = parseInt(modalData.inputVal);
      const actualPrice = parseFloat(modalData.actualPriceVal);

      if (isNaN(countInt) || countInt <= 0 || countInt > modalData.group.qty) {
        alert('Invalid quantity.');
        return;
      }

      if (isNaN(actualPrice) || actualPrice <= 0) {
        alert('Please enter a valid sale price.');
        return;
      }

      markAsSoldGroup(modalData.group.ids, countInt, actualPrice);
    } else if (modalData.type === 'delete') {
      const countInt = parseInt(modalData.inputVal);
      if (!isNaN(countInt) && countInt > 0 && countInt <= modalData.group.qty) {
        executeDelete(modalData.group.ids, countInt);
      } else {
        alert('Invalid quantity.');
        return;
      }
    } else if (modalData.type === 'restore') {
      const countInt = parseInt(modalData.inputVal);
      if (!isNaN(countInt) && countInt > 0 && countInt <= modalData.group.qty) {
        restoreTradeGroup(modalData.group.ids, countInt);
      } else {
        alert('Invalid quantity.');
        return;
      }
    } else if (modalData.type === 'history-delete') {
      const countInt = parseInt(modalData.inputVal);
      if (!isNaN(countInt) && countInt > 0 && countInt <= modalData.group.qty) {
        executeDelete(modalData.group.ids, countInt);
      } else {
        alert('Invalid quantity.');
        return;
      }
    }
    setModalData({ isOpen: false, type: '', group: null, inputVal: '', actualPriceVal: '' });
  }



  // block ui while loading auth
  if (user === undefined) return null;

  // force login state
  if (user === null) return <AuthScreen />;

  return (
    <div className="app-container">
      <div className="app-header-nav">
        <h1 className="header-title" style={{ margin: 0 }}>CS2 Arbitrage Hub</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{user.email || user.user_metadata?.full_name}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '4px 12px', transition: 'all 0.2s' }}
            onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--accent-red)'; e.currentTarget.style.color = 'var(--accent-red)'; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            Log Out
          </button>
        </div>
      </div>

      {/* dashboard cards */}
      <div className="dashboard-stats-grid">
        <div className="premium-card" style={{ borderTop: '3px solid var(--accent-blue)' }}>
          <h3 className="text-muted" style={{ margin: '0 0 10px 0', fontSize: '1rem', fontWeight: 500 }}>Capital In Play</h3>
          <h2 style={{ margin: 0, color: 'var(--accent-blue)', fontSize: '2rem' }}>${capitalInPlay.toFixed(2)}</h2>
        </div>
        <div className="premium-card" style={{ borderTop: '3px solid var(--accent-warning)' }}>
          <h3 className="text-muted" style={{ margin: '0 0 10px 0', fontSize: '1rem', fontWeight: 500 }}>Expected P&L (Active)</h3>
          <h2 style={{ margin: 0, color: expectedProfit >= 0 ? 'var(--accent-warning)' : 'var(--accent-red)', fontSize: '2rem' }}>
            ${expectedProfit.toFixed(2)}
          </h2>
        </div>
        <div className="premium-card" style={{ borderTop: '3px solid var(--accent-green)' }}>
          <h3 className="text-muted" style={{ margin: '0 0 10px 0', fontSize: '1rem', fontWeight: 500 }}>Realized P&L</h3>
          <h2 style={{ margin: 0, color: realizedProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: '2rem' }}>
            ${realizedProfit.toFixed(2)}
          </h2>
        </div>
        {/* Steam Balance Card */}
        <div className="premium-card" style={{ borderTop: '3px solid #77a9ff', cursor: 'default' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <h3 className="text-muted" style={{ margin: '0 0 10px 0', fontSize: '1rem', fontWeight: 500 }}>Steam Balance</h3>
            <button onClick={() => { setBalanceInput({ steam: String(balance.steam), csfloat: String(balance.csfloat) }); setBalanceModalOpen(true); }} style={{ background: 'transparent', border: '1px solid var(--border-light)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '3px 8px' }}>Edit</button>
          </div>
          <h2 style={{ margin: 0, color: '#77a9ff', fontSize: '2rem' }}>${Number(balance.steam).toFixed(2)}</h2>
        </div>
        {/* CSFloat Balance Card */}
        <div className="premium-card" style={{ borderTop: '3px solid var(--accent-green)', cursor: 'default' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <h3 className="text-muted" style={{ margin: '0 0 10px 0', fontSize: '1rem', fontWeight: 500 }}>CSFloat Balance</h3>
            <button onClick={() => { setBalanceInput({ steam: String(balance.steam), csfloat: String(balance.csfloat) }); setBalanceModalOpen(true); }} style={{ background: 'transparent', border: '1px solid var(--border-light)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '3px 8px' }}>Edit</button>
          </div>
          <h2 style={{ margin: 0, color: 'var(--accent-green)', fontSize: '2rem' }}>${Number(balance.csfloat).toFixed(2)}</h2>
        </div>
      </div>

      {/* edit balance popup */}
      {balanceModalOpen && (
        <div className="modal-overlay" onClick={() => setBalanceModalOpen(false)}>
          <div className="modal-content premium-card" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, marginBottom: '20px' }}>💰 Edit Balance</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '6px', display: 'block' }}>Steam Balance ($)</label>
                <input type="number" step="0.01" className="premium-input" value={balanceInput.steam} onChange={e => setBalanceInput({ ...balanceInput, steam: e.target.value })} />
              </div>
              <div>
                <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '6px', display: 'block' }}>CSFloat Balance ($)</label>
                <input type="number" step="0.01" className="premium-input" value={balanceInput.csfloat} onChange={e => setBalanceInput({ ...balanceInput, csfloat: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn" style={{ background: 'rgba(255,255,255,0.1)' }} onClick={() => setBalanceModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => {
                const newBalance = { steam: parseFloat(balanceInput.steam) || 0, csfloat: parseFloat(balanceInput.csfloat) || 0 };
                setBalance(newBalance);
                saveBalance(newBalance);
                setBalanceModalOpen(false);
              }}>Save</button>
            </div>
          </div>
        </div>
      )}

      <div className="layout-grid">
        {/* sticky left form */}
        <div className="sticky-sidebar">
          {/* trade setup */}
          <div className="premium-card" style={{ marginBottom: '2rem', position: 'relative', zIndex: 20 }}>
            <h2 style={{ marginTop: 0, marginBottom: '1.5rem', fontWeight: 600 }}>New Trade & Analysis</h2>
            <div className="form-inputs-grid">

              {/* find items */}
              <div style={{ position: 'relative' }}>
                <input
                  className="premium-input"
                  placeholder="Search Item Name..."
                  value={itemName}
                  onChange={handleSearchChange}
                  autoComplete="off"
                />
                {priceLoading && <span style={{ position: 'absolute', right: '12px', top: '12px', color: 'var(--accent-blue)', fontSize: '12px', fontWeight: 600 }}>Fetching prices...</span>}

                {/* dropdown hits */}
                {searchActive && (
                  <div className="autocomplete-dropdown">
                    {loading ? (
                      <div style={{ padding: '15px', color: 'var(--text-muted)', textAlign: 'center' }}>Scanning Listings...</div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map((result, index) => (
                        <div
                          key={index}
                          className="autocomplete-item"
                          onClick={() => selectItem(result)}
                        >
                          <img src={`https://steamcommunity-a.akamaihd.net/economy/image/${result.asset_description.icon_url}/60fx60f`} alt="icon" className="item-icon" />
                          <div style={{ fontSize: '13px' }}>
                            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{result.hash_name}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>{result.sell_listings} listings</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: '15px', color: 'var(--text-muted)', textAlign: 'center' }}>No results found</div>
                    )}
                  </div>
                )}
              </div>

              <select className="premium-input premium-select" value={direction} onChange={e => setDirection(e.target.value)}>
                <option value="SteamToFloat">Steam ➔ Float</option>
                <option value="FloatToSteam">Float ➔ Steam</option>
              </select>
              <input className="premium-input" type="number" placeholder="Buy Price ($)" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} />
              <input className="premium-input" type="number" placeholder="Target Sell ($)" value={sellPrice} onChange={e => setSellPrice(e.target.value)} />
              <input className="premium-input" type="number" min="1" placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} />
            </div>

            {isSellValid && (
              <div style={{
                padding: '1.2rem', borderRadius: '12px', textAlign: 'center', marginBottom: '1.5rem',
                background: liveProfit > 0 ? 'var(--accent-green-glow)' : 'var(--accent-red-glow)',
                border: `1px solid ${liveProfit > 0 ? 'rgba(36, 180, 126, 0.3)' : 'rgba(255, 51, 102, 0.3)'}`
              }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Estimated Net Revenue: <strong style={{ color: 'var(--text-primary)' }}>${netRevenue.toFixed(2)}</strong></span> <br />
                <strong style={{ fontSize: '1.4rem', marginTop: '8px', display: 'inline-block', color: liveProfit > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {liveProfit > 0 ? `PROFIT: $${liveProfit.toFixed(2)} (+${liveROI.toFixed(2)}%)` : `LOSS: $${liveProfit.toFixed(2)} (${liveROI.toFixed(2)}%)`}
                </strong>
              </div>
            )}

            {isBuyValid && (
              <div className="action-buttons-container">
                <button onClick={saveTrade} className="btn btn-success" style={{ flex: 2, padding: '1rem', fontSize: '1rem', fontWeight: 700, border: '1px solid rgba(36, 180, 126, 0.4)' }}>
                  + Add to Inventory
                </button>
                <button onClick={addToWatchlist} className="btn" style={{ flex: 1, padding: '1rem', fontSize: '1rem', background: 'var(--accent-blue-glow)', border: '1px solid rgba(58, 117, 255, 0.3)', color: 'var(--accent-blue)' }}>
                  ⊕ Track
                </button>
              </div>
            )}
          </div>

          {/* tracked deals */}
          <div className="premium-card" style={{ marginBottom: '2rem' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              ⊕ Tracks
              <span className="badge" style={{ background: 'var(--accent-blue-glow)', color: 'var(--accent-blue)' }}>{watchlist.length}</span>
            </h3>

            {watchlist.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0, textAlign: 'center', padding: '1rem 0' }}>Nothing tracked yet. Hit ⊕ Track on any item to monitor its price.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {watchlist.map((item, idx) => (
                  <div key={idx} className="autocomplete-item" style={{ padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border-color)', position: 'relative' }} onClick={() => loadWatchlistItem(item)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '30px' }}>
                        <div style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{item.item_name}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px' }}>
                          Target Buy: <strong style={{ color: 'var(--text-primary)' }}>${Number(item.buy_price).toFixed(2)}</strong>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromWatchlist(item.item_name); }}
                        style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: '5px', fontSize: '1.2rem', opacity: 0.6, transition: 'opacity 0.2s' }}
                        onMouseOver={e => e.currentTarget.style.opacity = 1}
                        onMouseOut={e => e.currentTarget.style.opacity = 0.6}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* list tables */}
        <div>
          {/* active list */}
          <div className="premium-card premium-card-table">
            <div className="premium-card-header">
              <h2 style={{ margin: 0, fontWeight: 600 }}>Items in the Cycle</h2>
            </div>

            {activeTrades.length === 0 ? <p style={{ color: 'var(--text-muted)', padding: '0 1.5rem 1.5rem 1.5rem' }}>No active trades right now.</p> : (
              <div className="premium-table-container">
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Buy / Sell</th>
                      <th>Live Price</th>
                      <th>Expected P&L</th>
                      <th>Trade Ban</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedActiveTrades.map(group => {
                      const banDate = new Date(group.ban_end_date);
                      const isBanOver = new Date() >= banDate;
                      const dateStr = banDate.toLocaleDateString('en-US') + ' ' + String(banDate.getHours()).padStart(2, '0') + ':' + String(banDate.getMinutes()).padStart(2, '0');
                      const isProfit = Number(group.total_expected_profit) > 0;

                      return (
                        <tr key={group.ids[0]}>
                          <td>
                            <strong>{group.item_name}</strong>
                            {group.qty > 1 && <span className="badge" style={{ background: 'var(--accent-blue-glow)', color: 'var(--accent-blue)', marginLeft: '8px', padding: '2px 8px' }}>x{group.qty}</span>}
                            <br />
                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>{group.trade_direction}</span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Buy:</span> ${Number(group.buy_price).toFixed(2)}
                              <span style={{ color: 'var(--text-muted)' }}>➔ Sell:</span> ${Number(group.target_sell_price).toFixed(2)}
                            </div>
                          </td>
                          <td>
                            {(() => {
                              const cached = livePrices[group.item_name];
                              if (!cached) return <span className="text-muted" style={{ fontSize: '0.8rem' }}></span>;

                              const { steam_price, float_price, updated_at } = cached;
                              if (!steam_price && !float_price) {
                                return <span className="text-muted" style={{ fontSize: '0.8rem' }}></span>;
                              }

                              const target = Number(group.target_sell_price);
                              const minsOld = Math.round((Date.now() - new Date(updated_at)) / 60000);
                              const isSteamSell = group.trade_direction === 'FloatToSteam';

                              const priceRow = (label, price, isSellSide) => {
                                if (!price) return null;
                                const diff = price - target;
                                const isAbove = diff >= 0;
                                return (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: '36px' }}>{label}</span>
                                    <span style={{ fontWeight: isSellSide ? 700 : 500, color: isAbove ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                      ${price.toFixed(2)}
                                    </span>
                                    <span style={{ fontSize: '0.7rem', color: isAbove ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                      {isAbove ? '' : ''}{Math.abs(diff).toFixed(2)}
                                    </span>
                                  </div>
                                );
                              };

                              return (
                                <div>
                                  {priceRow('Steam', steam_price, isSteamSell)}
                                  {priceRow('Float', float_price, !isSteamSell)}
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                                    {minsOld < 1 ? 'just now' : `${minsOld}m ago`}
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{ fontWeight: 600 }} className={isProfit ? 'text-profit' : 'text-loss'}>
                            {isProfit ? '+' : ''}${Number(group.total_expected_profit).toFixed(2)}
                          </td>
                          <td>
                            {isBanOver ? (
                              <span className="badge badge-success">Ready ✓</span>
                            ) : (
                              <span className="badge badge-warning">{dateStr} ⏳</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => handleSellClick(group)} className="btn btn-sm btn-success">
                                Sold {group.qty > 1 ? '...' : ''}
                              </button>
                              <button onClick={() => setModalData({ isOpen: true, type: 'delete', group, inputVal: '1', actualPriceVal: '' })} className="btn btn-sm btn-danger">
                                Delete {group.qty > 1 ? '...' : ''}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* sold history list */}
          <div className="premium-card premium-card-table" style={{ opacity: 0.8 }}>
            <div className="premium-card-header">
              <h2 style={{ margin: 0, fontWeight: 600 }}>Trade History (Sold)</h2>
            </div>

            {groupedSoldTrades.length === 0 ? <p style={{ color: 'var(--text-muted)', padding: '0 1.5rem 1.5rem 1.5rem' }}>Nothing sold yet.</p> : (
              <div className="premium-table-container">
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Buy / Sell</th>
                      <th>Realized P&L</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedSoldTrades.map(group => {
                      const isProfit = Number(group.total_profit) > 0;
                      return (
                        <tr key={group.ids[0]}>
                          <td>
                            <strong>{group.item_name}</strong>
                            {group.qty > 1 && <span className="badge" style={{ background: 'var(--accent-blue-glow)', color: 'var(--accent-blue)', marginLeft: '8px', padding: '2px 8px' }}>x{group.qty}</span>}
                            <br />
                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>{group.trade_direction}</span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Buy:</span> ${Number(group.buy_price).toFixed(2)}
                              <span style={{ color: 'var(--text-muted)' }}>➔ Sell:</span> ${Number(group.target_sell_price).toFixed(2)}
                            </div>
                          </td>
                          <td>
                            {(() => {
                              const cached = livePrices[group.item_name];
                              if (!cached) return <span className="text-muted" style={{ fontSize: '0.8rem' }}></span>;

                              const { steam_price, float_price, updated_at } = cached;
                              if (!steam_price && !float_price) {
                                return <span className="text-muted" style={{ fontSize: '0.8rem' }}></span>;
                              }

                              const target = Number(group.target_sell_price);
                              const minsOld = Math.round((Date.now() - new Date(updated_at)) / 60000);
                              const isSteamSell = group.trade_direction === 'FloatToSteam';

                              const priceRow = (label, price, isSellSide) => {
                                if (!price) return null;
                                const diff = price - target;
                                const isAbove = diff >= 0;
                                return (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: '36px' }}>{label}</span>
                                    <span style={{ fontWeight: isSellSide ? 700 : 500, color: isAbove ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                      ${price.toFixed(2)}
                                    </span>
                                    <span style={{ fontSize: '0.7rem', color: isAbove ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                      {isAbove ? '' : ''}{Math.abs(diff).toFixed(2)}
                                    </span>
                                  </div>
                                );
                              };

                              return (
                                <div>
                                  {priceRow('Steam', steam_price, isSteamSell)}
                                  {priceRow('Float', float_price, !isSteamSell)}
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                                    {minsOld < 1 ? 'just now' : `${minsOld}m ago`}
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{ fontWeight: 600 }} className={isProfit ? 'text-profit' : 'text-loss'}>
                            {isProfit ? '+' : ''}${Number(group.total_profit).toFixed(2)}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => setModalData({ isOpen: true, type: 'restore', group, inputVal: '1', actualPriceVal: '' })}
                                className="btn btn-sm"
                                style={{ background: 'var(--accent-warning)', color: '#000' }}
                              >
                                Restore {group.qty > 1 ? '...' : ''}
                              </button>
                              <button
                                onClick={() => setModalData({ isOpen: true, type: 'history-delete', group, inputVal: '1', actualPriceVal: '' })}
                                className="btn btn-sm btn-danger"
                              >
                                Delete Permanently {group.qty > 1 ? '...' : ''}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        {/* action confirm popup */}
        {modalData.isOpen && (
          <div className="modal-overlay">
            <div className="modal-content premium-card">
              {modalData.type === 'sell' && (
                <>
                  <h3 style={{ marginTop: 0, marginBottom: '15px' }}>Confirm Sale</h3>
                  {modalData.group.qty > 1 && (
                    <>
                      <p style={{ color: 'var(--text-muted)', marginBottom: '15px' }}>How many to mark as sold? (Max: {modalData.group.qty})</p>
                      <input
                        type="number"
                        className="premium-input"
                        min="1"
                        max={modalData.group.qty}
                        value={modalData.inputVal}
                        onChange={e => setModalData({ ...modalData, inputVal: e.target.value })}
                        style={{ width: '100%', marginBottom: '20px' }}
                      />
                    </>
                  )}
                  <p style={{ color: 'var(--text-muted)', marginBottom: '15px' }}>Actual Sale Price ($)</p>
                  <input
                    type="number"
                    className="premium-input"
                    min="0"
                    step="0.01"
                    value={modalData.actualPriceVal}
                    onChange={e => setModalData({ ...modalData, actualPriceVal: e.target.value })}
                    style={{ width: '100%', marginBottom: '20px' }}
                  />
                </>
              )}
              {modalData.type === 'delete' && (
                <>
                  <h3 style={{ marginTop: 0, marginBottom: '15px', color: 'var(--accent-red)' }}>Delete Trade</h3>
                  {modalData.group.qty === 1 ? (
                    <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>Are you sure you want to delete this trade? This cannot be undone.</p>
                  ) : (
                    <>
                      <p style={{ color: 'var(--text-muted)', marginBottom: '15px' }}>How many to delete? (Max: {modalData.group.qty})</p>
                      <input
                        type="number"
                        className="premium-input"
                        min="1"
                        max={modalData.group.qty}
                        value={modalData.inputVal}
                        onChange={e => setModalData({ ...modalData, inputVal: e.target.value })}
                        style={{ width: '100%', marginBottom: '20px' }}
                      />
                    </>
                  )}
                </>
              )}
              {(modalData.type === 'restore' || modalData.type === 'history-delete') && (
                <>
                  <h3 style={{ marginTop: 0, marginBottom: '15px', color: modalData.type === 'history-delete' ? 'var(--accent-red)' : 'var(--accent-warning)' }}>
                    {modalData.type === 'restore' ? '↩ Restore Trade' : '🗑️ Permanent Delete'}
                  </h3>
                  {modalData.group.qty === 1 ? (
                    <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
                      Are you sure you want to {modalData.type === 'restore' ? 'restore this to active' : 'permanently delete this'}?
                    </p>
                  ) : (
                    <>
                      <p style={{ color: 'var(--text-muted)', marginBottom: '15px' }}>
                        How many to {modalData.type === 'restore' ? 'restore' : 'delete'}? (Max: {modalData.group.qty})
                      </p>
                      <input
                        type="number"
                        className="premium-input"
                        min="1"
                        max={modalData.group.qty}
                        value={modalData.inputVal}
                        onChange={e => setModalData({ ...modalData, inputVal: e.target.value })}
                        style={{ width: '100%', marginBottom: '20px' }}
                      />
                    </>
                  )}
                </>
              )}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button className="btn" style={{ background: 'rgba(255,255,255,0.1)' }} onClick={() => setModalData({ isOpen: false, type: '', group: null, inputVal: '', actualPriceVal: '' })}>Cancel</button>
                <button
                  className={`btn ${(modalData.type === 'delete' || modalData.type === 'history-delete') ? 'btn-danger' : modalData.type === 'restore' ? '' : 'btn-success'}`}
                  style={modalData.type === 'restore' ? { background: 'var(--accent-warning)', color: '#000' } : {}}
                  onClick={handleModalConfirm}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;