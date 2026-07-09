# Unified Agent Context

[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | **Español**

Cada nuevo chat con una IA empieza con amnesia. Ayer le dijiste a Claude que
prefieres los README en inglés. Esta mañana lo preguntó Codex. Esta noche lo
volverá a preguntar un tercer asistente. Tienes cinco agentes, y la única
memoria que comparten eres tú. Te estás gastando a ti mismo, una
re-explicación a la vez.

**Unified Agent Context acaba con eso.** Dile una decisión a cualquier agente
una sola vez. Todos los demás la sabrán en su próxima sesión. Automáticamente,
en todas tus máquinas, con los secretos bloqueados.

Nunca conectas la memoria a mano. Nunca copias el contexto de un agente a otro.
Esa es toda la promesa. Si algún día tienes que hacerlo tú, UAC ha fracasado.

![Demo de UAC en 27 segundos](artifacts/promo/uac-promo.gif)

## Cómo funciona

```
Agents ──(MCP stdio, over ssh when remote)──► mcp-memory-keeper (canonical: sov ~/.uac/data/memory)
   │  ▲
   │  └─ Session start: inject distilled facts only (hook or instructed pull) — scripts/inject-context.mjs
   └──── During session: explicit record (record-fact) / on exit: auto-distill (distill-session)
              └─ Every write path goes through a central fail-closed secret gate (block or redact)
              └─ Permanent facts queue into the librarian outbox → librarian-sync delivers to the
                 sov Letta "The Noticer" inbox (Phase 5)
```

En palabras simples.

- Todos tus agentes leen y escriben una sola memoria compartida.
- Una preferencia te sigue a todas partes. Una decisión de proyecto se queda dentro de su proyecto.
- Las decisiones y preferencias se guardan para siempre. El estado de trabajo expira a los 90 días.
- Las conversaciones en bruto nunca se inyectan en sesiones. Van solo al archivo frío, con los secretos borrados al entrar.
- Cada escritura pasa por una puerta de secretos. Las claves y contraseñas se bloquean por defecto.
- Si el almacén no responde, los agentes lo dicen en voz alta en lugar de adivinar en silencio.
- El almacén principal vive en un servidor casero llamado sov. Las demás máquinas llegan por ssh.

## La documentación

| Doc | De qué trata |
|-----|--------------|
| `docs/phase0-comparison.md` | Qué almacén elegimos, y por qué. |
| `docs/phase1-storage.md` | El esquema, los ámbitos, la retención, la puerta de secretos. |
| `docs/phase2-hooks.md` | Cómo se conecta cada uno de los cinco agentes. |
| `docs/phase3-write-paths.md` | Las cinco rutas de escritura, más destilación y cuarentena. |
| `docs/phase4-coverage-matrix.md` | Veinte rutas de entrega, todas probadas y verificadas. |
| `docs/phase5-librarian.md` | El carril del bibliotecario que cura los hechos permanentes. |
| `docs/phase6-remote.md` | La mudanza del almacén principal a sov, y el acceso por ssh. |
| `docs/onboarding.md` | Cómo un agente nuevo se une en cinco minutos. |
| `docs/handoff-tailscale-connectivity.md` | Qué hacer cuando la conexión al almacén falla. |

## Los comandos

```sh
node scripts/inject-context.mjs [--cwd <dir>]        # imprime el bloque de contexto compartido
node scripts/record-fact.mjs --type decision "..."   # registro explícito (secretos bloqueados con exit 3)
node scripts/distill-session.mjs --file <transcript> # destila una sesión + barrido de cuarentena
node scripts/librarian-sync.mjs [--strict]           # entrega outbox → inbox del bibliotecario en sov (Phase 5)
node scripts/doctor.mjs                              # autocomprobación del cableado
node scripts/cross-verify.mjs                        # re-ejecuta la matriz de cobertura de 20 rutas
node scripts/reexplain.mjs log|report                # métricas de re-explicación (indicador auxiliar)
node --test 'tests/*.test.mjs'                       # suite completa de tests (73)
```

## La prueba de dos semanas

Todos los tests de escenario pasan. La prueba real es otra. Tras dos semanas
de uso diario, sigues explicando lo mismo dos veces, o ya no. Registra cada
repetición con `reexplain.mjs log`. Si el conteo semanal cae a cero, UAC funciona.

## Créditos

Construido de principio a fin con **[GJC, Gajae Code](https://github.com/Yeachan-Heo/gajae-code)**,
un agente de IA para programación. Las fases del almacén, el estilo narrativo
de este README en cinco idiomas y la animación de arriba fueron implementados,
verificados y publicados por GJC. Mientras construía UAC usaba la memoria
compartida del propio UAC.
