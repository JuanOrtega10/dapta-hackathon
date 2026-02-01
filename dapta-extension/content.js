// Dapta Agent Exporter - Content Script with Polling & Update
(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  const CONFIG = {
    // Endpoints
    EXPORT_ENDPOINT: 'https://cadence.crafter.run/app/stress-test',  // URL de Cadence
    POLLING_ENDPOINT: 'https://httpbin.org/get', // Mock endpoint - replace with your server
    UPDATE_ENDPOINT: 'https://api.dapta.ai/api/devops-dapta-tech-169-938-7/updatevoiceagentllm',

    // Polling
    POLLING_INTERVAL: 5000, // 5 seconds
    POLLING_ENABLED: true,

    // Development mode (shows Test Update button)
    DEV_MODE: false,

    // UI
    BUTTON_ID: 'dapta-export-btn',
    POLLING_INDICATOR_ID: 'dapta-polling-indicator',

    // Retry
    MAX_RETRIES: 30,
    CHECK_INTERVAL: 1000
  };

  // Fallback values - Real data from current session (Emmy agent)
  const FALLBACK = {
    daptaAgentId: 'ff5ac372-ae50-4ae0-a43a-33a177b2b0c2',
    retellAgentId: 'agent_68be86524f8222865a235714f6',
    retellLlmId: 'llm_151ffde660d1feebc1edc867a525',
    voiceId: 'custom_voice_b7f9d4e2175e188767738b4a1c',
    workspaceId: '39071534-c94d-4737-ba4c-1f5fbd9b4c9f',
    organizationId: '39071534-c94d-4737-ba4c-1f5fbd9b4c9f',
    apiKey: 'sVLfT-8f5211b7-ea23-4f31-b0ab-29710a46e83b-f',
    agentName: 'Emmy - Calificación De Leads'
  };

  // Cache for intercepted data
  let interceptedAgentData = null;
  let interceptedApiKey = null;
  let lastAgentId = null;

  // State
  let pollingInterval = null;
  let lastProcessedUpdateId = 0;

  // ============================================
  // NETWORK INTERCEPTION
  // ============================================

  // Intercept fetch requests to capture API key and agent data
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const [url, options] = args;
    const urlStr = typeof url === 'string' ? url : url.toString();

    // Capture x-api-key from outgoing requests
    if (options && options.headers) {
      const headers = options.headers;
      let apiKey = null;

      if (headers instanceof Headers) {
        apiKey = headers.get('x-api-key');
      } else if (typeof headers === 'object') {
        apiKey = headers['x-api-key'] || headers['X-Api-Key'];
      }

      if (apiKey && !interceptedApiKey) {
        console.log('[Dapta Exporter] Captured API key from request');
        interceptedApiKey = apiKey;
      }
    }

    // Call original fetch
    const response = await originalFetch.apply(this, args);

    // Clone response to read body without consuming it
    const clonedResponse = response.clone();

    // Intercept agent data responses
    if (urlStr.includes('/getagent/')) {
      try {
        const data = await clonedResponse.json();
        if (data && data.agent) {
          console.log('[Dapta Exporter] Intercepted agent data from network');
          interceptedAgentData = {
            daptaAgentId: data.agent.id,
            retellAgentId: data.agent.voice_retell_agent_id,
            retellLlmId: data.agent.voice_llm_id,
            voiceId: data.agent.voice,
            agentName: data.agent.name,
            model: data.agent.model,
            instructions: data.agent.instructions,
            variables: data.agent.variables || [],
            agentContext: data.agent.agent_context,
            companyContext: data.agent.company_context,
            organizationId: data.agent.organization_id,
            source: 'intercepted'
          };
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    return response;
  };

  // Also intercept XMLHttpRequest for older code paths
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (name.toLowerCase() === 'x-api-key' && value && !interceptedApiKey) {
      console.log('[Dapta Exporter] Captured API key from XHR');
      interceptedApiKey = value;
    }
    return originalXHRSetRequestHeader.apply(this, [name, value]);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const xhr = this;
    const url = this._url || '';

    if (url.includes('/getagent/')) {
      xhr.addEventListener('load', function() {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data && data.agent) {
            console.log('[Dapta Exporter] Intercepted agent data from XHR');
            interceptedAgentData = {
              daptaAgentId: data.agent.id,
              retellAgentId: data.agent.voice_retell_agent_id,
              retellLlmId: data.agent.voice_llm_id,
              voiceId: data.agent.voice,
              agentName: data.agent.name,
              model: data.agent.model,
              instructions: data.agent.instructions,
              variables: data.agent.variables || [],
              agentContext: data.agent.agent_context,
              companyContext: data.agent.company_context,
              organizationId: data.agent.organization_id,
              source: 'intercepted-xhr'
            };
          }
        } catch (e) {
          // Ignore parse errors
        }
      });
    }

    return originalXHRSend.apply(this, [body]);
  };

  // ============================================
  // CREDENTIAL MANAGEMENT
  // ============================================

  function getApiKey() {
    // Priority: intercepted > localStorage > fallback
    if (interceptedApiKey) {
      return interceptedApiKey;
    }

    // Try to find in localStorage (some apps store it there)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      if (value && value.startsWith('sVLfT-')) {
        console.log('[Dapta Exporter] Found API key in localStorage');
        interceptedApiKey = value;
        return value;
      }
    }

    // Use fallback
    console.log('[Dapta Exporter] Using fallback API key');
    return FALLBACK.apiKey;
  }

  function getAuthHeaders() {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn('[Dapta Exporter] No API key available');
    }
    return {
      'x-api-key': apiKey || '',
      'Content-Type': 'application/json'
    };
  }

  // ============================================
  // AGENT DATA EXTRACTION
  // ============================================
  function extractAgentId() {
    const url = window.location.href;
    const match = url.match(/voice-agents\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  // Pre-fetch agent data silently in background
  async function prefetchAgentData() {
    const currentAgentId = extractAgentId();
    if (!currentAgentId) return;

    // Already have data for this agent
    if (interceptedAgentData && interceptedAgentData.daptaAgentId === currentAgentId) {
      return;
    }

    console.log('[Dapta Exporter] Pre-fetching agent data silently...');

    try {
      const response = await originalFetch(
        `https://api.dapta.ai/api/devops-dapta-tech-169-938-7/getagent/${currentAgentId}`,
        {
          headers: {
            'x-api-key': FALLBACK.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const agent = data.agent || {};

      interceptedAgentData = {
        daptaAgentId: currentAgentId,
        retellAgentId: agent.voice_retell_agent_id || FALLBACK.retellAgentId,
        retellLlmId: agent.voice_llm_id || FALLBACK.retellLlmId,
        voiceId: agent.voice || FALLBACK.voiceId,
        agentName: agent.name || FALLBACK.agentName,
        model: agent.model || 'gpt-4.1',
        instructions: agent.instructions || '',
        variables: agent.variables || [],
        agentContext: agent.agent_context || null,
        companyContext: agent.company_context || null,
        organizationId: agent.organization_id || FALLBACK.organizationId,
        source: 'prefetch'
      };

      // Also capture API key if we got a successful response
      if (!interceptedApiKey) {
        interceptedApiKey = FALLBACK.apiKey;
      }

      console.log('[Dapta Exporter] Agent data pre-fetched successfully:', interceptedAgentData.agentName);

    } catch (error) {
      console.log('[Dapta Exporter] Pre-fetch failed, will use fallback:', error.message);
      // Set fallback data so button works immediately
      interceptedAgentData = {
        daptaAgentId: currentAgentId || FALLBACK.daptaAgentId,
        retellAgentId: FALLBACK.retellAgentId,
        retellLlmId: FALLBACK.retellLlmId,
        voiceId: FALLBACK.voiceId,
        agentName: FALLBACK.agentName,
        model: 'gpt-4.1',
        instructions: '',
        variables: [],
        agentContext: null,
        companyContext: null,
        organizationId: FALLBACK.organizationId,
        source: 'fallback'
      };
      interceptedApiKey = FALLBACK.apiKey;
    }
  }

  async function fetchAgentData() {
    const currentAgentId = extractAgentId();

    // Check if agent changed (SPA navigation)
    if (lastAgentId && lastAgentId !== currentAgentId) {
      console.log('[Dapta Exporter] Agent changed, clearing cache');
      interceptedAgentData = null;
      // Re-fetch for new agent
      await prefetchAgentData();
    }
    lastAgentId = currentAgentId;

    // Return cached/intercepted data if available
    if (interceptedAgentData) {
      console.log('[Dapta Exporter] Using cached agent data (source:', interceptedAgentData.source, ')');
      return interceptedAgentData;
    }

    // No cached data - fetch now
    await prefetchAgentData();

    // Return whatever we have (prefetched or fallback)
    return interceptedAgentData || {
      daptaAgentId: currentAgentId || FALLBACK.daptaAgentId,
      retellAgentId: FALLBACK.retellAgentId,
      retellLlmId: FALLBACK.retellLlmId,
      voiceId: FALLBACK.voiceId,
      agentName: FALLBACK.agentName,
      model: 'gpt-4.1',
      instructions: '',
      variables: [],
      agentContext: null,
      companyContext: null,
      organizationId: FALLBACK.organizationId,
      source: 'fallback'
    };
  }

  function extractSystemPrompt() {
    // Method 1: Try Monaco editor directly
    const monacoLines = document.querySelectorAll('.view-lines .view-line');
    if (monacoLines.length > 0) {
      const text = Array.from(monacoLines).map(line => line.textContent).join('\n');
      if (text.trim()) {
        console.log('[Dapta Exporter] Prompt extracted via Monaco (.view-lines):', text.length, 'chars');
        return text;
      }
    }

    // Method 2: Try code block with view-line children
    const codeBlock = document.querySelector('code');
    if (codeBlock) {
      const lines = codeBlock.querySelectorAll('[class*="view-line"]');
      if (lines.length > 0) {
        const text = Array.from(lines).map(line => line.textContent).join('\n');
        if (text.trim()) {
          console.log('[Dapta Exporter] Prompt extracted via code block:', text.length, 'chars');
          return text;
        }
      }
      if (codeBlock.textContent.trim()) {
        console.log('[Dapta Exporter] Prompt extracted via code textContent:', codeBlock.textContent.length, 'chars');
        return codeBlock.textContent;
      }
    }

    // Method 3: Try textarea with prompt content
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.value && ta.value.length > 100) {
        console.log('[Dapta Exporter] Prompt extracted via textarea:', ta.value.length, 'chars');
        return ta.value;
      }
    }

    // Method 4: Try Monaco model if available globally
    if (window.monaco && window.monaco.editor) {
      const editors = window.monaco.editor.getEditors();
      if (editors.length > 0) {
        const model = editors[0].getModel();
        if (model) {
          const text = model.getValue();
          console.log('[Dapta Exporter] Prompt extracted via Monaco API:', text.length, 'chars');
          return text;
        }
      }
    }

    // Method 5: Use intercepted instructions
    if (interceptedAgentData && interceptedAgentData.instructions) {
      console.log('[Dapta Exporter] Using intercepted instructions:', interceptedAgentData.instructions.length, 'chars');
      return interceptedAgentData.instructions;
    }

    console.warn('[Dapta Exporter] Could not extract prompt - all methods failed');
    return '';
  }

  // ============================================
  // UPDATE AGENT (PUT REQUEST)
  // ============================================
  async function updateAgentPrompt(newPrompt) {
    const agentData = await fetchAgentData();
    const agentId = agentData.retellAgentId;
    const llmId = agentData.retellLlmId;

    if (!agentId || !llmId) {
      console.error('[Dapta Exporter] Missing agent IDs for update');
      return { success: false, error: 'Missing agent IDs - wait for page to fully load' };
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      console.error('[Dapta Exporter] No API key available for update');
      return { success: false, error: 'No API key - navigate to agent page first' };
    }

    const url = `${CONFIG.UPDATE_ENDPOINT}?agent_id=${agentId}&llm_id=${llmId}`;

    console.log('[Dapta Exporter] Updating agent prompt...');
    console.log('[Dapta Exporter] Agent IDs source:', agentData.source);
    console.log('[Dapta Exporter] Retell Agent ID:', agentId);
    console.log('[Dapta Exporter] LLM ID:', llmId);
    console.log('[Dapta Exporter] Prompt length:', newPrompt.length);

    try {
      const response = await originalFetch(url, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          general_prompt: newPrompt
        })
      });

      console.log('[Dapta Exporter] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Dapta Exporter] Error response:', errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log('[Dapta Exporter] Update successful:', result);
      return { success: true, result };

    } catch (error) {
      console.error('[Dapta Exporter] Update failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // APPLY UPDATE TO PROMPT
  // ============================================
  function applyUpdateToPrompt(currentPrompt, update) {
    let newPrompt = currentPrompt;

    switch (update.action) {
      case 'append_space':
        newPrompt = currentPrompt + ' ';
        break;
      case 'append_text':
        newPrompt = currentPrompt + update.payload.appendText;
        break;
      case 'replace_text':
        newPrompt = currentPrompt.replace(update.payload.find, update.payload.replace);
        break;
      case 'set_prompt':
        newPrompt = update.payload.newPrompt;
        break;
      default:
        console.warn('[Dapta Exporter] Unknown update action:', update.action);
    }

    return newPrompt;
  }

  // ============================================
  // POLLING MECHANISM
  // ============================================
  async function checkForUpdates() {
    const agentId = extractAgentId();
    console.log('[Dapta Exporter] Checking for updates for agent:', agentId);

    try {
      const pollingUrl = `${CONFIG.POLLING_ENDPOINT}?agentId=${agentId}`;

      if (CONFIG.POLLING_ENDPOINT.includes('httpbin.org')) {
        console.log('[Dapta Exporter] Skipping poll - configure POLLING_ENDPOINT to your server');
        return;
      }

      const response = await originalFetch(pollingUrl);
      const data = await response.json();

      if (data.update) {
        console.log('[Dapta Exporter] Found update from server:', data.update);
        await processUpdate(data.update);
      } else {
        console.log('[Dapta Exporter] No updates available');
      }

    } catch (error) {
      console.error('[Dapta Exporter] Polling error:', error);
    }
  }

  async function processUpdate(update) {
    if (update.id <= lastProcessedUpdateId) {
      console.log('[Dapta Exporter] Update already processed, skipping');
      return;
    }

    const currentPrompt = extractSystemPrompt();

    if (!currentPrompt || currentPrompt.length < 50) {
      console.error('[Dapta Exporter] Prompt extraction failed or too short, aborting update');
      showNotification('Error: No se pudo extraer el prompt', 'error');
      return;
    }

    const newPrompt = applyUpdateToPrompt(currentPrompt, update);

    console.log('[Dapta Exporter] Applying update:', update.description);
    console.log('[Dapta Exporter] Prompt change:', {
      lengthBefore: currentPrompt.length,
      lengthAfter: newPrompt.length
    });

    const result = await updateAgentPrompt(newPrompt);

    if (result.success) {
      lastProcessedUpdateId = update.id;
      showNotification(`Update aplicado: ${update.description}`, 'success');

      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } else {
      showNotification(`Error: ${result.error}`, 'error');
    }
  }

  function startPolling() {
    if (CONFIG.POLLING_ENDPOINT.includes('httpbin.org')) {
      console.log('[Dapta Exporter] Polling disabled - configure POLLING_ENDPOINT first');
      showNotification('Configura POLLING_ENDPOINT para activar sync', 'error');
      return;
    }

    if (pollingInterval) {
      console.log('[Dapta Exporter] Polling already running');
      return;
    }

    console.log('[Dapta Exporter] Starting polling every', CONFIG.POLLING_INTERVAL, 'ms');
    pollingInterval = setInterval(checkForUpdates, CONFIG.POLLING_INTERVAL);
    updatePollingIndicator(true);
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
      console.log('[Dapta Exporter] Polling stopped');
      updatePollingIndicator(false);
    }
  }

  // ============================================
  // UI COMPONENTS
  // ============================================
  function showNotification(message, type = 'success') {
    const existing = document.getElementById('dapta-export-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'dapta-export-notification';
    notification.className = `dapta-export-notification dapta-export-notification--${type}`;
    notification.innerHTML = `
      <span class="dapta-export-notification__icon">${type === 'success' ? '✓' : '✕'}</span>
      <span class="dapta-export-notification__message">${message}</span>
    `;

    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }

  function updatePollingIndicator(isActive) {
    let indicator = document.getElementById(CONFIG.POLLING_INDICATOR_ID);

    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = CONFIG.POLLING_INDICATOR_ID;
      indicator.className = 'dapta-polling-indicator';
      indicator.title = 'Click para activar/desactivar sincronización';
      document.body.appendChild(indicator);
    }

    indicator.innerHTML = `
      <span class="dapta-polling-dot ${isActive ? 'active' : ''}"></span>
      <span>${isActive ? 'Sync' : 'Off'}</span>
    `;
    indicator.onclick = () => isActive ? stopPolling() : startPolling();
  }

  function hijackMejorarButton(mejorarBtn) {
    console.log('[Dapta Exporter] Hijacking button:', mejorarBtn.textContent.trim());

    const newButton = mejorarBtn.cloneNode(true);
    newButton.id = CONFIG.BUTTON_ID;
    newButton.dataset.hijacked = 'true';

    const updateText = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.includes('Mejorar con IA')) {
          node.textContent = node.textContent.replace('Mejorar con IA', 'Test in Cadence');
        }
      } else {
        node.childNodes.forEach(updateText);
      }
    };
    updateText(newButton);

    mejorarBtn.parentNode.replaceChild(newButton, mejorarBtn);
    newButton.addEventListener('click', handleExportClick);

    return newButton;
  }

  function createTestUpdateButton() {
    const button = document.createElement('button');
    button.id = 'dapta-test-update-btn';
    button.className = 'dapta-button dapta-button--outline dapta-export-button';
    button.style.marginLeft = '8px';
    button.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 4v6h-6"/>
        <path d="M1 20v-6h6"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
      Test Update
    `;
    button.addEventListener('click', handleTestUpdate);
    return button;
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================
  async function handleExportClick(event) {
    event.preventDefault();
    const button = document.getElementById(CONFIG.BUTTON_ID);
    if (!button || button.disabled) return;

    button.disabled = true;
    const originalContent = button.innerHTML;
    button.innerHTML = '<span class="dapta-spinner">⏳</span> Cargando...';

    try {
      // Get agent data (already pre-fetched or from cache)
      const agentData = await fetchAgentData();
      const apiKey = getApiKey() || FALLBACK.apiKey;

      // Use data with fallbacks - always have valid values
      const daptaAgentId = agentData.daptaAgentId || extractAgentId() || FALLBACK.daptaAgentId;
      const retellAgentId = agentData.retellAgentId || FALLBACK.retellAgentId;
      const llmId = agentData.retellLlmId || FALLBACK.retellLlmId;
      const agentName = agentData.agentName || FALLBACK.agentName;

      console.log('[Dapta Exporter] Opening Cadence with:', {
        daptaAgentId,
        retellAgentId,
        llmId,
        agentName,
        source: agentData.source
      });

      // Build query params
      const params = new URLSearchParams({
        daptaAgentId,
        retellAgentId,
        llmId,
        apiKey,
        agentName
      });

      const targetUrl = `${CONFIG.EXPORT_ENDPOINT}?${params.toString()}`;
      window.open(targetUrl, '_blank');
      showNotification('Abriendo Cadence...', 'success');

    } catch (error) {
      console.error('[Dapta Exporter] Export failed:', error);

      // Even on error, try with fallback values
      console.log('[Dapta Exporter] Using full fallback values');
      const params = new URLSearchParams({
        daptaAgentId: extractAgentId() || FALLBACK.daptaAgentId,
        retellAgentId: FALLBACK.retellAgentId,
        llmId: FALLBACK.retellLlmId,
        apiKey: FALLBACK.apiKey,
        agentName: FALLBACK.agentName
      });

      const targetUrl = `${CONFIG.EXPORT_ENDPOINT}?${params.toString()}`;
      window.open(targetUrl, '_blank');
      showNotification('Abriendo Cadence (fallback)...', 'success');
    } finally {
      button.disabled = false;
      button.innerHTML = originalContent;
    }
  }

  async function handleTestUpdate(event) {
    event.preventDefault();

    console.log('[Dapta Exporter] Testing update with simple change...');

    const currentPrompt = extractSystemPrompt();

    if (!currentPrompt || currentPrompt.length < 50) {
      showNotification('Error: No se pudo extraer el prompt', 'error');
      return;
    }

    const newPrompt = currentPrompt + ' ';

    console.log('[Dapta Exporter] Current prompt length:', currentPrompt.length);
    console.log('[Dapta Exporter] New prompt length:', newPrompt.length);

    showNotification('Enviando actualización de prueba...', 'success');

    const result = await updateAgentPrompt(newPrompt);

    if (result.success) {
      showNotification('¡Update exitoso! Recargando...', 'success');
      setTimeout(() => window.location.reload(), 2000);
    } else {
      showNotification(`Error: ${result.error}`, 'error');
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .dapta-polling-indicator {
        position: fixed;
        bottom: 16px;
        right: 16px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: rgba(26, 26, 46, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        color: rgba(255, 255, 255, 0.6);
        font-family: 'Poppins', sans-serif;
        font-size: 10px;
        cursor: pointer;
        z-index: 999998;
        transition: all 0.2s ease;
        opacity: 0.5;
      }
      .dapta-polling-indicator:hover {
        opacity: 1;
        background: rgba(26, 26, 46, 0.9);
      }
      .dapta-polling-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #555;
      }
      .dapta-polling-dot.active {
        background: rgb(166, 203, 23);
        box-shadow: 0 0 4px rgb(166, 203, 23);
        animation: pulse 2s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      .dapta-spinner {
        display: inline-block;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  function injectButton() {
    if (document.getElementById(CONFIG.BUTTON_ID)) return true;

    const buttons = Array.from(document.querySelectorAll('button'));
    const mejorarBtn = buttons.find(b =>
      b.textContent.includes('Mejorar con IA') &&
      !b.textContent.includes('Cadence') &&
      !b.dataset.hijacked
    );

    if (!mejorarBtn) return false;

    const hijackedButton = hijackMejorarButton(mejorarBtn);

    if (CONFIG.DEV_MODE) {
      const testUpdateButton = createTestUpdateButton();
      hijackedButton.parentNode.insertBefore(testUpdateButton, hijackedButton.nextSibling);
    }

    console.log('[Dapta Exporter] Button hijacked: Mejorar con IA → Test in Cadence');
    return true;
  }

  function init() {
    console.log('[Dapta Exporter] Initializing v1.8.0 (auto-prefetch)');

    // Pre-fetch agent data immediately in background (silent, no UI)
    prefetchAgentData();

    let retries = 0;

    const tryInject = () => {
      if (injectButton()) {
        console.log('[Dapta Exporter] Extension initialized');
        injectStyles();

        // Log current state
        console.log('[Dapta Exporter] Current state:', {
          hasInterceptedData: !!interceptedAgentData,
          hasApiKey: !!interceptedApiKey,
          agentId: extractAgentId()
        });

        if (!CONFIG.POLLING_ENDPOINT.includes('httpbin.org')) {
          updatePollingIndicator(false);
          if (CONFIG.POLLING_ENABLED) {
            setTimeout(startPolling, 2000);
          }
        } else {
          console.log('[Dapta Exporter] Polling disabled - using mock endpoint');
        }
        return;
      }

      retries++;
      if (retries < CONFIG.MAX_RETRIES) {
        setTimeout(tryInject, CONFIG.CHECK_INTERVAL);
      }
    };

    tryInject();

    // Watch for SPA navigation
    const observer = new MutationObserver(() => {
      if (!document.getElementById(CONFIG.BUTTON_ID)) {
        injectButton();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
