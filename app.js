/* Mocked Net Worth App */
const mockInput = {
  date: '2025-09-01',
  fx: { USD: 0.92, CHF: 1.03, RON: 0.20 },
  cryptoPrices: { BTC: 55000, ETH: 2800 }, // EUR prices
  revolut: { EUR: 0, RON: 0, CHF: 0, USD: 0 },
  ibkr: [ ],
  crypto: [ ],
  otherAssets: [ ],
  liabilities: [ ],
  history: [ ],
  targets: {
    'Emergency Fund': 10,
    'Crypto': 10, // with BTC/ETH split below
    'Equities – Regional ETFs': 20,
    'Equities – Asia ETFs': 10,
    'Individual Tech Stocks': 10,
    'Energy Stocks': 20,
    'Healthcare Stocks': 10,
    'Water ETF': 5,
    'Flexible / Open': 5
  },
  cryptoSplit: { BTC: 80, ETH: 20 },
};

/* Utils */
const fmtEUR = (n) => new Intl.NumberFormat('en-IE', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(n);
const pct = (n) => `${n.toFixed(2)}%`;
const clamp = (n) => Math.round(n * 100) / 100;

// UI state
let UI_STATE = { breakdownPeriod: 'MoM', ibkrPeriod: 'MoM', cryptoPeriod: 'MoM', cashPeriod: 'MoM' };

// Persistence helpers (Electron-aware; no-op on web)
async function loadPersisted(){
  try {
    if (window && window.store && typeof window.store.load === 'function'){
      const data = await window.store.load();
      if (data && typeof data === 'object'){
        Object.assign(mockInput, data);
      }
    }
  } catch(e){ console.warn('loadPersisted failed', e); }
}
async function savePersisted(){
  try {
    if (window && window.store && typeof window.store.save === 'function'){
      await window.store.save(mockInput);
    }
  } catch(e){ console.warn('savePersisted failed', e); }
}

// Per-holding return defaults – set to 0 for all holdings and periods
function getHoldingReturn(kind, key, period){
  return 0;
}

function toEUR(amount, currency, fx){
  if(currency === 'EUR') return amount;
  if(currency === 'USD') return amount * fx.USD;
  if(currency === 'CHF') return amount * fx.CHF;
  if(currency === 'RON') return amount * fx.RON;
  return amount; // fallback
}

function getFxEffective(baseFx){
  // Read UI overrides from Utility section if present
  const chfEl = document.getElementById('fx-chf');
  const ronEl = document.getElementById('fx-ron');
  const fx = { ...baseFx };
  if (chfEl && chfEl.value) { const v = parseFloat(chfEl.value); if (!Number.isNaN(v) && v>0) fx.CHF = v; }
  if (ronEl && ronEl.value) { const v = parseFloat(ronEl.value); if (!Number.isNaN(v) && v>0) fx.RON = v; }
  return fx;
}

function compute(input){
  const cryptoPrices = input.cryptoPrices;
  const fx = getFxEffective(input.fx);

  // Revolut (Cash) – exclude USD per request; keep EUR, RON, CHF
  const revolutEUR = Object.entries(input.revolut)
    .filter(([cur]) => cur === 'EUR' || cur === 'RON' || cur === 'CHF')
    .map(([cur, amt]) => ({cur, amt, eur: toEUR(amt, cur, fx)}));
  const revolutTotal = revolutEUR.reduce((s,r)=>s+r.eur,0);

  // IBKR
  const ibkrEUR = input.ibkr.map(p => ({...p, eur: toEUR(p.amount, p.currency, fx)}));
  const ibkrTotal = ibkrEUR.reduce((s,p)=>s+p.eur,0);

  // Crypto
  const cryptoEUR = input.crypto.map(c => ({...c, eur: c.coin==='BTC'? c.amount*cryptoPrices.BTC : c.amount*cryptoPrices.ETH }));
  const cryptoTotal = cryptoEUR.reduce((s,c)=>s+c.eur,0);

  // Other assets
  const otherEUR = input.otherAssets.map(a => ({...a, eur: toEUR(a.amount, a.currency, fx)}));
  const otherTotal = otherEUR.reduce((s,a)=>s+a.eur,0);

  // Liabilities (removed per user) – keep zeros for compatibility
  const liabEUR = [];
  const liabTotal = 0;

  const totalAssets = revolutTotal + ibkrTotal + cryptoTotal + otherTotal;
  const netWorth = totalAssets - liabTotal;

  // History
  const lastIdx = input.history && input.history.length ? input.history.length - 1 : -1;
  const lastMonth = lastIdx >= 0 ? input.history[lastIdx].netWorthEUR : netWorth;
  const baseline = (input.history && input.history.length && input.history[0].netWorthEUR != null)
    ? input.history[0].netWorthEUR
    : netWorth;
  const momAbs = netWorth - lastMonth;
  const momPct = lastMonth ? (momAbs/lastMonth*100) : 0;
  const cumAbs = netWorth - baseline;
  const cumPct = baseline ? (cumAbs/baseline*100) : 0;

  // Category breakdown + mapping to targets
  const breakdown = [
    { name: 'Cash & Emergency Fund', eur: revolutTotal, target: input.targets['Emergency Fund'] },
    { name: 'Brokerage Holdings', eur: ibkrTotal, target: null },
    { name: 'Crypto', eur: cryptoTotal, target: input.targets['Crypto'] },
    { name: 'Other Assets', eur: otherTotal, target: input.targets['Flexible / Open'] },
  ];

  // IBKR by strategy labels
  const ibkrByLabel = {};
  for(const p of ibkrEUR){ ibkrByLabel[p.label] = (ibkrByLabel[p.label]||0) + p.eur; }

  // Currency exposure (assets only)
  const byCurrency = {
    Crypto: cryptoTotal,
    EUR: (input.revolut.EUR||0) + ibkrEUR.filter(p=>p.currency==='EUR').reduce((s,p)=>s+p.eur,0) + otherEUR.filter(a=>a.currency==='EUR').reduce((s,a)=>s+a.eur,0),
    USD: ibkrEUR.filter(p=>p.currency==='USD').reduce((s,p)=>s+p.eur,0), // exclude Revolut USD
    RON: toEUR(input.revolut.RON||0,'RON',fx),
    CHF: toEUR(input.revolut.CHF||0,'CHF',fx),
  };

  return {
    revolutEUR, revolutTotal,
    ibkrEUR, ibkrTotal,
    cryptoEUR, cryptoTotal,
    otherEUR, otherTotal,
    liabEUR, liabTotal,
    totalAssets, netWorth,
    lastMonth, baseline, momAbs, momPct, cumAbs, cumPct,
    breakdown, ibkrByLabel, byCurrency
  };
}

function render(){
  console.log('[NetWorthApp] render start');
  const s = compute(mockInput);
  // Hide boot status upfront so partial renders are visible
  const bootEarly = document.getElementById('boot-status');
  if (bootEarly) bootEarly.style.display = 'none';
  // Initialize Utility FX inputs (set defaults once, and rebind change handlers to re-render)
  try {
    const chfEl = document.getElementById('fx-chf');
    const ronEl = document.getElementById('fx-ron');
    if (chfEl && !chfEl.dataset.bound) {
      chfEl.value = String(mockInput.fx.CHF);
      chfEl.addEventListener('input', () => safeRender());
      chfEl.dataset.bound = '1';
    }
    if (ronEl && !ronEl.dataset.bound) {
      ronEl.value = String(mockInput.fx.RON);
      ronEl.addEventListener('input', () => safeRender());
      ronEl.dataset.bound = '1';
    }
  } catch(e) { console.warn('FX inputs init failed', e); }
  // Overview (top): Total Net Worth + Return (dropdown)
  try {
    const top = document.getElementById('overview-top');
    if (top){
      top.innerHTML = '';
      // Total Net Worth box
      top.appendChild(kpi('Total Net Worth', fmtEUR(s.netWorth)));
      // Return Percentage box with toggle
      const box = document.createElement('div');
      box.className = 'kpi';
      const title = document.createElement('div');
      title.className = 'label inline';
      const titleText = document.createElement('span');
      titleText.textContent = 'Return';
      const select = document.createElement('select');
      select.id = 'overview-period';
      const options = [
        {key:'MoM', label:'MoM'},
        {key:'3M', label:'3M'},
        {key:'6M', label:'6M'},
        {key:'1Y', label:'1Y'},
        {key:'All', label:'All'},
      ];
      let active = 'MoM';
      const value = document.createElement('div');
      value.className = 'value';
      value.id = 'return-value';
      const update = () => {
        const res = computeReturn(s, mockInput.history, active);
        if (!res) { value.textContent = 'n/a'; return; }
        const pos = res.pct >= 0;
        value.innerHTML = `${fmtEUR(res.abs)} (<span class="${pos? 'text-pos':'text-neg'}">${pct(res.pct)}</span>)`;
      };
      options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.key; opt.textContent = o.label; select.appendChild(opt);
      });
      select.value = active;
      select.onchange = () => { active = select.value; update(); };
      title.append(titleText, select);
      box.append(title, value);
      top.appendChild(box);
      update();
    }
  } catch (e) { console.warn('Overview top render failed', e); }

  // Overview bottom removed per request

  // Breakdown table
  try {
    renderBreakdownTable(s, UI_STATE.breakdownPeriod || 'MoM');
  } catch (e) { console.warn('Breakdown render failed', e); }

  // Detailed holdings – Crypto
  try {
    const ct = document.getElementById('crypto-table');
    if (ct){
      ct.innerHTML = '';
      // Header with Return selector (no 'Amount' column)
      const header = document.createElement('div'); header.className='row header';
      header.append(span('','Coin'), span('','EUR Value'), span('','% of Portfolio'));
      const h4 = document.createElement('div'); h4.className='cell';
      const lab = document.createElement('span'); lab.textContent='Return (%)'; lab.style.marginRight='8px';
      const sel = document.createElement('select'); ['MoM','3M','6M','1Y','All'].forEach(k=>{ const o=document.createElement('option'); o.value=k; o.textContent=k; sel.appendChild(o); });
      sel.value = UI_STATE.cryptoPeriod; sel.onchange = ()=>{ UI_STATE.cryptoPeriod = sel.value; safeRender(); };
      h4.append(lab, sel); header.appendChild(h4); ct.appendChild(header);
      s.cryptoEUR.forEach(c => {
        const share = s.cryptoTotal? (c.eur / s.cryptoTotal * 100) : 0;
        const retPct = getHoldingReturn('crypto', c.coin, UI_STATE.cryptoPeriod);
        const retAbs = c.eur * (retPct/100);
        const pos = retPct>=0;
        const retCell = document.createElement('div'); retCell.className='cell'; retCell.innerHTML = `${fmtEUR(retAbs)} (<span class="${pos? 'text-pos':'text-neg'}">${pct(retPct)}</span>)`;
        const rr = document.createElement('div'); rr.className='row';
        rr.append(span('', c.coin), span('', fmtEUR(c.eur)), span('', pct(share)), retCell);
        ct.appendChild(rr);
        // Description row (full width under the coin row)
        const descRow = document.createElement('div'); descRow.className='row';
        const descCell = document.createElement('div'); descCell.className='cell'; descCell.style.gridColumn = '1 / -1';
        const key = `desc:crypto:${c.coin}`;
        const ta = document.createElement('textarea'); ta.className='input'; ta.rows = 2; ta.style.width='100%';
        ta.placeholder = 'Description / thesis (optional)';
        try { ta.value = localStorage.getItem(key) || ''; } catch(e) {}
        ta.addEventListener('input', ()=>{ try { localStorage.setItem(key, ta.value); } catch(e) {} });
        descCell.appendChild(ta);
        descRow.appendChild(descCell);
        ct.appendChild(descRow);
      });
    }
  } catch (e) { console.warn('Crypto table render failed', e); }

  // Detailed holdings – IBKR
  try {
    const sTicker = document.getElementById('in-stock-ticker');
    const sLabel = document.getElementById('in-stock-label');
    const sCurr = document.getElementById('in-stock-curr');
    const sAmt = document.getElementById('in-stock-amt');
    const btnAddStock = document.getElementById('btn-add-stock');
    if (btnAddStock && !btnAddStock.dataset.bound){
      btnAddStock.addEventListener('click', ()=>{
        const name = (sTicker && sTicker.value)||'';
        const label = (sLabel && sLabel.value)||'Custom';
        const currency = (sCurr && sCurr.value)||'EUR';
        const amount = parseFloat((sAmt && sAmt.value)||'0')||0;
        if (name && amount>0){
          const idx = mockInput.ibkr.findIndex(p=>p.name===name);
          if (idx>=0){ mockInput.ibkr[idx].amount += amount; }
          else { mockInput.ibkr.push({ name, label, currency, amount }); }
          if (sTicker) sTicker.value=''; if (sAmt) sAmt.value='';
          safeRender();
        }
      });
      btnAddStock.dataset.bound='1';
    }
    // P&G add form
    const pgLabel = document.getElementById('in-pg-label');
    const pgCurr = document.getElementById('in-pg-curr');
    const pgAmt = document.getElementById('in-pg-amt');
    const btnAddPG = document.getElementById('btn-add-pg');
    if (btnAddPG && !btnAddPG.dataset.bound){
      btnAddPG.addEventListener('click', ()=>{
        const label = (pgLabel && pgLabel.value)||'P&G Account';
        const currency = (pgCurr && pgCurr.value)||'USD';
        const amount = parseFloat((pgAmt && pgAmt.value)||'0')||0;
        if (amount>0){
          const idx = mockInput.ibkr.findIndex(p=>p.name==='PG');
          const entry = { name:'PG', label, currency, amount };
          if (idx>=0){ mockInput.ibkr[idx].amount += amount; }
          else { mockInput.ibkr.push(entry); }
          safeRender();
        }
      });
      btnAddPG.dataset.bound='1';
    }
    // Stock withdraw
    const wTicker = document.getElementById('in-stock-ticker-w');
    const wCCurr = document.getElementById('in-stock-curr-w');
    const wAmt = document.getElementById('in-stock-amt-w');
    const btnWStock = document.getElementById('btn-withdraw-stock');
    if (btnWStock && !btnWStock.dataset.bound){
      btnWStock.addEventListener('click', ()=>{
        const name = (wTicker && wTicker.value)||'';
        const curr = (wCCurr && wCCurr.value)||'EUR';
        const amt = parseFloat((wAmt && wAmt.value)||'0')||0;
        if (name && amt>0){
          const idx = mockInput.ibkr.findIndex(p=>p.name===name && p.currency===curr);
          if (idx>=0){
            mockInput.ibkr[idx].amount = Math.max(0, (mockInput.ibkr[idx].amount||0) - amt);
            if (mockInput.ibkr[idx].amount === 0){ mockInput.ibkr.splice(idx,1); }
            if (wTicker) wTicker.value=''; if (wAmt) wAmt.value='';
            safeRender();
          }
        }
      });
      btnWStock.dataset.bound='1';
    }
    // P&G withdraw
    const pgAmtW = document.getElementById('in-pg-amt-w');
    const btnWPG = document.getElementById('btn-withdraw-pg');
    if (btnWPG && !btnWPG.dataset.bound){
      btnWPG.addEventListener('click', ()=>{
        const amt = parseFloat((pgAmtW && pgAmtW.value)||'0')||0;
        if (amt>0){
          const idx = mockInput.ibkr.findIndex(p=>p.name==='PG');
          if (idx>=0){
            mockInput.ibkr[idx].amount = Math.max(0, (mockInput.ibkr[idx].amount||0) - amt);
            if (mockInput.ibkr[idx].amount === 0){ mockInput.ibkr.splice(idx,1); }
            if (pgAmtW) pgAmtW.value='';
            safeRender();
          }
        }
      });
      btnWPG.dataset.bound='1';
    }
    const it = document.getElementById('ibkr-table');
    const itIBKR = document.getElementById('ibkr-table-ibkr');
    const itPG = document.getElementById('ibkr-table-pg');
    const renderBlock = (container, rows) => {
      container.innerHTML = '';
      // Compute and render totals into dedicated containers above titles
      const total = rows.reduce((s,p)=> s + p.eur, 0);
      try {
        if (container.id === 'ibkr-table-ibkr'){
          // IBKR: show Total Value above the title
          const tot = document.getElementById('ibkr-total');
          if (tot){
            tot.innerHTML = '';
            const tr = document.createElement('div'); tr.className = 'row header';
            const tc = document.createElement('div'); tc.className='cell'; tc.style.gridColumn = '1 / -1'; tc.style.textAlign='center';
            tc.textContent = `Total Value: ${fmtEUR(total)}`; tr.appendChild(tc); tot.appendChild(tr);
          }
        } else if (container.id === 'ibkr-table-pg'){
          // P&G: do not inject header into #pg-total; header will be inside the table itself
          const place = document.getElementById('pg-total');
          if (place) { place.innerHTML = ''; }
        }
      } catch(e) { /* ignore */ }
      // Also duplicate total as first row only for IBKR table
      if (container.id === 'ibkr-table-ibkr'){
        const totalRow2 = document.createElement('div'); totalRow2.className='row header';
        const totalCell2 = document.createElement('div'); totalCell2.className='cell'; totalCell2.style.gridColumn = '1 / -1'; totalCell2.style.textAlign='center';
        totalCell2.textContent = `Total IBKR value: ${fmtEUR(total)}`;
        totalRow2.appendChild(totalCell2);
        container.appendChild(totalRow2);
      }
      // Header with selector; columns: Ticker, EUR Value, % of Portfolio, Return (%)
      const header = document.createElement('div'); header.className='row header';
      header.append(span('','Ticker'), span('','EUR Value'), span('','% of Portfolio'));
      const h4 = document.createElement('div'); h4.className='cell';
      const lab = document.createElement('span'); lab.textContent='Return (%)'; lab.style.marginRight='8px';
      const sel = document.createElement('select'); ['MoM','3M','6M','1Y','All'].forEach(k=>{ const o=document.createElement('option'); o.value=k; o.textContent=k; sel.appendChild(o); });
      sel.value = UI_STATE.ibkrPeriod; sel.onchange = ()=>{ UI_STATE.ibkrPeriod = sel.value; safeRender(); };
      h4.append(lab, sel); header.appendChild(h4); container.appendChild(header);
      rows.forEach(p => {
        const share = s.ibkrTotal? (p.eur / s.ibkrTotal * 100) : 0;
        const retPct = getHoldingReturn('stock', p.name, UI_STATE.ibkrPeriod);
        const retAbs = p.eur * (retPct/100);
        const pos = retPct>=0;
        const retCell = document.createElement('div'); retCell.className='cell'; retCell.innerHTML = `${fmtEUR(retAbs)} (<span class="${pos? 'text-pos':'text-neg'}">${pct(retPct)}</span>)`;
        const r = document.createElement('div'); r.className='row';
        // Ticker, EUR Value, % of Portfolio
        r.append(span('',p.name));
        r.append(span('',fmtEUR(p.eur)));
        r.append(span('', pct(share)));
        // Return
        r.append(retCell);
        container.appendChild(r);
      });
    };
    if (itIBKR && itPG){
      // Split tables rendering
      renderBlock(itIBKR, s.ibkrEUR.filter(p=>p.name!=='PG'));
      renderBlock(itPG, s.ibkrEUR.filter(p=>p.name==='PG'));
    } else if (it) {
      // Fallback: single table with combined content
      renderBlock(it, s.ibkrEUR);
    }
  } catch (e) { console.warn('IBKR table render failed', e); }

  // Revolut table (Cash)
  try {
    const rt = document.getElementById('revolut-table');
    if (rt){
      rt.innerHTML='';
      // Header with Return selector
      const header = document.createElement('div'); header.className='row header';
      header.append(span('','Currency'), span('','(X) Currency Value'), span('','EUR Value'));
      const h4 = document.createElement('div'); h4.className='cell';
      const lab = document.createElement('span'); lab.textContent='Return (%)'; lab.style.marginRight='8px';
      const sel = document.createElement('select'); ['MoM','3M','6M','1Y','All'].forEach(k=>{ const o=document.createElement('option'); o.value=k; o.textContent=k; sel.appendChild(o); });
      sel.value = UI_STATE.cashPeriod; sel.onchange = ()=>{ UI_STATE.cashPeriod = sel.value; safeRender(); };
      h4.append(lab, sel); header.appendChild(h4); rt.appendChild(header);
      s.revolutEUR.forEach(r => {
        const orig = r.cur==='EUR' ? fmtEUR(r.amt) : `${r.amt} ${r.cur}`;
        const retPct = getHoldingReturn('cash', r.cur, UI_STATE.cashPeriod);
        const retAbs = r.eur * (retPct/100);
        const pos = retPct>=0;
        const retCell = document.createElement('div'); retCell.className='cell'; retCell.innerHTML = `${fmtEUR(retAbs)} (<span class="${pos? 'text-pos':'text-neg'}">${pct(retPct)}</span>)`;
        const rrow = document.createElement('div'); rrow.className='row';
        rrow.append(span('', r.cur), span('', orig), span('', fmtEUR(r.eur)), retCell);
        rt.appendChild(rrow);
      });
      rt.appendChild(row([
        span('muted', 'Total'), span('', ''), span('', fmtEUR(s.revolutTotal)), span('', '')
      ]));
    }
  } catch (e) { console.warn('Revolut table render failed', e); }

  // Other Assets table (remove 'Original' column)
  try {
    const ot = document.getElementById('otherassets-table');
    if (ot) {
      ot.innerHTML = '';
      ot.appendChild(rowHeader(['Name','EUR Value','','']));
      s.otherEUR.forEach(a => {
        ot.appendChild(row([
          span('', a.name),
          span('', fmtEUR(a.eur)),
          span('', ''),
          span('', ''),
        ]));
      });
      ot.appendChild(row([
        span('muted','Total'), span('', fmtEUR(s.otherTotal)), span('', ''), span('', '')
      ]));
    }
  } catch(e) { console.warn('Other Assets render failed', e); }

  try {
    // Allocation vs Target
    const at = document.getElementById('allocation-table');
    if (at){
      at.innerHTML='';
      at.appendChild(rowHeader(['Sleeve','Actual %','Target %','Drift']));
      const sleeveRows = [
        ...Object.entries(s.ibkrByLabel).map(([label, eur]) => ({
          label,
          actual: s.netWorth? eur/s.netWorth*100:0,
          target: (mockInput.targets && mockInput.targets[label] !== undefined) ? mockInput.targets[label] : null
        })),
        {label:'Emergency Fund', actual: s.netWorth? s.revolutTotal/s.netWorth*100:0, target: (mockInput.targets && mockInput.targets['Emergency Fund'] !== undefined) ? mockInput.targets['Emergency Fund'] : null},
        {label:'Crypto', actual: s.netWorth? s.cryptoTotal/s.netWorth*100:0, target: (mockInput.targets && mockInput.targets['Crypto'] !== undefined) ? mockInput.targets['Crypto'] : null},
        {label:'Water ETF', actual: s.ibkrByLabel['Water ETF']? s.ibkrByLabel['Water ETF']/s.netWorth*100:0, target: (mockInput.targets && mockInput.targets['Water ETF'] !== undefined) ? mockInput.targets['Water ETF'] : null},
        {label:'Flexible / Open', actual: s.netWorth? s.otherTotal/s.netWorth*100:0, target: (mockInput.targets && mockInput.targets['Flexible / Open'] !== undefined) ? mockInput.targets['Flexible / Open'] : null},
      ];
      // Deduplicate labels in case they appeared already
      const seen = new Set();
      sleeveRows.forEach(r => {
        if(seen.has(r.label)) return; seen.add(r.label);
        const drift = r.target!=null ? clamp(r.actual - r.target) : null;
        at.appendChild(row([
          span('', r.label),
          span('', pct(r.actual||0)),
          span('', r.target!=null? `${r.target}%`:'–'),
          r.target!=null? driftFlag(drift): span('badge ok','n/a'),
        ]));
      });
    }
  } catch (e) { console.warn('Allocation render failed', e); }

  try {
    // Crypto internal split vs sub-target
    const at2 = document.getElementById('allocation-table');
    if (at2){
      const btcFound = s.cryptoEUR.find(function(c){ return c.coin==='BTC'; });
      const ethFound = s.cryptoEUR.find(function(c){ return c.coin==='ETH'; });
      const btc = btcFound ? btcFound.eur : 0;
      const eth = ethFound ? ethFound.eur : 0;
      const btcPct = s.cryptoTotal? btc/s.cryptoTotal*100:0;
      const ethPct = s.cryptoTotal? eth/s.cryptoTotal*100:0;
      at2.appendChild(row([
        span('muted','— Crypto internal split —'), span('', ''), span('', ''), span('', '')
      ]));
      at2.appendChild(row([
        span('', 'BTC share'), span('', pct(btcPct)), span('', `${mockInput.cryptoSplit.BTC}%`), driftFlag(clamp(btcPct - mockInput.cryptoSplit.BTC))
      ]));
      at2.appendChild(row([
        span('', 'ETH share'), span('', pct(ethPct)), span('', `${mockInput.cryptoSplit.ETH}%`), driftFlag(clamp(ethPct - mockInput.cryptoSplit.ETH))
      ]));
    }
  } catch (e) { console.warn('Crypto split render failed', e); }

  // Currency exposure removed per user

  // Charts (descriptions)
  try {
    const cl = document.getElementById('charts-list');
    if (cl){
      cl.innerHTML = '';
      const charts = [
        'Line: Net Worth over Time – baseline €30k → last month €40.3k → current €43.63k',
        'Pie: Allocation by Category – Cash 15.9%, Equities 38.3%, Crypto 44.4%, Other 3.4%',
        'Stacked Bar: By Platform – Trust Wallet €19.35k, IBKR €16.71k, Revolut €6.93k',
        'Pie: Currency Exposure – Crypto 43.5%, USD 25.5%, EUR 24.7%, RON 4.5%, CHF 1.9%'
      ];
      charts.forEach(t => {
        const li = document.createElement('li'); li.textContent = t; cl.appendChild(li);
      });
    }
  } catch (e) { console.warn('Charts render failed', e); }

  // Commentary
  try {
    const com = document.getElementById('commentary-list');
    if (com){
      com.innerHTML = '';
      const commentary = [
        'Net worth rose €3.33k MoM (+8.3%), indicating positive contributions and/or market gains.',
        'Crypto weight is 44% vs 10% target – consider directing new cash to underweight sleeves.',
        'Notable underweights: Energy (-14pp), Healthcare (-6.6pp), Asia ETFs (-5.4pp), Regional ETFs (-5.1pp).',
        'Currency risk: High non-fiat (crypto) and sizable USD exposure (~25%). Ensure this aligns with income currency and risk tolerance.'
      ];
      commentary.forEach(t => { const li = document.createElement('li'); li.textContent=t; com.appendChild(li); });
    }
  } catch (e) { console.warn('Commentary render failed', e); }

  // Hook export button
  const btn = document.getElementById('export-btn');
  if (btn) btn.onclick = () => exportCSV();

  // Information Input wiring
  try {
    wireInfoInputs();
  } catch(e){ console.warn('Info input wiring failed', e); }

  // Remove any lingering App Error card, if it exists
  try {
    const cards = document.querySelectorAll('.card');
    cards.forEach(function(c){
      const h2 = c.querySelector('h2');
      if (h2 && h2.textContent && h2.textContent.trim() === 'App Error') { c.remove(); }
    });
  } catch(e) { /* ignore */ }
  console.log('[NetWorthApp] render complete');
}

