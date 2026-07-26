/* ─── Promo bar ──────────────────────────────────────────────── */
(() => {
  const PROMO_KEY = 'caflat_promo_dismissed_v1';
  const closeBtn = document.getElementById('promoBarClose');
  if (!closeBtn) return;

  if (!localStorage.getItem(PROMO_KEY)) {
    document.body.classList.add('has-promo');
  }

  closeBtn.addEventListener('click', () => {
    document.body.classList.remove('has-promo');
    localStorage.setItem(PROMO_KEY, '1');
  });
})();

/* ─── Nav scroll state ──────────────────────────────────────── */
const nav = document.querySelector('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

/* ─── Mobile hamburger ───────────────────────────────────────── */
const hamburger    = document.getElementById('navHamburger');
const mobileDrawer = document.getElementById('navMobileDrawer');

if (hamburger && mobileDrawer) {
  hamburger.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('nav-open');
    hamburger.setAttribute('aria-expanded', isOpen);
    mobileDrawer.setAttribute('aria-hidden', !isOpen);
  });

  mobileDrawer.querySelectorAll('.nav-drawer-link').forEach(link => {
    link.addEventListener('click', () => {
      nav.classList.remove('nav-open');
      hamburger.setAttribute('aria-expanded', 'false');
      mobileDrawer.setAttribute('aria-hidden', 'true');
    });
  });

  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && !mobileDrawer.contains(e.target)) {
      nav.classList.remove('nav-open');
      hamburger.setAttribute('aria-expanded', 'false');
      mobileDrawer.setAttribute('aria-hidden', 'true');
    }
  });
}

/* ─── Sticky CTA bar ─────────────────────────────────────────── */
const stickyCta    = document.getElementById('stickyCta');
const accessSection = document.getElementById('access');

if (stickyCta && accessSection) {
  let accessVisible = false;

  new IntersectionObserver(entries => {
    accessVisible = entries[0].isIntersecting;
    const show = !accessVisible && window.scrollY > 600;
    stickyCta.classList.toggle('visible', show);
    stickyCta.setAttribute('aria-hidden', !show);
  }, { threshold: 0.1 }).observe(accessSection);

  window.addEventListener('scroll', () => {
    if (!accessVisible) {
      const show = window.scrollY > 600;
      stickyCta.classList.toggle('visible', show);
      stickyCta.setAttribute('aria-hidden', !show);
    }
  }, { passive: true });
}

/* ─── Scroll reveal ─────────────────────────────────────────── */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      revealObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });

document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => {
  revealObserver.observe(el);
});

/* Defense-in-depth: IntersectionObserver can silently fail to fire on some
   devices/browsers (WebKit has known misses around scroll-behavior:smooth,
   which is exactly what the nav's anchor links use), leaving content
   permanently at opacity:0 (seen on real iPad Safari). Two independent
   fallbacks guarantee reveal still happens even if the observer never
   fires: a throttled scroll listener for the common case, plus a low-
   frequency poll that needs no event at all, so it also covers scroll
   paths that never dispatch a 'scroll' event. Both re-query live so they
   also cover .reveal targets added later (e.g. by .stagger below). */
function revealFallbackCheck() {
  const vh = window.innerHeight;
  document.querySelectorAll('.reveal:not(.visible), .reveal-left:not(.visible), .reveal-right:not(.visible)').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0) {
      el.classList.add('visible');
      revealObserver.unobserve(el);
    }
  });
  return document.querySelectorAll('.reveal:not(.visible), .reveal-left:not(.visible), .reveal-right:not(.visible)').length;
}
let revealFallbackTicking = false;
window.addEventListener('scroll', () => {
  if (!revealFallbackTicking) {
    revealFallbackTicking = true;
    requestAnimationFrame(() => { revealFallbackTicking = false; revealFallbackCheck(); });
  }
}, { passive: true });
window.addEventListener('load', revealFallbackCheck);
const revealPoll = setInterval(() => {
  if (revealFallbackCheck() === 0) clearInterval(revealPoll);
}, 400);

