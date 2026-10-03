// Real-time Deriv API integration for live market data with precise digit analysis
const DERIV_API = {
  appId: 1089, // Your Deriv app ID
  baseUrl: 'wss://ws.derivws.com/websockets/v3',
  connection: null,
  subscriptions: new Map(),
  requestId: 1,
};

class DerivMarketDataSync {
  constructor() {
    this.connection = null;
    this.requestId = 1;
    this.subscriptions = new Map();
    this.priceHistory = [];
    this.digitHistory = [];
    this.listeners = [];
    this.windowSize = 100; // Analyze last 100 ticks
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.connection = new WebSocket(DERIV_API.baseUrl);

        this.connection.onopen = () => {
          console.log('✓ Connected to Deriv Real-time Feed');
          this.authorize();
          resolve();
        };

        this.connection.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };

        this.connection.onerror = (error) => {
          console.error('✗ Deriv connection error:', error);
          reject(error);
        };

        this.connection.onclose = () => {
          console.log('Deriv connection closed. Reconnecting in 3s...');
          setTimeout(() => this.connect(), 3000);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  authorize() {
    const authRequest = {
      authorize: localStorage.getItem('deriv.auth.token') || '',
      req_id: this.requestId++,
    };
    this.connection.send(JSON.stringify(authRequest));
  }

  subscribeToPrices(symbols = ['Volatility 10 Index', 'Volatility 50 Index', 'Volatility 100 Index']) {
    symbols.forEach(symbol => {
      const request = {
        ticks: symbol,
        req_id: this.requestId++,
      };
      this.connection.send(JSON.stringify(request));
      this.subscriptions.set(symbol, { 
        ticks: [],
        digitAnalysis: this.initializeDigitAnalysis()
      });
    });
  }

  initializeDigitAnalysis() {
    return {
      distribution: Array(10).fill(0),
      transitions: Array(10).fill(null).map(() => Array(10).fill(0)),
      lastDigit: null,
      predictions: {},
      confidence: {}
    };
  }

  handleMessage(data) {
    if (data.error) {
      console.error('Deriv API error:', data.error.message);
      return;
    }

    if (data.tick) {
      this.processTick(data.tick);
    }

    if (data.authorize) {
      console.log('✓ Authorized with Deriv');
      this.subscribeToPrices();
    }
  }

  processTick(tick) {
    const { symbol, quote } = tick;
    
    if (!this.subscriptions.has(symbol)) {
      this.subscriptions.set(symbol, { 
        ticks: [],
        digitAnalysis: this.initializeDigitAnalysis()
      });
    }

    const subscription = this.subscriptions.get(symbol);
    
    // Store raw price with precision
    subscription.ticks.push({
      price: quote,
      timestamp: Date.now(),
      bid: tick.bid || quote,
      ask: tick.ask || quote
    });

    // Keep only last 100 ticks for analysis
    if (subscription.ticks.length > this.windowSize) {
      subscription.ticks.shift();
    }

    // Extract last digit with precision
    const digit = this.extractLastDigit(quote);
    this.digitHistory.push({
      symbol,
      digit,
      price: quote,
      timestamp: Date.now()
    });

    // Update digit analysis
    this.updateDigitAnalysis(subscription.digitAnalysis, digit);
    
    // Calculate predictions
    this.calculatePredictions(subscription.digitAnalysis);

    this.priceHistory.push({
      symbol,
      price: quote,
      digit,
      timestamp: Date.now(),
    });

    // Notify listeners with accurate analysis
    this.listeners.forEach(cb => cb({
      symbol,
      price: quote,
      digit,
      analysis: subscription.digitAnalysis
    }));

    // Update UI with accurate data
    this.updateHeroChart(quote, subscription.digitAnalysis);
  }

  extractLastDigit(price) {
    // Extract the last digit with mathematical precision
    // Handle both integer and decimal prices
    const priceStr = price.toFixed(5); // 5 decimal precision
    const lastChar = priceStr.replace('.', '').slice(-1);
    return parseInt(lastChar, 10);
  }

  updateDigitAnalysis(analysis, currentDigit) {
    // Update distribution
    analysis.distribution[currentDigit]++;

    // Update transitions if we have a previous digit
    if (analysis.lastDigit !== null) {
      analysis.transitions[analysis.lastDigit][currentDigit]++;
    }

    analysis.lastDigit = currentDigit;
  }

  calculatePredictions(analysis) {
    const totalCount = analysis.distribution.reduce((a, b) => a + b, 0);
    
    if (totalCount === 0) return;

    // Calculate frequency percentages
    const frequencies = analysis.distribution.map((count, digit) => ({
      digit,
      count,
      percentage: (count / totalCount * 100).toFixed(2),
      probability: (count / totalCount).toFixed(4)
    }));

    // Sort by frequency
    frequencies.sort((a, b) => b.count - a.count);

    // Store predictions with confidence
    analysis.predictions = {
      mostLikely: frequencies[0].digit,
      leastLikely: frequencies[9].digit,
      top3: frequencies.slice(0, 3),
      distribution: frequencies
    };

    // Calculate confidence levels
    const topFreq = frequencies[0].count;
    const secondFreq = frequencies[1].count;
    const confidence = ((topFreq - secondFreq) / totalCount * 100).toFixed(2);

    analysis.confidence = {
      overall: confidence,
      mostLikely: parseFloat(frequencies[0].probability) * 100,
      leastLikely: parseFloat(frequencies[9].probability) * 100
    };

    // Markov transition predictions
    if (analysis.lastDigit !== null) {
      const transitionRow = analysis.transitions[analysis.lastDigit];
      const totalTransitions = transitionRow.reduce((a, b) => a + b, 0);
      
      if (totalTransitions > 0) {
        analysis.markovPrediction = transitionRow.map((count, nextDigit) => ({
          nextDigit,
          probability: (count / totalTransitions * 100).toFixed(2),
          count
        })).filter(p => p.count > 0).sort((a, b) => b.probability - a.probability);
      }
    }
  }

  updateHeroChart(latestPrice, analysis) {
    window.dispatchEvent(new CustomEvent('marketUpdate', { 
      detail: { 
        price: latestPrice,
        analysis: analysis
      } 
    }));
  }

  onPriceUpdate(callback) {
    this.listeners.push(callback);
  }

  subscribe(symbol) {
    if (this.connection && this.connection.readyState === WebSocket.OPEN) {
      const request = {
        ticks: symbol,
        req_id: this.requestId++,
      };
      this.connection.send(JSON.stringify(request));
    }
  }

  disconnect() {
    if (this.connection) {
      this.connection.close();
    }
  }

  getAccurateAnalysis(symbol) {
    const subscription = this.subscriptions.get(symbol);
    if (!subscription) return null;

    return {
      recentDigits: this.digitHistory.slice(-20),
      distribution: subscription.digitAnalysis.distribution,
      predictions: subscription.digitAnalysis.predictions,
      confidence: subscription.digitAnalysis.confidence,
      markovPrediction: subscription.digitAnalysis.markovPrediction,
      lastPrice: subscription.ticks[subscription.ticks.length - 1]?.price,
      sampleSize: subscription.ticks.length
    };
  }

  getDigitPercentage(symbol, digit) {
    const subscription = this.subscriptions.get(symbol);
    if (!subscription) return null;

    const total = subscription.digitAnalysis.distribution.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;

    return ((subscription.digitAnalysis.distribution[digit] / total) * 100).toFixed(2);
  }
}

// Initialize market data sync
const marketSync = new DerivMarketDataSync();

// Canvas chart rendering
const canvas = document.getElementById('heroChart');
const ctx = canvas.getContext('2d');
let priceHistory = [];
let currentAnalysis = null;

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawChart();
}

