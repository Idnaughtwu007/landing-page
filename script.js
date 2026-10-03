// Real-time Deriv API WebSocket Integration
// Deriv WebSocket URL: wss://ws.derivws.com/websockets/v3
// Documentation: https://api.deriv.com/docs/websocket/

class DerivWebSocketManager {
  constructor() {
    this.ws = null;
    this.requestId = 1;
    this.subscriptions = new Map();
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 3000;
    this.listeners = [];
    
    // Deriv WebSocket configuration
    this.config = {
      url: 'wss://ws.derivws.com/websockets/v3',
      appId: 1089, // Default Deriv app ID
      language: 'EN'
    };
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        console.log('🔗 Connecting to Deriv WebSocket...');
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          console.log('✓ Deriv WebSocket Connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.ping(); // Send ping to keep connection alive
          resolve(this);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };

        this.ws.onerror = (error) => {
          console.error('✗ WebSocket Error:', error);
          this.isConnected = false;
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('⚠ WebSocket Closed');
          this.isConnected = false;
          this.attemptReconnect();
        };
      } catch (error) {
        console.error('✗ Connection failed:', error);
        reject(error);
      }
    });
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      setTimeout(() => this.connect(), this.reconnectDelay);
    } else {
      console.error('✗ Max reconnection attempts reached');
    }
  }

  ping() {
    // Send ping every 30 seconds to keep connection alive
    setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ ping: 1 });
      }
    }, 30000);
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      console.warn('WebSocket not connected. Cannot send:', payload);
    }
  }

  handleMessage(data) {
    // Handle errors
    if (data.error) {
      console.error('Deriv API Error:', data.error.message);
      return;
    }

    // Handle pong
    if (data.pong) {
      console.log('✓ Pong received');
      return;
    }

    // Handle tick data (live prices)
    if (data.tick) {
      this.processTick(data);
    }

    // Handle subscription confirmations
    if (data.subscription) {
      console.log('✓ Subscription confirmed:', data.subscription.id);
    }

    // Notify all listeners
    this.listeners.forEach(callback => callback(data));
  }

  processTick(tickData) {
    const { tick } = tickData;
    
    if (!tick || !tick.symbol) {
      return;
    }

    // Extract precise price and digit
    const price = parseFloat(tick.quote).toFixed(5);
    const digit = this.extractLastDigit(tick.quote);

    // Store in subscription
    if (!this.subscriptions.has(tick.symbol)) {
      this.subscriptions.set(tick.symbol, {
        ticks: [],
        digitAnalysis: this.initializeDigitAnalysis()
      });
    }

    const subscription = this.subscriptions.get(tick.symbol);
    
    // Add tick to history
    subscription.ticks.push({
      price: parseFloat(price),
      digit,
      timestamp: tick.epoch * 1000, // Convert to milliseconds
      bid: tick.bid || parseFloat(price),
      ask: tick.ask || parseFloat(price)
    });

    // Keep only last 500 ticks for analysis
    if (subscription.ticks.length > 500) {
      subscription.ticks.shift();
    }

    // Update digit analysis
    this.updateDigitAnalysis(subscription.digitAnalysis, digit);
    this.calculatePredictions(subscription.digitAnalysis);

    // Emit update event
    window.dispatchEvent(new CustomEvent('derivTick', {
      detail: {
        symbol: tick.symbol,
        price: parseFloat(price),
        digit,
        bid: tick.bid || parseFloat(price),
        ask: tick.ask || parseFloat(price),
        timestamp: tick.epoch * 1000,
        analysis: subscription.digitAnalysis
      }
    }));
  }

  extractLastDigit(price) {
    // Extract the last decimal digit with precision
    const priceStr = price.toString();
    
    // Remove decimal point and get last character
    const digitsOnly = priceStr.replace('.', '');
    const lastDigit = parseInt(digitsOnly[digitsOnly.length - 1], 10);
    
    return isNaN(lastDigit) ? 0 : lastDigit;
  }

  initializeDigitAnalysis() {
    return {
      distribution: Array(10).fill(0), // Count for each digit 0-9
      transitions: Array(10).fill(null).map(() => Array(10).fill(0)), // Markov transitions
      lastDigit: null,
      predictions: {},
      confidence: {},
      markovPrediction: [],
      totalTicks: 0
    };
  }

  updateDigitAnalysis(analysis, currentDigit) {
    // Increment digit count
    analysis.distribution[currentDigit]++;
    analysis.totalTicks++;

    // Track transitions from previous digit
    if (analysis.lastDigit !== null) {
      analysis.transitions[analysis.lastDigit][currentDigit]++;
    }

    analysis.lastDigit = currentDigit;
  }

  calculatePredictions(analysis) {
    const total = analysis.distribution.reduce((a, b) => a + b, 0);
    
    if (total === 0) return;

    // Calculate digit probabilities
    const digitStats = analysis.distribution.map((count, digit) => {
      const percentage = (count / total * 100).toFixed(2);
      return {
        digit,
        count,
        percentage: parseFloat(percentage),
        probability: (count / total).toFixed(6)
      };
    });

    // Sort by frequency (highest to lowest)
    digitStats.sort((a, b) => b.count - a.count);

    // Store predictions
    analysis.predictions = {
      mostLikely: digitStats[0].digit,
      mostLikelyProbability: digitStats[0].percentage,
      leastLikely: digitStats[9].digit,
      leastLikelyProbability: digitStats[9].percentage,
      top5: digitStats.slice(0, 5),
      distribution: digitStats
    };

    // Calculate confidence level
    const topCount = digitStats[0].count;
    const secondCount = digitStats[1]?.count || 0;
    const confidenceGap = topCount - secondCount;
    const confidence = ((confidenceGap / total) * 100).toFixed(2);

    analysis.confidence = {
      overall: parseFloat(confidence),
      mostLikely: digitStats[0].percentage,
      secondMostLikely: digitStats[1]?.percentage || 0,
      distributionStrength: total > 100 ? 'High' : total > 30 ? 'Medium' : 'Low'
    };

    // Markov transition predictions
    if (analysis.lastDigit !== null) {
      const transitionRow = analysis.transitions[analysis.lastDigit];
      const transitionTotal = transitionRow.reduce((a, b) => a + b, 0);

      if (transitionTotal > 0) {
        analysis.markovPrediction = transitionRow
          .map((count, nextDigit) => ({
            nextDigit,
            probability: parseFloat((count / transitionTotal * 100).toFixed(2)),
            count,
            occurrences: count
          }))
          .filter(p => p.count > 0)
          .sort((a, b) => b.probability - a.probability)
          .slice(0, 5);
      }
    }
  }

  subscribe(symbols) {
    // Ensure symbols is an array
    const symbolArray = Array.isArray(symbols) ? symbols : [symbols];

    symbolArray.forEach(symbol => {
      const request = {
        ticks: symbol,
        subscribe: 1,
        req_id: this.requestId++
      };

      console.log(`📊 Subscribing to ${symbol}...`);
      this.send(request);

      // Initialize subscription tracking
      if (!this.subscriptions.has(symbol)) {
        this.subscriptions.set(symbol, {
          ticks: [],
          digitAnalysis: this.initializeDigitAnalysis()
        });
      }
    });
  }

  unsubscribe(symbol) {
    const request = {
      forget: symbol,
      req_id: this.requestId++
    };
    this.send(request);
    this.subscriptions.delete(symbol);
  }

  getAnalysis(symbol) {
    const subscription = this.subscriptions.get(symbol);
    if (!subscription) return null;

    const { digitAnalysis, ticks } = subscription;
    return {
      symbol,
      lastPrice: ticks.length > 0 ? ticks[ticks.length - 1].price : null,
      lastDigit: digitAnalysis.lastDigit,
      sampleSize: ticks.length,
      predictions: digitAnalysis.predictions,
      confidence: digitAnalysis.confidence,
      markovPrediction: digitAnalysis.markovPrediction,
      distribution: digitAnalysis.distribution,
      recentTicks: ticks.slice(-20)
    };
  }

  getAllAnalysis() {
    const analysis = {};
    this.subscriptions.forEach((_, symbol) => {
      analysis[symbol] = this.getAnalysis(symbol);
    });
    return analysis;
  }

  onUpdate(callback) {
    this.listeners.push(callback);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.isConnected = false;
    }
  }

  isReady() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Initialize global Deriv manager
