# Unified Agent Context

[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | **Español**

Cada nuevo chat con una IA empieza con amnesia. Ayer le dijiste a Claude que
prefieres los README en inglés. Esta mañana lo preguntó Codex. Esta noche lo
volverá a preguntar un tercer asistente. Usas cinco agentes de IA, y la única
memoria que comparten eres tú — y te estás gastando a ti mismo, una
re-explicación a la vez.

**Unified Agent Context acaba con eso.** Dile una decisión a cualquier agente
una sola vez — claude code, codex, hermes, gajaecode, lettacode — y todos los
demás la sabrán en su próxima sesión. Automáticamente, en todas tus máquinas,
con los secretos bloqueados por diseño.

![UAC demo](artifacts/promo/uac-promo.gif)

## Arquitectura (almacén canónico = store-host, acceso independiente del dispositivo)

```
Agents ──(MCP stdio, over ssh when remote)──► mcp-memory-keeper (canonical: store-host ~/.uac/data/memory)
   │  ▲
   │  └─ Session start: inject distilled facts only (hook or instructed pull) — scripts/inject-context.mjs
   └──── During session: explicit record (record-fact) / on exit: auto-distill (distill-session)
              └─ Every write path goes through a central fail-closed secret gate (block or redact)
              └─ Permanent facts queue into the librarian outbox → librarian-sync delivers to the
                 store-host Letta "The Noticer" inbox (Phase 5)
```

- Ámbitos: `global` (preferencias) vs `project:<git-root-basename>` (decisiones/estado de trabajo) — fuga entre proyectos bloqueada (impuesto por consultas del lado del servidor)
- TTL: decision/preference se conservan permanentemente, project_state 90 días
- Las conversaciones en bruto van solo al archivo frío (nunca se inyectan; los secretos solo se redactan)
- Modo degradado: si el servidor no está accesible, emite 4 evidencias (warning/log/health/metric); con `UAC_STRICT=1` se convierte en fallo duro
- Independencia del dispositivo: el almacén canónico vive en store-host — otras máquinas (p. ej. el Mac) lo alcanzan vía ssh según `uac.config.json` (Phase 6)
- Planeado para v2: cola local offline + resincronización / MCP remoto autoalojado + autenticación → incorporación de claude.ai

## Documentación

| Doc | Contenido |
|-----|-----------|
| `docs/phase0-comparison.md` | Comparativa de candidatos de almacén + justificación |
| `docs/phase1-storage.md` | Esquema / ámbitos / TTL / puerta de secretos |
| `docs/phase2-hooks.md` | Cableado de los 5 harnesses + modo degradado |
| `docs/phase3-write-paths.md` | Las 5 rutas de escritura + destilación/cuarentena |
| `docs/phase4-coverage-matrix.md` | Matriz de cobertura de 20 rutas + niveles de verificación |
| `docs/phase5-librarian.md` | Carril de handoff del bibliotecario Letta (curación single-writer) |
| `docs/phase6-remote.md` | Traslado del almacén canónico a store-host + acceso ssh stdio-MCP |
| `docs/onboarding.md` | **Procedimiento de incorporación de nuevos agentes (5 min)** |
| `docs/handoff-tailscale-connectivity.md` | Problema de conectividad del almacén (Tailscale/LAN) + prompt de handoff con fallback automático |

## Comandos clave

```sh
node scripts/inject-context.mjs [--cwd <dir>]        # imprime el bloque de contexto compartido
node scripts/record-fact.mjs --type decision "..."   # registro explícito (secretos bloqueados con exit 3)
node scripts/distill-session.mjs --file <transcript> # destila una sesión + barrido de cuarentena
node scripts/librarian-sync.mjs [--strict]           # entrega outbox → inbox del bibliotecario en store-host (Phase 5)
node scripts/doctor.mjs                              # autocomprobación del cableado
node scripts/cross-verify.mjs                        # re-ejecuta la matriz de cobertura de 20 rutas
node scripts/reexplain.mjs log|report                # métricas de re-explicación (indicador auxiliar de la puerta de 2 semanas)
node --test 'tests/*.test.mjs'                       # suite completa de tests (73)
```

## Puerta de uso real de 2 semanas (en curso)

Todos los tests de escenario pasan. La aceptación final la juzga el usuario: **¿desaparece la sensación de "explicarlo otra vez" tras 2 semanas de uso real?** Cada vez que ocurra una re-explicación, regístrala con `reexplain.mjs log`; tras 2 semanas, comprueba si la tendencia semanal de `report` converge a cero.

## Créditos

Construido de principio a fin con **[GJC (Gajae Code)](https://github.com/Yeachan-Heo/gajae-code)**,
un agente de IA para programación: las fases del almacén, el estilo narrativo de este
README en los cinco idiomas y la animación promocional de arriba fueron implementados,
verificados y publicados por GJC — usando la propia memoria compartida de UAC mientras la construía.
