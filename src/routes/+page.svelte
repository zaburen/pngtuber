<!-- SPDX-License-Identifier: GPL-3.0-or-later
     Copyright (c) 2026 zaburen -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { Avatar } from '$lib/avatar';
  import { Mic } from '$lib/mic';
  import { Renderer, RENDERER_CSS, placeholder } from '$lib/renderer';
  import * as backend from '$lib/backend';
  import { mainLayer } from '$lib/poses';
  import { addProp, moveProp, removeProp, setPropBehind } from '$lib/props';
  import {
    DEFAULT_VARIANT_ID,
    FRAME_KEYS,
    OVERLAY_ORIGIN,
    frameStorageKey,
    mergeProfile,
    type FrameKey,
    type Layer,
    type Profile,
  } from '$lib/types';

  let profile: Profile = $state(mergeProfile(null));
  let present: string[] = $state([]);
  let frameVersion = $state(0);
  let mics: MediaDeviceInfo[] = $state([]);
  let micRunning = $state(false);
  let micStatus = $state({ text: '', error: false });
  let dragOver: string | null = $state(null);
  let profileDir = $state('');
  let copied = $state(false);
  let ready = $state(false);
  /** Layer id whose delete is awaiting confirmation. */
  let confirmingDelete: string | null = $state(null);

  let avatar: Avatar;
  let stage: HTMLDivElement;
  let meter: HTMLCanvasElement;

  const frameUrls = $derived(backend.frameUrls(present, frameVersion));
  const main = $derived(mainLayer(profile));
  const mainIndex = $derived(profile.layers.indexOf(main));
  // The prop layers (everything that isn't the voice-reactive character), as live objects.
  const propLayers = $derived(profile.layers.filter((l) => l.id !== main.id && !l.reactsToVoice));

  onMount(() => {
    let cleanup = () => {};
    (async () => {
      profile = mergeProfile(await backend.loadProfile());
      present = await backend.listFrames();
      profileDir = await backend.profilePath();

      const renderer = new Renderer(stage);
      avatar = new Avatar(profile, (s) => {
        renderer.render(s);
        backend.publishState(JSON.stringify(s)).catch((e) => console.error('publish failed', e));
      });
      avatar.frames = frameUrls;
      avatar.start();
      ready = true;

      mics = await Mic.list();
      if (profile.mic.enabled) startMic();

      const unlisten = await getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === 'leave') { dragOver = null; return; }
        const key = slotAt(p.position.x, p.position.y);
        if (p.type === 'over') { dragOver = key; return; }
        dragOver = null;
        const file = p.paths[0];
        if (key && file) importFrame(key, file);
      });

      let raf = requestAnimationFrame(function draw() {
        drawMeter();
        raf = requestAnimationFrame(draw);
      });
      cleanup = () => { unlisten(); cancelAnimationFrame(raf); avatar.stop(); };
    })();
    return () => cleanup();
  });

  // Persist + re-render whenever a setting changes (deep-tracked by $state).
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const snapshot = JSON.stringify(profile);
    if (!ready) return;
    avatar.emit();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      backend.saveProfile(JSON.parse(snapshot)).catch((e) => console.error('save failed', e));
    }, 300);
  });

  $effect(() => {
    if (!ready) return;
    avatar.frames = frameUrls;
    avatar.emit(true);
  });

  function slotAt(px: number, py: number): string | null {
    const dpr = window.devicePixelRatio || 1;
    const el = document.elementFromPoint(px / dpr, py / dpr)?.closest<HTMLElement>('[data-slot]');
    return el?.dataset.slot ?? null;
  }

  async function pickFrame(key: string) {
    const file = await open({ multiple: false, filters: [{ name: 'Images', extensions: ['png'] }] });
    if (typeof file === 'string') importFrame(key, file);
  }

  async function importFrame(key: string, path: string) {
    try {
      present = await backend.importFrame(key, path);
      frameVersion++;
    } catch (e) {
      micStatus = { text: `import failed: ${e}`, error: true };
      console.error('import failed', e);
    }
  }

  async function removeFrame(key: string, ev: MouseEvent) {
    ev.stopPropagation();
    present = await backend.clearFrame(key);
    frameVersion++;
  }

  function addLayer() {
    addProp(profile);
  }

  async function deleteLayer(layer: Layer) {
    confirmingDelete = null;
    const key = frameStorageKey(layer.id, DEFAULT_VARIANT_ID, 'idle');
    if (frameUrls[key]) present = await backend.clearFrame(key);
    removeProp(profile, layer.id);
    frameVersion++;
  }

  async function startMic() {
    try {
      await avatar.mic.start(profile.mic.deviceId);
      micRunning = true;
      micStatus = { text: 'using: ' + avatar.mic.label, error: false };
      mics = await Mic.list(); // labels appear once permission is granted
      profile.mic.enabled = true;
    } catch (e) {
      const err = e as Error;
      micRunning = false;
      micStatus = { text: `${err.name}: ${err.message}`, error: true };
      console.error('mic failed', e);
    }
  }
  function stopMic() {
    avatar.mic.stop();
    micRunning = false;
    micStatus = { text: '', error: false };
    profile.mic.enabled = false;
  }
  function onMicChange() {
    if (micRunning) startMic();
  }

  function drawMeter() {
    if (!meter || !avatar) return;
    const x = meter.getContext('2d')!;
    const { width: w, height: h } = meter;
    x.fillStyle = '#2a2d36';
    x.fillRect(0, 0, w, h);
    x.fillStyle = avatar.talking ? '#4caf7d' : '#6ea8fe';
    x.fillRect(0, 0, Math.min(1, avatar.level) * w, h);
    x.fillStyle = '#e05555';
    x.fillRect(profile.mic.threshold * w - 1, 0, 2, h);
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(OVERLAY_ORIGIN + '/');
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }
</script>