const deriv = new DerivWebSocketManager();

// Canvas rendering
const canvas = document.getElementById('heroChart');
const ctx = canvas.getContext('2d');
let priceHistory = [];
let currentAnalysis = null;
let connectionStatus = 'disconnected';

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawChart();
}

function drawChart() {
  if (!canvas || !ctx) return;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = 'rgba(16, 18, 24, 0.7)';
  ctx.fillRect(0, 0, w, h);

  // Grid
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

  // Draw price data
  if (priceHistory.length > 1) {
    drawPriceChart(w, h);
  } else {
    drawPlaceholderChart(w, h);
  }

  // Draw analysis overlay
  if (currentAnalysis && currentAnalysis.predictions) {
    drawAnalysisOverlay(w, h);
  }

  // Draw status indicator
  drawStatusIndicator(w, h);
}

function drawPriceChart(w, h) {
  const prices = priceHistory.map(p => p.price);
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const points = priceHistory.map((p, i) => {
    const x = (i / (priceHistory.length - 1)) * w;
    const y = h - ((p.price - minPrice) / priceRange) * (h - 60) - 30;
    return { x, y, price: p.price, digit: p.digit };
  });

  // Line
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

  // Area fill
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

  // Latest point indicator
  if (points.length > 0) {
    const lastPoint = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#38c793';
    ctx.fill();

    // Digit label
    ctx.fillStyle = '#f4f6f8';
    ctx.font = 'bold 11px IBM Plex Mono';
    ctx.textAlign = 'center';
    ctx.fillText(lastPoint.digit, lastPoint.x, lastPoint.y - 16);
  }
}

