# Reporte de Seguridad - Plataforma Dapta

**Fecha:** 2026-01-31
**Alcance:** Análisis de APIs, endpoints y arquitectura documentada
**Metodología:** Revisión de documentación técnica y observación de patrones de diseño

---

## Resumen Ejecutivo

Se identificaron **15 hallazgos de seguridad** en la plataforma Dapta, clasificados de la siguiente manera:

| Severidad | Cantidad | Riesgo |
|-----------|----------|--------|
| Crítica | 4 | Acceso no autorizado, modificación de datos, data breach |
| Alta | 4 | Exposición de información financiera, enumeración masiva |
| Media | 4 | Superficie de ataque amplia, datos propietarios |
| Baja | 3 | Tracking, headers, validación |

---

## Hallazgos Críticos

### DAPTA-001: Autenticación mediante API Key estática compartida

**Severidad:** Crítica
**CVSS Estimado:** 9.1
**CWE:** CWE-798 (Use of Hard-coded Credentials)

#### Descripción
La plataforma utiliza una única API Key estática para autenticar todas las operaciones de una organización:

```http
x-api-key: {DAPTA_API_KEY}
```

#### Evidencia
```http
GET https://api.dapta.ai/api/devops-dapta-tech-169-938-7/getagent/{id}
x-api-key: {DAPTA_API_KEY}
```

#### Impacto
- No hay autenticación por usuario individual
- Si la key se filtra, acceso total a todos los recursos de la organización
- No hay expiración ni rotación automática visible
- Imposible auditar acciones por usuario específico

#### Recomendación
- Implementar autenticación OAuth 2.0 / JWT con tokens por usuario
- Tokens con expiración corta (15-60 minutos)
- Refresh tokens con rotación
- Scopes granulares por recurso

---

### DAPTA-002: Insecure Direct Object Reference (IDOR) en endpoints de agentes

**Severidad:** Crítica
**CVSS Estimado:** 8.6
**CWE:** CWE-639 (Authorization Bypass Through User-Controlled Key)

#### Descripción
Los endpoints aceptan IDs de recursos directamente sin validar que el solicitante tenga permisos sobre ellos.

#### Evidencia
```http
# Obtener cualquier agente conociendo su UUID
GET /getagent/{daptaAgentId}

# Obtener configuración de Retell
GET /get_retell_agent?agent_id={retellAgentId}

# Obtener configuración de voz
GET /get_voice_llm_by_llm_id?llm_id={llmId}

# Modificar cualquier agente
PUT /updatevoiceagentllm?agent_id={id}&llm_id={id}
```

#### Impacto
- Acceso a agentes de otras organizaciones (potencial - requiere verificación)
- Lectura de system prompts (propiedad intelectual)
- Modificación no autorizada de configuraciones
- Enumeración de recursos mediante fuerza bruta de UUIDs

#### Recomendación
- Validar `resource.organization_id === user.organization_id` en cada request
- Implementar middleware de autorización centralizado
- Logging de intentos de acceso a recursos ajenos

---

### DAPTA-003: Endpoint de actualización sin verificación de permisos

**Severidad:** Crítica
**CVSS Estimado:** 9.0
**CWE:** CWE-862 (Missing Authorization)

#### Descripción
El endpoint de actualización de agentes permite modificar configuraciones críticas sin verificar permisos granulares.

#### Evidencia
```http
PUT https://api.dapta.ai/api/devops-dapta-tech-169-938-7/updatevoiceagentllm
    ?agent_id={RETELL_AGENT_ID}
    &llm_id={RETELL_LLM_ID}
Content-Type: application/json
x-api-key: {DAPTA_API_KEY}

{
  "general_prompt": "# Prompt malicioso inyectado..."
}
```

#### Impacto
- Modificación de prompts de agentes de voz (prompt injection)
- Alteración de comportamiento de agentes en producción
- Posible exfiltración de datos a través de prompts modificados
- Sin audit trail de quién realizó cambios

#### Recomendación
- Implementar roles y permisos (RBAC)
- Audit logging de todas las modificaciones
- Aprobación de cambios para agentes en producción
- Versionado de prompts con rollback

