/**
 * public/js/theme.js
 * OLFU IT Olympics LAN Quiz Bee System (ITPM 311)
 * Theme Manager & Mode Persistence Controller (Zero-CDN)
 */

(function () {
  'use strict';

  function getSavedTheme() {
    try {
      return localStorage.getItem('quizbee_theme');
    } catch (e) {
      return null;
    }
  }

  function setSavedTheme(theme) {
    try {
      localStorage.setItem('quizbee_theme', theme);
    } catch (e) {}
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  // Read saved preference or system preference
  var current = getSavedTheme();
  if (current) {
    applyTheme(current);
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    applyTheme('light');
  }

  // Attach button handler when DOM is ready
  function initToggle() {
    var toggleButtons = document.querySelectorAll('.theme-toggle-btn, #btn-theme-toggle');
    toggleButtons.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var isLight = document.documentElement.getAttribute('data-theme') === 'light';
        var next = isLight ? 'dark' : 'light';
        applyTheme(next);
        setSavedTheme(next);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToggle);
  } else {
    initToggle();
  }
})();
