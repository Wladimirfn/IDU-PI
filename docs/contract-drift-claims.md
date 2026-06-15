# Approved contracts — schema y checker registry

## Cómo funciona

El Plan Maestro declara contratos **detectados** automáticamente a partir del código y la documentación. Esos contratos son **propuestas** — el humano todavía no los firmó.

Cuando vos aprobás un contrato (en `/idu revise` o editando `master-plan.json` directamente), el `contractId` se mueve a `master-plan.json.approvedContracts`. A partir de ese momento, el sistema lo **vigila**:

1. En cada `postflight` (cada vez que decís "este cambio está listo") corre `detectContractDrift()`.
2. En cada cron tick (cada 15 min) corre `detectContractDrift()`.
3. Si el contrato aprobado se violó, se escribe un evento `contract_drift_violation` en `events.jsonl`.
4. El orquestador (Pi) lee la violation y decide: fix, override, escalate.

## Schema de `approvedContracts`

```jsonc
{
  "approvedContracts": [
    {
      "contractId": "data-retention",  // debe existir en CLAIM_CHECKERS
      "claim": "Todo store SQLite/JSON/JSONL debe declarar retención, backup y criterios de archivo.",
      "severity": "critical"           // info | warning | critical
    }
  ]
}
```

## Checkers disponibles

| `contractId` | Severidad | Qué verifica |
|---|---|---|
| `data-retention` | critical | El stateRoot tiene `retention.json` con `version` y `stores` no-vacío |

## Cómo aprobar un contrato ahora mismo

Editás `master-plan.json` y agregás un objeto a `approvedContracts`:

```bash
# Ejemplo: aprobar el contrato de data-retention
code "C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\master-plan.json"
```

```jsonc
{
  "status": "approved",
  // ... resto del plan ...
  "approvedContracts": [
    {
      "contractId": "data-retention",
      "claim": "Todo store SQLite/JSON/JSONL debe declarar retención, backup y criterios de archivo.",
      "severity": "critical"
    }
  ]
}
```

Después de aprobar:

1. **Sin `retention.json`**: el próximo postflight emite un `contract_drift_violation` con `evidence: "Missing retention.json at ..."` y severity `critical`.
2. **Con `retention.json` válido**: 0 violations.

## Cómo agregar un nuevo checker

1. Elegí un `contractId` estable (kebab-case, descriptivo).
2. Implementá el checker en `src/claim-checkers.ts`:
   ```typescript
   const checkMiContrato: ClaimCheck = ({ stateRoot }) => {
       // tu lógica
       if (violado) return "evidence text";
       return null;
   };
   ```
3. Registralo en `CLAIM_CHECKERS` con el mismo `contractId`.
4. TDD: test RED (plan con el contractId → 1 violation), test GREEN (con el state correcto → 0 violations).
5. Agregá el `contractId` a esta tabla.

## Estado actual (2026-06-15)

- 1 checker registrado: `data-retention`
- 0 contratos aprobados en el stateRoot actual (todos los planes tienen `approvedContracts: []`)
- Wire listo en `postflight` y en `runMcpContextPackAutoRefreshTick`

## Lo que NO hay que hacer

- ❌ Auto-aprobar contratos sin intervención humana.
- ❌ Borrar `approvedContracts` cuando el código cambia (es un contrato durable).
- ❌ Marcar el plan como `stale` por un commit (lo que se rompe es un contrato específico, no el plan).