---

### DAPTA-004: Exposición de información sensible en respuestas de API

**Severidad:** Crítica
**CVSS Estimado:** 7.5
**CWE:** CWE-200 (Exposure of Sensitive Information)

#### Descripción
Las respuestas de API incluyen información sensible que debería estar protegida o minimizada.

#### Evidencia
```json
{
  "agent": {
    "instructions": "# Prompt completo con lógica de negocio, estrategias de venta, objeciones...",
    "voice_retell_agent_id": "{RETELL_AGENT_ID}",
    "voice_llm_id": "{RETELL_LLM_ID}",
    "voice": "{ELEVENLABS_VOICE_ID}",
    "variables": [{"key": "contact_name", "value": "..."}]
  }
}
```

#### Impacto
- Exposición de propiedad intelectual (system prompts)
- IDs de servicios externos permiten ataques dirigidos
- Competidores pueden copiar estrategias de agentes
- Variables pueden contener datos sensibles

#### Recomendación
- Principio de mínimo privilegio en respuestas
- Endpoints separados para información sensible
- Cifrado de campos críticos
- Redacción de prompts en logs

---

## Hallazgos de Severidad Alta

### DAPTA-005: Endpoints de billing sin protección adicional

**Severidad:** Alta
**CVSS Estimado:** 7.2
**CWE:** CWE-639 (Authorization Bypass)

#### Descripción
Información financiera accesible con solo conocer IDs.

#### Evidencia
```http
GET /billing/{accountId}/balance?customer_id={stripeCustomerId}
GET /get_stripe_subscription_prod?customer_id={stripeCustomerId}
```

#### Impacto
- Acceso a información de facturación
- Conocer planes y gastos de competidores
- Potencial para fraude de billing

#### Recomendación
- Autenticación adicional para endpoints financieros
- Validación estricta de ownership
- Rate limiting agresivo

---

### DAPTA-006: Enumeración masiva de recursos organizacionales

**Severidad:** Alta
**CVSS Estimado:** 6.5
**CWE:** CWE-200 (Information Exposure)

#### Descripción
Endpoints permiten listar todos los recursos de una organización sin límites efectivos.

#### Evidencia
```http
GET /get_project_by_organization_id_prod?organizationID={organizationId}
GET /get_all_phone_numbers_by_organization/{organizationId}
GET /voice-agents/{workspaceId}?page=1&page_size=1000
GET /iam/workspace/search?page=1&limit=50&query=
```

#### Impacto
- Extracción completa de datos organizacionales
- Mapeo de estructura de cuentas
- Identificación de targets de alto valor

#### Recomendación
- Límites de paginación obligatorios (max 100)
- Rate limiting por endpoint
- Logging de patrones de enumeración

---

### DAPTA-007: IAM endpoints expuestos

**Severidad:** Alta
**CVSS Estimado:** 6.8
**CWE:** CWE-200 (Information Exposure)

#### Descripción
Endpoints de Identity and Access Management accesibles con API key genérica.

#### Evidencia
```http
GET /iam/account/{accountId}
GET /iam/workspace/{workspaceId}
```

#### Impacto
- Información de cuentas y permisos
- Facilita ataques de ingeniería social
- Mapeo de jerarquía organizacional

#### Recomendación
- Restringir acceso IAM a administradores
- Autenticación MFA para operaciones IAM
- Audit logging detallado

---

### DAPTA-008: Historial de llamadas sin protección de datos personales

**Severidad:** Alta
**CVSS Estimado:** 7.0
**CWE:** CWE-311 (Missing Encryption of Sensitive Data)

#### Descripción
Transcripciones completas de llamadas accesibles con datos personales.

#### Evidencia
```http
POST /get_voice_call_by_agent_id?agent_id={retellAgentId}&page=1&page_size=100
```

Respuesta incluye:
```
Agent: Hola, soy Emmy de 30X. ¿Con quién tengo el gusto?
User: Hola, ¿con [NOMBRE]?
Agent: Gracias, [NOMBRE]. ¿Es buen momento...
User: Sí. Pertenecemos al sector de [SECTOR] y tenemos [N] empleados...
```