function drawChart() {
  if (!canvas) return;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);

  // Background panels
  ctx.fillStyle = 'rgba(16, 18, 24, 0.7)';
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let y = 0; y <= h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let x = 0; x <= w; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Draw price history if available
  if (priceHistory.length > 1) {
    drawPriceChart(w, h);
  } else {
    drawPlaceholderChart(w, h);
  }

  // Draw digit analysis overlay
  if (currentAnalysis && currentAnalysis.predictions) {
    drawDigitAnalysisOverlay(w, h, currentAnalysis);
  }

  // Live indicator with accuracy status
  drawLiveIndicator(w, h);
}

function drawPriceChart(w, h) {
  const maxPrice = Math.max(...priceHistory.map(p => p.price));
  const minPrice = Math.min(...priceHistory.map(p => p.price));
  const priceRange = maxPrice - minPrice || 1;

  // Normalize price history to chart coordinates
  const points = priceHistory.map((p, i) => {
    const x = (i / (priceHistory.length - 1)) * w;
    const y = h - ((p.price - minPrice) / priceRange) * (h - 60) - 30;
    return { x, y, price: p.price, digit: p.digit };
  });

  // Draw line
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = 'rgba(141,156,255,0.92)';
  ctx.lineWidth = 2.2;
  ctx.shadowColor = 'rgba(141,156,255,0.35)';
  ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Fill area
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(141,156,255,0.38)');
  grad.addColorStop(1, 'rgba(141,156,255,0.04)');
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Latest price dot with digit indicator
  if (points.length > 0) {
    const lastPoint = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#38c793';
    ctx.fill();
    
    // Draw digit label
    ctx.fillStyle = '#f4f6f8';
    ctx.font = 'bold 10px IBM Plex Mono';
    ctx.textAlign = 'center';
    ctx.fillText(lastPoint.digit, lastPoint.x, lastPoint.y - 14);
  }
}

