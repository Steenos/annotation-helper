// ============================================
// Unicode Extension - Content Script
// ============================================

let isEnabled = false;
let currentToolbar = null;
let lastClickPosition = { x: 0, y: 0 };

// Initialize state
chrome.storage.local.get(['latexEnabled'], (result) => {
  isEnabled = result.latexEnabled === true;
});

// Update state on change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.latexEnabled) {
    isEnabled = changes.latexEnabled.newValue;
    if (!isEnabled) removeToolbar();
  }
});

// Use capture phase to get mouse position before annotation tool captures it
document.addEventListener('mouseup', (e) => {
  lastClickPosition = { x: e.clientX, y: e.clientY };
  handleSelection(e);
}, true);
document.addEventListener('keyup', handleSelection);
document.addEventListener('mousedown', (e) => {
  lastClickPosition = { x: e.clientX, y: e.clientY };
  
  if (currentToolbar && !currentToolbar.contains(e.target)) {
    removeToolbar();
  }
}, true);

function handleSelection(e) {
  if (!isEnabled) return;

  setTimeout(() => {
    const activeEl = document.activeElement;
    const isInput = activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA';

    if (isInput && activeEl.selectionStart !== activeEl.selectionEnd) {
      showToolbar(activeEl, e);
    }
  }, 10);
}

function showToolbar(inputElement, event) {
  removeToolbar();

  const toolbar = document.createElement('div');
  toolbar.className = 'unicode-latex-toolbar';
  
  const boldBtn = document.createElement('button');
  boldBtn.textContent = 'B';
  boldBtn.title = 'Bold (\\textbf{})';
  boldBtn.onclick = (e) => applyLatex(inputElement, 'textbf', e);

  const italicBtn = document.createElement('button');
  italicBtn.textContent = 'I';
  italicBtn.title = 'Italic (\\textit{})';
  italicBtn.style.fontStyle = 'italic';
  italicBtn.onclick = (e) => applyLatex(inputElement, 'textit', e);

  toolbar.appendChild(boldBtn);
  toolbar.appendChild(italicBtn);

  document.body.appendChild(toolbar);
  currentToolbar = toolbar;

  // Positioning
  const rect = inputElement.getBoundingClientRect();
  let top, left;

  if (event && event.type === 'mouseup') {
      top = event.pageY - 40;
      left = event.pageX;
  } else {
      top = rect.top + window.scrollY - 40;
      left = rect.left + window.scrollX + (rect.width / 2);
  }

  if (top < 0) top = rect.bottom + window.scrollY + 10;
  if (left < 0) left = 10;
  
  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
}

function removeToolbar() {
  if (currentToolbar) {
    currentToolbar.remove();
    currentToolbar = null;
  }
}

function applyLatex(input, command, e) {
  e.preventDefault();
  e.stopPropagation();

  const start = input.selectionStart;
  const end = input.selectionEnd;
  const text = input.value;
  const selectedText = text.substring(start, end);

  const newText = `\\${command}{${selectedText}}`;
  
  input.value = text.substring(0, start) + newText + text.substring(end);

  input.dispatchEvent(new Event('input', { bubbles: true }));

  const newEnd = start + newText.length;
  input.setSelectionRange(start, newEnd);
  input.focus();
  
  removeToolbar();
}

// ============================================
// Table Annotation Helper - Message Listener
// ============================================

let tahNextButton = null;
let tahObserver = null;
let tahMutating = false;

// Inject the page helper script
function injectPageHelper() {
  if (document.getElementById('tah-page-helper')) {
    return;
  }
  
  const script = document.createElement('script');
  script.id = 'tah-page-helper';
  script.src = chrome.runtime.getURL('page_helper.js');
  (document.head || document.documentElement).appendChild(script);
}

injectPageHelper();

// Input field selectors (from the annotorious popup)
const SELECTORS = {
  popup: 'div[data-annotation-popup="true"]'
};

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fillTableAnnotation') {
    fillAnnotationFields(message.data).then(result => sendResponse(result));
    return true; // keep channel open for async response
  }
  return true;
});

