# Dapta Extension - Documentación Completa

## Resumen

La extensión de Dapta permite:
1. **Exportar** información del agente a un endpoint externo
2. **Recibir actualizaciones** via polling desde un servidor
3. **Actualizar el agente** en Dapta usando la API oficial

**Versión actual:** 1.6.0

---

## Arquitectura General

```
┌─────────────────┐     Export      ┌─────────────────┐
│                 │ ──────────────► │                 │
│   Dapta App     │                 │   Tu Servidor   │
│   (Browser)     │ ◄────────────── │   (Backend)     │
│                 │    Polling      │                 │
└────────┬────────┘                 └─────────────────┘
         │
         │ Update API
         ▼
┌─────────────────┐
│   Dapta API     │
│ (api.dapta.ai)  │
└─────────────────┘
```

---

## 1. Exportar Agente (POST)

Cuando se hace clic en "Exportar Agente", la extensión envía los datos del agente.

### Request

```http
POST {EXPORT_ENDPOINT}
Content-Type: application/json
```

**Endpoint actual:** `https://httpbin.org/post` (prueba)

### Schema de Exportación

```typescript
interface DaptaAgentExport {
  agent: AgentInfo;
  configuration: AgentConfiguration;
  context: AgentContext;
  organization: OrganizationInfo;
  metadata: ExportMetadata;
}

interface AgentInfo {
  name: string;              // "Emmy - Calificación De Leads"
  daptaAgentId: string;      // UUID del agente en Dapta
  retellAgentId: string;     // ID en Retell AI
  llmId: string;             // ID del LLM en Retell
  voiceId: string;           // ID de voz en ElevenLabs
}

interface AgentConfiguration {
  llmModel: string;          // "gpt-4.1"
  systemPrompt: string;      // Prompt completo (puede ser varios KB)
  inputVariables: InputVariable[];  // Variables dinámicas del agente
}

interface InputVariable {
  key: string;    // Nombre de la variable (ej: "contact_name")
  value: string;  // Valor por defecto
}

interface AgentContext {
  agent: {
    id: string;
    identity_name: string;   // "Emmy"
    purpose: string;
    language: string;        // "es-419"
  } | null;
  company: {
    id: string;
    company_name: string;    // "30x"
    company_description: string;
  } | null;
}

interface OrganizationInfo {
  workspaceId: string;       // UUID del workspace
  organizationId: string;    // UUID de la organización
}

interface ExportMetadata {
  exportedAt: string;        // ISO 8601: "2026-01-31T17:25:45.611Z"
  sourceUrl: string;         // URL de la página
  extensionVersion: string;  // "1.5.0"
  dataSource: string;        // "api" o "fallback"
}
```

### Ejemplo Completo de Export

```json
{
  "agent": {
    "name": "Emmy - Calificación De Leads",
    "daptaAgentId": "{DAPTA_AGENT_ID}",
    "retellAgentId": "{RETELL_AGENT_ID}",
    "llmId": "{RETELL_LLM_ID}",
    "voiceId": "{ELEVENLABS_VOICE_ID}"
  },
  "configuration": {
    "llmModel": "gpt-4.1",
    "systemPrompt": "# Identidad\n- Eres Emmy, una agente de voz automatizada...",
    "inputVariables": [
      {"key": "contact_name", "value": "contact_name"},
      {"key": "current_time", "value": "current_time"}
    ]
  },
  "context": {
    "agent": {
      "id": "{AGENT_CONTEXT_ID}",
      "identity_name": "Emmy",
      "purpose": "35",
      "language": "es-419"
    },
    "company": {
      "id": "{COMPANY_CONTEXT_ID}",
      "company_name": "30x",
      "company_description": "30X es una plataforma de educación ejecutiva..."
    }
  },
  "organization": {
    "workspaceId": "{WORKSPACE_ID}",
    "organizationId": "{ORGANIZATION_ID}"
  },
  "metadata": {
    "exportedAt": "2026-01-31T17:25:45.611Z",
    "sourceUrl": "https://app.dapta.ai/agents-studio/voice-agents/{DAPTA_AGENT_ID}?segment=instructions",
    "extensionVersion": "1.5.0",
    "dataSource": "api"
  }
}
```