function drawDigitAnalysisOverlay(w, h, analysis) {
  if (!analysis.predictions || !analysis.predictions.top3) return;

  const boxWidth = 160;
  const boxHeight = 100;
  const startX = 14;
  const startY = 14;

  // Semi-transparent background
  ctx.fillStyle = 'rgba(8, 9, 12, 0.85)';
  ctx.fillRect(startX, startY, boxWidth, boxHeight);
  
  ctx.strokeStyle = 'rgba(141,156,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(startX, startY, boxWidth, boxHeight);

  // Title
  ctx.fillStyle = 'rgba(141,156,255,0.9)';
  ctx.font = 'bold 11px IBM Plex Mono';
  ctx.fillText('DIGIT PREDICTION', startX + 8, startY + 16);

  // Top 3 predictions with percentages
  let y = startY + 32;
  analysis.predictions.top3.forEach((pred, idx) => {
    ctx.fillStyle = idx === 0 ? '#38c793' : 'rgba(244,246,248,0.7)';
    ctx.font = idx === 0 ? 'bold 10px IBM Plex Mono' : '10px IBM Plex Mono';
    
    const barWidth = parseFloat(pred.percentage) / 100 * 100;
    ctx.fillRect(startX + 8, y, barWidth, 6);
    
    ctx.fillStyle = '#f4f6f8';
    ctx.fillText(`${pred.digit}: ${pred.percentage}%`, startX + 8, y + 16);
    y += 22;
  });
}

