/* ============================================
   THE TECH ROOM — Subscriber Management System
   ============================================

   HOW TO SET UP:

   1. SUPABASE (Free tier — handles subscriber database):
      - Go to https://supabase.com and create a project
      - Run the SQL from scripts/supabase-setup.sql in SQL Editor
      - Copy your Project URL and anon key from Settings > API
      - Replace the values below

   2. STRIPE (Handles $5/mo Premium payments):
      - Go to https://stripe.com and create an account
      - Create a Product: "The Tech Room Premium" at $5/month
      - Get the Price ID (starts with price_)
      - Get your Publishable Key (starts with pk_)
      - Replace the values below
      - Set up a webhook endpoint for subscription events

   ============================================ */

const SUBSCRIBER_CONFIG = {
  // Supabase — replace with your project credentials
  supabaseUrl: 'https://ktobesojbbarhwjsmtay.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0b2Jlc29qYmJhcmh3anNtdGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NzAwNTQsImV4cCI6MjA5MDQ0NjA1NH0.lFLOoSDvLsRowHJwFcKK8CF3dHbbbJ7geMxDh4dxI7s',

  // Stripe — replace with your keys
  stripePublishableKey: 'YOUR-STRIPE-PUBLISHABLE-KEY', // e.g., 'pk_live_...' or 'pk_test_...'
  stripePriceId: 'YOUR-STRIPE-PRICE-ID',               // e.g., 'price_1234567890'

  // Premium pricing
  premiumPrice: 5,
  premiumCurrency: 'USD',

  // Local storage keys
  storageKeys: {
    subscriberEmail: 'ttr_subscriber_email',
    subscriberTier: 'ttr_subscriber_tier',
    subscriberToken: 'ttr_subscriber_token',
    adFree: 'ttr_ad_free',
  }
};

// =============================================
// SUPABASE CLIENT (lightweight, no SDK needed)
// =============================================
class SupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.headers = {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  async insert(table, data) {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Insert failed: ${res.status}`);
    }
    return res.json();
  }

  async select(table, filters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      params.set(key, `eq.${value}`);
    }
    params.set('select', '*');
    const res = await fetch(`${this.url}/rest/v1/${table}?${params}`, {
      headers: this.headers
    });
    if (!res.ok) throw new Error(`Select failed: ${res.status}`);
    return res.json();
  }

  async update(table, filters, data) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      params.set(key, `eq.${value}`);
    }
    const res = await fetch(`${this.url}/rest/v1/${table}?${params}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`Update failed: ${res.status}`);
    return res.json();
  }
}

// =============================================
// SUBSCRIBER MANAGER
// =============================================
class SubscriberManager {
  constructor() {
    this.db = null;
    this.isConfigured = false;
    this._initDB();
  }

  _initDB() {
    if (SUBSCRIBER_CONFIG.supabaseUrl !== 'YOUR-SUPABASE-URL') {
      this.db = new SupabaseClient(SUBSCRIBER_CONFIG.supabaseUrl, SUBSCRIBER_CONFIG.supabaseAnonKey);
      this.isConfigured = true;
    }
  }

  // Check if user is subscribed (from localStorage)
  isSubscribed() {
    return !!localStorage.getItem(SUBSCRIBER_CONFIG.storageKeys.subscriberEmail);
  }

  isPremium() {
    return localStorage.getItem(SUBSCRIBER_CONFIG.storageKeys.subscriberTier) === 'premium';
  }

  getEmail() {
    return localStorage.getItem(SUBSCRIBER_CONFIG.storageKeys.subscriberEmail);
  }

  getTier() {
    return localStorage.getItem(SUBSCRIBER_CONFIG.storageKeys.subscriberTier) || 'free';
  }

  // Subscribe (free tier)
  async subscribeFree(email, source = 'website') {
    if (!email || !email.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }

    // Store locally immediately
    localStorage.setItem(SUBSCRIBER_CONFIG.storageKeys.subscriberEmail, email);
    localStorage.setItem(SUBSCRIBER_CONFIG.storageKeys.subscriberTier, 'free');

    // If Supabase is configured, store in database
    if (this.isConfigured) {
      try {
        // Check if already exists
        const existing = await this.db.select('subscribers', { email });
        if (existing && existing.length > 0) {
          // Already subscribed — update to active
          await this.db.update('subscribers', { email }, { is_active: true });
          localStorage.setItem(SUBSCRIBER_CONFIG.storageKeys.subscriberTier, existing[0].tier);
          return { status: 'existing', tier: existing[0].tier };
        }
        // New subscriber
        await this.db.insert('subscribers', {
          email,
          tier: 'free',
          utm_source: source,
          referring_url: window.location.href
        });
        return { status: 'new', tier: 'free' };
      } catch (err) {
        // If duplicate key error, they're already subscribed
        if (err.message && err.message.includes('duplicate')) {
          return { status: 'existing', tier: 'free' };
        }
        console.warn('Supabase insert failed, subscriber stored locally:', err.message);
        return { status: 'local', tier: 'free' };
      }
    }

    return { status: 'local', tier: 'free' };
  }