/* ─── Stagger grid children ─────────────────────────────────── */
// .stagger containers: each child gets .reveal + a staggered delay
document.querySelectorAll('.stagger').forEach(parent => {
  const cols = window.innerWidth > 1000 ? 3 : window.innerWidth > 720 ? 2 : 1;
  Array.from(parent.children).forEach((child, i) => {
    const colIndex = i % cols;
    child.style.transitionDelay = `${colIndex * 60}ms`;
    child.classList.add('reveal');
    revealObserver.observe(child);
  });
});

/* ─── Counter animation ─────────────────────────────────────── */
function animateCount(el, target, suffix = '') {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = target + suffix;
    return;
  }
  let start = 0;
  const duration = 1400;
  const step = timestamp => {
    if (!start) start = timestamp;
    const progress = Math.min((timestamp - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(ease * target) + suffix;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const el = e.target;
      const target = parseInt(el.dataset.target, 10);
      const suffix = el.dataset.suffix || '';
      animateCount(el, target, suffix);
      statsObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('[data-target]').forEach(el => statsObserver.observe(el));

/* ─── [data-populate] progressive reveal ────────────────────────
   Any container marked data-populate gets .populated once it scrolls
   into view; its CSS then choreographs children via staggered
   transition-delay (see style.css). One-shot, like revealObserver. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const populateObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('populated');
        populateObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.25 });
  document.querySelectorAll('[data-populate]').forEach(el => {
    if (reduce) { el.classList.add('populated'); return; }
    populateObserver.observe(el);
  });
})();

/* ─── Atelier hero: ContainerScroll ticker + ambience ───────────
   Writes only CSS custom properties on the hero section; CSS owns
   every transform via calc() of --csp (0 → 1 scroll progress) and
   --px/--py (pointer lerp for the champagne-dust parallax). */
(() => {
  const hero = document.getElementById('atelierHero');
  if (!hero) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Scroll progress: how far the tall section has been scrolled
     through (0 at page top, 1 when its bottom meets the viewport
     bottom), the same window the framer-motion original tracks. */
  if (!reduce) {
    let ticking = false;
    const update = () => {
      const r = hero.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 1;
      hero.style.setProperty('--csp', p.toFixed(4));
      ticking = false;
    };
    const request = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request, { passive: true });
  }

  /* KPI counters inside the device frame: locale-formatted tick-up
     (the shared [data-target] counter is integer+suffix only). */
  document.querySelectorAll('.mk-count[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10) || 0;
    if (reduce) { el.textContent = target.toLocaleString(); return; }
    let start = null;
    const dur = 1600, delay = 900;
    const step = ts => {
      if (!start) start = ts;
      const t = Math.min(1, Math.max(0, (ts - start - delay) / dur));
      const ease = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.floor(ease * target).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  /* Device-frame tabs: the rail icons switch the screen behind the
     glass (Dashboard / POS / Supply) and retitle the caption. */
  const tabs = hero.querySelectorAll('.mk-tab');
  const screens = hero.querySelectorAll('.mk-screen');
  const caption = document.getElementById('cscrollCaption');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    if (tab.classList.contains('on')) return;
    tabs.forEach(t => {
      const on = t === tab;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    screens.forEach(s => s.classList.toggle('on', s.dataset.mkScreen === tab.dataset.mk));
    if (caption && tab.dataset.caption) caption.textContent = tab.dataset.caption;
  }));

  /* Pointer parallax for the dust layers: desktop fine-pointer only */
  if (reduce || !window.matchMedia('(pointer: fine) and (min-width: 769px)').matches) return;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
  const tick = () => {
    cx += (tx - cx) * 0.06;
    cy += (ty - cy) * 0.06;
    hero.style.setProperty('--px', cx.toFixed(2) + 'px');
    hero.style.setProperty('--py', cy.toFixed(2) + 'px');
    raf = (Math.abs(tx - cx) > .05 || Math.abs(ty - cy) > .05)
      ? requestAnimationFrame(tick) : null;
  };
  hero.addEventListener('pointermove', e => {
    tx = (e.clientX / window.innerWidth  - .5) * 22;
    ty = (e.clientY / window.innerHeight - .5) * 16;
    if (!raf) raf = requestAnimationFrame(tick);
  });
})();

/* ─── Mode explorer: ARIA tablist swapping the 5 showcase panels ─
   Direction-aware WAAPI switch (outgoing panel exits fast, incoming
   enters slower from the direction of travel), stage height animates
   between panel heights, keyboard Left/Right/Home/End, and a resize
   dispatch after unhiding a panel so its [data-slider] (zero-width
   while hidden) recomputes its position immediately. */
(() => {
  const rail = document.querySelector('.mode-rail');
  const stage = document.querySelector('.mode-stage');
  if (!rail || !stage) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOUSE_EASE = 'cubic-bezier(.22,.61,.36,1)';
  const EXIT_EASE  = 'cubic-bezier(.4,0,1,1)';

  const tabs = Array.from(rail.querySelectorAll('.mode-tab'));
  const panels = tabs.map(t => document.getElementById(t.getAttribute('aria-controls')));
  const underline = rail.querySelector('.mode-rail-underline');
  let activeIndex = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
  if (activeIndex < 0) activeIndex = 0;
  let switching = false;
  let switchToken = 0;

  const moveUnderline = (tab) => {
    if (!underline) return;
    underline.style.width = tab.offsetWidth + 'px';
    underline.style.transform = `translateX(${tab.offsetLeft - 5}px)`;
  };
  // Initial placement (post-layout)
  requestAnimationFrame(() => moveUnderline(tabs[activeIndex]));
  window.addEventListener('resize', () => moveUnderline(tabs[activeIndex]), { passive: true });

  const EXIT_MS = 200, ENTER_MS = 420;

  /* Return a panel to its resting state: fully opaque, untransformed, with
     no animation still holding it.

     Cancelling matters more than clearing the inline styles. The exit
     animation below runs with fill:forwards so the panel holds at opacity 0
     until it is hidden, and a finished forwards animation keeps applying its
     end value indefinitely. The enter animation has no fill, so it never
     qualifies to replace the exit one; it plays, looks right, and the instant
     it ends its effect drops and the old exit animation reasserts opacity 0.
     That left a full-height panel with nothing visible in it, which is why
     the section only went dark on a tab the visitor came back to. */
  const rest = (panel) => {
    panel.getAnimations().forEach(a => a.cancel());
    panel.style.opacity = '';
    panel.style.transform = '';
  };

  function switchMode(newIndex, { focusTab = false } = {}) {
    if (newIndex === activeIndex || switching || newIndex < 0 || newIndex >= panels.length) return;
    const dir = newIndex > activeIndex ? 1 : -1;
    const oldTab = tabs[activeIndex], newTab = tabs[newIndex];
    const oldPanel = panels[activeIndex], newPanel = panels[newIndex];
    activeIndex = newIndex;

    oldTab.setAttribute('aria-selected', 'false'); oldTab.tabIndex = -1;
    newTab.setAttribute('aria-selected', 'true');  newTab.tabIndex = 0;
    moveUnderline(newTab);
    if (focusTab) newTab.focus();

    if (reduce) {
      oldPanel.hidden = true;
      newPanel.hidden = false;
      rest(newPanel);
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      return;
    }

    switching = true;
    // Every stage below is driven by an animation callback with a timer as
    // backstop, since onfinish is not guaranteed to arrive (a tab
    // backgrounded mid-transition can withhold it). This token makes the
    // stale backstop of a superseded transition a no-op instead of letting
    // it clobber the transition that replaced it.
    const token = ++switchToken;
    const oldH = stage.offsetHeight;

    // Measure the incoming panel's natural height without showing it yet
    newPanel.hidden = false;
    newPanel.style.cssText = 'position:absolute;top:0;left:0;right:0;opacity:0;pointer-events:none;';
    const newH = newPanel.offsetHeight;
    newPanel.style.cssText = '';
    newPanel.hidden = true;

    stage.style.height = oldH + 'px';
    stage.style.overflow = 'hidden';
    stage.getBoundingClientRect(); // force reflow before animating

    stage.animate(
      [{ height: oldH + 'px' }, { height: newH + 'px' }],
      { duration: ENTER_MS, easing: HOUSE_EASE }
    );

    const exitAnim = oldPanel.animate(
      [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-24 * dir}px)` }],
      { duration: EXIT_MS, easing: EXIT_EASE, fill: 'forwards' }
    );

    const settle = () => {
      if (token !== switchToken) return;
      rest(newPanel);
      stage.style.height = '';
      stage.style.overflow = '';
      switching = false;
    };

    let swapped = false;
    const swap = () => {
      if (token !== switchToken || swapped) return;
      swapped = true;
      oldPanel.hidden = true;
      rest(oldPanel);   // drop the forwards-filled exit animation
      newPanel.hidden = false;
      rest(newPanel);   // and any exit animation left over from last time
      window.dispatchEvent(new Event('resize')); // sliders in the newly-shown panel recompute width

      const enterAnim = newPanel.animate(
        [{ opacity: 0, transform: `translateX(${24 * dir}px)` }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: ENTER_MS, easing: HOUSE_EASE }
      );
      enterAnim.onfinish = settle;
      enterAnim.oncancel = settle;
      setTimeout(settle, ENTER_MS + 150);
    };

    exitAnim.onfinish = swap;
    exitAnim.oncancel = swap;
    setTimeout(swap, EXIT_MS + 150);
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => switchMode(i));
    tab.addEventListener('keydown', e => {
      let target = null;
      if (e.key === 'ArrowRight') target = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') target = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') target = 0;
      else if (e.key === 'End') target = tabs.length - 1;
      if (target === null) return;
      e.preventDefault();
      switchMode(target, { focusTab: true });
    });
  });

  // Deep-link support: #mode-03 activates the Events tab on load/hashchange
  const activateFromHash = () => {
    const id = location.hash.replace('#', '');
    const idx = panels.findIndex(p => p && p.id === id);
    if (idx >= 0) switchMode(idx);
  };
  if (location.hash) activateFromHash();
  window.addEventListener('hashchange', activateFromHash);
})();

/* ─── Mode sliders: swipeable app screens in each showcase ──────
   Shared driver for every [data-slider]: arrows + dots (generated
   here), pointer drag with snap, wrap-around, and a gentle auto-
   advance that stands down permanently once the visitor interacts. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-slider]').forEach(slider => {
    const track = slider.querySelector('.mode-slider-track');
    const slides = Array.from(track.children);
    if (slides.length < 2) return;

    let index = 0;
    let auto = null;
    let interacted = false;

    /* Nav: arrows + one dot per slide, appended after the slider */
    const nav = document.createElement('div');
    nav.className = 'mode-slider-nav';
    const mkArrow = (dir, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mode-arrow';
      b.setAttribute('aria-label', label);
      b.innerHTML = dir < 0
        ? '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 2 3.5 6l4 4"/></svg>'
        : '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 2l4 4-4 4"/></svg>';
      b.addEventListener('click', () => { userMove(index + dir); });
      return b;
    };
    const dots = document.createElement('div');
    dots.className = 'mode-dots';
    const dotEls = slides.map((_, i) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'mode-dot' + (i === 0 ? ' on' : '');
      d.setAttribute('aria-label', `Screen ${i + 1} of ${slides.length}`);
      d.addEventListener('click', () => { userMove(i); });
      dots.appendChild(d);
      return d;
    });
    nav.append(mkArrow(-1, 'Previous screen'), dots, mkArrow(1, 'Next screen'));
    slider.after(nav);

    const goTo = i => {
      index = ((i % slides.length) + slides.length) % slides.length;
      track.style.transform = `translateX(${-slides[index].offsetLeft}px)`;
      dotEls.forEach((d, k) => d.classList.toggle('on', k === index));
    };
    const userMove = i => {
      interacted = true;
      stopAuto();
      goTo(i);
    };
    const stopAuto = () => { if (auto) { clearInterval(auto); auto = null; } };

    /* Drag: 1:1 rAF-batched finger follow with a direction lock,
       rubber-band past the ends, and velocity-aware release. Once a
       gesture locks horizontal, a non-passive touchmove preventDefault
       keeps iOS Safari from stealing it mid-drag (which was cancelling
       swipes, especially back-swipes). Vertical gestures are released
       to the page untouched. */
    let startX = null, startY = 0, delta = 0, lock = null, raf = null;
    let lastX = 0, lastT = 0, vel = 0, justDragged = false;

    const render = () => {
      raf = null;
      let d = delta;
      if ((index === 0 && d > 0) || (index === slides.length - 1 && d < 0)) d *= .35;
      track.style.transform = `translateX(${-slides[index].offsetLeft + d}px)`;
    };
    slider.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY;
      lastX = e.clientX; lastT = performance.now();
      delta = 0; vel = 0; lock = null; justDragged = false;
      slider.setPointerCapture(e.pointerId);
    });
    slider.addEventListener('pointermove', e => {
      if (startX === null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (lock === 'x') {
          track.classList.add('dragging');
          slider.classList.add('is-dragging');
        }
      }
      if (lock !== 'x') return;
      justDragged = true;
      delta = dx;
      const now = performance.now();
      if (now - lastT > 12) {
        vel = (e.clientX - lastX) / (now - lastT);
        lastX = e.clientX; lastT = now;
      }
      if (!raf) raf = requestAnimationFrame(render);
    });
    const release = () => {
      if (startX === null) return;
      const wasX = lock === 'x';
      startX = null; lock = null;
      track.classList.remove('dragging');
      slider.classList.remove('is-dragging');
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      if (!wasX) return;
      const w = slides[0].offsetWidth;
      const past = Math.abs(delta) > w * .18;
      const flick = Math.abs(vel) > .4 && Math.abs(delta) > 24;
      // Settle time scales with how far the slide still has to travel
      const remaining = past || flick ? 1 - Math.min(1, Math.abs(delta) / w) : Math.abs(delta) / w;
      track.style.transitionDuration = `${Math.max(.28, .55 * Math.max(.4, remaining)).toFixed(2)}s`;
      if (past || flick) {
        const dir = past ? (delta < 0 ? 1 : -1) : (vel < 0 ? 1 : -1);
        userMove(index + dir);
      } else {
        goTo(index);
      }
      if (Math.abs(delta) > 6) { interacted = true; stopAuto(); }
      delta = 0;
    };
    slider.addEventListener('pointerup', release);
    slider.addEventListener('pointercancel', release);
    track.addEventListener('transitionend', () => { track.style.transitionDuration = ''; });
    /* While locked horizontal, keep iOS from taking the gesture */
    slider.addEventListener('touchmove', e => {
      if (lock === 'x') e.preventDefault();
    }, { passive: false });
    /* A real drag must not fire the click that trails it */
    slider.addEventListener('click', e => {
      if (justDragged) { e.preventDefault(); e.stopPropagation(); justDragged = false; }
    }, true);

    /* Auto-advance: only until first interaction, paused on hover,
       skipped entirely under reduced motion or hidden tabs. */
    if (!reduce) {
      const startAuto = () => {
        if (auto || interacted) return;
        auto = setInterval(() => {
          if (document.hidden) return;
          goTo(index + 1);
        }, 6000);
      };
      slider.addEventListener('mouseenter', stopAuto);
      slider.addEventListener('mouseleave', startAuto);
      new IntersectionObserver(entries => {
        entries[0].isIntersecting ? startAuto() : stopAuto();
      }, { threshold: 0.35 }).observe(slider);
    }

    window.addEventListener('resize', () => goTo(index), { passive: true });
  });
})();

/* ─── Request Access form ───────────────────────────────────── */
const SUPABASE_URL    = 'https://tkrsebalgonimmozbgqc.supabase.co';
const SUPABASE_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrcnNlYmFsZ29uaW1tb3piZ3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAxNDgzNjUsImV4cCI6MjA2NTcyNDM2NX0.s5Jb0VEp1FPR10lVqBBODf93OIFczHGJXnpODWWCbf8';
const WEB3FORMS_KEY   = '7ff88d7f-645f-4693-a1e1-fe8b1de57cab';

const form  = document.getElementById('accessForm');
const toast = document.getElementById('toast');

function showToast(msg, type = 'success') {
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => { toast.classList.remove('show'); }, 4000);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = form.querySelector('.form-submit');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  const data = {
    cafe_name:    form.cafe_name.value.trim(),
    contact_name: form.contact_name.value.trim(),
    email:        form.email.value.trim(),
    phone:        form.phone.value.trim(),
    tier:         form.tier.value,
    message:      form.message.value.trim(),
    requested_at: new Date().toISOString(),
  };

  try {
    // Save to Supabase + email notification fire in parallel
    const [dbRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/access_requests`, {
        method: 'POST',
        headers: {
          'apikey':        SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify(data),
      }),
      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_key: WEB3FORMS_KEY,
          subject:    `New Access Request: ${data.cafe_name || 'Unknown Café'}`,
          from_name:  'Caflat.CORE Landing',
          cafe_name:    data.cafe_name,
          contact_name: data.contact_name,
          email:        data.email,
          phone:        data.phone,
          tier:         data.tier,
          message:      data.message || '-',
        }),
      }).catch(err => console.warn('Email notification failed:', err)), // non-fatal
    ]);

    if (!dbRes.ok) throw new Error(await dbRes.text());

    showToast('Request sent! We\'ll reach out within 24–48 hours.', 'success');
    form.reset();
  } catch (err) {
    console.error('Access request error:', err);
    showToast('Something went wrong. Email us at caflatcore@gmail.com', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Application';
  }
});