// Delegate field filling to the page context (page_helper.js) so that
// the website's framework properly picks up the value changes.
function fillAnnotationFields(data) {
  injectPageHelper();
  
  return new Promise((resolve) => {
    function onResult(e) {
      document.removeEventListener('tah-fill-result', onResult);
      let result;
      try {
        result = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
      } catch (err) {
        result = { success: false, error: 'Failed to parse fill result' };
      }
      resolve(result);
    }
    document.addEventListener('tah-fill-result', onResult);
    
    // JSON-stringify data to ensure it passes across Chrome's isolated worlds
    document.dispatchEvent(new CustomEvent('tah-fill-fields', {
      detail: JSON.stringify(data)
    }));
    
    // Timeout fallback
    setTimeout(() => {
      document.removeEventListener('tah-fill-result', onResult);
      resolve({ success: false, error: 'Page helper did not respond' });
    }, 2000);
  });
}

// ============================================
// Table Annotation Helper - Inline auto-fill Button
// ============================================

function findCellMetadataHeader(popup) {
  // Find the "Cell Metadata" label div inside the popup.
  // The header may contain extra child elements (e.g. a "— needs value" span)
  // so we match by checking the first child's text or a startsWith check.
  const divs = popup.querySelectorAll('div');
  for (const div of divs) {
    const text = div.textContent.trim();
    // Check that it starts with "Cell Metadata" and is the label div
    // (not a parent container that also includes input fields).
    if (text.startsWith('Cell Metadata') && div.querySelector('input') === null) {
      // Prefer a div whose first direct child text or element says "Cell Metadata"
      const firstChild = div.childNodes[0];
      if (firstChild) {
        const firstText = (firstChild.textContent || '').trim();
        if (firstText === 'Cell Metadata') {
          return div;
        }
      }
    }
  }
  return null;
}

function injectTahButton() {
  const popup = document.querySelector(SELECTORS.popup);
  if (!popup) return;
  
  // Don't inject twice
  if (popup.querySelector('[data-tah-button]')) {
    tahNextButton = popup.querySelector('[data-tah-button]');
    return;
  }
  
  const header = findCellMetadataHeader(popup);
  if (!header) return;
  
  // Make the header's parent a flex row so the button sits inline
  header.style.display = 'inline';
  
  const btn = document.createElement('button');
  btn.setAttribute('data-tah-button', 'true');
  btn.textContent = 'auto-fill';
  btn.title = 'Fill cell metadata & advance to next cell';
  btn.style.cssText = 'border: 1px solid #4a90d9; background: #4a90d9; color: white; ' +
    'border-radius: 3px; cursor: pointer; font-size: 10px; padding: 1px 6px; ' +
    'line-height: 16px; margin-left: 6px; font-weight: bold; vertical-align: middle;';
  
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    triggerFillAndNext();
  });
  
  // Insert button right after the header text
  header.parentElement.insertBefore(btn, header.nextSibling);
  
  tahMutating = true;
  tahNextButton = btn;
  setTimeout(() => { tahMutating = false; }, 0);
}

function removeTahNextButton() {
  if (tahNextButton) {
    tahMutating = true;
    tahNextButton.remove();
    tahNextButton = null;
    setTimeout(() => { tahMutating = false; }, 0);
  }
}

function positionTahNextButton() {
  injectTahButton();
}

function triggerFillAndNext() {
  directFillAndNext();
}

async function directFillAndNext() {
  const result = await new Promise(resolve => {
    chrome.storage.local.get(['table_helper_state'], resolve);
  });
  
  let tableState = {
    currentRow: 0,
    currentCol: 0,
    totalCols: 3,
    xspan: 1,
    yspan: 1
  };
  
  if (result.table_helper_state) {
    tableState = { ...tableState, ...result.table_helper_state };
  }
  
  const fillResult = await fillAnnotationFields({
    row: tableState.currentRow,
    col: tableState.currentCol,
    xspan: tableState.xspan,
    yspan: tableState.yspan
  });
  
  if (fillResult && fillResult.success) {
    tableState.currentCol++;
    if (tableState.currentCol >= tableState.totalCols) {
      tableState.currentCol = 0;
      tableState.currentRow++;
    }
    chrome.storage.local.set({ table_helper_state: tableState });
    showTahFeedback('Filled! Next: R' + tableState.currentRow + ' C' + tableState.currentCol);
  } else {
    showTahFeedback(fillResult.error || 'Fill failed');
  }
}

function showTahFeedback(message) {
  const feedback = document.createElement('div');
  feedback.className = 'tah-feedback';
  feedback.textContent = message;
  document.body.appendChild(feedback);
  
  setTimeout(() => {
    feedback.classList.add('fade-out');
    setTimeout(() => feedback.remove(), 200);
  }, 1500);
}

