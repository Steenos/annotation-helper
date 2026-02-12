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
  popup: '.annotorious-popup',
  rowInput: 'input.annotorious-popup-input-row-idx',
  colInput: 'input.annotorious-popup-input-col-idx',
  increaseRowSpan: 'a.annotorious-popup-button.annotorious-popup-button-increase-row-span',
  increaseColSpan: 'a.annotorious-popup-button.annotorious-popup-button-increase-col-span'
};

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fillTableAnnotation') {
    const result = fillAnnotationFields(message.data);
    sendResponse(result);
  }
  return true;
});

function fillAnnotationFields(data) {
  const { row, col, xspan, yspan } = data;
  
  const popup = document.querySelector(SELECTORS.popup);
  
  if (!popup) {
    return { success: false, error: 'No annotation popup found' };
  }
  
  const rowInput = popup.querySelector(SELECTORS.rowInput);
  const colInput = popup.querySelector(SELECTORS.colInput);

  if (!rowInput || !colInput) {
    return { success: false, error: 'Input fields not found' };
  }

  setInputValue(rowInput, row);
  setInputValue(colInput, col);
  
  const rowSpanBtnSelector = SELECTORS.popup + ' ' + SELECTORS.increaseRowSpan;
  const colSpanBtnSelector = SELECTORS.popup + ' ' + SELECTORS.increaseColSpan;
  
  for (let i = 0; i < yspan; i++) {
    clickButtonInPageContext(rowSpanBtnSelector);
  }
  
  for (let i = 0; i < xspan; i++) {
    clickButtonInPageContext(colSpanBtnSelector);
  }

  return { success: true };
}

function setInputValue(input, value) {
  if (!input) return;
  
  const strValue = String(value);
  input.value = strValue;
  
  try {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(input, strValue);
  } catch (e) {}
  
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickButtonInPageContext(selector) {
  document.dispatchEvent(new CustomEvent('tah-click-button', {
    detail: { selector: selector }
  }));
}

// ============================================
// Table Annotation Helper - Floating auto-fill Button
// ============================================

function createTahNextButton() {
  if (tahNextButton) return tahNextButton;
  
  const toolbar = document.createElement('div');
  toolbar.className = 'unicode-latex-toolbar tah-toolbar';
  toolbar.style.position = 'fixed';
  toolbar.setAttribute('data-tah-button', 'true');
  
  const btn = document.createElement('button');
  btn.textContent = 'auto-fill';
  btn.title = 'Fill & advance to next cell';
  
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    triggerFillAndNext();
  });
  
  toolbar.appendChild(btn);
  tahMutating = true;
  document.body.appendChild(toolbar);
  tahNextButton = toolbar;
  setTimeout(() => { tahMutating = false; }, 0);
  return toolbar;
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
  const toolbar = createTahNextButton();
  
  let top, left;
  
  // Position to the left of the annotorious popup toolbar
  const popup = document.querySelector(SELECTORS.popup);
  if (popup) {
    const rect = popup.getBoundingClientRect();
    const toolbarWidth = toolbar.offsetWidth || 70; // estimate if not yet rendered
    top = rect.top;
    left = rect.left - toolbarWidth - 6; // 6px gap
    
    // If not enough room on the left, try right side
    if (left < 5) {
      left = rect.right + 6;
    }
  } else {
    // Fallback to click position if popup not found
    top = lastClickPosition.y - 15;
    left = lastClickPosition.x - 80;
  }
  
  // Boundary checks
  if (top < 5) top = 5;
  if (left < 5) left = 5;
  if (left > window.innerWidth - 80) left = window.innerWidth - 80;
  
  toolbar.style.top = top + 'px';
  toolbar.style.left = left + 'px';
}

function triggerFillAndNext() {
  chrome.runtime.sendMessage({ action: 'triggerFillAndNext' }, (response) => {
    if (chrome.runtime.lastError) {
      directFillAndNext();
    }
  });
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
  
  const fillResult = fillAnnotationFields({
    row: tableState.currentRow,
    col: tableState.currentCol,
    xspan: tableState.xspan,
    yspan: tableState.yspan
  });
  
  if (fillResult.success) {
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