/* ─── Smooth scroll for anchor links ───────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', e => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ─── "How it works" smooth open/close ─────────────────────── */
const HOW_EASE = 'cubic-bezier(.22,.61,.36,1)';
document.querySelectorAll('.mode-how').forEach(details => {
  const toggle = details.querySelector('.mode-how-toggle');
  const body   = details.querySelector('.mode-how-body');
  if (!toggle || !body) return;

  let animating = false;

  toggle.addEventListener('click', e => {
    e.preventDefault();
    if (animating) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      details.open = !details.open;
      return;
    }

    if (!details.open) {
      // OPEN: reveal content, then grow the body from 0 to its natural height
      // (offsetHeight = layout height; ignores the steps' translateY overflow)
      details.open = true;
      const h = body.offsetHeight;
      animating = true;
      const anim = body.animate(
        [{ height: '0px' }, { height: h + 'px' }],
        { duration: 460, easing: HOW_EASE }
      );
      anim.onfinish = () => { animating = false; };
    } else {
      // CLOSE: steps cascade out (CSS .closing), body shrinks to 0, then collapse
      details.classList.add('closing');
      const h = body.offsetHeight;
      animating = true;
      const anim = body.animate(
        [{ height: h + 'px' }, { height: '0px' }],
        { duration: 420, easing: HOW_EASE, delay: 90, fill: 'forwards' }
      );
      anim.onfinish = () => {
        details.open = false;
        details.classList.remove('closing');
        anim.cancel(); // release the forwards fill once collapsed
        animating = false;
      };
    }
  });
});

