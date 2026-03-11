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

  // Fill annotation fields from page context (needed for framework compatibility)
  document.addEventListener('tah-fill-fields', function(e) {
    let data;
    try {
      data = typeof e.detail === 'string' ? JSON.parse(e.detail) : (e.detail || {});
    } catch (err) {
      console.log('TAH: Failed to parse fill data:', err);
      document.dispatchEvent(new CustomEvent('tah-fill-result', {
        detail: JSON.stringify({ success: false, error: 'Failed to parse fill data' })
      }));
      return;
    }
    
    const { row, col, xspan, yspan } = data;
    console.log('TAH: Fill fields request:', { row, col, xspan, yspan });
    
    const popup = document.querySelector('div[data-annotation-popup="true"]');
    if (!popup) {
      console.log('TAH: No annotation popup found');
      document.dispatchEvent(new CustomEvent('tah-fill-result', {
        detail: JSON.stringify({ success: false, error: 'No annotation popup found' })
      }));
      return;
    }

    function findInputByLabel(labelText) {
      const spans = popup.querySelectorAll('span');
      for (const span of spans) {
        if (span.textContent.trim() === labelText) {
          const container = span.parentElement;
          if (container) {
            const input = container.querySelector('input');
            if (input) return input;
          }
        }
      }
      return null;
    }

    function setVal(input, value) {
      if (!input) return;
      const strValue = String(value);
      
      // Simulate real user typing so any framework picks up the change
      input.focus();
      input.select();
      
      // execCommand goes through the browser's editing pipeline
      if (!document.execCommand('insertText', false, strValue)) {
        // Fallback: native setter + InputEvent
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(input, strValue);
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true, data: strValue, inputType: 'insertText'
        }));
      }
      
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
    }

    const rowInput = findInputByLabel('row_idx');
    const colInput = findInputByLabel('col_idx');
    console.log('TAH: Found inputs - row_idx:', !!rowInput, 'col_idx:', !!colInput);

    if (!rowInput || !colInput) {
      document.dispatchEvent(new CustomEvent('tah-fill-result', {
        detail: JSON.stringify({ success: false, error: 'row_idx / col_idx inputs not found' })
      }));
      return;
    }

    setVal(rowInput, row);
    setVal(colInput, col);

    const colSpanInput = findInputByLabel('col_span');
    if (colSpanInput) setVal(colSpanInput, xspan !== undefined ? xspan : 1);

    const rowSpanInput = findInputByLabel('row_span');
    if (rowSpanInput) setVal(rowSpanInput, yspan !== undefined ? yspan : 1);

    console.log('TAH: Fill fields success');
    document.dispatchEvent(new CustomEvent('tah-fill-result', {
      detail: JSON.stringify({ success: true })
    }));
  });
  
  // Signal that the helper is ready
  document.dispatchEvent(new CustomEvent('tah-helper-ready'));
})();