#### Impacto
- Exposición de datos personales (nombres, empresas, sectores)
- Violación potencial de GDPR/CCPA
- Información confidencial de prospectos

#### Recomendación
- Cifrado de transcripciones en reposo
- Acceso basado en roles
- Anonimización opcional
- Políticas de retención de datos

---

## Hallazgos de Severidad Media

### DAPTA-009: Múltiples dominios de backend

**Severidad:** Media
**CVSS Estimado:** 5.0
**CWE:** CWE-1059 (Insufficient Technical Documentation)

#### Descripción
La arquitectura distribuida aumenta la superficie de ataque.

#### Evidencia
| Dominio | Servicio |
|---------|----------|
| `api.dapta.ai` | API principal |
| `clone-services.dapta.ai` | IAM |
| `backend.dapta.ai` | Billing/Voice |
| `brains.dapta.ai` | Knowledge base |
| `services.dapta.ai` | Real-time |
| `call-rest-api.dapta.ai` | Llamadas |
| `webcall-back.dapta.ai` | Web calls |

#### Impacto
- Inconsistencia potencial en políticas de seguridad
- Más difícil de auditar y monitorear
- Configuraciones CORS/headers pueden variar

#### Recomendación
- Centralizar políticas de seguridad
- API Gateway unificado
- Monitoreo consolidado

---

### DAPTA-010: Socket.IO sin autenticación documentada

**Severidad:** Media
**CVSS Estimado:** 5.5
**CWE:** CWE-306 (Missing Authentication)

#### Descripción
Comunicación real-time potencialmente sin validación adecuada.

#### Evidencia
```http
GET /ta/socket.io/?EIO=4&transport=polling&t={timestamp}
```

#### Impacto
- Posible inyección de eventos
- Session hijacking en websockets
- Suscripción a canales ajenos

#### Recomendación
- Autenticación en handshake de Socket.IO
- Validación de room membership
- Rate limiting de eventos

---

### DAPTA-011: Knowledge Base accesible

**Severidad:** Media
**CVSS Estimado:** 5.8
**CWE:** CWE-200 (Information Exposure)

#### Descripción
Bases de conocimiento (RAG) accesibles sin restricciones granulares.

#### Evidencia
```http
GET /brain/v1/workspaces/{workspaceId}/brains?limit=100&offset=0
```

#### Impacto
- Acceso a información propietaria de empresas
- Documentos internos expuestos
- Ventaja competitiva comprometida

#### Recomendación
- Permisos granulares por brain
- Cifrado de contenido
- Audit de accesos

---

### DAPTA-012: Paths de API predecibles

**Severidad:** Media
**CVSS Estimado:** 4.0
**CWE:** CWE-200 (Information Exposure)

#### Descripción
Los paths de API contienen patrones identificables que sugieren arquitectura interna.

#### Evidencia
```
/api/devops-dapta-tech-169-938-7/
/api/{API_PATH_HASH}/
```

#### Impacto
- Facilita descubrimiento de endpoints
- Sugiere multi-tenancy por path
- El hash aparece en múltiples lugares (posible reutilización)

#### Recomendación
- Paths opacos sin información interna
- Versionado semántico estándar (/v1/, /v2/)

---

## Hallazgos de Severidad Baja

### DAPTA-013: Tracking IDs expuestos en frontend

**Severidad:** Baja
**CVSS Estimado:** 3.0
**CWE:** CWE-200 (Information Exposure)

#### Descripción
Tokens de servicios de analytics visibles en el código/network.

#### Evidencia
```yaml
posthog_token: "{POSTHOG_TOKEN}"
hubspot_portal_id: "{HUBSPOT_PORTAL_ID}"
google_analytics_ids: ["{GA_ID_1}", "{GA_ID_2}"]
facebook_pixel_id: "{FACEBOOK_PIXEL_ID}"
```

#### Impacto
- Inyección de eventos falsos en analytics
- Información sobre stack tecnológico

#### Recomendación
- Server-side tracking donde sea posible
- Validación de origen de eventos

---

### DAPTA-014: Headers de seguridad no documentados

**Severidad:** Baja
**CVSS Estimado:** 3.5
**CWE:** CWE-693 (Protection Mechanism Failure)

