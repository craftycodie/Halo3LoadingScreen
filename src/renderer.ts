import shaderSource from './shaders/loading.wgsl?raw';
import halo3LogoUrl from './assets/halo3-logo.png';
import { buildAtlasTextures, decodeAtlas } from './atlas';
import { buildWvp, evalCamera } from './camera';
import {
  expandQuads,
  fillFullscreenQuad,
  fillOverlayQuad,
  generateGeometry,
  packVertices,
} from './geometry';
import { CB_BYTES, LoadingConstants, TWO_PI } from './gpu/types';
import {
  computeFade,
  createRingState,
  resetRingState,
  SLICE_COUNT,
  updateFadeOut,
  updateProgress,
  type RingState,
} from './progress';
import {
  applyFreeCamLook,
  adjustFreeCamSpeed,
  createFreeCam,
  freeCamLookAt,
  syncFreeCamFromTrack,
  updateFreeCam,
  type FreeCamState,
} from './freecam';

/** Match Xbox overlay_b NDC width: 256px * (overlayUnit*2) scale. */
const OVERLAY_B_REF_WIDTH = 256;
const OVERLAY_B_REF_SCALE = 2;

const GUIDE_HALF = [3.1415927, 2.5132742, 1.8849556, 1.2566371, 0.62831855];
const GUIDE_RADIUS = [18.0, 19.0, 20.0, 21.0, 22.0];
const GUIDE_SCALE = [0.05, 0.04, 0.03, 0.02, 0.01];
const GUIDE_OTHER = [20.0, 24.0, 28.0, 32.0, 34.0];

// 32 outlines + 5*48 guides + 32*2 points + 32 egg + 2 overlay + 1 composite
const MAX_DRAWS = 400;

const ADDITIVE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
};

const OPAQUE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
};

