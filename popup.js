document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('results-container');
  const toast = document.getElementById('toast');

  let allSymbols = [];
  let filteredSymbols = [];
  let renderedCount = 0;
  const BATCH_SIZE = 50; // Render 50 items at a time for faster initial load

  // ============================================
  // Tab Navigation
  // ============================================
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      
      // Update buttons
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update content
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `${tabId}-tab`) {
          content.classList.add('active');
        }
      });

      // Save active tab
      localStorage.setItem('unicode_active_tab', tabId);
    });
  });

  // Restore active tab
  const savedTab = localStorage.getItem('unicode_active_tab');
  if (savedTab) {
    const savedBtn = document.querySelector(`.tab-btn[data-tab="${savedTab}"]`);
    if (savedBtn) savedBtn.click();
  }

  // ============================================
  // Unicode Search Tab
  // ============================================

  // State Persistence: Load saved query
  const savedQuery = localStorage.getItem('unicode_search_query') || '';
  if (savedQuery) {
    searchInput.value = savedQuery;
  }

  // Load symbols - try cache first, then CSV
  chrome.storage.local.get(['cached_symbols'], (result) => {
    if (result.cached_symbols && result.cached_symbols.length > 0) {
      // Use cached symbols for instant load
      allSymbols = result.cached_symbols;
      initializeResults();
    } else {
      // First load - fetch and parse CSV
      fetch('Supported Unicode Symbols - General Symbols.csv')
        .then(response => response.text())
        .then(csvText => {
          allSymbols = parseCSV(csvText);
          // Cache for next time
          chrome.storage.local.set({ cached_symbols: allSymbols });
          initializeResults();
        })
        .catch(err => {
          console.error('Error loading CSV:', err);
          resultsContainer.innerHTML = '<div style="padding:10px; color:red;">Error loading symbols.</div>';
        });
    }
  });

  function initializeResults() {
    // Filter immediately if active query
    if (searchInput.value) {
      const query = searchInput.value.toLowerCase();
      filteredSymbols = allSymbols.filter(item => 
        item.name.toLowerCase().includes(query) || 
        item.code.toLowerCase().includes(query) ||
        item.symbol.includes(query)
      );
    } else {
      filteredSymbols = allSymbols;
    }
    
    renderedCount = 0;
    resultsContainer.innerHTML = '';
    renderNextBatch();

    // Restore scroll position
    const savedScroll = localStorage.getItem('unicode_scroll_pos');
    if (savedScroll) {
      setTimeout(() => {
        resultsContainer.scrollTop = parseInt(savedScroll, 10);
      }, 0);
    }
  }

  // Search Listener
  searchInput.addEventListener('input', (e) => {
    localStorage.setItem('unicode_search_query', e.target.value);
    const query = e.target.value.toLowerCase();
    filteredSymbols = allSymbols.filter(item => 
      item.name.toLowerCase().includes(query) || 
      item.code.toLowerCase().includes(query) ||
      item.symbol.includes(query)
    );
    renderedCount = 0;
    resultsContainer.innerHTML = '';
    renderNextBatch();
  });

  // Infinite scroll - load more as user scrolls
  resultsContainer.addEventListener('scroll', () => {
    const scrollPos = resultsContainer.scrollTop;
    localStorage.setItem('unicode_scroll_pos', scrollPos);
    
    // Load more when near bottom
    if (resultsContainer.scrollTop + resultsContainer.clientHeight >= resultsContainer.scrollHeight - 100) {
      renderNextBatch();
    }
  });

  // renderNextBatch - renders the next batch of symbols for lazy loading
  function renderNextBatch() {
    if (renderedCount >= filteredSymbols.length) return;
    
    const endIndex = Math.min(renderedCount + BATCH_SIZE, filteredSymbols.length);
    const batch = filteredSymbols.slice(renderedCount, endIndex);
    
    if (batch.length === 0) {
      if (renderedCount === 0) {
        resultsContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#888;">No symbols found.</div>';
      }
      return;
    }
    
    const fragment = document.createDocumentFragment();
    
    // Group the batch by category
    const grouped = new Map();
    batch.forEach(item => {
      if (!grouped.has(item.category)) {
        grouped.set(item.category, []);
      }
      grouped.get(item.category).push(item);
    });
    
    grouped.forEach((groupItems, categoryName) => {
      // Only add category header if first item of this category in this batch
      const firstOfCategory = filteredSymbols.findIndex(s => s.category === categoryName);
      if (firstOfCategory >= renderedCount && firstOfCategory < endIndex) {
        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = categoryName;
        fragment.appendChild(header);
      }
      
      groupItems.forEach(item => {
        const el = document.createElement('div');
        el.className = 'symbol-item';
        
        const charDiv = document.createElement('div');
        charDiv.className = 'symbol-char';
        charDiv.textContent = item.symbol;
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'symbol-info';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'symbol-name';
        nameSpan.textContent = item.name;
        
        const codeSpan = document.createElement('span');
        codeSpan.className = 'symbol-code';
        codeSpan.textContent = item.code;
        
        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(codeSpan);
        el.appendChild(charDiv);
        el.appendChild(infoDiv);
        
        el.addEventListener('click', () => copyToClipboard(item.symbol));
        fragment.appendChild(el);
      });
    });
    
    resultsContainer.appendChild(fragment);
    renderedCount = endIndex;
  }

  // LaTeX Toggle Handler
  const latexToggle = document.getElementById('latex-toggle');
  
  chrome.storage.local.get(['latexEnabled'], (result) => {
    latexToggle.checked = result.latexEnabled === true;
  });

  latexToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ latexEnabled: e.target.checked });
  });

  function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    const symbols = [];
    let currentCategory = 'General';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = parseCSVLine(line);
      if (parts.length < 1) continue;

      const col0 = parts[0]?.trim() || '';
      const col1 = parts[1]?.trim() || '';
      const col2 = parts[2]?.trim() || '';

      const isCategory = col0 && !col1 && !col2;

      if (isCategory) {
        currentCategory = col0.replace(/^"|"$/g, '');
      } else if (col0 && col1) {
        symbols.push({
          category: currentCategory,
          symbol: col0,
          name: col1,
          code: col2
        });
      }
    }
    return symbols;
  }

  function parseCSVLine(text) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      showToast();
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  }

  function showToast(message) {
    toast.textContent = message || 'Copied to clipboard!';
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2000);
  }

  // ============================================
  // Table Helper Tab
  // ============================================
  
  let tableState = {
    currentRow: 0,
    currentCol: 0,
    totalCols: 3,
    xspan: 1,
    yspan: 1
  };

  // Table Helper Toggle Handler
  const tableHelperToggle = document.getElementById('table-helper-toggle');
  
  chrome.storage.local.get(['tableHelperEnabled'], (result) => {
    tableHelperToggle.checked = result.tableHelperEnabled === true;
  });

  tableHelperToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ tableHelperEnabled: e.target.checked });
  });

  // CharSize Toggle Handler
  const charsizeToggle = document.getElementById('charsize-toggle');
  
  chrome.storage.local.get(['charsizeEnabled'], (result) => {
    if (charsizeToggle) charsizeToggle.checked = result.charsizeEnabled === true;
  });

  if (charsizeToggle) {
    charsizeToggle.addEventListener('change', (e) => {
      chrome.storage.local.set({ charsizeEnabled: e.target.checked });
    });
  }

  // Load saved state from chrome.storage.local
  chrome.storage.local.get(['table_helper_state'], (result) => {
    if (result.table_helper_state) {
      tableState = { ...tableState, ...result.table_helper_state };
    }
    // Update UI with loaded state
    updateTableDisplay();
    document.getElementById('total-cols').value = tableState.totalCols;
    document.getElementById('xspan').value = tableState.xspan;
    document.getElementById('yspan').value = tableState.yspan;
  });

  function updateTableDisplay() {
    document.getElementById('row-value').textContent = tableState.currentRow;
    document.getElementById('col-value').textContent = tableState.currentCol;
  }

  function saveTableState() {
    chrome.storage.local.set({ table_helper_state: tableState });
  }

  // Row controls
  document.getElementById('row-dec').addEventListener('click', () => {
    if (tableState.currentRow > 0) {
      tableState.currentRow--;
      updateTableDisplay();
      saveTableState();
    }
  });

  document.getElementById('row-inc').addEventListener('click', () => {
    tableState.currentRow++;
    updateTableDisplay();
    saveTableState();
  });

  // Column controls
  document.getElementById('col-dec').addEventListener('click', () => {
    if (tableState.currentCol > 0) {
      tableState.currentCol--;
      updateTableDisplay();
      saveTableState();
    }
  });

  document.getElementById('col-inc').addEventListener('click', () => {
    tableState.currentCol++;
    updateTableDisplay();
    saveTableState();
  });

  // Input handlers
  document.getElementById('total-cols').addEventListener('change', (e) => {
    tableState.totalCols = parseInt(e.target.value) || 3;
    saveTableState();
  });

  document.getElementById('xspan').addEventListener('change', (e) => {
    tableState.xspan = parseInt(e.target.value) || 1;
    saveTableState();
  });

  document.getElementById('yspan').addEventListener('change', (e) => {
    tableState.yspan = parseInt(e.target.value) || 1;
    saveTableState();
  });

  // Reset button
  document.getElementById('reset-btn').addEventListener('click', () => {
    tableState.currentRow = 0;
    tableState.currentCol = 0;
    updateTableDisplay();
    saveTableState();
  });

  // Fill button
  document.getElementById('fill-btn').addEventListener('click', () => {
    fillAndNext();
  });

  async function fillFields() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'fillTableAnnotation',
        data: {
          row: tableState.currentRow,
          col: tableState.currentCol,
          xspan: tableState.xspan,
          yspan: tableState.yspan
        }
      });

      if (response && response.success) {
        showToast('Fields filled!');
        return true;
      } else {
        showToast(response?.error || 'Failed to fill fields');
        return false;
      }
    } catch (err) {
      console.error('Error sending message:', err);
      showToast('No annotation popup found');
      return false;
    }
  }

  async function fillAndNext() {
    const success = await fillFields();
    
    if (success) {
      tableState.currentCol++;
      
      if (tableState.currentCol >= tableState.totalCols) {
        tableState.currentCol = 0;
        tableState.currentRow++;
      }
      
      updateTableDisplay();
      saveTableState();
    }
  }

  // Keyboard shortcuts for table helper tab
  document.addEventListener('keydown', (e) => {
    const tableTab = document.getElementById('table-tab');
    if (!tableTab.classList.contains('active')) return;
    if (e.target.tagName === 'INPUT') return;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        fillFields();
      } else {
        fillAndNext();
      }
    }
  });
});