function drawAnalysisOverlay(w, h) {
  if (!currentAnalysis.predictions.top5) return;

  const boxW = 180;
  const boxH = 110;
  const x = 14;
  const y = 14;

  // Background
  ctx.fillStyle = 'rgba(8, 9, 12, 0.92)';
  ctx.fillRect(x, y, boxW, boxH);
  
  ctx.strokeStyle = 'rgba(141,156,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, boxW, boxH);

  // Title
  ctx.fillStyle = 'rgba(141,156,255,0.95)';
  ctx.font = 'bold 10px IBM Plex Mono';
  ctx.textAlign = 'left';
  ctx.fillText('DIGIT ANALYSIS', x + 8, y + 14);

  // Confidence
  ctx.fillStyle = 'rgba(244,246,248,0.7)';
  ctx.font = '9px IBM Plex Mono';
  ctx.fillText(`Conf: ${currentAnalysis.confidence.overall}%`, x + 8, y + 28);

  // Top predictions
  let py = y + 42;
  currentAnalysis.predictions.top5.slice(0, 3).forEach((pred, idx) => {
    const barW = (pred.percentage / 100) * 100;
    
    ctx.fillStyle = idx === 0 ? 'rgba(56,199,147,0.6)' : 'rgba(141,156,255,0.4)';
    ctx.fillRect(x + 8, py, barW, 5);
    
    ctx.fillStyle = '#f4f6f8';
    ctx.font = idx === 0 ? 'bold 9px IBM Plex Mono' : '9px IBM Plex Mono';
    ctx.fillText(`${pred.digit}: ${pred.percentage}%`, x + 8, py + 16);
    
    py += 18;
  });
}

function drawPlaceholderChart(w, h) {
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

  const pulseOpacity = 0.5 + Math.sin(time * 4) * 0.3;
  ctx.fillStyle = `rgba(141,156,255,${pulseOpacity * 0.15})`;
  ctx.fillRect(0, 0, w, h);
}