---

## 2. Polling - Recibir Actualizaciones

La extensión consulta periódicamente un endpoint para recibir instrucciones de actualización.

### Configuración

```javascript
// En content.js
const CONFIG = {
  POLLING_ENDPOINT: 'https://tu-servidor.com/api/agent-updates',
  POLLING_INTERVAL: 5000,  // 5 segundos
  POLLING_ENABLED: true
};
```

### Request de Polling

```http
GET {POLLING_ENDPOINT}?agentId={daptaAgentId}
```

**Ejemplo real:**
```http
GET https://tu-servidor.com/api/agent-updates?agentId={DAPTA_AGENT_ID}
```

El `agentId` se extrae automáticamente de la URL de Dapta donde está el usuario.

### Schema que DEBE retornar el servidor

```typescript
interface PollingResponse {
  update?: AgentUpdate | null;  // null si no hay actualizaciones
}

interface AgentUpdate {
  id: number;                   // ID único incremental del update
  type: 'prompt_update';        // Tipo de actualización
  action: UpdateAction;         // Acción a realizar
  description: string;          // Descripción legible
  payload: UpdatePayload;       // Datos de la actualización
}

type UpdateAction =
  | 'append_space'    // Agregar espacio al final
  | 'append_text'     // Agregar texto al final
  | 'replace_text'    // Buscar y reemplazar texto
  | 'set_prompt';     // Reemplazar prompt completo

interface UpdatePayload {
  appendText?: string;   // Para append_space, append_text
  find?: string;         // Para replace_text
  replace?: string;      // Para replace_text
  newPrompt?: string;    // Para set_prompt
}
```

### Ejemplos de Respuesta del Servidor

#### Sin actualizaciones pendientes
```json
{
  "update": null
}
```

#### Agregar espacio (prueba mínima)
```json
{
  "update": {
    "id": 1,
    "type": "prompt_update",
    "action": "append_space",
    "description": "Agregar espacio al final del prompt",
    "payload": {
      "appendText": " "
    }
  }
}
```

#### Agregar texto al final
```json
{
  "update": {
    "id": 2,
    "type": "prompt_update",
    "action": "append_text",
    "description": "Agregar sección de prueba",
    "payload": {
      "appendText": "\n\n# Nueva Sección\n- Agregada desde el servidor"
    }
  }
}
```

#### Buscar y reemplazar
```json
{
  "update": {
    "id": 3,
    "type": "prompt_update",
    "action": "replace_text",
    "description": "Cambiar nombre del agente",
    "payload": {
      "find": "Emmy",
      "replace": "Emmy AI"
    }
  }
}
```

#### Reemplazar prompt completo
```json
{
  "update": {
    "id": 4,
    "type": "prompt_update",
    "action": "set_prompt",
    "description": "Nuevo prompt desde el servidor",
    "payload": {
      "newPrompt": "# Nuevo Prompt Completo\n\nTodo el contenido nuevo aquí..."
    }
  }
}
```

---

## 3. Actualizar Agente en Dapta (PUT)

Cuando la extensión recibe un update, hace un PUT a la API de Dapta.

### Request

```http
PUT https://api.dapta.ai/api/devops-dapta-tech-169-938-7/updatevoiceagentllm?agent_id={retellAgentId}&llm_id={llmId}
Content-Type: application/json
x-api-key: {DAPTA_API_KEY}
```

### Headers Requeridos

| Header | Valor | Descripción |
|--------|-------|-------------|
| `Content-Type` | `application/json` | Tipo de contenido |
| `x-api-key` | `{DAPTA_API_KEY}` | API Key de Dapta |