// ============================================
// Watch for annotorious popup visibility
// ============================================

let isTableHelperEnabled = false;

chrome.storage.local.get(['tableHelperEnabled'], (result) => {
  isTableHelperEnabled = result.tableHelperEnabled === true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tableHelperEnabled) {
    isTableHelperEnabled = changes.tableHelperEnabled.newValue;
    if (!isTableHelperEnabled) {
      removeTahNextButton();
    }
  }
});

function watchForAnnotoriousPopup() {
  if (tahObserver) return;
  
  let lastPopupState = false;
  
  tahObserver = new MutationObserver((mutations) => {
    // Skip mutations caused by our own button creation/removal
    if (tahMutating) return;
    
    if (!isTableHelperEnabled) {
      removeTahNextButton();
      return;
    }
    
    const popup = document.querySelector(SELECTORS.popup);
    const isPopupVisible = popup && popup.offsetParent !== null;
    
    if (isPopupVisible) {
      // Reposition every time popup is visible (handles popup moving to new box)
      positionTahNextButton();
    } else if (!isPopupVisible && lastPopupState) {
      removeTahNextButton();
    }
    
    lastPopupState = isPopupVisible;
  });
  
  tahObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });
  
  setInterval(() => {
    if (!isTableHelperEnabled) {
      if (tahNextButton) removeTahNextButton();
      return;
    }
    
    const popup = document.querySelector(SELECTORS.popup);
    if (popup && popup.offsetParent !== null && !tahNextButton) {
      positionTahNextButton();
    } else if ((!popup || popup.offsetParent === null) && tahNextButton) {
      removeTahNextButton();
    }
  }, 500);
}

watchForAnnotoriousPopup();

// ============================================
// Table Annotation Helper - CharSize Viewer
// ============================================

let isCharsizeEnabled = false;
let charsizeData = null;
let charsizeInterval = null;

chrome.storage.local.get(['charsizeEnabled'], (result) => {
  isCharsizeEnabled = result.charsizeEnabled === true;
  updateCharsizeViewer();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.charsizeEnabled !== undefined) {
    isCharsizeEnabled = changes.charsizeEnabled.newValue;
    updateCharsizeViewer();
  }
});

function updateCharsizeViewer() {
  if (isCharsizeEnabled) {
    injectPageHelper();
    document.dispatchEvent(new CustomEvent('tah-fetch-annotations'));
  } else {
    clearCharsizeLabels();
    if (charsizeInterval) {
      clearInterval(charsizeInterval);
      charsizeInterval = null;
    }
  }
}

