# User Dashboard Refactor - Design Document

## Overview

Refactor del diseño de la sección "User Dashboard" para mejorar la jerarquía visual y cohesión entre el selector de cluster y las secciones que dependen de él.

## Problema actual

- Cada sección tiene su propia card independiente
- No hay jerarquía visual clara entre el selector de cluster y las secciones subordinadas
- Falta cohesión visual - parece que las secciones no están relacionadas

## Solución

### Estructura general

Card único que contiene todo el dashboard del usuario:

```
┌─────────────────────────────────────────────────────────┐
│  [All] [Cluster A] [Cluster B] [Cluster C]  [+]         │ ← Tabs sticky
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Validators: 12    Balance: 384 GNO                     │
│  Performance: 99.5%  Claimable: 2.4 GNO                 │
│                                                         │
│  ───────────────────────────────────────────────────    │
│                                                         │
│  PERFORMANCE METRICS              [tipo ▼] [rango ▼]    │
│  [Gráfico de barras]                                    │
│                                                         │
│  ───────────────────────────────────────────────────    │
│                                                         │
│  EVENTS                                                 │
│  [Incidents] [Blocks] [Deposits] [Withdrawals]          │
│  [Lista de eventos]                                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Tabs de clusters

**Comportamiento:**

- Tabs horizontales en el header del card
- "All" como primer tab (vista agregada de todos los clusters)
- Tab "+" al final para crear nuevo cluster (abre sheet)
- Mobile: scroll horizontal con fade sutil en los bordes

**Sticky behavior:**

- Los tabs se adhieren al top del viewport al scrollear
- Aparece sombra sutil (`shadow-md`) cuando está en modo sticky
- Fondo sólido (mismo color que el card) para legibilidad

**Estilos:**

- Tab activo: estilo pill/rounded con fondo destacado
- Tabs inactivos: solo texto, sin fondo
- Tab "+": ícono Plus, mismo tamaño que los demás

### Secciones internas

Las secciones fluyen dentro del card sin cards propios, separadas por líneas sutiles.

**1. Cluster Overview**

- Sin título (el contexto viene del tab seleccionado)
- Contenido: validators count + status badges, balances (total, effective, claimable), performance (1h, 24h, 7d, 30d)
- Tabla de APY/rewards por período
- Botón "Manage Cluster" solo visible cuando NO es "All"

**2. Performance Metrics**

- Título pequeño "PERFORMANCE METRICS" en `text-muted-foreground`
- Selectores de tipo y rango temporal alineados a la derecha
- Gráfico de barras debajo

**3. Events Feed**

- Título pequeño "EVENTS"
- Tabs internos: Incidents, Consolidations, Blocks, Deposits, Withdrawals
- Lista de eventos según tab seleccionado

**Separadores:**

- Línea `border-border/50`
- Padding vertical generoso (`py-6` o similar)

### Responsive (Mobile)

- Tabs de clusters: scroll horizontal (swipeable)
- Fade visual en los bordes para indicar más contenido
- Sticky tabs funcionan igual
- Contenido interno se adapta con grid responsive existente

## Archivos a modificar

1. `packages/webapp/app/page.tsx` - Reestructurar layout principal
2. `packages/webapp/components/validators/cluster-controls.tsx` - Convertir a tabs
3. `packages/webapp/components/validators/cluster-list.tsx` - Integrar en nuevo layout
4. `packages/webapp/components/validators/cluster-overview.tsx` - Remover card wrapper
5. `packages/webapp/components/validators/performance-metrics.tsx` - Remover card wrapper
6. `packages/webapp/components/validators/events-feed.tsx` - Remover card wrapper

## Nuevo componente

- `packages/webapp/components/validators/user-dashboard.tsx` - Componente contenedor principal con:
  - Tabs de clusters (sticky)
  - Lógica de selección de cluster
  - Renderizado de secciones internas

## Consideraciones técnicas

- Usar `sticky top-0` con detección de scroll para agregar sombra
- Implementar scroll horizontal en tabs con CSS (`overflow-x-auto`)
- Mantener la lógica existente de agregación para "All Clusters"
- Sheet de crear cluster se mantiene igual