**IMPORTANTE:** Dapta usa `x-api-key`, NO Bearer token.

### Body

```json
{
  "general_prompt": "# El nuevo prompt completo aquí..."
}
```

### Ejemplo Completo

```bash
curl -X PUT \
  'https://api.dapta.ai/api/devops-dapta-tech-169-938-7/updatevoiceagentllm?agent_id={RETELL_AGENT_ID}&llm_id={RETELL_LLM_ID}' \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: {DAPTA_API_KEY}' \
  -d '{
    "general_prompt": "# Identidad\n- Eres Emmy..."
  }'
```

### Response Exitosa

```json
{
  "error": false,
  "message": "Agent updated successfully"
}
```

---

## 4. Flujo Completo de Actualización

```
┌──────────────────────────────────────────────────────────────────────┐
│                        FLUJO DE ACTUALIZACIÓN                        │
└──────────────────────────────────────────────────────────────────────┘

1. POLLING (cada 5 segundos)
   ┌─────────────┐                      ┌─────────────┐
   │  Extensión  │ ── GET ?agentId=X ─► │  Tu Server  │
   │             │ ◄─── Response ────── │             │
   └─────────────┘                      └─────────────┘
         │
         │ ¿Hay update?
         │
    ┌────┴────┐
    │         │
   NO        SÍ
    │         │
    ▼         ▼
  Espera   2. PROCESAR UPDATE
  5 seg       │
              │ Extraer prompt actual de Monaco Editor
              │ Aplicar transformación (append/replace/set)
              │ Generar nuevo prompt
              │
              ▼
         3. ACTUALIZAR DAPTA
              │
   ┌─────────────┐                      ┌─────────────┐
   │  Extensión  │ ──── PUT ──────────► │  Dapta API  │
   │             │     x-api-key        │             │
   │             │ ◄─── 200 OK ──────── │             │
   └─────────────┘                      └─────────────┘
              │
              ▼
         4. CONFIRMAR
              │
              │ Mostrar notificación "¡Update exitoso!"
              │ Recargar página para ver cambios
              │
              ▼
           FIN
```

---

## 5. Implementar tu Servidor de Polling

### Ejemplo mínimo con Express.js

```javascript
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Cola de updates por agente: { agentId: [updates] }
const pendingUpdatesByAgent = {};
let lastUpdateId = 0;

// Endpoint de polling (la extensión consulta aquí)
app.get('/api/agent-updates', (req, res) => {
  const { agentId } = req.query;

  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }

  const agentUpdates = pendingUpdatesByAgent[agentId] || [];

  if (agentUpdates.length > 0) {
    const update = agentUpdates.shift();
    console.log(`[${agentId}] Enviando update:`, update.description);
    res.json({ update });
  } else {
    res.json({ update: null });
  }
});

// Endpoint para encolar updates para un agente específico
app.post('/api/queue-update', (req, res) => {
  const { agentId, action, payload, description } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }

  lastUpdateId++;
  const update = {
    id: lastUpdateId,
    type: 'prompt_update',
    action,
    description,
    payload
  };

  if (!pendingUpdatesByAgent[agentId]) {
    pendingUpdatesByAgent[agentId] = [];
  }
  pendingUpdatesByAgent[agentId].push(update);

  console.log(`[${agentId}] Update encolado:`, description);
  res.json({ queued: true, updateId: lastUpdateId, agentId });
});

// Ver updates pendientes (debug)
app.get('/api/pending', (req, res) => {
  res.json(pendingUpdatesByAgent);
});

app.listen(3000, () => {
  console.log('Servidor de polling en http://localhost:3000');
});
```

### Encolar un update para un agente específico

