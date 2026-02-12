// This script runs in the PAGE context (not extension context)
// It provides a global function that the content script can call via custom events

(function() {
  'use strict';
  
  console.log('TAH: Page context helper loaded');
  
  // Listen for custom events from the content script
  document.addEventListener('tah-click-button', function(e) {
    const selector = e.detail.selector;
    console.log('TAH: Received click request for:', selector);
    
    const btn = document.querySelector(selector);
    if (btn) {
      btn.click();
      console.log('TAH: Successfully clicked button:', selector);
    } else {
      console.log('TAH: Button not found:', selector);
    }
  });
  
  // Signal that the helper is ready
  document.dispatchEvent(new CustomEvent('tah-helper-ready'));
})();
