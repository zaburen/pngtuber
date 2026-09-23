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
    mergeGlobal,
    mergeProfile,
    type FrameKey,
    type GlobalSettings,
    type Layer,
    type Profile,
    type SetsIndex,
  } from '$lib/types';

  let profile: Profile = $state(mergeProfile(null));
  let global: GlobalSettings = $state(mergeGlobal(null));
  let sets: SetsIndex = $state({ active: '', sets: [] });
  let defaults: string[] = $state([]);
  // Set-management UI state.
  let creating = $state(false);
  let renaming = $state(false);
  let confirmingSetDelete = $state(false);
  let newSetName = $state('');
  let newSetFrom = $state('blank');
  let renameValue = $state('');
  let applyDefaultName = $state('');
  let confirmingApply = $state(false);
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
  let previewEl: HTMLElement;
  let meter: HTMLCanvasElement;

  const frameUrls = $derived(backend.frameUrls(present, frameVersion));
  const main = $derived(mainLayer(profile));
  const mainIndex = $derived(profile.layers.indexOf(main));
  // The prop layers (everything that isn't the voice-reactive character), as live objects.
  const propLayers = $derived(profile.layers.filter((l) => l.id !== main.id && !l.reactsToVoice));
  const activeSet = $derived(sets.sets.find((s) => s.id === sets.active));

  onMount(() => {
    let cleanup = () => {};
    (async () => {
      sets = await backend.listSets();
      defaults = await backend.defaultAvatars();
      const rawProfile = await backend.loadProfile();
      const storedGlobal = await backend.loadGlobal();
      // Fresh installs / new global.json seed the mic from an old profile's
      // `mic` block if present (one-time migration to global settings).
      global = mergeGlobal(
        storedGlobal,
        storedGlobal ? undefined : (rawProfile as { mic?: unknown } | null)?.mic,
      );
      profile = mergeProfile(rawProfile);
      present = await backend.listFrames();
      profileDir = await backend.profilePath();

      const renderer = new Renderer(stage, previewEl);
      avatar = new Avatar(profile, (s) => {
        renderer.render(s);
        backend.publishState(JSON.stringify(s)).catch((e) => console.error('publish failed', e));
      });
      avatar.frames = frameUrls;
      avatar.micSettings = global.mic;
      avatar.start();
      ready = true;

      mics = await Mic.list();
      if (global.mic.enabled) startMic();

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
    avatar.profile = profile; // keep avatar on the current reactive proxy (survives set reloads)
    avatar.emit();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      backend.saveProfile(JSON.parse(snapshot)).catch((e) => console.error('save failed', e));
    }, 300);
  });

  // Global settings (mic) persist separately from the per-set profile.
  let globalSaveTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const snapshot = JSON.stringify(global);
    if (!ready) return;
    avatar.micSettings = global.mic;
    if (globalSaveTimer) clearTimeout(globalSaveTimer);
    globalSaveTimer = setTimeout(() => {
      backend.saveGlobal(JSON.parse(snapshot)).catch((e) => console.error('save global failed', e));
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
      profile.frameSources[key] = path; // remember source so the frame can be re-imported
      frameVersion++;
    } catch (e) {
      micStatus = { text: `import failed: ${e}`, error: true };
      console.error('import failed', e);
    }
  }

  /** Re-copy a frame from the file it was last imported from (after editing it). */
  async function reimport(key: string) {
    const src = profile.frameSources[key];
    if (src) await importFrame(key, src);
  }

  /** Overwrite the current set's character frames with a bundled default. */
  async function applyDefault() {
    if (!applyDefaultName) return;
    present = await backend.applyDefault(applyDefaultName);
    for (const fk of FRAME_KEYS) delete profile.frameSources[frameStorageKey(main.id, DEFAULT_VARIANT_ID, fk)];
    frameVersion++;
    confirmingApply = false;
    applyDefaultName = '';
  }

  async function removeFrame(key: string, ev: MouseEvent) {
    ev.stopPropagation();
    present = await backend.clearFrame(key);
    delete profile.frameSources[key];
    frameVersion++;
  }

  // --- Sets ---
  async function reloadActive() {
    const p = mergeProfile(await backend.loadProfile());
    profile = p;
    avatar.profile = p;
    present = await backend.listFrames();
    frameVersion++;
    avatar.emit(true);
  }
  async function switchTo(id: string) {
    if (!id || id === sets.active) return;
    await backend.switchSet(id);
    sets = { ...sets, active: id };
    await reloadActive();
  }
  async function createNewSet() {
    const name = newSetName.trim() || 'New set';
    const id = await backend.createSet(name, newSetFrom);
    sets = await backend.listSets();
    creating = false;
    newSetName = '';
    newSetFrom = 'blank';
    await switchTo(id);
  }
  function startRename() {
    renameValue = activeSet?.name ?? '';
    renaming = true;
    creating = false;
  }
  async function renameActive() {
    const name = renameValue.trim();
    if (name) {
      await backend.renameSet(sets.active, name);
      sets = await backend.listSets();
    }
    renaming = false;
  }
  async function deleteActive() {
    const newActive = await backend.deleteSet(sets.active);
    sets = await backend.listSets();
    sets = { ...sets, active: newActive };
    confirmingSetDelete = false;
    await reloadActive();
  }

  function addLayer() {
    addProp(profile);
  }

  async function deleteLayer(layer: Layer) {
    confirmingDelete = null;
    const key = frameStorageKey(layer.id, DEFAULT_VARIANT_ID, 'idle');
    if (frameUrls[key]) present = await backend.clearFrame(key);
    delete profile.frameSources[key];
    removeProp(profile, layer.id);
    frameVersion++;
  }

  async function startMic() {
    try {
      await avatar.mic.start(global.mic.deviceId);
      micRunning = true;
      micStatus = { text: 'using: ' + avatar.mic.label, error: false };
      mics = await Mic.list(); // labels appear once permission is granted
      global.mic.enabled = true;
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
    global.mic.enabled = false;
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
    x.fillRect(global.mic.threshold * w - 1, 0, 2, h);
  }

  // Layer Size slider uses a logarithmic mapping so each drag step changes size
  // by a constant percentage — fine control at the small end for big images.
  const SMIN = 0.05;
  const SMAX = 4;
  const SPOS = 1000;
  function scaleToPos(s: number): number {
    const c = Math.min(SMAX, Math.max(SMIN, s || 1));
    return Math.round((SPOS * Math.log(c / SMIN)) / Math.log(SMAX / SMIN));
  }
  function posToScale(pos: number): number {
    return Math.round(SMIN * Math.pow(SMAX / SMIN, pos / SPOS) * 1000) / 1000;
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
          {#if profile.frameSources[key]}
            <button class="reimport" title="Re-import from the original file"
                    onclick={(e) => { e.stopPropagation(); reimport(key); }}>↻</button>
          {/if}
          <button class="x" title="Remove" onclick={(e) => removeFrame(key, e)}>×</button>
        {/if}
      </div>
    {/each}
  </div>
{/snippet}

<main>
  <section class="preview" bind:this={previewEl}>
    <div class="stage"><div bind:this={stage}></div></div>
  </section>

  <aside class="panel">
    <h1>pngtuber</h1>

    <h2>Avatar set</h2>
    <p class="hint">Each set is a whole avatar (its art + layers + look). Switch between them here.</p>
    <select value={sets.active} onchange={(e) => switchTo(e.currentTarget.value)}>
      {#each sets.sets as s (s.id)}
        <option value={s.id}>{s.name}</option>
      {/each}
    </select>
    <div class="row" style="margin-top:4px">
      <button class="small" onclick={startRename}>Rename</button>
      <button class="small" onclick={() => { creating = !creating; renaming = false; }}>New</button>
      <button class="small danger" disabled={sets.sets.length <= 1}
              onclick={() => (confirmingSetDelete = true)}>Delete</button>
    </div>
    {#if renaming}
      <div class="row" style="margin-top:6px">
        <input class="layer-name" bind:value={renameValue} placeholder="Set name"
               onkeydown={(e) => e.key === 'Enter' && renameActive()}>
        <button class="small" onclick={renameActive}>Save</button>
      </div>
    {/if}
    {#if confirmingSetDelete}
      <div class="confirm">
        Delete set “{activeSet?.name}” and its images?
        <button class="small danger" onclick={deleteActive}>Delete</button>
        <button class="small" onclick={() => (confirmingSetDelete = false)}>Cancel</button>
      </div>
    {/if}
    {#if creating}
      <div class="card">
        <label>Name
          <input class="layer-name" bind:value={newSetName} placeholder="New set"></label>
        <label>Start from
          <select bind:value={newSetFrom}>
            <option value="blank">Blank (placeholder art)</option>
            <option value={`copy:${sets.active}`}>Duplicate current set</option>
            {#each defaults as d (d)}
              <option value={`default:${d}`}>Default: {d}</option>
            {/each}
          </select>
        </label>
        <div class="row" style="margin-top:6px">
          <button class="small" onclick={createNewSet}>Create</button>
          <button class="small" onclick={() => (creating = false)}>Cancel</button>
        </div>
      </div>
    {/if}

    <h2>Microphone</h2>
    <select bind:value={global.mic.deviceId} onchange={onMicChange}>
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
      <span class="row"><input type="range" min="0" max="1" step="0.01" bind:value={global.mic.threshold}>
      <span class="val">{global.mic.threshold.toFixed(2)}</span></span></label>
    <label>Gain
      <span class="row"><input type="range" min="0.5" max="8" step="0.1" bind:value={global.mic.gain}>
      <span class="val">{global.mic.gain.toFixed(1)}x</span></span></label>
    <label>Hold (ms)
      <span class="row"><input type="range" min="0" max="800" step="10" bind:value={global.mic.hold}>
      <span class="val">{global.mic.hold}</span></span></label>

    <h2>Character</h2>
    <p class="hint">Your <b>idle</b> and <b>talking</b> frames. Click or drop a PNG on any slot to change it. Only idle is required — talking and the timed frames fall back to it.</p>
    {@render frameSlots(main.id, DEFAULT_VARIANT_ID, true, true)}
    {#if defaults.length}
      <div class="row" style="margin-top:6px">
        <select bind:value={applyDefaultName}>
          <option value="">Replace with a default…</option>
          {#each defaults as d (d)}<option value={d}>{d}</option>{/each}
        </select>
        <button class="small" disabled={!applyDefaultName} onclick={() => (confirmingApply = true)}>Apply</button>
      </div>
      {#if confirmingApply}
        <div class="confirm">
          Replace the character's frames with “{applyDefaultName}”? (Accessory layers stay.)
          <button class="small danger" onclick={applyDefault}>Replace</button>
          <button class="small" onclick={() => (confirmingApply = false)}>Cancel</button>
        </div>
      {/if}
    {/if}

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
        <label>Size
          <span class="row"><input type="range" min="0" max="1000" step="1"
            value={scaleToPos(layer.scale ?? 1)}
            oninput={(e) => (layer.scale = posToScale(+e.currentTarget.value))}>
          <span class="val">{(layer.scale ?? 1) < 0.1 ? (layer.scale ?? 1).toFixed(3) : (layer.scale ?? 1).toFixed(2)}×</span></span></label>
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
    {#if profile.look.bounce}
      <label>Bounce height
        <span class="row"><input type="range" min="0.2" max="3" step="0.1" bind:value={profile.look.bounceScale}>
        <span class="val">{profile.look.bounceScale.toFixed(1)}x</span></span></label>
    {/if}
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
  main { display: flex; height: 100vh; overflow: hidden; }
  .preview {
    flex: 1; min-width: 0; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    background-color: #202329;
    background-image: linear-gradient(45deg, #262a31 25%, transparent 25%, transparent 75%, #262a31 75%),
      linear-gradient(45deg, #262a31 25%, transparent 25%, transparent 75%, #262a31 75%);
    background-size: 24px 24px; background-position: 0 0, 12px 12px;
  }
  .stage { display: flex; align-items: center; justify-content: center; }
  /* Panel sits above the preview and keeps its width, so an oversized avatar
     in the preview can never overlap or push it off-screen. */
  .panel {
    position: relative; z-index: 1; flex: none;
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
  .slot .reimport { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; padding: 0;
    line-height: 1; font-size: 12px; margin: 0; }
  .hint { color: #6f7480; font-size: 11px; margin: 6px 0; }
  .hint a { color: #6ea8fe; }
  .url { flex: 1; background: #12141a; padding: 5px 7px; border-radius: 4px; font-size: 12px; user-select: all; }
</style>