// Mock per-category return assumptions (percent) for each period
const CATEGORY_RETURNS = {
  'Cash & Emergency Fund': { MoM: 0.00, '3M': 0.00, '6M': 0.00, '1Y': 0.00, All: 0.00 },
  'Brokerage Holdings':    { MoM: 0.00, '3M': 0.00, '6M': 0.00, '1Y': 0.00, All: 0.00 },
  'Crypto':               { MoM: 0.00, '3M': 0.00, '6M': 0.00, '1Y': 0.00, All: 0.00 },
  'Other Assets':         { MoM: 0.00, '3M': 0.00, '6M': 0.00, '1Y': 0.00, All: 0.00 },
};

function renderBreakdownTable(s, period){
  const bd = document.getElementById('breakdown-table');
  if (!bd) return;
  bd.innerHTML = '';
  // Custom header with selector next to Return (%)
  const header = document.createElement('div');
  header.className = 'row header';
  const h1 = document.createElement('div'); h1.className = 'cell'; h1.textContent = 'Category';
  const h2 = document.createElement('div'); h2.className = 'cell'; h2.textContent = 'Balance (EUR)';
  const h3 = document.createElement('div'); h3.className = 'cell'; h3.textContent = '% of Net Worth';
  const h4 = document.createElement('div'); h4.className = 'cell';
  const label = document.createElement('span'); label.textContent = 'Return (%)'; label.style.marginRight = '8px';
  const sel = document.createElement('select'); sel.id = 'breakdown-period';
  ;['MoM','3M','6M','1Y','All'].forEach(k => { const opt=document.createElement('option'); opt.value=k; opt.textContent=k; sel.appendChild(opt); });
  sel.value = period;
  sel.onchange = () => { UI_STATE.breakdownPeriod = sel.value; renderBreakdownTable(s, UI_STATE.breakdownPeriod); };
  h4.appendChild(label); h4.appendChild(sel);
  header.append(h1,h2,h3,h4);
  bd.appendChild(header);
  s.breakdown.forEach(b => {
    const share = s.netWorth ? (b.eur / s.netWorth * 100) : 0;
    const retPct = (CATEGORY_RETURNS[b.name] && CATEGORY_RETURNS[b.name][period] != null) ? CATEGORY_RETURNS[b.name][period] : 0;
    const retAbs = b.eur * (retPct/100);
    const pos = retPct >= 0;
    const retCell = document.createElement('div'); retCell.className = 'cell'; retCell.innerHTML = `${fmtEUR(retAbs)} (<span class="${pos? 'text-pos':'text-neg'}">${pct(retPct)}</span>)`;
    bd.appendChild(row([
      span('', b.name),
      span('', fmtEUR(b.eur)),
      span('', pct(share)),
      retCell,
    ]));
  });
}