/* ─── Generalized smooth open/close accordion (same WAAPI pattern
   as .mode-how, minus its step-cascade). Used by FAQ and feature cards.
   Padding on the body is animated to 0 alongside height: with the
   page's global box-sizing:border-box, a body with vertical padding
   (e.g. .feat-detail's 26px bottom padding) can never render below
   that padding sum from height alone, so an animation that only
   touches height stalls at the padding floor and then snaps shut
   once <details> finishes closing natively. ─── */
function initSimpleAccordion(containerSelector, summarySelector, bodySelector) {
  document.querySelectorAll(containerSelector).forEach(details => {
    const summary = details.querySelector(summarySelector);
    const body    = details.querySelector(bodySelector);
    if (!summary || !body) return;

    let animating = false;

    summary.addEventListener('click', e => {
      e.preventDefault();
      if (animating) return;

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        details.open = !details.open;
        return;
      }

      const cs = getComputedStyle(body);
      const padTop = cs.paddingTop;
      const padBottom = cs.paddingBottom;

      if (!details.open) {
        details.open = true;
        const h = body.offsetHeight;
        animating = true;
        const anim = body.animate(
          [
            { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
            { height: h + 'px', paddingTop: padTop, paddingBottom: padBottom, opacity: 1 },
          ],
          { duration: 320, easing: HOW_EASE }
        );
        anim.onfinish = () => { animating = false; };
      } else {
        const h = body.offsetHeight;
        animating = true;
        const anim = body.animate(
          [
            { height: h + 'px', paddingTop: padTop, paddingBottom: padBottom, opacity: 1 },
            { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
          ],
          { duration: 260, easing: HOW_EASE, fill: 'forwards' }
        );
        anim.onfinish = () => {
          details.open = false;
          anim.cancel();
          animating = false;
        };
      }
    });
  });
}

initSimpleAccordion('.faq-item', '.faq-question', '.faq-answer');
initSimpleAccordion('.feat-card', '.feat-summary', '.feat-detail');
