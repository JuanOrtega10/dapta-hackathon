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

  // Fallback IDs (used if dynamic fetch fails)
  // TODO: Configure these values or use environment variables
  const FALLBACK_IDS = {
    retellAgentId: '', // e.g., 'agent_xxx'
    retellLlmId: '', // e.g., 'llm_xxx'
    elevenLabsVoiceId: '', // e.g., 'custom_voice_xxx'
    workspaceId: '', // UUID
    organizationId: '' // UUID
  };

  // Cache for dynamic agent data
  let cachedAgentData = null;
  let lastAgentId = null;

  // ============================================
  // MOCK DATA FOR TESTING
  // ============================================
  const MOCK_UPDATES = [
    {
      id: 1,
      type: 'prompt_update',
      action: 'append_space',
      description: 'Agregar espacio al final del prompt',
      payload: { appendText: ' ' }
    },
    {
      id: 2,
      type: 'prompt_update',
      action: 'append_text',
      description: 'Agregar texto de prueba',
      payload: { appendText: '\n# Test desde extensión' }
    },
    {
      id: 3,
      type: 'prompt_update',
      action: 'replace_text',
      description: 'Reemplazar texto',
      payload: { find: 'Emmy', replace: 'Emmy AI' }
    }
  ];

  // State
  let pollingInterval = null;
  let lastProcessedUpdateId = 0;
  let mockUpdateIndex = 0;

  // ============================================
  // CREDENTIAL MANAGEMENT
  // ============================================

  // x-api-key discovered from Dapta's actual API calls
  // This is the correct authentication method (NOT Bearer token)
  // TODO: Configure your API key here or fetch dynamically
  const DAPTA_API_KEY = ''; // Set your Dapta API key

  function getCredentials() {
    return {
      accessToken: localStorage.getItem('iam_access_token'),
      tokenType: localStorage.getItem('iam_token_type') || 'Bearer',
      sessionId: localStorage.getItem('iam_session_id'),
      userId: localStorage.getItem('iam_user_id'),
      apiKey: DAPTA_API_KEY
    };
  }

  function getAuthHeaders() {
    const creds = getCredentials();
    // Dapta uses x-api-key header, NOT Bearer token
    return {
      'x-api-key': creds.apiKey,
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

  // Fetch agent data from Dapta API (with fallback to hardcoded values)
  async function fetchAgentData() {
    const currentAgentId = extractAgentId();

    // Invalidate cache if agent changed (SPA navigation)
    if (lastAgentId && lastAgentId !== currentAgentId) {
      console.log('[Dapta Exporter] Agent changed, clearing cache');
      cachedAgentData = null;
    }
    lastAgentId = currentAgentId;

    // Return cached data if available
    if (cachedAgentData) {
      return cachedAgentData;
    }

    const daptaAgentId = currentAgentId;
    if (!daptaAgentId) {
      console.warn('[Dapta Exporter] No agent ID in URL, using fallback IDs');
      return {
        daptaAgentId: null,
        retellAgentId: FALLBACK_IDS.retellAgentId,
        retellLlmId: FALLBACK_IDS.retellLlmId,
        voiceId: FALLBACK_IDS.elevenLabsVoiceId,
        agentName: '',
        model: '',
        instructions: '',
        variables: [],
        agentContext: null,
        companyContext: null,
        source: 'fallback'
      };
    }

    try {
      console.log('[Dapta Exporter] Fetching agent data for:', daptaAgentId);
      const response = await fetch(
        `https://api.dapta.ai/api/devops-dapta-tech-169-938-7/getagent/${daptaAgentId}`,
        { headers: getAuthHeaders() }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const agent = data.agent || {};

      cachedAgentData = {
        daptaAgentId,
        retellAgentId: agent.voice_retell_agent_id || FALLBACK_IDS.retellAgentId,
        retellLlmId: agent.voice_llm_id || FALLBACK_IDS.retellLlmId,
        voiceId: agent.voice || FALLBACK_IDS.elevenLabsVoiceId,
        agentName: agent.name || '',
        model: agent.model || '',
        instructions: agent.instructions || '',
        variables: agent.variables || [],
        agentContext: agent.agent_context || null,
        companyContext: agent.company_context || null,
        source: 'api'
      };

      console.log('[Dapta Exporter] Agent data fetched:', cachedAgentData);
      return cachedAgentData;

    } catch (error) {
      console.warn('[Dapta Exporter] Failed to fetch agent data, using fallback:', error.message);
      return {
        daptaAgentId,
        retellAgentId: FALLBACK_IDS.retellAgentId,
        retellLlmId: FALLBACK_IDS.retellLlmId,
        voiceId: FALLBACK_IDS.elevenLabsVoiceId,
        agentName: '',
        model: '',
        instructions: '',
        variables: [],
        agentContext: null,
        companyContext: null,
        source: 'fallback'
      };
    }
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

    console.warn('[Dapta Exporter] Could not extract prompt - all methods failed');
    return '';
  }

  async function extractAgentData() {
    const url = window.location.href;

    // Fetch dynamic agent data from API (includes variables)
    const agentData = await fetchAgentData();

    // Deduplicate variables (API may return duplicates)
    const uniqueVariables = [];
    const seenKeys = new Set();
    for (const v of agentData.variables || []) {
      if (!seenKeys.has(v.key)) {
        seenKeys.add(v.key);
        uniqueVariables.push({ key: v.key, value: v.value });
      }
    }

    return {
      agent: {
        name: agentData.agentName,
        daptaAgentId: agentData.daptaAgentId || extractAgentId(),
        retellAgentId: agentData.retellAgentId,
        llmId: agentData.retellLlmId,
        voiceId: agentData.voiceId
      },
      configuration: {
        llmModel: agentData.model,
        systemPrompt: agentData.instructions || extractSystemPrompt(),
        inputVariables: uniqueVariables
      },
      context: {
        agent: agentData.agentContext,
        company: agentData.companyContext
      },
      organization: {
        workspaceId: FALLBACK_IDS.workspaceId,
        organizationId: FALLBACK_IDS.organizationId
      },
      metadata: {
        exportedAt: new Date().toISOString(),
        sourceUrl: url,
        extensionVersion: '1.6.0',
        dataSource: agentData.source
      }
    };
  }

  // ============================================
  // UPDATE AGENT (PUT REQUEST)
  // ============================================
  async function updateAgentPrompt(newPrompt) {
    // Fetch dynamic agent IDs (with fallback)
    const agentData = await fetchAgentData();
    const agentId = agentData.retellAgentId;
    const llmId = agentData.retellLlmId;

    const url = `${CONFIG.UPDATE_ENDPOINT}?agent_id=${agentId}&llm_id=${llmId}`;
    const headers = getAuthHeaders();

    console.log('[Dapta Exporter] Updating agent prompt...');
    console.log('[Dapta Exporter] Agent IDs source:', agentData.source);
    console.log('[Dapta Exporter] Retell Agent ID:', agentId);
    console.log('[Dapta Exporter] LLM ID:', llmId);
    console.log('[Dapta Exporter] URL:', url);
    console.log('[Dapta Exporter] Prompt length:', newPrompt.length);

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: headers,
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
      // Build polling URL with agentId
      const pollingUrl = `${CONFIG.POLLING_ENDPOINT}?agentId=${agentId}`;

      // Only poll from real server, not mock endpoint
      if (CONFIG.POLLING_ENDPOINT.includes('httpbin.org')) {
        // httpbin is a test endpoint - skip polling to avoid reload loops
        console.log('[Dapta Exporter] Skipping poll - configure POLLING_ENDPOINT to your server');
        return;
      }

      // Production mode - fetch from real server
      {
        // Production mode - fetch from real server
        const response = await fetch(pollingUrl);
        const data = await response.json();

        if (data.update) {
          console.log('[Dapta Exporter] Found update from server:', data.update);
          await processUpdate(data.update);
        } else {
          console.log('[Dapta Exporter] No updates available');
        }
      }

    } catch (error) {
      console.error('[Dapta Exporter] Polling error:', error);
    }
  }

  function getMockUpdate() {
    // Simulate getting an update every 3rd poll
    if (Math.random() > 0.7 && mockUpdateIndex < MOCK_UPDATES.length) {
      const update = MOCK_UPDATES[mockUpdateIndex];
      mockUpdateIndex++;
      return update;
    }
    return null;
  }

  async function processUpdate(update) {
    if (update.id <= lastProcessedUpdateId) {
      console.log('[Dapta Exporter] Update already processed, skipping');
      return;
    }

    const currentPrompt = extractSystemPrompt();

    // Validate prompt before applying update
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

      // Refresh the page to show the changes
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } else {
      showNotification(`Error: ${result.error}`, 'error');
    }
  }

  function startPolling() {
    // Block polling entirely when using mock endpoint
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

    // Clone to remove all existing event listeners
    const newButton = mejorarBtn.cloneNode(true);
    newButton.id = CONFIG.BUTTON_ID;
    newButton.dataset.hijacked = 'true';

    // Update button text - walk through all text nodes
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

    // Replace original button
    mejorarBtn.parentNode.replaceChild(newButton, mejorarBtn);

    // Add our click handler
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
      // Fetch agent data from API
      const agentData = await fetchAgentData();

      // Build query params with minimum required data
      const params = new URLSearchParams({
        daptaAgentId: agentData.daptaAgentId,
        retellAgentId: agentData.retellAgentId,
        llmId: agentData.retellLlmId,
        apiKey: DAPTA_API_KEY,
        agentName: agentData.agentName || ''
      });

      // Open new window with the external system URL + params
      const targetUrl = `${CONFIG.EXPORT_ENDPOINT}?${params.toString()}`;
      console.log('[Dapta Exporter] Opening external system:', targetUrl);

      window.open(targetUrl, '_blank');
      showNotification('Abriendo Cadence...', 'success');

    } catch (error) {
      console.error('[Dapta Exporter] Export failed:', error);
      showNotification('Error al obtener datos del agente', 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = originalContent;
    }
  }

  async function handleTestUpdate(event) {
    event.preventDefault();

    console.log('[Dapta Exporter] Testing update with simple change...');

    const currentPrompt = extractSystemPrompt();

    // Validate prompt
    if (!currentPrompt || currentPrompt.length < 50) {
      showNotification('Error: No se pudo extraer el prompt', 'error');
      return;
    }

    const testUpdate = {
      id: Date.now(),
      action: 'append_space',
      description: 'Test: Agregar espacio'
    };

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

    // Hijack the existing "Mejorar con IA" button
    const hijackedButton = hijackMejorarButton(mejorarBtn);

    // Only show Test Update button in dev mode
    if (CONFIG.DEV_MODE) {
      const testUpdateButton = createTestUpdateButton();
      hijackedButton.parentNode.insertBefore(testUpdateButton, hijackedButton.nextSibling);
    }

    console.log('[Dapta Exporter] Button hijacked: Mejorar con IA → Test in Cadence');
    return true;
  }

  function init() {
    let retries = 0;

    const tryInject = () => {
      if (injectButton()) {
        console.log('[Dapta Exporter] Extension initialized v1.6.0 (query params export)');
        injectStyles();

        // Only show polling indicator and auto-start if using real endpoint
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