<svelte:head>
  <title>pngtuber</title>
  {@html `<style>${RENDERER_CSS}</style>`}
</svelte:head>

{#snippet frameSlots(layerId: string, variantId: string, voice: boolean, ghost: boolean)}
  <div class="slots">
    {#each (voice ? FRAME_KEYS : (['idle'] as FrameKey[])) as k (k)}
      {@const key = frameStorageKey(layerId, variantId, k)}
      <div class="slot" class:dragover={dragOver === key} data-slot={key}
           role="button" tabindex="0" title="Click or drop a PNG"
           onclick={() => pickFrame(key)} onkeydown={(e) => e.key === 'Enter' && pickFrame(key)}>
        <img src={frameUrls[key] ?? placeholder(k)} alt="" class:pixelated={profile.look.pixelated}
             class:missing={!frameUrls[key] && !ghost}>
        <div class="name">{voice ? k : 'image'}{frameUrls[key] ? '' : ghost ? ' (placeholder)' : ' (empty)'}</div>
        {#if frameUrls[key]}
          <button class="x" title="Remove" onclick={(e) => removeFrame(key, e)}>×</button>
        {/if}
      </div>
    {/each}
  </div>
{/snippet}

<main>
  <section class="preview">
    <div class="stage"><div bind:this={stage}></div></div>
  </section>

  <aside class="panel">
    <h1>pngtuber</h1>

    <h2>Microphone</h2>
    <select bind:value={profile.mic.deviceId} onchange={onMicChange}>
      <option value="">Default microphone</option>
      {#each mics as m (m.deviceId)}
        <option value={m.deviceId}>{m.label || 'Microphone'}</option>
      {/each}
    </select>
    <button class:on={micRunning} onclick={() => (micRunning ? stopMic() : startMic())}>
      {micRunning ? 'Mic running (click to stop)' : 'Start mic'}
    </button>
    <div class="status" class:error={micStatus.error}>{micStatus.text}</div>
    <canvas class="meter" bind:this={meter} width="272" height="18"></canvas>
    <label>Threshold
      <span class="row"><input type="range" min="0" max="1" step="0.01" bind:value={profile.mic.threshold}>
      <span class="val">{profile.mic.threshold.toFixed(2)}</span></span></label>
    <label>Gain
      <span class="row"><input type="range" min="0.5" max="8" step="0.1" bind:value={profile.mic.gain}>
      <span class="val">{profile.mic.gain.toFixed(1)}x</span></span></label>
    <label>Hold (ms)
      <span class="row"><input type="range" min="0" max="800" step="10" bind:value={profile.mic.hold}>
      <span class="val">{profile.mic.hold}</span></span></label>

    <h2>Character</h2>
    <p class="hint">Your <b>idle</b> and <b>talking</b> frames. Only idle is required — talking and the timed frames fall back to it.</p>
    {@render frameSlots(main.id, DEFAULT_VARIANT_ID, true, true)}

    <h2>Layers</h2>
    <p class="hint">
      Backgrounds and accessories that stack on the character — glasses, a hat, a background.
      Toggle each on/off, order them, and choose whether they move with the character.
    </p>
    {#each propLayers as layer (layer.id)}
      {@const i = profile.layers.indexOf(layer)}
      <div class="card">
        <div class="pose-head">
          <input class="layer-name" bind:value={layer.name} title="Layer name">
          <button class="icon" title="Move up" disabled={i + 1 >= profile.layers.length || profile.layers[i + 1].id === main.id}
                  onclick={() => moveProp(profile, layer.id, 1)}>▲</button>
          <button class="icon" title="Move down" disabled={i - 1 < 0 || profile.layers[i - 1].id === main.id}
                  onclick={() => moveProp(profile, layer.id, -1)}>▼</button>
          <button class="icon" title="Delete layer and its image" onclick={() => (confirmingDelete = layer.id)}>×</button>
        </div>
        {#if confirmingDelete === layer.id}
          <div class="confirm">
            Delete “{layer.name}” and its image?
            <button class="small danger" onclick={() => deleteLayer(layer)}>Delete</button>
            <button class="small" onclick={() => (confirmingDelete = null)}>Cancel</button>
          </div>
        {/if}
        <label class="row"><input type="checkbox" bind:checked={layer.visible}> Show this layer</label>
        <label class="row">
          <input type="checkbox" checked={i < mainIndex}
                 onchange={(e) => setPropBehind(profile, layer.id, e.currentTarget.checked)}>
          Behind the character (background)
        </label>
        <label class="row"><input type="checkbox" bind:checked={layer.followBounce}> Move with the character (bounce)</label>
        {#if layer.offset}
          <label>Nudge
            <span class="row">
              x <input class="num" type="number" step="1" bind:value={layer.offset.x}>
              y <input class="num" type="number" step="1" bind:value={layer.offset.y}>
            </span>
          </label>
        {/if}
        {@render frameSlots(layer.id, DEFAULT_VARIANT_ID, false, false)}
      </div>
    {/each}
    <button onclick={addLayer}>+ Add layer</button>

    <h2>Look</h2>
    <label>Scale
      <span class="row"><input type="range" min="1" max="12" step="1" bind:value={profile.look.scale}>
      <span class="val">{profile.look.scale}x</span></span></label>
    <label class="row"><input type="checkbox" bind:checked={profile.look.pixelated}> Crisp pixels (nearest-neighbor)</label>
    <label class="row"><input type="checkbox" bind:checked={profile.look.bounce}> Bounce on talk start</label>
    <label class="row"><input type="checkbox" bind:checked={profile.look.timed}> Timed frame (blink / twitch / sway)</label>
    {#if profile.look.timed}
      <label>Timed every
        <span class="row"><input type="range" min="1" max="12" step="0.5" bind:value={profile.look.timedEvery}>
        <span class="val">{profile.look.timedEvery}s</span></span></label>
    {/if}

    <h2>OBS</h2>
    <p class="hint">Add a <b>Browser</b> source with this URL. Transparent background, no chroma key needed. Keep this app running.</p>
    <div class="row">
      <code class="url">{OVERLAY_ORIGIN}/</code>
      <button class="small" onclick={copyUrl}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
    <button class="small" style="margin-top:8px" onclick={() => revealItemInDir(profileDir)}>Open data folder</button>

    <h2>About</h2>
    <p class="hint">
      pngtuber is free software (GPL-3.0-or-later), © 2026 zaburen.
      <a href="https://github.com/zaburen/pngtuber"
         onclick={(e) => { e.preventDefault(); openUrl('https://github.com/zaburen/pngtuber'); }}>
        Source code &amp; license</a>.
      If you received this app without its source, you're entitled to it under the GPL.
    </p>
  </aside>
</main>

<style>
  :global(html, body) { margin: 0; height: 100%; overflow: hidden; }
  :global(body) { font: 13px/1.4 system-ui, sans-serif; color: #d8dae0; background: #101217; }
  main { display: flex; height: 100vh; }
  .preview {
    flex: 1; display: flex; align-items: center; justify-content: center;
    background-color: #202329;
    background-image: linear-gradient(45deg, #262a31 25%, transparent 25%, transparent 75%, #262a31 75%),
      linear-gradient(45deg, #262a31 25%, transparent 25%, transparent 75%, #262a31 75%);
    background-size: 24px 24px; background-position: 0 0, 12px 12px;
  }
  .stage { display: flex; align-items: center; justify-content: center; }
  .panel {
    width: 320px; padding: 14px; overflow-y: auto;
    background: #1b1d23; border-left: 1px solid #333;
  }
  h1 { font-size: 15px; margin: 0 0 10px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8f9c; margin: 18px 0 6px; }
  label { display: block; margin: 8px 0 2px; }
  .row { display: flex; align-items: center; gap: 8px; }
  input[type=range] { flex: 1; }
  select, button { width: 100%; padding: 5px; margin-top: 4px; background: #2a2d36; color: #d8dae0;
    border: 1px solid #444; border-radius: 4px; cursor: pointer; }
  button:hover:not(:disabled) { border-color: #6ea8fe; }
  button:disabled { opacity: 0.4; cursor: default; }
  button.on { border-color: #4caf7d; color: #7fe0a8; }
  button.small { width: auto; margin-top: 0; }
  button.danger { border-color: #e05555; color: #e88; }
  .val { min-width: 38px; text-align: right; color: #9aa0ad; font-variant-numeric: tabular-nums; }
  .status { font-size: 11px; color: #7fe0a8; margin-top: 4px; min-height: 14px; word-break: break-word; }
  .status.error { color: #e08a8a; }
  .meter { width: 100%; height: 18px; border-radius: 4px; margin-top: 6px; }
  .card { border: 1px solid #333; border-radius: 6px; padding: 8px; margin-top: 8px; }
  .pose-head { display: flex; gap: 4px; align-items: center; }
  .layer-name { flex: 1; min-width: 0; padding: 3px 6px; background: #12141a; color: #d8dae0;
    border: 1px solid #333; border-radius: 4px; }
  button.icon { width: 26px; padding: 3px 0; margin-top: 0; flex: none; }
  .confirm { font-size: 12px; color: #e0b0b0; margin: 6px 0; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .num { width: 52px; padding: 3px 5px; background: #12141a; color: #d8dae0; border: 1px solid #333; border-radius: 4px; }
  .slots { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
  .slot {
    position: relative; border: 1px dashed #555; border-radius: 6px; padding: 6px; text-align: center;
    cursor: pointer; min-height: 84px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 4px;
  }
  .slot.dragover { border-color: #6ea8fe; background: #232733; }
  .slot img { width: 48px; height: 48px; object-fit: contain; }
  .slot img.pixelated { image-rendering: pixelated; }
  .slot img.missing { visibility: hidden; }
  .slot .name { font-size: 11px; color: #9aa0ad; }
  .slot .x { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0;
    line-height: 1; font-size: 12px; margin: 0; }
  .hint { color: #6f7480; font-size: 11px; margin: 6px 0; }
  .hint a { color: #6ea8fe; }
  .url { flex: 1; background: #12141a; padding: 5px 7px; border-radius: 4px; font-size: 12px; user-select: all; }
</style>