function createR8Texture(
  device: GPUDevice,
  width: number,
  height: number,
  data: Uint8Array,
  label: string,
): GPUTexture {
  const texture = device.createTexture({
    label,
    size: { width, height },
    format: 'r8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  // Copy into a tight ArrayBuffer-backed view so byteOffset is always 0.
  const bytes = new Uint8Array(data);
  device.queue.writeTexture(
    { texture },
    bytes,
    { bytesPerRow: width },
    { width, height },
  );
  return texture;
}

function createR8Texture3D(
  device: GPUDevice,
  width: number,
  height: number,
  depth: number,
  data: Uint8Array,
): GPUTexture {
  const texture = device.createTexture({
    label: 'volume',
    size: { width, height, depthOrArrayLayers: depth },
    format: 'r8unorm',
    dimension: '3d',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const bytes = new Uint8Array(data);
  device.queue.writeTexture(
    { texture },
    bytes,
    { bytesPerRow: width, rowsPerImage: height },
    { width, height, depthOrArrayLayers: depth },
  );
  return texture;
}

function createMeshBuffer(device: GPUDevice, data: Float32Array, label: string): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: data.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    buffer,
    0,
    data.buffer as ArrayBuffer,
    data.byteOffset,
    data.byteLength,
  );
  return buffer;
}

/** Decode a white-on-black PNG into an R8 luminance atlas for ps_overlay. */
async function loadLogoR8(url: string): Promise<{ width: number; height: number; data: Uint8Array }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load logo: ${response.status} ${url}`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('2D canvas unavailable for logo decode');
  }
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  bitmap.close();
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = Math.max(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!);
  }
  return { width, height, data };
}

function createPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  vs: string,
  fs: string,
  topology: GPUPrimitiveTopology,
  blend: GPUBlendState | undefined,
  label: string,
): GPURenderPipeline {
  return device.createRenderPipeline({
    label,
    layout,
    vertex: {
      module,
      entryPoint: vs,
      buffers: [
        {
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: fs,
      targets: [{ format, blend }],
    },
    primitive: {
      topology,
      cullMode: 'none',
    },
  });
}

export class LoadingScreenRenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private constants = new LoadingConstants();

  /** 256-byte aligned uniform slots (WebGPU dynamic-offset requirement). */
  private uniformAlign = 256;
  private uniformSlotBytes = 0;
  private uniformSlotFloats = 0;
  private uniformCpu!: Float32Array;
  private uniformBuffer!: GPUBuffer;
  private uniformDraw = 0;

  private bufEgg!: GPUBuffer;
  private bufSuper!: GPUBuffer;
  private bufGuide!: GPUBuffer;
  private bufPoint!: GPUBuffer;
  private bufOverlayB!: GPUBuffer;
  private bufOverlayA!: GPUBuffer;
  private bufFullscreen!: GPUBuffer;
  private eggCount = 0;
  private superCount = 0;
  private guideCount = 0;
  private pointCount = 0;

  private ringTexture: GPUTexture | null = null;
  private ringView: GPUTextureView | null = null;
  private ringWidth = 0;
  private ringHeight = 0;

  private texCell!: GPUTexture;
  private texMask!: GPUTexture;
  private texEgg!: GPUTexture;
  private texVolume!: GPUTexture;
  private texParticle!: GPUTexture;
  private texOverlayA!: GPUTexture;
  private texOverlayB!: GPUTexture;
  private texDummy!: GPUTexture;
  private overlayBWidth = OVERLAY_B_REF_WIDTH;
  private overlayBHeight = 32;

  private sampLinear!: GPUSampler;
  private sampNearestClamp!: GPUSampler;
  private sampNearestWrap!: GPUSampler;

  private bgl!: GPUBindGroupLayout;
  private pipeEgg!: GPURenderPipeline;
  private pipeLines!: GPURenderPipeline;
  private pipePoints!: GPURenderPipeline;
  private pipeOverlay!: GPURenderPipeline;
  private pipeComposite!: GPURenderPipeline;

  private bgRing!: GPUBindGroup;
  private bgOverlayA!: GPUBindGroup;
  private bgOverlayB!: GPUBindGroup;
  private bgComposite: GPUBindGroup | null = null;

  private state: RingState = createRingState();
  private freecam: FreeCamState = createFreeCam();
  private keys = new Set<string>();
  private syncedFreecam = false;
  eggActive = false;
  loadSeconds = 30;
  loop = false;
  private ringFormat: GPUTextureFormat = 'rgba8unorm';

  setFreecam(enabled: boolean): void {
    if (enabled && !this.freecam.enabled) {
      this.syncedFreecam = false;
    }
    this.freecam.enabled = enabled;
  }

  setKeys(keys: Set<string>): void {
    this.keys = keys;
  }

  applyLook(dx: number, dy: number): void {
    applyFreeCamLook(this.freecam, dx, dy);
  }

  adjustSpeed(wheelDeltaY: number): void {
    adjustFreeCamSpeed(this.freecam, wheelDeltaY);
  }

  setMoveSpeed(speed: number): void {
    this.freecam.moveSpeed = Math.max(0.25, Math.min(80, speed));
  }

  get moveSpeed(): number {
    return this.freecam.moveSpeed;
  }

  /** True once the first ring has finished the Xbox join reveal (frac≥1 + 2s). */
  get firstPlayComplete(): boolean {
    if (this.state.completeElapsed < 0) {
      return false;
    }
    // ps_egg / points: birth = stamp + 2. Same hold as fade_out's join wait.
    return this.state.elapsedSeconds - this.state.completeElapsed >= 2.0;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not available in this browser.');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to acquire a WebGPU adapter.');
    }
    this.device = await adapter.requestDevice();
    this.uniformAlign = this.device.limits.minUniformBufferOffsetAlignment || 256;
    this.uniformSlotBytes = Math.ceil(CB_BYTES / this.uniformAlign) * this.uniformAlign;
    this.uniformSlotFloats = this.uniformSlotBytes / 4;
    this.uniformCpu = new Float32Array(MAX_DRAWS * this.uniformSlotFloats);
    this.uniformBuffer = this.device.createBuffer({
      label: 'loading-cb-slots',
      size: MAX_DRAWS * this.uniformSlotBytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.context = canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
      colorSpace: 'srgb',
    });

    this.ringFormat = 'rgba8unorm';

    const geom = generateGeometry();
    const eggTri = packVertices(expandQuads(geom.eggVerts));
    const superPacked = packVertices(geom.superVerts);
    const guidePacked = packVertices(geom.guideVerts);
    const pointPacked = packVertices(geom.pointVerts);
    this.eggCount = eggTri.length / 8;
    this.superCount = superPacked.length / 8;
    this.guideCount = guidePacked.length / 8;
    this.pointCount = pointPacked.length / 8;
    this.bufEgg = createMeshBuffer(this.device, eggTri, 'egg');
    this.bufSuper = createMeshBuffer(this.device, superPacked, 'super');
    this.bufGuide = createMeshBuffer(this.device, guidePacked, 'guide');
    this.bufPoint = createMeshBuffer(this.device, pointPacked, 'point');
    this.bufOverlayB = this.device.createBuffer({
      label: 'overlayB',
      size: 6 * 32,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.bufOverlayA = this.device.createBuffer({
      label: 'overlayA',
      size: 6 * 32,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.bufFullscreen = this.device.createBuffer({
      label: 'fullscreen',
      size: 6 * 32,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const fs = new Float32Array(6 * 8);
    fillFullscreenQuad(fs);
    this.device.queue.writeBuffer(this.bufFullscreen, 0, fs);

    const atlas = decodeAtlas();
    const tex = buildAtlasTextures(atlas);
    this.texCell = createR8Texture(this.device, 16, 16, tex.cell, 'cell');
    this.texMask = createR8Texture(this.device, 32, 4, tex.mask, 'mask');
    this.texEgg = createR8Texture(this.device, 138, 10, tex.egg, 'egg');
    this.texOverlayA = createR8Texture(this.device, 123, 47, tex.overlayA, 'overlayA');
    const logo = await loadLogoR8(halo3LogoUrl);
    this.overlayBWidth = logo.width;
    this.overlayBHeight = logo.height;
    this.texOverlayB = createR8Texture(this.device, logo.width, logo.height, logo.data, 'overlayB');
    this.texParticle = createR8Texture(this.device, 16, 16, tex.particle, 'particle');
    this.texVolume = createR8Texture3D(this.device, 64, 32, 4, tex.volume);
    this.texDummy = createR8Texture(this.device, 1, 1, new Uint8Array([0]), 'dummy');

    this.sampLinear = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });
    this.sampNearestClamp = this.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });
    this.sampNearestWrap = this.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'repeat',
    });

    this.bgl = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: CB_BYTES },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '3d' },
        },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'non-filtering' } },
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'non-filtering' } },
        { binding: 10, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'non-filtering' } },
        { binding: 11, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 12, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'non-filtering' } },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bgl],
    });
    const module = this.device.createShaderModule({
      label: 'loading',
      code: shaderSource,
    });
    const shaderInfo = await module.getCompilationInfo();
    const shaderErrors = shaderInfo.messages.filter((m) => m.type === 'error');
    if (shaderErrors.length > 0) {
      throw new Error(
        shaderErrors
          .map((m) => `WGSL L${m.lineNum}:${m.linePos} ${m.message}`)
          .join('\n'),
      );
    }

    this.pipeEgg = createPipeline(
      this.device, module, pipelineLayout, this.ringFormat,
      'vs_egg', 'ps_egg', 'triangle-list', ADDITIVE, 'egg',
    );
    this.pipeLines = createPipeline(
      this.device, module, pipelineLayout, this.ringFormat,
      'vs_lines', 'ps_lines', 'line-list', ADDITIVE, 'lines',
    );
    this.pipePoints = createPipeline(
      this.device, module, pipelineLayout, this.ringFormat,
      'vs_points', 'ps_points', 'triangle-list', ADDITIVE, 'points',
    );
    this.pipeOverlay = createPipeline(
      this.device, module, pipelineLayout, this.ringFormat,
      'vs_screen', 'ps_overlay', 'triangle-list', ADDITIVE, 'overlay',
    );
    this.pipeComposite = createPipeline(
      this.device, module, pipelineLayout, this.format,
      'vs_screen', 'ps_composite', 'triangle-list', OPAQUE, 'composite',
    );

    this.bgRing = this.makeBindGroup(this.texDummy.createView());
    this.bgOverlayA = this.makeBindGroup(this.texOverlayA.createView());
    this.bgOverlayB = this.makeBindGroup(this.texOverlayB.createView());
  }

  private makeBindGroup(sourceView: GPUTextureView): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.bgl,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.uniformBuffer,
            offset: 0,
            size: CB_BYTES,
          },
        },
        { binding: 1, resource: this.texCell.createView() },
        { binding: 2, resource: this.texMask.createView() },
        { binding: 3, resource: this.texEgg.createView() },
        { binding: 4, resource: this.texVolume.createView({ dimension: '3d' }) },
        { binding: 5, resource: this.texParticle.createView() },
        { binding: 6, resource: sourceView },
        { binding: 7, resource: this.sampLinear },
        { binding: 8, resource: this.sampNearestClamp },
        { binding: 9, resource: this.sampNearestClamp },
        { binding: 10, resource: this.sampNearestWrap },
        { binding: 11, resource: this.sampLinear },
        { binding: 12, resource: this.sampNearestClamp },
      ],
    });
  }

  restart(): void {
    resetRingState(this.state);
    this.syncedFreecam = false;
  }

  private ensureRing(width: number, height: number): void {
    width = Math.max(8, width);
    height = Math.max(8, height);
    if (this.ringTexture && this.ringWidth === width && this.ringHeight === height) {
      return;
    }
    this.ringTexture?.destroy();
    this.ringTexture = this.device.createTexture({
      label: 'ring',
      size: { width, height },
      format: this.ringFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.ringView = this.ringTexture.createView();
    this.ringWidth = width;
    this.ringHeight = height;
    this.bgComposite = this.makeBindGroup(this.ringView);
  }

  private beginUniformFrame(): void {
    this.uniformDraw = 0;
  }

  /** Snapshot current constants into the next dynamic-offset slot; return byte offset. */
  private pushUniforms(): number {
    if (this.uniformDraw >= MAX_DRAWS) {
      throw new Error('uniform slot overflow');
    }
    const floatBase = this.uniformDraw * this.uniformSlotFloats;
    this.uniformCpu.set(this.constants.data, floatBase);
    // Clear padding between CB_BYTES and slot end (not strictly required).
    const offset = this.uniformDraw * this.uniformSlotBytes;
    this.uniformDraw++;
    return offset;
  }

  private flushUniforms(): void {
    if (this.uniformDraw === 0) return;
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.uniformCpu.buffer,
      this.uniformCpu.byteOffset,
      this.uniformDraw * this.uniformSlotBytes,
    );
  }

  private draw(
    pass: GPURenderPassEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    vertexBuffer: GPUBuffer,
    vertexCount: number,
  ): void {
    const dynOffset = this.pushUniforms();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup, [dynOffset]);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(vertexCount);
  }

  /** Debug snapshot for smoke tests. */
  getDebug(): {
    smoothedFrac: number;
    filteredFrac: number;
    elapsed: number;
    velocity: number;
    freecam: boolean;
  } {
    return {
      smoothedFrac: this.state.smoothedFrac,
      filteredFrac: this.state.filteredFrac,
      elapsed: this.state.elapsedSeconds,
      velocity: this.state.velocity,
      freecam: this.freecam.enabled,
    };
  }

  frame(nowMs: number, dt = 1 / 60): void {
    const canvas = this.context.canvas as HTMLCanvasElement;
    // Cap DPR — full-res 4K × 3M point tris is unplayable in browser.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    updateProgress(this.state, 1.0, nowMs, this.loadSeconds);
    // Loop: Xbox fade-out (latch near frac 0.9, dim ~2.9s, join+2 hold), then
    // reset once black. Non-loop stays lit after complete.
    if (this.loop && updateFadeOut(this.state, nowMs)) {
      resetRingState(this.state);
      this.syncedFreecam = false;
      updateProgress(this.state, 1.0, nowMs, this.loadSeconds);
    }

    const aspect = height > 0 ? width / height : 16 / 9;
    const trackCam = evalCamera(
      this.state.filteredFrac,
      this.state.smoothedFrac,
      this.eggActive,
    );

    if (this.freecam.enabled) {
      if (!this.syncedFreecam) {
        syncFreeCamFromTrack(this.freecam, trackCam.position, trackCam.lookAt);
        this.syncedFreecam = true;
      }
      updateFreeCam(this.freecam, this.keys, dt);
    } else {
      this.syncedFreecam = false;
    }

    const position = this.freecam.enabled
      ? this.freecam.position
      : trackCam.position;
    const lookAt = this.freecam.enabled
      ? freeCamLookAt(this.freecam)
      : trackCam.lookAt;

    const fade = this.loop ? computeFade(this.state, nowMs) : 1.0;
    const lit = trackCam.intensity;

    buildWvp(position, lookAt, aspect, this.constants.mat);
    this.constants.setPixelInverseVolume([0.015625, 0.03125, 0.25, lit]);
    this.constants.setPixelVolume([64, 32, 4, 0]);
    this.constants.setVertexTimescale([0, 0, this.state.smoothedFrac, this.state.elapsedSeconds]);
    this.constants.setPixelTimescale([0, 0, this.state.smoothedFrac, this.state.elapsedSeconds]);

    // Full framebuffer resolution (DPR-capped above). Shaders take inv_extent
    // from these sizes — no 720p lock.
    const ringW = width;
    const ringH = height;

    // Overlay NDC sized like Xbox 720p, but on a virtual screen with this
    // buffer's aspect so logos stay right-aligned and unstretched.
    const overlayUnit = width >= 1280 ? 2.0 : 1.5;
    const virtH = 720;
    const virtW = Math.max(1, virtH * (ringW / ringH));
    // Preserve Xbox Halo-logo NDC width while using the custom texture aspect.
    const overlayBScale =
      overlayUnit * OVERLAY_B_REF_SCALE * (OVERLAY_B_REF_WIDTH / this.overlayBWidth);
    const overlayB = new Float32Array(6 * 8);
    const overlayA = new Float32Array(6 * 8);
    fillOverlayQuad(
      overlayB,
      0.85,
      -0.55,
      this.overlayBWidth,
      this.overlayBHeight,
      overlayBScale,
      virtW,
      virtH,
    );
    fillOverlayQuad(overlayA, 0.85, -0.85, 123, 47, overlayUnit, virtW, virtH);
    this.device.queue.writeBuffer(this.bufOverlayB, 0, overlayB);
    this.device.queue.writeBuffer(this.bufOverlayA, 0, overlayA);

    this.ensureRing(ringW, ringH);
    this.beginUniformFrame();
    const encoder = this.device.createCommandEncoder();

    {
      const ringPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.ringView!,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });

      this.constants.setPassModes([1, 0, 0, 0]);
      for (let slice = 0; slice < SLICE_COUNT; slice++) {
        this.constants.setTheta([
          slice * 0.03125 * TWO_PI,
          0.19634955,
          this.state.sliceA[slice]!,
          this.state.sliceB[slice]!,
        ]);
        this.constants.setOther([4.0, 0.050000191, 0.25, 0.0]);
        const group = slice < 16 ? slice : 31 - slice;
        const mirror = slice >= 16;
        for (let line = 0; line < 6; line++) {
          const start = this.state.lineStarts[group * 6 + line]!;
          const end = this.state.lineEnds[group * 6 + line]!;
          this.constants.setLineConstant(line, mirror ? end : start, mirror ? start : end);
        }
        this.draw(ringPass, this.pipeLines, this.bgRing, this.bufSuper, this.superCount);
      }

      if (lit > 0.02) {
        this.constants.setPassModes([0, 0, 0, 0]);
        for (let ring = 0; ring < 5; ring++) {
          const half = GUIDE_HALF[ring]!;
          const radius = GUIDE_RADIUS[ring]!;
          const scale = GUIDE_SCALE[ring]! * 0.4;
          const other = GUIDE_OTHER[ring]! / Math.sin(half * 0.5);
          for (let rot = 0; rot < 48; rot++) {
            this.constants.setTheta([
              rot * 0.020833334 * TWO_PI,
              0.1308997,
              -half * 0.5,
              half,
            ]);
            this.constants.setOther([radius, other, scale, 0.0]);
            this.draw(ringPass, this.pipeLines, this.bgRing, this.bufGuide, this.guideCount);
          }
        }
      }

      const invX = 1 / ringW;
      const invY = 1 / ringH;
      for (let slice = 0; slice < SLICE_COUNT; slice++) {
        this.constants.setTheta([
          slice * 0.03125 * TWO_PI,
          0.19634955,
          this.state.sliceA[slice]!,
          this.state.sliceB[slice]!,
        ]);
        this.constants.setOther([4.0, 0.050000191, 0.25, 0.0]);
        this.constants.setSliceTimes(this.state.buildTimes, slice);
        for (let ambient = 0; ambient < 2; ambient++) {
          // vs_points: oPts is framebuffer pixels → NDC via 1/extent per axis
          // (actual RT size, not locked 720p).
          this.constants.setPassModes([0, ambient, invX, invY]);
          this.draw(ringPass, this.pipePoints, this.bgRing, this.bufPoint, this.pointCount);
        }
      }
      this.constants.setPassModes([0, 0, 0, 0]);

      const eggSpan = this.eggActive ? 4.9468598 : 0.0;
      for (let slice = 0; slice < SLICE_COUNT; slice++) {
        const sector = slice * 0.03125;
        this.constants.setTheta([
          sector * TWO_PI,
          0.19634955,
          this.state.sliceA[slice]!,
          this.state.sliceB[slice]!,
        ]);
        this.constants.setOther([4.0, 0.050000191, 0.25, 0.0]);
        this.constants.setEggScales([
          sector * eggSpan - 0.4830918,
          eggSpan * 0.03125,
          0,
          0,
        ]);
        this.constants.setSliceTimes(this.state.buildTimes, slice);
        this.draw(ringPass, this.pipeEgg, this.bgRing, this.bufEgg, this.eggCount);
      }

      const overlayFade = fade * trackCam.fadeA;
      this.constants.setPassModes([0, 0, 0, 0]);
      this.constants.setCompositeControl([overlayFade, overlayFade, overlayFade, 1]);
      this.draw(ringPass, this.pipeOverlay, this.bgOverlayB, this.bufOverlayB, 6);
      this.draw(ringPass, this.pipeOverlay, this.bgOverlayA, this.bufOverlayA, 6);

      ringPass.end();
    }

    const swapView = this.context.getCurrentTexture().createView();
    const displayPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: swapView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    this.constants.setCompositeControl([0.5875, 0.65, 0.83333331, fade]);
    this.draw(displayPass, this.pipeComposite, this.bgComposite!, this.bufFullscreen, 6);
    displayPass.end();

    // Uniforms must land before the command buffer runs.
    this.flushUniforms();
    this.device.queue.submit([encoder.finish()]);
  }
}