```bash
# Agregar texto al prompt del agente Emmy
curl -X POST http://localhost:3000/api/queue-update \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "{DAPTA_AGENT_ID}",
    "action": "append_text",
    "description": "Agregar nota de prueba",
    "payload": {
      "appendText": "\n\n# Nota agregada remotamente"
    }
  }'
```

### Ver updates pendientes

```bash
curl http://localhost:3000/api/pending
```

---

## 6. Configuración de la Extensión

### Archivo: `content.js` - Constantes principales

```javascript
const CONFIG = {
  // Endpoints
  EXPORT_ENDPOINT: 'https://httpbin.org/post',           // Cambiar en producción
  POLLING_ENDPOINT: 'https://httpbin.org/get',           // Cambiar en producción
  UPDATE_ENDPOINT: 'https://api.dapta.ai/api/devops-dapta-tech-169-938-7/updatevoiceagentllm',

  // Polling
  POLLING_INTERVAL: 5000,  // milisegundos
  POLLING_ENABLED: true    // activar/desactivar
};

// IDs del agente actual (se obtienen dinámicamente)
const DAPTA_IDS = {
  retellAgentId: '{RETELL_AGENT_ID}',
  retellLlmId: '{RETELL_LLM_ID}',
  elevenLabsVoiceId: '{ELEVENLABS_VOICE_ID}',
  workspaceId: '{WORKSPACE_ID}',
  organizationId: '{ORGANIZATION_ID}'
};

// API Key de Dapta (debe configurarse como variable de entorno)
const DAPTA_API_KEY = '{DAPTA_API_KEY}';
```

---

## 7. APIs Relacionadas de Dapta

### Obtener agente de Retell
```http
GET https://api.dapta.ai/api/devops-dapta-tech-169-938-7/get_retell_agent?agent_id={retellAgentId}
x-api-key: {DAPTA_API_KEY}
```

### Obtener voz de ElevenLabs
```http
GET https://api.dapta.ai/api/devops-dapta-tech-169-938-7/get_11labs_voice_by_id?voice_id={voiceId}
x-api-key: {DAPTA_API_KEY}
```

### Obtener agente de Dapta
```http
GET https://api.dapta.ai/api/devops-dapta-tech-169-938-7/getagent/{daptaAgentId}
x-api-key: {DAPTA_API_KEY}
```

#### Response Schema
```typescript
interface GetAgentResponse {
  error: null | string;
  agent: {
    id: string;                      // UUID del agente (daptaAgentId)
    name: string;                    // Nombre del agente
    instructions: string;            // System prompt completo
    model: string;                   // "gpt-4.1"

    // IDs de servicios externos
    voice_retell_agent_id: string;   // ID en Retell AI
    voice_llm_id: string;            // ID del LLM en Retell
    voice: string;                   // ID de voz en ElevenLabs

    // Configuración de voz
    voice_language: string;          // "es-419"
    voice_model: string;             // "eleven_turbo_v2_5"
    voice_speed: string;             // "1.1"
    voice_volume: string;            // "1"
    voice_temperature: string;       // "1"

    // Variables de entrada
    variables: InputVariable[];      // Variables dinámicas del agente

    // Contextos
    agent_context: {
      id: string;
      identity_name: string;
      purpose: string;
      language: string;
    };
    company_context: {
      id: string;
      company_name: string;
      company_description: string;
    };

    // Configuración de llamada
    max_call_duration_ms: string;
    end_call_after_silence_ms: string;
    enable_voicemail_detection: boolean;

    // Metadata
    organization_id: string;
    created_at: string;
    updated_at: string;
    status: string;                  // "ACTIVE"
  };
}

interface InputVariable {
  key: string;    // Nombre de la variable (ej: "contact_name")
  value: string;  // Valor por defecto
}
```