/* UI helpers */
function kpi(label, value, pos){
  const div = document.createElement('div'); div.className='kpi';
  div.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>` + (pos===undefined? '' : `<div class="delta ${pos? 'pos':'neg'}">${pos? '▲':'▼'} ${value.includes('%')? value : ''}</div>`);
  return div;
}
function rowHeader(cols){
  const r = document.createElement('div'); r.className='row header';
  r.append(...cols.map(c=>{ const d=document.createElement('div'); d.className='cell'; d.textContent=c; return d; }));
  return r;
}
function row(cols){
  const r = document.createElement('div'); r.className='row';
  cols.forEach(c => r.append(c));
  return r;
}
function span(cls, txt){ const d=document.createElement('div'); d.className=`cell ${cls||''}`.trim(); d.textContent=txt; return d; }
function frag(nodes){ const f=document.createDocumentFragment(); nodes.forEach(n=>f.append(n)); return f; }
function badge(type, txt){ const b=document.createElement('div'); b.className=`cell badge flag ${type}`; b.textContent=txt; return b; }
function driftFlag(drift){
  const abs = Math.abs(drift);
  const type = abs>5? (drift>0? 'err':'err') : 'ok';
  const text = abs>5? (drift>0? `Overweight (+${pct(drift)})` : `Underweight (${pct(drift)})`) : `Within band (${pct(drift)})`;
  return badge(type, text);
}

// ===== CSV Export =====
function exportCSV(){
  const s = compute(mockInput);
  const now = new Date();
  const tsFile = tsForFilename(now);
  const tsHuman = tsHumanReadable(now);
  const rows = buildCSV(s, mockInput, tsHuman);
  const csv = toCSV(rows);
  const fname = `net-worth-${mockInput.date}-${tsFile}.csv`;
  download(fname, csv);
}

function buildCSV(s, input, exportedAt){
  const rows = [];
  // Metadata
  rows.push(['Report Date', input.date]);
  rows.push(['Exported At', exportedAt]);
  rows.push(['FX Rates (to EUR)', `USD:${input.fx.USD}`, `CHF:${input.fx.CHF}`, `RON:${input.fx.RON}`]);
  rows.push([]);

  // Summary
  rows.push(['Summary']);
  rows.push(['Total Assets (EUR)', s.totalAssets.toFixed(2)]);
  rows.push(['Net Worth (EUR)', s.netWorth.toFixed(2)]);
  rows.push(['MoM Change (EUR)', s.momAbs.toFixed(2), 'MoM Change (%)', s.momPct.toFixed(2)]);
  rows.push(['Cumulative (EUR)', s.cumAbs.toFixed(2), 'Cumulative (%)', s.cumPct.toFixed(2)]);
  rows.push([]);

  // Revolut
  rows.push(['Revolut Balances']);
  rows.push(['Currency','Original Amount','EUR Value']);
  s.revolutEUR.forEach(r=> rows.push([r.cur, String(r.amt), r.eur.toFixed(2)]));
  rows.push(['Total','','', s.revolutTotal.toFixed(2)]);
  rows.push([]);

  // IBKR positions
  rows.push(['IBKR Portfolio']);
  rows.push(['Ticker','Category','Currency','Original Amount','EUR Value']);
  s.ibkrEUR.forEach(p=> rows.push([p.name, p.label, p.currency, String(p.amount), p.eur.toFixed(2)]));
  rows.push(['Total','','','', s.ibkrTotal.toFixed(2)]);
  rows.push([]);

  // Crypto
  rows.push(['Crypto (Trust Wallet)']);
  rows.push(['Coin','Amount','EUR Value']);
  s.cryptoEUR.forEach(c=> rows.push([c.coin, String(c.amount), c.eur.toFixed(2)]));
  rows.push(['Total','','', s.cryptoTotal.toFixed(2)]);
  rows.push([]);

  // Other Assets
  rows.push(['Other Assets']);
  rows.push(['Name','Currency','Amount','EUR Value']);
  s.otherEUR.forEach(a=> rows.push([a.name, a.currency, String(a.amount), a.eur.toFixed(2)]));
  rows.push(['Total','','', s.otherTotal.toFixed(2)]);
  rows.push([]);

  // Liabilities removed per user

  // Breakdown vs Targets
  rows.push(['Allocation vs Target']);
  rows.push(['Sleeve','Actual % of Net Worth','Target %','Drift %']);
  // Emergency/Crypto/Other
  const sleeves = [
    ['Emergency Fund', (s.revolutTotal/s.netWorth*100) || 0, (input.targets && input.targets['Emergency Fund'] !== undefined) ? input.targets['Emergency Fund'] : null],
    ['Crypto', (s.cryptoTotal/s.netWorth*100) || 0, (input.targets && input.targets['Crypto'] !== undefined) ? input.targets['Crypto'] : null],
    ['Flexible / Open', (s.otherTotal/s.netWorth*100) || 0, (input.targets && input.targets['Flexible / Open'] !== undefined) ? input.targets['Flexible / Open'] : null],
  ];
  // IBKR labels
  Object.entries(s.ibkrByLabel).forEach(([label, eur]) => sleeves.push([label, (eur/s.netWorth*100)||0, (input.targets && input.targets[label] !== undefined) ? input.targets[label] : null]));
  const seen = new Set();
  sleeves.forEach(([label, actual, target]) => {
    if(seen.has(label)) return; seen.add(label);
    const drift = target==null? '' : (actual - target).toFixed(2);
    rows.push([label, actual.toFixed(2), target==null? '': String(target), drift]);
  });
  rows.push([]);

  // Currency exposure
  rows.push(['Currency Exposure (Assets)']);
  rows.push(['Currency','EUR Value','% of Assets']);
  Object.entries(s.byCurrency).forEach(([cur, eur]) => rows.push([cur, eur.toFixed(2), ((eur/s.totalAssets*100)||0).toFixed(2)]));

  return rows;
}

function pad2(n){ return String(n).padStart(2,'0'); }
function tsForFilename(d){
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth()+1);
  const dd = pad2(d.getDate());
  // Date only (YYYYMMDD)
  return `${yyyy}${mm}${dd}`;
}
function tsHumanReadable(d){
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth()+1);
  const dd = pad2(d.getDate());
  // Date only (YYYY-MM-DD)
  return `${yyyy}-${mm}-${dd}`;
}

function toCSV(rows){
  const esc = (v)=>{
    const s = v==null? '' : String(v);
    if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };
  return rows.map(r=> r.map(esc).join(',')).join('\n');
}

function download(filename, text){
  const blob = new Blob([text], {type: 'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
}

function safeRender(){
  try { render(); }
  catch(e){ console.error('Render failed', e); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeRender);
} else {
  safeRender();
}