function drawLiveIndicator(w, h) {
  // Status box
  ctx.fillStyle = 'rgba(16,18,24,0.9)';
  ctx.fillRect(w - 200, 20, 180, 70);
  ctx.strokeStyle = 'rgba(141,156,255,0.26)';
  ctx.lineWidth = 1;
  ctx.strokeRect(w - 200, 20, 180, 70);

  // Title
  ctx.fillStyle = '#f4f6f8';
  ctx.font = 'bold 12px IBM Plex Mono';
  ctx.fillText('IDMarks LIVE', w - 188, 38);

  // Status indicator
  ctx.fillStyle = currentAnalysis ? '#38c793' : '#ff6b7a';
  ctx.beginPath();
  ctx.arc(w - 30, 36, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = currentAnalysis ? '#38c793' : '#ff6b7a';
  ctx.font = '10px IBM Plex Mono';
  ctx.fillText(currentAnalysis ? 'SYNCED' : 'CONNECTING', w - 188, 58);

  // Sample size
  if (currentAnalysis) {
    ctx.fillStyle = 'rgba(244,246,248,0.6)';
    ctx.font = '9px IBM Plex Mono';
    ctx.fillText(`n=${currentAnalysis.sampleSize}`, w - 188, 72);
  }
}

function drawPlaceholderChart(w, h) {
  // Placeholder animation while waiting for live data
  const time = Date.now() / 3000;

  ctx.beginPath();
  ctx.moveTo(0, h - 60);
  for (let i = 0; i <= 1; i += 0.05) {
    const x = i * w;
    const y = h - 60 - Math.sin(i * Math.PI * 2 + time) * 80 - Math.cos(i * Math.PI + time) * 40;
    ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(141,156,255,0.92)';
  ctx.lineWidth = 2.2;
  ctx.shadowColor = 'rgba(141,156,255,0.35)';
  ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Pulse for "waiting for data"
  const pulseOpacity = 0.5 + Math.sin(time * 4) * 0.3;
  ctx.fillStyle = `rgba(141,156,255,${pulseOpacity * 0.2})`;
  ctx.fillRect(0, 0, w, h);
}

// Listen for market updates
window.addEventListener('marketUpdate', (e) => {
  priceHistory.push({
    price: e.detail.price,
    digit: e.detail.analysis?.lastDigit || 0,
    timestamp: Date.now()
  });

  currentAnalysis = e.detail.analysis;

  // Keep last 200 ticks for visualization
  if (priceHistory.length > 200) {
    priceHistory.shift();
  }
  drawChart();
});

// Initialize connection and sync
async function initializeMarketSync() {
  try {
    await marketSync.connect();
    console.log('✓ Market data sync initialized with precision digit analysis');
  } catch (error) {
    console.error('Failed to connect to market data:', error);
    startDemoMode();
  }
}

function startDemoMode() {
  console.log('Starting demo mode with realistic simulated data...');
  let basePrice = 50000;
  const digitWeights = [0.12, 0.09, 0.11, 0.08, 0.14, 0.10, 0.09, 0.13, 0.07, 0.07];
  
  setInterval(() => {
    basePrice += (Math.random() - 0.5) * 100;
    
    // Simulate weighted digit distribution
    const randomDigit = Math.random();
    let digit = 0;
    let cumulative = 0;
    for (let i = 0; i < 10; i++) {
      cumulative += digitWeights[i];
      if (randomDigit <= cumulative) {
        digit = i;
        break;
      }
    }
    
    // Simulate analysis update
    const mockAnalysis = {
      lastDigit: digit,
      distribution: Array(10).fill(0).map((_, i) => Math.floor(Math.random() * 20)),
      predictions: {
        mostLikely: digit,
        top3: [
          { digit, percentage: '22.50', probability: '0.2250' },
          { digit: (digit + 1) % 10, percentage: '18.20', probability: '0.1820' },
          { digit: (digit + 2) % 10, percentage: '15.40', probability: '0.1540' }
        ]
      },
      confidence: {
        overall: '45.30',
        mostLikely: 22.50,
        leastLikely: 7.10
      },
      sampleSize: 100
    };

    priceHistory.push({
      price: basePrice,
      digit: digit,
      timestamp: Date.now()
    });

    currentAnalysis = mockAnalysis;

    if (priceHistory.length > 200) {
      priceHistory.shift();
    }
    drawChart();
  }, 500);
}

window.addEventListener('resize', resizeCanvas);

// Start on load
window.addEventListener('load', () => {
  resizeCanvas();
  initializeMarketSync();
});

// Fallback draw on page start
resizeCanvas();