#### Ejemplo de Response
```json
{
  "error": null,
  "agent": {
    "id": "{DAPTA_AGENT_ID}",
    "name": "Emmy - Calificación De Leads",
    "instructions": "# Identidad\n- Eres Emmy...",
    "model": "gpt-4.1",
    "voice_retell_agent_id": "{RETELL_AGENT_ID}",
    "voice_llm_id": "{RETELL_LLM_ID}",
    "voice": "{ELEVENLABS_VOICE_ID}",
    "voice_language": "es-419",
    "variables": [
      {"key": "contact_name", "value": "contact_name"},
      {"key": "current_time", "value": "current_time"}
    ],
    "agent_context": {
      "id": "{AGENT_CONTEXT_ID}",
      "identity_name": "Emmy",
      "purpose": "35",
      "language": "es-419"
    },
    "company_context": {
      "id": "{COMPANY_CONTEXT_ID}",
      "company_name": "30x",
      "company_description": "30X es una plataforma de educación ejecutiva..."
    }
  }
}
```

---

## 8. Interfaz de Usuario

### Botón "Test in Cadence"

La extensión reemplaza el botón original "Mejorar con IA" y abre Cadence con query params:

| Acción | Comportamiento |
|--------|----------------|
| Click | Abre nueva ventana: `https://cadence.crafter.run/app/stress-test?{params}` |
| Loading | Muestra "⏳ Cargando..." |
| Éxito | Notificación "Abriendo Cadence..." |

### Query Params enviados

```
?daptaAgentId={DAPTA_AGENT_ID}
&retellAgentId={RETELL_AGENT_ID}
&llmId={RETELL_LLM_ID}
&apiKey={DAPTA_API_KEY}
&agentName=Emmy%20-%20Calificacion
```

| Param | Descripción | Uso |
|-------|-------------|-----|
| `daptaAgentId` | UUID del agente en Dapta | Para GET `/getagent/{id}` |
| `retellAgentId` | ID del agente en Retell | Para PUT (query param `agent_id`) |
| `llmId` | ID del LLM en Retell | Para PUT (query param `llm_id`) |
| `apiKey` | API Key de Dapta | Header `x-api-key` |
| `agentName` | Nombre del agente | Display/referencia |

### Indicador de Polling (solo con endpoint real)

| Estado | Apariencia | Acción al click |
|--------|------------|-----------------|
| `Sync` | Punto verde pulsante | Detiene polling |
| `Off` | Punto gris | Inicia polling |

**Nota:** El indicador no aparece cuando se usa `httpbin.org` como endpoint.

---

## 9. Notas Importantes

- El `systemPrompt` puede ser muy largo (2000+ caracteres)
- Los UUIDs son estables y únicos por agente
- La extensión usa `x-api-key` para autenticación (NO Bearer token)
- El polling se auto-inicia 2 segundos después de cargar la página
- Después de un update exitoso, la página se recarga automáticamente
- El ID de update debe ser incremental para evitar procesar duplicados

---

## 10. Troubleshooting

### Error 401 "Missing or invalid token"
- **Causa:** Usar `Authorization: Bearer` en lugar de `x-api-key`
- **Solución:** Usar header `x-api-key: {DAPTA_API_KEY}`

### Prompt no se extrae (length: 0)
- **Causa:** Monaco Editor no cargó completamente
- **Solución:** La extensión tiene múltiples métodos de fallback

### Updates no se aplican
- **Causa:** El ID del update ya fue procesado
- **Solución:** Usar IDs incrementales únicos

### CORS errors en polling
- **Causa:** Tu servidor no tiene CORS habilitado
- **Solución:** Agregar headers CORS o usar proxy

---

## 11. Variables de Entorno Requeridas

```bash
# IDs del Agente
DAPTA_AGENT_ID=
RETELL_AGENT_ID=
RETELL_LLM_ID=
ELEVENLABS_VOICE_ID=

# Organización
WORKSPACE_ID=
ORGANIZATION_ID=

# API
DAPTA_API_KEY=

# Contextos (opcionales)
AGENT_CONTEXT_ID=
COMPANY_CONTEXT_ID=
```
