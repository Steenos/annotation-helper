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

  // Fetch Annotations
  document.addEventListener('tah-fetch-annotations', function() {
    // Find the button by text content to be robust to DOM changes
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent && b.textContent.includes('Copy Anno JSON'));
    
    if (!btn) {
      console.log('TAH: Copy Anno JSON button not found');
      document.dispatchEvent(new CustomEvent('tah-annotations-data', { detail: null }));
      return;
    }
    
    const originalWriteText = navigator.clipboard.writeText;
    let intercepted = false;
    
    navigator.clipboard.writeText = function(text) {
      intercepted = true;
      document.dispatchEvent(new CustomEvent('tah-annotations-data', { detail: text }));
      navigator.clipboard.writeText = originalWriteText; // Restore immediately
      return Promise.resolve(); // Fake successful copy so page doesn't error
    };
    
    btn.click();
    
    // Cleanup in case writeText wasn't called synchronously
    setTimeout(() => {
      if (navigator.clipboard.writeText !== originalWriteText && !intercepted) {
        navigator.clipboard.writeText = originalWriteText;
        document.dispatchEvent(new CustomEvent('tah-annotations-data', { detail: null }));
      }
    }, 500);
  });
  
  // Signal that the helper is ready
  document.dispatchEvent(new CustomEvent('tah-helper-ready'));
})();