#### Descripción
No hay evidencia de headers de seguridad estándar.

#### Headers recomendados no observados
- `Content-Security-Policy`
- `X-Frame-Options`
- `Strict-Transport-Security`
- `X-Content-Type-Options`

#### Impacto
- Posible clickjacking
- XSS más fácil de explotar

#### Recomendación
- Implementar headers de seguridad estándar
- HSTS con preload

---

### DAPTA-015: Validación débil de datos de entrada

**Severidad:** Baja
**CVSS Estimado:** 3.0
**CWE:** CWE-20 (Improper Input Validation)

#### Descripción
Se observan datos duplicados en respuestas, sugiriendo validación insuficiente.

#### Evidencia
```json
{
  "variables": [
    {"key": "contact_name", "value": "contact_name"},
    {"key": "contact_name", "value": "contact_name"}
  ]
}
```

#### Impacto
- Posible inyección de variables maliciosas
- Comportamiento impredecible

#### Recomendación
- Validación y deduplicación en backend
- Schema validation (JSON Schema, Zod, etc.)

---

## Matriz de Riesgos

| ID | Hallazgo | Severidad | Probabilidad | Impacto | Esfuerzo Fix |
|----|----------|-----------|--------------|---------|--------------|
| DAPTA-001 | API Key estática | Crítica | Alta | Crítico | Alto |
| DAPTA-002 | IDOR en endpoints | Crítica | Alta | Crítico | Medio |
| DAPTA-003 | Update sin permisos | Crítica | Media | Crítico | Medio |
| DAPTA-004 | Info sensible expuesta | Crítica | Alta | Alto | Medio |
| DAPTA-005 | Billing expuesto | Alta | Media | Alto | Bajo |
| DAPTA-006 | Enumeración masiva | Alta | Alta | Medio | Bajo |
| DAPTA-007 | IAM expuesto | Alta | Media | Alto | Medio |
| DAPTA-008 | Historial sin cifrar | Alta | Alta | Alto | Medio |
| DAPTA-009 | Múltiples dominios | Media | Baja | Medio | Alto |
| DAPTA-010 | Socket.IO sin auth | Media | Media | Medio | Medio |
| DAPTA-011 | Knowledge Base | Media | Media | Medio | Bajo |
| DAPTA-012 | Paths predecibles | Media | Alta | Bajo | Bajo |
| DAPTA-013 | Tracking expuesto | Baja | Alta | Bajo | Bajo |
| DAPTA-014 | Headers faltantes | Baja | Media | Bajo | Bajo |
| DAPTA-015 | Validación débil | Baja | Media | Bajo | Bajo |

---

## Plan de Remediación Recomendado

### Fase 1: Inmediato (0-2 semanas)
1. **Rotar API keys** actuales como medida preventiva
2. Implementar **validación de ownership** en endpoints críticos (DAPTA-002, DAPTA-003)
3. Agregar **rate limiting** básico

### Fase 2: Corto Plazo (2-4 semanas)
4. Migrar a **autenticación JWT por usuario** (DAPTA-001)
5. Implementar **audit logging** de operaciones sensibles
6. **Cifrar transcripciones** en reposo (DAPTA-008)

### Fase 3: Medio Plazo (1-2 meses)
7. Implementar **RBAC completo**
8. **API Gateway** centralizado con políticas de seguridad
9. **Headers de seguridad** en todos los dominios

### Fase 4: Largo Plazo (2-3 meses)
10. **Penetration testing** profesional
11. Programa de **bug bounty**
12. **Certificación SOC 2** / ISO 27001

---

## Disclaimer

Este análisis se basa en documentación técnica observada y patrones de diseño inferidos. Las vulnerabilidades marcadas como "potencial" o "requiere verificación" necesitan pruebas de penetración controladas para confirmar su explotabilidad real.

No se realizaron pruebas activas contra sistemas en producción. Las recomendaciones son preventivas basadas en mejores prácticas de seguridad.

---

**Preparado por:** Análisis automatizado
**Clasificación:** Confidencial
**Distribución:** Equipo de seguridad Dapta
