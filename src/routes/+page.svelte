<!-- SPDX-License-Identifier: GPL-3.0-or-later
     Copyright (c) 2026 zaburen -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { Avatar } from '$lib/avatar';
  import { Mic } from '$lib/mic';
  import { Renderer, RENDERER_CSS, placeholder } from '$lib/renderer';
  import * as backend from '$lib/backend';
  import {
    FRAME_KEYS,
    OVERLAY_ORIGIN,
    frameStorageKey,
    mergeProfile,
    newLayerId,
    newVariantId,
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

  let avatar: Avatar;
  let stage: HTMLDivElement;
  let meter: HTMLCanvasElement;

  const frameUrls = $derived(backend.frameUrls(present, frameVersion));
  const multiLayer = $derived(profile.layers.length > 1);

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

  function slotsFor(layer: Layer): FrameKey[] {
    return layer.reactsToVoice ? [...FRAME_KEYS] : ['idle'];
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
    profile.layers.push({
      id: newLayerId(),
      name: `layer ${profile.layers.length + 1}`,
      reactsToVoice: false,
      visible: true,
      variants: [{ id: 'default', name: 'default' }],
      activeVariant: 'default',
    });
  }

  async function removeLayer(layer: Layer) {
    for (const v of layer.variants) {
      for (const f of FRAME_KEYS) {
        const key = frameStorageKey(layer.id, v.id, f);
        if (frameUrls[key]) present = await backend.clearFrame(key);
      }
    }
    profile.layers = profile.layers.filter((l) => l.id !== layer.id);
    frameVersion++;
  }

  function addVariant(layer: Layer) {
    const v = { id: newVariantId(), name: `variant ${layer.variants.length + 1}` };
    layer.variants.push(v);
    layer.activeVariant = v.id;
  }

  async function removeVariant(layer: Layer) {
    if (layer.variants.length <= 1) return;
    const v = layer.activeVariant;
    for (const f of FRAME_KEYS) {
      const key = frameStorageKey(layer.id, v, f);
      if (frameUrls[key]) present = await backend.clearFrame(key);
    }
    layer.variants = layer.variants.filter((x) => x.id !== v);
    layer.activeVariant = layer.variants[0].id;
    frameVersion++;
  }

  function moveLayer(layer: Layer, delta: number) {
    const i = profile.layers.indexOf(layer);
    const j = i + delta;
    if (j < 0 || j >= profile.layers.length) return;
    [profile.layers[i], profile.layers[j]] = [profile.layers[j], profile.layers[i]];
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

    <h2>Frames</h2>
    {#each profile.layers as layer, i (layer.id)}
      <div class="layer" class:card={multiLayer}>
        {#if multiLayer}
          <div class="layer-head">
            <input class="layer-name" bind:value={layer.name} title="Layer name">
            <button class="icon" title="Bring forward" disabled={i === profile.layers.length - 1}
                    onclick={() => moveLayer(layer, 1)}>▲</button>
            <button class="icon" title="Send back" disabled={i === 0}
                    onclick={() => moveLayer(layer, -1)}>▼</button>
            <button class="icon" title="Delete layer and its images" onclick={() => removeLayer(layer)}>×</button>
          </div>
          <label class="row"><input type="checkbox" bind:checked={layer.visible}> Visible</label>
          <label class="row"><input type="checkbox" bind:checked={layer.reactsToVoice}> Reacts to voice (talking/blink frames)</label>
        {/if}
        {#if layer.variants.length > 1}
          <div class="variant-row">
            <select bind:value={layer.activeVariant} title="Active variant">
              {#each layer.variants as v (v.id)}
                <option value={v.id}>{v.name}</option>
              {/each}
            </select>
            {#each layer.variants.filter((v) => v.id === layer.activeVariant) as av (av.id)}
              <input class="layer-name" bind:value={av.name} title="Variant name">
            {/each}
            <button class="icon" title="Add variant" onclick={() => addVariant(layer)}>+</button>
            <button class="icon" title="Delete this variant and its images" onclick={() => removeVariant(layer)}>×</button>
          </div>
        {/if}
        <div class="slots">
          {#each slotsFor(layer) as k (k)}
            {@const key = frameStorageKey(layer.id, layer.activeVariant, k)}
            <div class="slot" class:dragover={dragOver === key} data-slot={key}
                 role="button" tabindex="0" title="Click or drop an image"
                 onclick={() => pickFrame(key)} onkeydown={(e) => e.key === 'Enter' && pickFrame(key)}>
              <img src={frameUrls[key] ?? placeholder(k)} alt="" class:pixelated={profile.look.pixelated}
                   class:missing={!frameUrls[key] && multiLayer}>
              <div class="name">{layer.reactsToVoice ? k : 'image'}{frameUrls[key] ? '' : multiLayer ? ' (empty)' : ' (placeholder)'}</div>
              {#if frameUrls[key]}
                <button class="x" title="Remove" onclick={(e) => removeFrame(key, e)}>×</button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
    <button onclick={addLayer}>+ Add layer</button>
    <p class="hint">
      {#if multiLayer}
        Layers draw bottom to top — later cards appear in front. Use the same canvas size for every image so layers line up.
      {:else}
        Only <b>idle</b> is required. Missing blink/talking frames fall back automatically.
        Add layers for props, outfits, or parts you'll want to trigger separately.
      {/if}
    </p>

    <h2>Look</h2>
    <label>Scale
      <span class="row"><input type="range" min="1" max="12" step="1" bind:value={profile.look.scale}>
      <span class="val">{profile.look.scale}x</span></span></label>
    <label class="row"><input type="checkbox" bind:checked={profile.look.pixelated}> Crisp pixels (nearest-neighbor)</label>
    <label class="row"><input type="checkbox" bind:checked={profile.look.bounce}> Bounce on talk start</label>
    <label class="row"><input type="checkbox" bind:checked={profile.look.blink}> Auto-blink</label>

    <h2>OBS</h2>
    <p class="hint">Add a <b>Browser</b> source with this URL. Transparent background, no chroma key needed. Keep this app running.</p>
    <div class="row">
      <code class="url">{OVERLAY_ORIGIN}/</code>
      <button class="small" onclick={copyUrl}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
    <button class="small" style="margin-top:8px" onclick={() => revealItemInDir(profileDir)}>Open data folder</button>
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
  .val { min-width: 38px; text-align: right; color: #9aa0ad; font-variant-numeric: tabular-nums; }
  .status { font-size: 11px; color: #7fe0a8; margin-top: 4px; min-height: 14px; word-break: break-word; }
  .status.error { color: #e08a8a; }
  .meter { width: 100%; height: 18px; border-radius: 4px; margin-top: 6px; }
  .layer.card { border: 1px solid #333; border-radius: 6px; padding: 8px; margin-top: 8px; }
  .layer-head { display: flex; gap: 4px; align-items: center; }
  .variant-row { display: flex; gap: 4px; align-items: center; margin-top: 6px; }
  .variant-row select { flex: 1; margin-top: 0; }
  .layer-name { flex: 1; min-width: 0; padding: 3px 6px; background: #12141a; color: #d8dae0;
    border: 1px solid #333; border-radius: 4px; }
  button.icon { width: 26px; padding: 3px 0; margin-top: 0; flex: none; }
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
  .url { flex: 1; background: #12141a; padding: 5px 7px; border-radius: 4px; font-size: 12px; user-select: all; }
</style>
