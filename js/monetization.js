/* ============================================
   THE TECH ROOM — Monetization Setup
   ============================================

   HOW TO SET UP:

   1. GOOGLE ADSENSE:
      - Go to https://adsense.google.com
      - Sign up with your Google account
      - Add site: thetechroom.com
      - Replace 'YOUR-ADSENSE-CLIENT-ID' below with your ca-pub-XXXXXXX ID
      - Ads will auto-appear in the designated slots

   2. BEEHIIV NEWSLETTER:
      - Go to https://beehiiv.com and create free account
      - Create publication "The Tech Room"
      - Go to Settings > Integrations > Embeddable Forms
      - Copy your publication ID
      - Replace 'YOUR-BEEHIIV-PUBLICATION-ID' below

   3. AMAZON ASSOCIATES:
      - Go to https://affiliate-program.amazon.com
      - Sign up (approval is fast)
      - Replace 'YOUR-AMAZON-TAG' below with your tag (e.g., thetechroom-20)
      - Affiliate links in articles will auto-activate

   ============================================ */

const MONETIZATION_CONFIG = {
  // Google AdSense — replace with your ca-pub ID from adsense.google.com
  adsenseClientId: 'ca-pub-6541023899724889',

  // Beehiiv Newsletter — replace with your publication ID from beehiiv.com
  beehiivPublicationId: 'YOUR-BEEHIIV-PUBLICATION-ID',  // e.g., 'pub_xxxxxxxxxxxxxxxx'

  // Amazon Associates — replace with your affiliate tag
  amazonTag: 'YOUR-AMAZON-TAG',  // e.g., 'thetechroom-20'

  // Ad-On Policy Controls
  adPolicy: {
    // Maximum ads per page by tier
    maxAdsPerPage: { free: 6, premium: 0 },
    // Ad types enabled by tier
    enabledAdTypes: {
      free: ['adsense', 'amazon', 'sponsored', 'house'],
      premium: []  // No ads for premium
    },
    // Sponsored content visibility
    showSponsoredContent: { free: true, premium: false },
    // Ad refresh interval (seconds, 0 = no refresh)
    adRefreshInterval: { free: 60, premium: 0 },
    // Ad density rules
    minParagraphsBetweenAds: 4,
    noAdsInFirstParagraphs: 2,
  }
};

// =============================================
// NEWSLETTER FORM SETUP
// =============================================
// Newsletter forms are now handled by subscribers.js (SubscriberManager)
// This function is kept as fallback only if subscribers.js is not loaded
function initNewsletter() {
  // Skip if subscribers.js is loaded — it handles forms directly
  if (typeof subscriberManager !== 'undefined') return;

  const forms = document.querySelectorAll('.newsletter-form');
  forms.forEach(form => {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const email = form.querySelector('input[type="email"]').value;
      const btn = form.querySelector('button');

      if (!email || !email.includes('@')) {
        alert('Please enter a valid email address.');
        return;
      }

      // Fallback: store locally and redirect to subscribe page
      localStorage.setItem('ttr_subscriber_email', email);
      localStorage.setItem('ttr_subscriber_tier', 'free');
      btn.textContent = 'Subscribed!';
      btn.style.background = '#10b981';
      form.querySelector('input[type="email"]').value = '';
      setTimeout(() => {
        btn.textContent = 'Subscribe Free';
        btn.style.background = '';
      }, 3000);
    });
  });
}

// =============================================
// ADSENSE AUTO-INSERTION (with Ad-On Policy)
// =============================================
function initAdsense() {
  if (MONETIZATION_CONFIG.adsenseClientId === 'YOUR-ADSENSE-CLIENT-ID') return;

  // Check subscriber tier for ad policy
  const tier = localStorage.getItem('ttr_subscriber_tier') || 'free';
  const policy = MONETIZATION_CONFIG.adPolicy;
  const maxAds = policy.maxAdsPerPage[tier] || policy.maxAdsPerPage.free;
  const enabledTypes = policy.enabledAdTypes[tier] || policy.enabledAdTypes.free;

  // Premium users: no ads at all
  if (maxAds === 0 || !enabledTypes.includes('adsense')) {
    document.querySelectorAll('.ad-slot').forEach(slot => { slot.style.display = 'none'; });
    return;
  }

  // Load AdSense script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${MONETIZATION_CONFIG.adsenseClientId}`;
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);

  // Activate ad slots (respecting max ads and density rules)
  script.onload = function() {
    let adsInserted = 0;
    document.querySelectorAll('.ad-slot').forEach(slot => {
      if (adsInserted >= maxAds) {
        slot.style.display = 'none';
        return;
      }
      slot.style.display = 'block';
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', MONETIZATION_CONFIG.adsenseClientId);
      ins.setAttribute('data-ad-slot', slot.dataset.adSlot || 'auto');
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      slot.appendChild(ins);
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch(e) {}
      adsInserted++;

      // Hide the slot if AdSense can't fill it. Otherwise we get an
      // empty white rectangle (the <ins> reserves space even when no
      // ad is returned). AdSense stamps data-ad-status="unfilled"
      // once it decides; if it never decides within 3s, treat it as
      // unfilled and hide the wrapper.
      const hideIfUnfilled = () => {
        const status = ins.getAttribute('data-ad-status');
        if (status === 'unfilled' || !status) {
          slot.style.display = 'none';
        }
      };
      const mo = new MutationObserver(() => {
        if (ins.getAttribute('data-ad-status') === 'unfilled') {
          slot.style.display = 'none';
          mo.disconnect();
        } else if (ins.getAttribute('data-ad-status') === 'filled') {
          mo.disconnect();
        }
      });
      mo.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
      setTimeout(() => { hideIfUnfilled(); mo.disconnect(); }, 3000);
    });

    // Hide sponsored content for premium users
    if (!policy.showSponsoredContent[tier]) {
      document.querySelectorAll('[data-content="sponsored"], .sponsored-content').forEach(el => {
        el.style.display = 'none';
      });
    }
  };
}

// =============================================
// AMAZON AFFILIATE LINK ACTIVATION
// =============================================
function initAffiliateLinks() {
  if (MONETIZATION_CONFIG.amazonTag === 'YOUR-AMAZON-TAG') return;

  // Find all Amazon affiliate links and append tag
  document.querySelectorAll('a[data-affiliate="amazon"]').forEach(link => {
    const url = new URL(link.href);
    url.searchParams.set('tag', MONETIZATION_CONFIG.amazonTag);
    link.href = url.toString();
  });
}

// =============================================
// INITIALIZE ALL MONETIZATION
// =============================================
document.addEventListener('DOMContentLoaded', function() {
  initNewsletter();
  initAdsense();
  initAffiliateLinks();
});