  // Start Premium checkout via Stripe
  async startPremiumCheckout(email) {
    if (!email || !email.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }

    // First subscribe free to capture email
    await this.subscribeFree(email, 'premium_checkout');

    // If Stripe is configured, redirect to checkout
    if (SUBSCRIBER_CONFIG.stripePublishableKey !== 'YOUR-STRIPE-PUBLISHABLE-KEY') {
      try {
        // Load Stripe.js if not loaded
        if (!window.Stripe) {
          await this._loadStripe();
        }
        const stripe = window.Stripe(SUBSCRIBER_CONFIG.stripePublishableKey);

        // Create checkout session via Supabase Edge Function or direct
        // For now, redirect to Stripe Payment Link (simpler setup)
        const res = await fetch(`${SUBSCRIBER_CONFIG.supabaseUrl}/functions/v1/create-checkout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUBSCRIBER_CONFIG.supabaseAnonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email,
            priceId: SUBSCRIBER_CONFIG.stripePriceId,
            successUrl: `${window.location.origin}/subscribe.html?success=true&email=${encodeURIComponent(email)}`,
            cancelUrl: `${window.location.origin}/subscribe.html?canceled=true`
          })
        });

        if (res.ok) {
          const { sessionUrl } = await res.json();
          window.location.href = sessionUrl;
          return;
        }
      } catch (err) {
        console.warn('Stripe checkout failed:', err.message);
      }
    }

    // Fallback: show setup instructions
    return {
      status: 'setup_needed',
      message: 'Premium payments are being set up. Your email has been saved — we\'ll notify you when Premium is available!'
    };
  }

  // Verify subscriber status (check against Supabase)
  async verifySubscription(email) {
    if (!this.isConfigured || !email) return null;

    try {
      const results = await this.db.select('subscribers', { email });
      if (results && results.length > 0) {
        const sub = results[0];
        localStorage.setItem(SUBSCRIBER_CONFIG.storageKeys.subscriberEmail, sub.email);
        localStorage.setItem(SUBSCRIBER_CONFIG.storageKeys.subscriberTier, sub.tier);
        if (sub.tier === 'premium') {
          localStorage.setItem(SUBSCRIBER_CONFIG.storageKeys.adFree, 'true');
        }
        return sub;
      }
    } catch (err) {
      console.warn('Verification failed:', err.message);
    }
    return null;
  }

  // Sign out
  signOut() {
    Object.values(SUBSCRIBER_CONFIG.storageKeys).forEach(key => {
      localStorage.removeItem(key);
    });
  }

  // Load Stripe.js dynamically
  _loadStripe() {
    return new Promise((resolve, reject) => {
      if (window.Stripe) return resolve();
      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
}

// =============================================
// AD CONTROL SYSTEM
// =============================================
class AdController {
  constructor(subscriberManager) {
    this.subscriber = subscriberManager;
  }

  init() {
    if (this.subscriber.isPremium()) {
      this.hideAds();
    } else {
      this.showAds();
    }
  }

  hideAds() {
    // Hide all ad slots
    document.querySelectorAll('.ad-slot, .ad-container, [data-ad-slot], .adsbygoogle, ins.adsbygoogle').forEach(el => {
      el.style.display = 'none';
    });
    // Add premium body class
    document.body.classList.add('premium-subscriber');
    document.body.classList.remove('free-subscriber');
    // Show premium badge if exists
    document.querySelectorAll('.premium-badge-indicator').forEach(el => {
      el.style.display = 'inline-flex';
    });
  }

  showAds() {
    document.querySelectorAll('.ad-slot').forEach(el => {
      el.style.display = '';
    });
    document.body.classList.add('free-subscriber');
    document.body.classList.remove('premium-subscriber');
  }
}

// =============================================
// PREMIUM ARTICLE ACCESS CONTROL
// =============================================
class ArticleAccessController {
  constructor(subscriberManager) {
    this.subscriber = subscriberManager;
  }

  init() {
    // Find all premium-gated content
    document.querySelectorAll('[data-access="premium"]').forEach(el => {
      if (!this.subscriber.isPremium()) {
        this._addPaywall(el);
      }
    });

    // Add premium badges to premium articles
    document.querySelectorAll('[data-tier="premium"]').forEach(el => {
      const badge = document.createElement('span');
      badge.className = 'article-premium-badge';
      badge.innerHTML = '&#9733; Premium';
      badge.style.cssText = 'display:inline-block;background:rgba(139,92,246,0.2);color:#a78bfa;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;text-transform:uppercase;margin-left:0.5rem;';
      const title = el.querySelector('h3, h2');
      if (title) title.appendChild(badge);
    });
  }

  _addPaywall(el) {
    // Blur content and add overlay
    el.style.position = 'relative';
    el.style.overflow = 'hidden';

    const overlay = document.createElement('div');
    overlay.className = 'premium-paywall-overlay';
    overlay.innerHTML = `
      <div style="text-align:center;padding:2rem;">
        <p style="font-size:1.5rem;margin-bottom:0.5rem;">&#9733;</p>
        <h3 style="color:var(--text-primary);margin:0 0 0.5rem;">Premium Content</h3>
        <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:1rem;">This deep analysis is available to Premium subscribers.</p>
        <a href="subscribe.html#premium-subscribe-form" class="btn btn--primary" style="display:inline-block;padding:0.6rem 1.5rem;text-decoration:none;">Unlock for $5/mo</a>
      </div>
    `;
    overlay.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,var(--bg-primary) 40%);padding:3rem 1rem;z-index:10;min-height:200px;display:flex;align-items:flex-end;justify-content:center;';

    // Limit visible content
    el.style.maxHeight = '400px';
    el.appendChild(overlay);
  }
}

// =============================================
// SUBSCRIBE PAGE UI CONTROLLER
// =============================================
class SubscribePageUI {
  constructor(subscriberManager) {
    this.subscriber = subscriberManager;
  }

  init() {
    this._handleURLParams();
    this._setupForms();
    this._updateDashboard();
    this._setupSignIn();
  }

  _handleURLParams() {
    const params = new URLSearchParams(window.location.search);

    if (params.get('success') === 'true') {
      const email = params.get('email');
      if (email) {
        localStorage.setItem(SUBSCRIBER_CONFIG.storageKeys.subscriberEmail, email);
        localStorage.setItem(SUBSCRIBER_CONFIG.storageKeys.subscriberTier, 'premium');
        localStorage.setItem(SUBSCRIBER_CONFIG.storageKeys.adFree, 'true');
      }
      this._showStatus('premium-status', 'Welcome to Premium! Your ad-free experience is now active.', 'success');
      // Clean URL
      window.history.replaceState({}, '', '/subscribe.html');
    }

    if (params.get('canceled') === 'true') {
      this._showStatus('premium-status', 'Checkout was canceled. No charges were made.', 'info');
      window.history.replaceState({}, '', '/subscribe.html');
    }
  }

  _setupForms() {
    // Free subscribe form
    const freeForm = document.getElementById('free-subscribe-form');
    if (freeForm) {
      freeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = freeForm.querySelector('input[type="email"]').value;
        const btn = freeForm.querySelector('button');

        btn.textContent = 'Subscribing...';
        btn.disabled = true;

        try {
          const result = await this.subscriber.subscribeFree(email);
          if (result.status === 'existing') {
            this._showStatus('free-status', 'Welcome back! You\'re already subscribed.', 'info');
          } else {
            this._showStatus('free-status', 'You\'re subscribed! Check your inbox for a welcome email.', 'success');
          }
          freeForm.querySelector('input').value = '';
          this._updateDashboard();
        } catch (err) {
          this._showStatus('free-status', err.message, 'error');
        }

        btn.textContent = 'Subscribe Free';
        btn.disabled = false;
      });
    }

    // Premium subscribe form
    const premiumForm = document.getElementById('premium-subscribe-form');
    if (premiumForm) {
      premiumForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = premiumForm.querySelector('input[type="email"]').value;
        const btn = premiumForm.querySelector('button');

        btn.textContent = 'Starting checkout...';
        btn.disabled = true;

        try {
          const result = await this.subscriber.startPremiumCheckout(email);
          if (result && result.status === 'setup_needed') {
            this._showStatus('premium-status', result.message, 'info');
          }
        } catch (err) {
          this._showStatus('premium-status', err.message, 'error');
        }

        btn.textContent = 'Start Premium — $5/mo';
        btn.disabled = false;
      });
    }
  }

  _updateDashboard() {
    const dashboard = document.getElementById('subscriber-dashboard');
    const pricingCards = document.getElementById('pricing-cards');
    if (!dashboard) return;

    if (this.subscriber.isSubscribed()) {
      dashboard.classList.add('active');
      // Don't hide pricing cards — let users see upgrade option

      const email = this.subscriber.getEmail();
      const tier = this.subscriber.getTier();

      document.getElementById('dash-email').textContent = email;

      const badge = document.getElementById('dash-tier-badge');
      badge.textContent = tier === 'premium' ? 'Premium' : 'Free';
      badge.className = `dashboard-card__tier-badge ${tier === 'premium' ? 'badge--premium' : 'badge--free'}`;

      const details = document.getElementById('dash-details');
      if (tier === 'premium') {
        details.innerHTML = 'You have full Premium access: ad-free browsing, exclusive articles, early access, and premium digests.';
        document.getElementById('dash-manage-btn').style.display = '';
      } else {
        details.innerHTML = 'You\'re on the Free plan. Upgrade to Premium for ad-free browsing, exclusive deep analysis, and market insights.';
        document.getElementById('dash-upgrade-btn').style.display = '';
      }

      // Sign out button
      document.getElementById('dash-logout-btn').addEventListener('click', () => {
        this.subscriber.signOut();
        dashboard.classList.remove('active');
        location.reload();
      });

      // Upgrade button
      const upgradeBtn = document.getElementById('dash-upgrade-btn');
      if (upgradeBtn) {
        upgradeBtn.addEventListener('click', () => {
          const premiumForm = document.getElementById('premium-subscribe-form');
          if (premiumForm) {
            premiumForm.querySelector('input').value = email;
            premiumForm.scrollIntoView({ behavior: 'smooth' });
          }
        });
      }
    }
  }

  _setupSignIn() {
    // Allow returning subscribers to sign in by entering their email
    // This is handled by the free form — if they're already in the DB,
    // it will restore their tier
  }

  _showStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = `sub-status sub-status--${type}`;
  }
}

// =============================================
// GLOBAL INITIALIZATION
// =============================================
const subscriberManager = new SubscriberManager();
const adController = new AdController(subscriberManager);
const articleAccess = new ArticleAccessController(subscriberManager);

document.addEventListener('DOMContentLoaded', function() {
  // Initialize ad controls on every page
  adController.init();

  // Initialize article access control on every page
  articleAccess.init();

  // Initialize subscribe page UI (only runs on subscribe.html)
  if (document.getElementById('free-subscribe-form') || document.getElementById('premium-subscribe-form')) {
    const subscribeUI = new SubscribePageUI(subscriberManager);
    subscribeUI.init();
  }

  // Handle newsletter forms on other pages (index, category pages)
  document.querySelectorAll('.newsletter-form').forEach(form => {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const emailInput = form.querySelector('input[type="email"]');
      const btn = form.querySelector('button');
      const email = emailInput.value;

      if (!email || !email.includes('@')) {
        alert('Please enter a valid email address.');
        return;
      }

      const originalText = btn.textContent;
      btn.textContent = 'Subscribing...';
      btn.style.opacity = '0.7';
      btn.disabled = true;

      try {
        const result = await subscriberManager.subscribeFree(email);
        btn.textContent = 'Subscribed!';
        btn.style.background = '#10b981';
        btn.style.borderColor = '#10b981';
        emailInput.value = '';

        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.style.opacity = '';
          btn.disabled = false;
        }, 3000);
      } catch (err) {
        alert(err.message);
        btn.textContent = originalText;
        btn.style.opacity = '';
        btn.disabled = false;
      }
    });
  });

  // Show subscriber indicator in nav if subscribed
  if (subscriberManager.isSubscribed()) {
    const nav = document.querySelector('.nav__links');
    if (nav) {
      const subLink = document.createElement('a');
      subLink.href = 'subscribe.html';
      subLink.className = 'nav__link';
      subLink.style.cssText = 'color: #a78bfa; font-weight: 600;';
      subLink.textContent = subscriberManager.isPremium() ? '★ Premium' : '♡ Subscribed';
      nav.appendChild(subLink);
    }
  }
});
