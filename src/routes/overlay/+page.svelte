<!-- SPDX-License-Identifier: GPL-3.0-or-later
     Copyright (c) 2026 zaburen -->
<script lang="ts">
  /**
   * OBS overlay: transparent page that mirrors whatever the control window
   * publishes. Add it in OBS as a Browser Source at http://127.0.0.1:8737/
   */
  import { onMount } from 'svelte';
  import { Renderer, RENDERER_CSS } from '$lib/renderer';
  import { OVERLAY_PORT, type RenderState } from '$lib/types';

  let stage: HTMLDivElement;
  let connected = $state(false);

  onMount(() => {
    const renderer = new Renderer(stage);
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(`ws://127.0.0.1:${OVERLAY_PORT}/ws`);
      ws.onopen = () => { connected = true; console.log('overlay: connected'); };
      ws.onmessage = (e) => {
        // A single unparseable frame must not kill the handler (which would
        // silently freeze the overlay with no reconnect).
        try {
          renderer.render(JSON.parse(e.data) as RenderState);
        } catch (err) {
          console.error('overlay: ignoring unparseable render state', err);
        }
      };
      ws.onclose = () => {
        connected = false;
        if (!closed) retry = setTimeout(connect, 1000); // app not running yet / restarted
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => { closed = true; if (retry) clearTimeout(retry); ws?.close(); };
  });
</script>

<svelte:head>
  <title>pngtuber overlay</title>
  {@html `<style>${RENDERER_CSS}</style>`}
</svelte:head>

<div class="stage"><div bind:this={stage}></div></div>
{#if !connected}
  <div class="hint">waiting for pngtuber app…</div>
{/if}

<style>
  :global(html, body) { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  .stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
  .hint {
    position: fixed; left: 8px; bottom: 8px; font: 12px system-ui, sans-serif;
    color: #fff; background: rgba(0, 0, 0, 0.5); padding: 3px 6px; border-radius: 3px;
  }
</style>