function drawStatusIndicator(w, h) {
  const boxW = 200;
  const boxH = 75;
  const x = w - boxW - 14;
  const y = 14;

  // Background
  ctx.fillStyle = 'rgba(16,18,24,0.92)';
  ctx.fillRect(x, y, boxW, boxH);

  ctx.strokeStyle = 'rgba(141,156,255,0.26)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, boxW, boxH);

  // Title
  ctx.fillStyle = '#f4f6f8';
  ctx.font = 'bold 12px IBM Plex Mono';
  ctx.textAlign = 'left';
  ctx.fillText('IDMarks LIVE', x + 12, y + 18);

  // Status indicator
  const statusColor = connectionStatus === 'connected' ? '#38c793' : 
                      connectionStatus === 'connecting' ? '#ffc107' : '#ff6b7a';
  const statusText = connectionStatus === 'connected' ? 'SYNCED' :
                     connectionStatus === 'connecting' ? 'CONNECTING' : 'OFFLINE';

  ctx.fillStyle = statusColor;
  ctx.beginPath();
  ctx.arc(x + 12, y + 36, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = statusColor;
  ctx.font = '10px IBM Plex Mono';
  ctx.fillText(statusText, x + 24, y + 40);

  // Details
  if (currentAnalysis && currentAnalysis.sampleSize > 0) {
    ctx.fillStyle = 'rgba(244,246,248,0.6)';
    ctx.font = '9px IBM Plex Mono';
    ctx.fillText(`n=${currentAnalysis.sampleSize} | Digit: ${currentAnalysis.lastDigit}`, x + 12, y + 62);
  }
}

// Listen for Deriv ticks
window.addEventListener('derivTick', (e) => {
  const detail = e.detail;
  priceHistory.push({
    price: detail.price,
    digit: detail.digit,
    timestamp: detail.timestamp
  });

  currentAnalysis = detail.analysis;
  connectionStatus = 'connected';

  // Keep last 200 for visualization
  if (priceHistory.length > 200) {
    priceHistory.shift();
  }

  drawChart();
});

// Initialize Deriv connection
async function initializeDerivConnection() {
  connectionStatus = 'connecting';
  try {
    await deriv.connect();
    connectionStatus = 'connected';
    console.log('✓ Connected to Deriv WebSocket');

    // Subscribe to popular Deriv synthetic indices
    deriv.subscribe([
      'R_10',      // Volatility Index 10
      'R_25',      // Volatility Index 25
      'R_50',      // Volatility Index 50
      'R_100',     // Volatility Index 100
      'FRXEURJPY', // EUR/JPY
      'FRXEURUSD'  // EUR/USD
    ]);

  } catch (error) {
    console.error('Failed to connect to Deriv:', error);
    connectionStatus = 'offline';
    console.log('Starting demo mode...');
    startDemoMode();
  }
}

function startDemoMode() {
  console.log('🎬 Demo mode: Simulating Deriv market data');
  let basePrice = 50000;
  const digitWeights = [0.12, 0.09, 0.11, 0.08, 0.14, 0.10, 0.09, 0.13, 0.07, 0.07];

  connectionStatus = 'connected';

  const demoInterval = setInterval(() => {
    basePrice += (Math.random() - 0.5) * 100;

    // Weighted random digit
    const randomVal = Math.random();
    let digit = 0;
    let cumulative = 0;
    for (let i = 0; i < 10; i++) {
      cumulative += digitWeights[i];
      if (randomVal <= cumulative) {
        digit = i;
        break;
      }
    }

    priceHistory.push({
      price: basePrice,
      digit,
      timestamp: Date.now()
    });

    currentAnalysis = {
      lastDigit: digit,
      sampleSize: priceHistory.length,
      predictions: {
        top5: [
          { digit, percentage: 22.50 },
          { digit: (digit + 1) % 10, percentage: 18.20 },
          { digit: (digit + 2) % 10, percentage: 15.40 }
        ]
      },
      confidence: {
        overall: 45.30
      }
    };

    if (priceHistory.length > 200) {
      priceHistory.shift();
    }

    drawChart();
  }, 400);
}

window.addEventListener('resize', resizeCanvas);

// Initialize on load
window.addEventListener('load', () => {
  resizeCanvas();
  initializeDerivConnection();
});

// Initial draw
resizeCanvas();

// Export for debugging
window.derivDebug = {
  manager: deriv,
  getAnalysis: () => deriv.getAllAnalysis(),
  subscribe: (symbol) => deriv.subscribe(symbol),
  unsubscribe: (symbol) => deriv.unsubscribe(symbol),
  status: () => connectionStatus
};