document.addEventListener('tah-annotations-data', (e) => {
  if (!isCharsizeEnabled) return;
  const jsonStr = e.detail;
  if (!jsonStr) {
    showTahFeedback('Failed to read charSize data. Please make sure the JSON format is correct.');
    return;
  }
  
  try {
    const data = JSON.parse(jsonStr);
    const annoList = data.anno_list || [];
    
    charsizeData = new Map();
    if (Array.isArray(annoList)) {
      annoList.forEach(ann => {
        if (ann.id && ann.shapes && ann.shapes.length > 0) {
          let cleanIdStr = String(ann.id).replace(/^#/, '');
          let size = ann.charSize !== undefined ? ann.charSize : ann.char_size;
          if (size !== undefined) {
             // Round to 2 decimal places for cleaner display
             charsizeData.set(cleanIdStr, {
               size: Number(size).toFixed(2),
               geom: ann.shapes[0].geometry 
             });
          }
        }
      });
    }
    
    if (charsizeInterval) clearInterval(charsizeInterval);
    drawCharsizeLabels();
    charsizeInterval = setInterval(drawCharsizeLabels, 200);
    
    showTahFeedback(`Found ${charsizeData.size} charSize values`);
  } catch(err) {
    console.error('TAH: JSON parse error for charSize data', err);
    showTahFeedback('Error parsing annotation JSON');
  }
});

function clearCharsizeLabels() {
  document.querySelectorAll('.tah-charsize-label').forEach(el => el.remove());
}

function drawCharsizeLabels() {
  if (!isCharsizeEnabled || !charsizeData) return;
  
  // Try multiple selectors to find the annotation layer / image container.
  // Konva.js (new UI) first, then Annotorious / OpenSeadragon fallbacks.
  const container =
    document.querySelector('.konvajs-content') ||
    document.querySelector('.a9s-annotationlayer') ||
    document.querySelector('.a9s-osd-layer') ||
    document.querySelector('.openseadragon-canvas') ||
    document.querySelector('svg.a9s-annotationlayer') ||
    document.querySelector('img.annotatable') ||
    document.querySelector('.a9s-outer');
  
  if (!container) {
    document.querySelectorAll('.tah-charsize-label').forEach(label => label.style.display = 'none');
    return;
  }
  
  const rect = container.getBoundingClientRect();
  
  // Determine the native (internal) resolution of the canvas for coordinate scaling.
  // Konva canvases may have a higher internal resolution than their CSS display size
  // (e.g. canvas width=1800 displayed at 1200px due to devicePixelRatio).
  let nativeWidth = rect.width;
  let nativeHeight = rect.height;
  const canvas = container.querySelector('canvas');
  if (canvas) {
    nativeWidth = canvas.width;
    nativeHeight = canvas.height;
  }
  
  const processedIds = new Set();
  
  charsizeData.forEach((data, id) => {
    const { size, geom } = data;
    if (!geom) return;
    
    let geomX = geom.x;
    let geomY = geom.y;
    
    // Handle polygon types which might store coordinates in a points array
    if (geomX === undefined || geomY === undefined) {
      if (geom.points && Array.isArray(geom.points) && geom.points.length > 0) {
        if (Array.isArray(geom.points[0])) {
           geomX = Math.min(...geom.points.map(p => p[0]));
           geomY = Math.min(...geom.points.map(p => p[1]));
        } else if (geom.points[0].x !== undefined) {
           geomX = Math.min(...geom.points.map(p => p.x));
           geomY = Math.min(...geom.points.map(p => p.y));
        }
      }
    }
    
    if (geomX === undefined || geomY === undefined) return;
    
    processedIds.add(id);
    
    let label = document.getElementById('charsize-label-' + id);
    if (!label) {
      label = document.createElement('div');
      label.id = 'charsize-label-' + id;
      label.className = 'tah-charsize-label';
      label.textContent = size;
      document.body.appendChild(label);
    }
    
    label.style.display = 'block';
    
    // Determine coordinate type and compute absolute position.
    // Fractional coords (old Annotorious): both x,y in 0-1 range → multiply by display size.
    // Absolute pixel coords (Konva): values > 1 → scale from native canvas resolution to display size.
    let absoluteX, absoluteY;
    if (geomX <= 1 && geomY <= 1) {
      // Fractional coordinates (Annotorious-style)
      absoluteX = rect.left + window.scrollX + (geomX * rect.width);
      absoluteY = rect.top + window.scrollY + (geomY * rect.height);
    } else {
      // Absolute pixel coordinates – scale from canvas native resolution to display size
      absoluteX = rect.left + window.scrollX + (geomX / nativeWidth * rect.width);
      absoluteY = rect.top + window.scrollY + (geomY / nativeHeight * rect.height);
    }
    
    label.style.left = absoluteX + 'px';
    label.style.top = (absoluteY - 18) + 'px';
    
    const hue = (size * 35) % 360; 
    label.style.backgroundColor = `hsl(${hue}, 70%, 40%)`;
  });
  
  document.querySelectorAll('.tah-charsize-label').forEach(label => {
    const id = label.id.replace('charsize-label-', '');
    if (!processedIds.has(id)) {
      label.remove();
    }
  });
}

// char size viewer new tab
function getAnnotationJsonFromPage() {
  return new Promise((resolve, reject) => {
    let timeoutId;

    function handleData(event) {
      clearTimeout(timeoutId);
      document.removeEventListener('tah-annotations-data', handleData);

      try {
        const raw = event.detail;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

        if (!parsed || !parsed.anno_list) {
          reject(new Error('Invalid annotation data'));
          return;
        }

        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    }

    document.addEventListener('tah-annotations-data', handleData, { once: true });
    document.dispatchEvent(new CustomEvent('tah-fetch-annotations'));

    timeoutId = setTimeout(() => {
      document.removeEventListener('tah-annotations-data', handleData);
      reject(new Error('Timed out waiting for annotation data'));
    }, 3000);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getAnnotationJson') {
    getAnnotationJsonFromPage()
      .then((data) => {
        sendResponse({ success: true, data });
      })
      .catch((error) => {
        console.error('getAnnotationJson error:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  }
});