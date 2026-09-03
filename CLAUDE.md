# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Tetris implementado en JavaScript vanilla + Canvas 2D. Sin dependencias, sin build, sin `package.json`. Tres archivos: `index.html` (DOM/canvas), `style.css` (tema dark), `game.js` (toda la lógica, ~300 líneas).

## Comandos

No hay build ni test suite. Para ejecutar:

```bash
python3 -m http.server 8000   # o: npx serve .
```

Luego abrir `http://localhost:8000`. También se puede abrir `index.html` directamente en el navegador.

No hay linter ni framework de tests configurado en el repo.

## Arquitectura

Todo el estado y la lógica viven en variables globales y funciones de nivel superior en `game.js` (no hay clases ni módulos). Puntos clave para entender el flujo antes de modificar algo:

- **Estado global mutable**: `board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, etc. se declaran con `let` al inicio y se reinician en `init()`.
- **Tablero**: matriz `ROWS × COLS`, cada celda es `0` (vacía) o un índice `1–7` en `COLORS`/`PIECES` que identifica el tipo de pieza que ocupa esa celda.
- **Piezas**: matrices cuadradas fijas en `PIECES`. La rotación no usa tablas de estado (SRS clásico), sino que recalcula la forma con `rotateCW` (transposición + reverso) cada vez.
- **Colisión y wall kicks**: `collide(shape, ox, oy)` es la única función que valida límites/solapes; todo lo demás (movimiento, rotación, drop) se apoya en ella. `tryRotate()` prueba una rotación y, si choca, reintenta con offsets `[-1, 1, -2, 2]` antes de descartar el giro.
- **Bucle de juego**: `loop(ts)` corre vía `requestAnimationFrame`, acumula `dt` en `dropAccum` y cuando supera `dropInterval` baja la pieza o llama a `lockPiece()`. `togglePause()` cancela/reanuda este `animId`.
- **Ciclo de una pieza**: `lockPiece()` → `merge()` (fija la pieza en `board`) → `clearLines()` (elimina filas completas, recalcula `level`/`dropInterval`) → `spawn()` (promueve `next` a `current`, genera nueva `next`, y si la nueva pieza ya colisiona al aparecer, dispara `endGame()`).
- **Renderizado**: `draw()` dibuja grid + tablero fijo + ghost piece (`ghostY()` proyecta la caída, se pinta con `globalAlpha=0.2`) + pieza actual, todo en el canvas `#board`. `drawNext()` dibuja la vista previa en un canvas aparte (`#next-canvas`).
- **Input**: un único listener `keydown` global despacha por `e.code`; ignora todo salvo pausa cuando `paused || gameOver`.

Si se cambia `COLS`, `ROWS` o `BLOCK`, hay que ajustar también el `width`/`height` del `<canvas id="board">` en `index.html` para que coincidan (`COLS × BLOCK`, `ROWS × BLOCK`).

El README.md tiene más detalle narrativo de cada pieza (útil si se necesita contexto adicional, p. ej. la tabla de puntuación o la fórmula de velocidad por nivel).
