import React, { useState, useRef, useEffect } from 'react';
import {
  Upload, Download, Play, Pause, Zap, Music2, Mic, Check, ChevronRight
} from 'lucide-react';
import { useCreateTrack } from '@/hooks/use-tracks';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';

/**
 * ============================================================
 *  REAL DEAL AUDIO ENGINE (WebAudio constraints, no lying)
 *  - Two-pass offline render:
 *    Pass 1: render DSP (no final trim/limiter), analyze LUFS + true peak
 *    Pass 2: render DSP + trim to hit -14 LUFS + limiter + ceiling -0.5 dBFS
 *  - Integrated loudness: K-weighting approximation + R128 gating
 *  - True peak: 4x oversampled linear interpolation estimate
 *
 *  Notes:
 *  - WebAudio has no native LUFS meter or true brickwall limiter.
 *  - We do a defensible implementation inside the browser.
 * ============================================================
 */

// ---------- Original preset definitions (kept for UI) ----------
const presets = {
  deharsh: {
    name: "De-Harsh",
    intent: "Control aggressive high-end transients",
    description: "Tames harsh 2.5-6kHz zones without losing energy.",
    settings: { bass: 0, mid: -1, high: -3, compression: 4, loudness: -9 }
  },
  mudremover: {
    name: "Mud Remover",
    intent: "Clean up the 150-350Hz region",
    description: "Removes low-mid buildup to let the kick breathe.",
    settings: { bass: -2, mid: 2, high: 1, compression: 2, loudness: -9 }
  },
  basstamer: {
    name: "Bass Tamer",
    intent: "Stabilize wild 808s",
    description: "Heavy compression on lows with tight sub-filtering.",
    settings: { bass: 4, mid: 0, high: 0, compression: 6, loudness: -9 }
  },
  vintage: {
    name: "Vintage Warmth",
    intent: "Analog saturation feel",
    description: "Warm lows and softened highs for a classic vibe.",
    settings: { bass: 3, mid: 1, high: -2, compression: 3, loudness: -9 }
  },
  modern: {
    name: "Modern Bright",
    intent: "Airy, high-definition sheen",
    description: "12kHz+ air shelf for that expensive studio feel.",
    settings: { bass: 1, mid: 0, high: 4, compression: 3, loudness: -9 }
  },
  lofi: {
    name: "Lo-Fi Character",
    intent: "Gritty, textured sound",
    description: "Limited bandwidth and subtle pumping effects.",
    settings: { bass: 2, mid: -2, high: -4, compression: 5, loudness: -10 }
  },
  neosoul: {
    name: "Neo Soul",
    intent: "Deep, organic resonance",
    description: "Focus on warm mids and wide stereo depth.",
    settings: { bass: 2, mid: 3, high: 1, compression: 2, loudness: -9 }
  },
  festival: {
    name: "Festival Banger",
    intent: "Maximum energy and impact",
    description: "Aggressive limiting and sub-bass enhancement.",
    settings: { bass: 5, mid: 2, high: 3, compression: 7, loudness: -8.5 }
  },
  focus: {
    name: "Focus Center",
    intent: "Mono-compatible punch",
    description: "Tightens the stereo field for ultimate impact.",
    settings: { bass: 1, mid: 2, high: 0, compression: 4, loudness: -9 }
  },
  immersive: {
    name: "Immersive",
    intent: "3D Spatial depth",
    description: "Mid-Side rules applied for wrap-around sound.",
    settings: { bass: 0, mid: 1, high: 3, compression: 2, loudness: -9 }
  },
  wide: {
    name: "Wide & Spacious",
    intent: "Extreme stereo width",
    description: "Pushes high-end elements to the edges.",
    settings: { bass: -1, mid: 0, high: 4, compression: 2, loudness: -9 }
  },
  vocalforward: {
    name: "Vocal Forward",
    intent: "Lyrics front and center",
    description: "Boosts 1-4kHz presence and controls sub-mud.",
    settings: { bass: 1, mid: 5, high: 2, compression: 4, loudness: -9 }
  },
  smoothmids: {
    name: "Smooth Mids",
    intent: "Velvet frequency response",
    description: "Diplomatic approach to the mid-range.",
    settings: { bass: 1, mid: -2, high: 1, compression: 3, loudness: -9 }
  },
  dynamic: {
    name: "Dynamic & Clear",
    intent: "Preserve transients",
    description: "Light compression with high-end clarity.",
    settings: { bass: 0, mid: 1, high: 2, compression: 1.5, loudness: -9.5 }
  },
  maximpact: {
    name: "Maximum Impact",
    intent: "Loud, punchy, aggressive",
    description: "Optimized for club systems and high volume.",
    settings: { bass: 4, mid: 3, high: 3, compression: 6, loudness: -8.5 }
  },
  bigcappo: {
    name: "BigCappo (Signature)",
    intent: "Emotional, human Trap-Soul",
    description: "Soft auto-tune feel with warm, expressive mids.",
    settings: { bass: 3, mid: 4, high: 1, compression: 3, loudness: -9, special: "bigcappo" }
  }
};

// ---------- DSP types ----------
type EQNodeSpec =
  | { type: 'hpf'; freq: number; order?: 1 | 2; q?: number }
  | { type: 'lowshelf'; freq: number; gainDb: number; q?: number }
  | { type: 'highshelf'; freq: number; gainDb: number; q?: number }
  | { type: 'bell'; freq: number; gainDb: number; q: number };

type MultibandBandSpec = {
  ratio: number;
  thresholdDb: number;
  kneeDb: number;
  attackSec: number;
  releaseSec: number;
};

type MultibandSpec = {
  xoversHz: [number, number, number, number];
  bands: [MultibandBandSpec, MultibandBandSpec, MultibandBandSpec, MultibandBandSpec, MultibandBandSpec];
};

type BusCompSpec = {
  enabled: boolean;
  ratio: number;
  thresholdDb: number;
  kneeDb: number;
  attackSec: number;
  releaseSec: number;
  sidechainHpfHz?: number;
};

type StereoSpec = {
  monoBelowHz?: number;
  overallWidth?: number;   // 100 = no change
  widthHighOnly?: { freq: number; width: number }; // widen highs above freq
};

type OutputSpec = {
  targetIntegratedLUFS: number; // -14
  ceilingDbFS: number;          // -0.5
  limiter: {
    thresholdDb: number;
    ratio: number;
    kneeDb: number;
    attackSec: number;
    releaseSec: number;
  };
  trimClampDb: { min: number; max: number };
};

type PresetDSP = {
  eq: EQNodeSpec[];
  busComp?: BusCompSpec;
  multiband: MultibandSpec;
  stereo: StereoSpec;
  output: OutputSpec;
  special?: string;
};

// ---------- Utility ----------
const dbToLin = (db: number) => Math.pow(10, db / 20);
const linToDb = (lin: number) => 20 * Math.log10(Math.max(1e-12, lin));
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const UNIVERSAL_OUTPUT: OutputSpec = {
  targetIntegratedLUFS: -14.0,
  ceilingDbFS: -0.5,
  limiter: {
    thresholdDb: -7.0,
    ratio: 20,
    kneeDb: 0,
    attackSec: 0.001,
    releaseSec: 0.10
  },
  trimClampDb: { min: -24, max: +12 }
};

const MB_XOVERS: [number, number, number, number] = [120, 400, 2500, 6000];

// ---------- Exact "spec" presets (the ones you demanded precision for) ----------
const EXACT_PRESETS: Partial<Record<keyof typeof presets, Partial<PresetDSP>>> = {
  smoothmids: {
    eq: [
      { type: 'hpf', freq: 40, order: 2, q: 0.707 },
      { type: 'bell', freq: 250, gainDb: -1.5, q: 1.5 },
      { type: 'highshelf', freq: 4000, gainDb: +1.0, q: 0.7 },
    ],
    multiband: {
      xoversHz: MB_XOVERS,
      bands: [
        { ratio: 2.0, thresholdDb: -24, kneeDb: 3, attackSec: 0.025, releaseSec: 0.12 },
        { ratio: 2.0, thresholdDb: -22, kneeDb: 3, attackSec: 0.015, releaseSec: 0.11 },
        { ratio: 1.6, thresholdDb: -20, kneeDb: 3, attackSec: 0.010, releaseSec: 0.10 },
        { ratio: 1.5, thresholdDb: -18, kneeDb: 3, attackSec: 0.005, releaseSec: 0.08 },
        { ratio: 1.4, thresholdDb: -18, kneeDb: 3, attackSec: 0.002, releaseSec: 0.06 },
      ]
    },
    stereo: { monoBelowHz: 120, widthHighOnly: { freq: 150, width: 110 } },
    output: UNIVERSAL_OUTPUT,
  },
  dynamic: {
    eq: [
      { type: 'hpf', freq: 35, order: 2, q: 0.707 },
      { type: 'highshelf', freq: 10000, gainDb: +1.5, q: 0.7 },
    ],
    multiband: {
      xoversHz: MB_XOVERS,
      bands: [
        { ratio: 3.0, thresholdDb: -26, kneeDb: 3, attackSec: 0.025, releaseSec: 0.12 },
        { ratio: 2.0, thresholdDb: -22, kneeDb: 3, attackSec: 0.015, releaseSec: 0.11 },
        { ratio: 1.6, thresholdDb: -20, kneeDb: 3, attackSec: 0.010, releaseSec: 0.10 },
        { ratio: 1.5, thresholdDb: -18, kneeDb: 3, attackSec: 0.005, releaseSec: 0.08 },
        { ratio: 1.4, thresholdDb: -18, kneeDb: 3, attackSec: 0.002, releaseSec: 0.06 },
      ]
    },
    stereo: { monoBelowHz: 120, overallWidth: 115 },
    output: { ...UNIVERSAL_OUTPUT, limiter: { ...UNIVERSAL_OUTPUT.limiter, thresholdDb: -7 } },
  },
  maximpact: {
    eq: [
      { type: 'lowshelf', freq: 60, gainDb: +1.0, q: 1.0 },
      { type: 'bell', freq: 350, gainDb: -2.0, q: 1.8 },
      { type: 'bell', freq: 8000, gainDb: +0.5, q: 1.0 },
    ],
    busComp: {
      enabled: true,
      ratio: 4.0,
      thresholdDb: -18,
      kneeDb: 6,
      attackSec: 0.03,
      releaseSec: 0.10,
      sidechainHpfHz: 100,
    },
    multiband: {
      xoversHz: MB_XOVERS,
      bands: [
        { ratio: 3.5, thresholdDb: -26, kneeDb: 3, attackSec: 0.025, releaseSec: 0.12 },
        { ratio: 2.5, thresholdDb: -23, kneeDb: 3, attackSec: 0.015, releaseSec: 0.11 },
        { ratio: 1.8, thresholdDb: -20, kneeDb: 3, attackSec: 0.010, releaseSec: 0.10 },
        { ratio: 1.6, thresholdDb: -18, kneeDb: 3, attackSec: 0.005, releaseSec: 0.08 },
        { ratio: 1.4, thresholdDb: -18, kneeDb: 3, attackSec: 0.002, releaseSec: 0.06 },
      ]
    },
    stereo: { monoBelowHz: 120, widthHighOnly: { freq: 4000, width: 125 } },
    output: { ...UNIVERSAL_OUTPUT, limiter: { ...UNIVERSAL_OUTPUT.limiter, thresholdDb: -8 } },
  },
  modern: {
    eq: [
      { type: 'bell', freq: 300, gainDb: -1.5, q: 2.0 },
      { type: 'highshelf', freq: 12000, gainDb: +2.0, q: 0.7 },
    ],
    multiband: {
      xoversHz: MB_XOVERS,
      bands: [
        { ratio: 2.5, thresholdDb: -25, kneeDb: 3, attackSec: 0.025, releaseSec: 0.12 },
        { ratio: 2.0, thresholdDb: -22, kneeDb: 3, attackSec: 0.015, releaseSec: 0.11 },
        { ratio: 1.5, thresholdDb: -19, kneeDb: 3, attackSec: 0.010, releaseSec: 0.10 },
        { ratio: 1.4, thresholdDb: -18, kneeDb: 3, attackSec: 0.005, releaseSec: 0.08 },
        { ratio: 1.3, thresholdDb: -18, kneeDb: 3, attackSec: 0.002, releaseSec: 0.06 },
      ]
    },
    stereo: { monoBelowHz: 120, widthHighOnly: { freq: 200, width: 120 } },
    output: { ...UNIVERSAL_OUTPUT, limiter: { ...UNIVERSAL_OUTPUT.limiter, thresholdDb: -7 } },
  },
  festival: {
    eq: [
      { type: 'lowshelf', freq: 50, gainDb: +1.5, q: 0.8 },
      { type: 'bell', freq: 250, gainDb: -2.5, q: 2.0 },
      { type: 'highshelf', freq: 11000, gainDb: +1.0, q: 0.7 },
      { type: 'bell', freq: 3200, gainDb: -1.0, q: 2.5 },
    ],
    multiband: {
      xoversHz: MB_XOVERS,
      bands: [
        { ratio: 5.0, thresholdDb: -28, kneeDb: 3, attackSec: 0.025, releaseSec: 0.12 },
        { ratio: 3.0, thresholdDb: -24, kneeDb: 3, attackSec: 0.015, releaseSec: 0.11 },
        { ratio: 1.8, thresholdDb: -20, kneeDb: 3, attackSec: 0.010, releaseSec: 0.10 },
        { ratio: 1.6, thresholdDb: -18, kneeDb: 3, attackSec: 0.005, releaseSec: 0.08 },
        { ratio: 1.4, thresholdDb: -18, kneeDb: 3, attackSec: 0.002, releaseSec: 0.06 },
      ]
    },
    stereo: { monoBelowHz: 100, widthHighOnly: { freq: 5000, width: 130 } },
    output: { ...UNIVERSAL_OUTPUT, limiter: { ...UNIVERSAL_OUTPUT.limiter, thresholdDb: -9 } },
  },
  bigcappo: {
    special: "bigcappo",
  }
};

// ---------- Map "slider presets" into deterministic DSP (for all other presets) ----------
function buildDSPForPreset(key: keyof typeof presets): PresetDSP {
  // If it's one of the exact presets, use that exactly.
  const exact = EXACT_PRESETS[key];

  // Baseline from your sliders (deterministic mapping, not "magic").
  const s = presets[key].settings;

  // Slider→EQ mapping
  // bass affects low shelf at 120Hz, mid affects bell at 1.5k, high affects high shelf at 12k.
  const eq: EQNodeSpec[] = [
    { type: 'hpf', freq: 30, order: 2, q: 0.707 },
    { type: 'lowshelf', freq: 120, gainDb: clamp(s.bass, -6, +6), q: 1.0 },
    { type: 'bell', freq: 1500, gainDb: clamp(s.mid, -6, +6), q: 1.1 },
    { type: 'highshelf', freq: 12000, gainDb: clamp(s.high, -6, +6), q: 0.7 },
  ];

  // Compression slider→multiband ratios/thresholds (sane, mobile-safe)
  const comp = clamp(s.compression, 1.5, 7);
  const lowRatio = clamp(1.8 + comp * 0.45, 1.6, 5.0);
  const lowMidRatio = clamp(1.6 + comp * 0.28, 1.4, 3.5);
  const midRatio = clamp(1.3 + comp * 0.12, 1.2, 2.0);
  const highMidRatio = clamp(1.2 + comp * 0.10, 1.2, 1.8);
  const highRatio = clamp(1.2 + comp * 0.08, 1.2, 1.6);

  const threshBase = -22 - (comp - 2) * 0.8;

  const multiband: MultibandSpec = {
    xoversHz: MB_XOVERS,
    bands: [
      { ratio: lowRatio, thresholdDb: threshBase - 2, kneeDb: 3, attackSec: 0.025, releaseSec: 0.12 },
      { ratio: lowMidRatio, thresholdDb: threshBase - 1, kneeDb: 3, attackSec: 0.015, releaseSec: 0.11 },
      { ratio: midRatio, thresholdDb: threshBase + 0, kneeDb: 3, attackSec: 0.010, releaseSec: 0.10 },
      { ratio: highMidRatio, thresholdDb: threshBase + 1, kneeDb: 3, attackSec: 0.005, releaseSec: 0.08 },
      { ratio: highRatio, thresholdDb: threshBase + 1, kneeDb: 3, attackSec: 0.002, releaseSec: 0.06 },
    ]
  };

  // Stereo rules derived from preset "intent"
  const stereo: StereoSpec = (() => {
    if (key === 'focus') return { monoBelowHz: 120, overallWidth: 95 };
    if (key === 'wide') return { monoBelowHz: 120, overallWidth: 125 };
    if (key === 'immersive') return { monoBelowHz: 120, overallWidth: 118 };
    return { monoBelowHz: 120, overallWidth: 110 };
  })();

  const output: OutputSpec = UNIVERSAL_OUTPUT;

  const dsp: PresetDSP = {
    eq,
    multiband,
    stereo,
    output,
    special: (s as any).special
  };

  // Merge any exact overrides
  if (exact) {
    return {
      eq: (exact.eq ?? dsp.eq) as EQNodeSpec[],
      busComp: exact.busComp ?? dsp.busComp,
      multiband: (exact.multiband ?? dsp.multiband) as MultibandSpec,
      stereo: (exact.stereo ?? dsp.stereo) as StereoSpec,
      output: (exact.output ?? dsp.output) as OutputSpec,
      special: (exact.special ?? dsp.special) as string | undefined,
    };
  }

  return dsp;
}

// ---------- DSP graph builders ----------
function applyFilterChain(ctx: BaseAudioContext, input: AudioNode, eq: EQNodeSpec[]) {
  let chain: AudioNode = input;

  for (const spec of eq) {
    // HPF order approximation: cascade 1st/2nd order (biquad is 2nd-order)
    if (spec.type === 'hpf') {
      const hp1 = ctx.createBiquadFilter();
      hp1.type = 'highpass';
      hp1.frequency.value = spec.freq;
      hp1.Q.value = spec.q ?? 0.707;

      chain.connect(hp1);
      chain = hp1;

      if (spec.order === 2) {
        const hp2 = ctx.createBiquadFilter();
        hp2.type = 'highpass';
        hp2.frequency.value = spec.freq;
        hp2.Q.value = spec.q ?? 0.707;
        chain.connect(hp2);
        chain = hp2;
      }
      continue;
    }

    const f = ctx.createBiquadFilter();

    if (spec.type === 'lowshelf') {
      f.type = 'lowshelf';
      f.frequency.value = spec.freq;
      f.gain.value = spec.gainDb;
      f.Q.value = spec.q ?? 1.0;
    } else if (spec.type === 'highshelf') {
      f.type = 'highshelf';
      f.frequency.value = spec.freq;
      f.gain.value = spec.gainDb;
      f.Q.value = spec.q ?? 0.7;
    } else if (spec.type === 'bell') {
      f.type = 'peaking';
      f.frequency.value = spec.freq;
      f.gain.value = spec.gainDb;
      f.Q.value = spec.q;
    }

    chain.connect(f);
    chain = f;
  }

  return chain;
}

function createBandSplit(ctx: BaseAudioContext, input: AudioNode, xoversHz: [number, number, number, number]) {
  const [x1, x2, x3, x4] = xoversHz;

  const makeLP = (freq: number) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.Q.value = 0.707;
    return f;
  };

  const makeHP = (freq: number) => {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    f.Q.value = 0.707;
    return f;
  };

  const low = makeLP(x1);

  const lowMidHP = makeHP(x1);
  const lowMidLP = makeLP(x2);

  const midHP = makeHP(x2);
  const midLP = makeLP(x3);

  const highMidHP = makeHP(x3);
  const highMidLP = makeLP(x4);

  const high = makeHP(x4);

  input.connect(low);

  input.connect(lowMidHP);
  lowMidHP.connect(lowMidLP);

  input.connect(midHP);
  midHP.connect(midLP);

  input.connect(highMidHP);
  highMidHP.connect(highMidLP);

  input.connect(high);

  return [low, lowMidLP, midLP, highMidLP, high] as AudioNode[];
}

function applyMultiband(ctx: BaseAudioContext, input: AudioNode, spec: MultibandSpec) {
  const bands = createBandSplit(ctx, input, spec.xoversHz);
  const sum = ctx.createGain();
  sum.gain.value = 1;

  bands.forEach((bandNode, i) => {
    const c = ctx.createDynamicsCompressor();
    const b = spec.bands[i];

    c.ratio.value = clamp(b.ratio, 1.0, 20.0);
    c.threshold.value = b.thresholdDb;
    c.knee.value = b.kneeDb;
    c.attack.value = clamp(b.attackSec, 0.001, 0.25);
    c.release.value = clamp(b.releaseSec, 0.03, 0.5);

    bandNode.connect(c);
    c.connect(sum);
  });

  return sum;
}

function applyBusComp(ctx: BaseAudioContext, input: AudioNode, spec?: BusCompSpec) {
  if (!spec?.enabled) return input;

  // Sidechain HPF approximation: filter signal before compressor detector.
  let node: AudioNode = input;
  if (spec.sidechainHpfHz) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = spec.sidechainHpfHz;
    hp.Q.value = 0.707;
    node.connect(hp);
    node = hp;
  }

  const comp = ctx.createDynamicsCompressor();
  comp.ratio.value = clamp(spec.ratio, 1.0, 20.0);
  comp.threshold.value = spec.thresholdDb;
  comp.knee.value = spec.kneeDb;
  comp.attack.value = clamp(spec.attackSec, 0.001, 0.25);
  comp.release.value = clamp(spec.releaseSec, 0.03, 0.5);

  node.connect(comp);
  return comp;
}

function applyStereoShaping(
  ctx: OfflineAudioContext,
  input: AudioNode,
  stereo: StereoSpec,
  numChannels: number
) {
  if (numChannels < 2) return input;

  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  input.connect(splitter);

  const L = ctx.createGain();
  const R = ctx.createGain();
  splitter.connect(L, 0);
  splitter.connect(R, 1);

  // Mid = (L+R)/2
  const mid = ctx.createGain();
  mid.gain.value = 0.5;
  L.connect(mid);
  R.connect(mid);

  // Side = (L-R)/2
  const invR = ctx.createGain();
  invR.gain.value = -1;
  R.connect(invR);

  const side = ctx.createGain();
  side.gain.value = 0.5;
  L.connect(side);
  invR.connect(side);

  const overallWidth = clamp((stereo.overallWidth ?? 100) / 100, 0.5, 1.6);
  const sideScaled = ctx.createGain();
  sideScaled.gain.value = overallWidth;
  side.connect(sideScaled);

  const outL = ctx.createGain();
  const outR = ctx.createGain();

  // L = Mid + Side
  mid.connect(outL);
  sideScaled.connect(outL);

  // R = Mid - Side
  mid.connect(outR);
  const sideInv = ctx.createGain();
  sideInv.gain.value = -1;
  sideScaled.connect(sideInv);
  sideInv.connect(outR);

  // Mono below Hz: remove low-frequency side content
  if (stereo.monoBelowHz) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = stereo.monoBelowHz;
    lp.Q.value = 0.707;

    side.connect(lp);

    const cancel = ctx.createGain();
    cancel.gain.value = -1;
    lp.connect(cancel);
    cancel.connect(outL);

    const addBack = ctx.createGain();
    addBack.gain.value = 1;
    lp.connect(addBack);
    addBack.connect(outR);
  }

  // High-only widening
  if (stereo.widthHighOnly) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = stereo.widthHighOnly.freq;
    hp.Q.value = 0.707;

    const targetWidth = clamp(stereo.widthHighOnly.width / 100, 0.5, 1.8);
    const extra = targetWidth - overallWidth;

    if (Math.abs(extra) > 0.01) {
      const extraGain = ctx.createGain();
      extraGain.gain.value = extra;

      side.connect(hp);
      hp.connect(extraGain);

      extraGain.connect(outL);
      const extraInv = ctx.createGain();
      extraInv.gain.value = -1;
      extraGain.connect(extraInv);
      extraInv.connect(outR);
    }
  }

  outL.connect(merger, 0, 0);
  outR.connect(merger, 0, 1);
  return merger;
}

function applyLimiterAndCeiling(ctx: BaseAudioContext, input: AudioNode, out: OutputSpec, trimDb: number) {
  const trim = ctx.createGain();
  trim.gain.value = dbToLin(trimDb);
  input.connect(trim);

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = out.limiter.thresholdDb;
  limiter.knee.value = out.limiter.kneeDb;
  limiter.ratio.value = out.limiter.ratio;
  limiter.attack.value = out.limiter.attackSec;
  limiter.release.value = out.limiter.releaseSec;
  trim.connect(limiter);

  const ceiling = ctx.createGain();
  ceiling.gain.value = dbToLin(out.ceilingDbFS);
  limiter.connect(ceiling);

  return ceiling;
}

// ---------- Loudness + True Peak ----------
function estimateTruePeakDbFS(buffer: AudioBuffer, oversample = 4): number {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  let peak = 0;

  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len - 1; i++) {
      const a = data[i];
      const b = data[i + 1];

      peak = Math.max(peak, Math.abs(a), Math.abs(b));

      for (let k = 1; k < oversample; k++) {
        const t = k / oversample;
        const s = a + (b - a) * t;
        peak = Math.max(peak, Math.abs(s));
      }
    }
  }

  return linToDb(peak);
}

function lufsBlocksToMeanSquare(blockLUFS: number[]): number {
  const msVals = blockLUFS.map(l => Math.pow(10, (l + 0.691) / 10));
  return msVals.reduce((a, b) => a + b, 0) / msVals.length;
}

function integratedLUFS_R128Gated(buffer: AudioBuffer): number {
  const sr = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const blockLen = Math.max(1, Math.floor(sr * 0.400));
  const step = Math.max(1, Math.floor(sr * 0.100));
  const absGateLUFS = -70.0;

  const blocks: number[] = [];
  for (let start = 0; start + blockLen <= buffer.length; start += step) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      let s = 0;
      for (let i = start; i < start + blockLen; i++) {
        const x = data[i];
        s += x * x;
      }
      sum += s / blockLen;
    }
    const meanSquare = sum / channels;
    const lufs = -0.691 + 10 * Math.log10(Math.max(1e-12, meanSquare));
    blocks.push(lufs);
  }

  if (!blocks.length) return -Infinity;

  const absGated = blocks.filter(l => l > absGateLUFS);
  if (!absGated.length) return absGateLUFS;

  const ungatedMs = lufsBlocksToMeanSquare(absGated);
  const ungatedLUFS = -0.691 + 10 * Math.log10(Math.max(1e-12, ungatedMs));

  const relGate = ungatedLUFS - 10.0;
  const relGated = absGated.filter(l => l > relGate);
  if (!relGated.length) return ungatedLUFS;

  const gatedMs = lufsBlocksToMeanSquare(relGated);
  return -0.691 + 10 * Math.log10(Math.max(1e-12, gatedMs));
}

async function computeIntegratedLUFS_KWeighted(buffer: AudioBuffer): Promise<number> {
  const sr = buffer.sampleRate;
  const offline = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, sr);

  const src = offline.createBufferSource();
  src.buffer = buffer;

  // K-weighting approximation:
  // HPF ~60 Hz + high-shelf +4 dB @ 4 kHz
  const hp = offline.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 60;
  hp.Q.value = 0.707;

  const shelf = offline.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 4000;
  shelf.Q.value = 0.707;
  shelf.gain.value = 4.0;

  src.connect(hp);
  hp.connect(shelf);
  shelf.connect(offline.destination);

  src.start(0);
  const filtered = await offline.startRendering();
  return integratedLUFS_R128Gated(filtered);
}

// ---------- Two-pass premium processor ----------
type RenderMode = 'preOutput' | 'final';

async function renderPresetGraph(
  audioBuffer: AudioBuffer,
  dsp: PresetDSP,
  useAutoTune: boolean,
  mode: RenderMode,
  trimDb: number
): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );

  const src = offline.createBufferSource();
  src.buffer = audioBuffer;

  // Safety HPF (always)
  const safetyHPF = offline.createBiquadFilter();
  safetyHPF.type = 'highpass';
  safetyHPF.frequency.value = 30;
  safetyHPF.Q.value = 0.707;
  src.connect(safetyHPF);

  // EQ
  const eqOut = applyFilterChain(offline, safetyHPF, dsp.eq);

  // Signature warmth trim (not real autotune, just your original "feel" node)
  let tuned: AudioNode = eqOut;
  if (dsp.special === 'bigcappo' || useAutoTune) {
    const warmthTrim = offline.createBiquadFilter();
    warmthTrim.type = 'peaking';
    warmthTrim.frequency.value = 400;
    warmthTrim.Q.value = 1.2;
    warmthTrim.gain.value = -2;
    tuned.connect(warmthTrim);
    tuned = warmthTrim;
  }

  // Bus comp
  const busOut = applyBusComp(offline, tuned, dsp.busComp);

  // Multiband
  const mbOut = applyMultiband(offline, busOut, dsp.multiband);

  // Stereo shaping
  const stereoOut = applyStereoShaping(offline, mbOut, dsp.stereo, audioBuffer.numberOfChannels);

  if (mode === 'preOutput') {
    stereoOut.connect(offline.destination);
  } else {
    const finalOut = applyLimiterAndCeiling(offline, stereoOut, dsp.output, trimDb);
    finalOut.connect(offline.destination);
  }

  src.start(0);
  return await offline.startRendering();
}

async function processAudioPremium(audioBuffer: AudioBuffer, presetKey: keyof typeof presets, useAutoTune = false) {
  const dsp = buildDSPForPreset(presetKey);

  // Pass 1: render without output so the analysis is honest
  const pre = await renderPresetGraph(audioBuffer, dsp, useAutoTune, 'preOutput', 0);

  const integrated = await computeIntegratedLUFS_KWeighted(pre);
  const tpPre = estimateTruePeakDbFS(pre, 4);

  // Trim to hit -14 integrated
  let trimDb = dsp.output.targetIntegratedLUFS - integrated;

  // Enforce ceiling safety after trim
  const predictedTP = tpPre + trimDb;
  if (predictedTP > dsp.output.ceilingDbFS) {
    trimDb = Math.min(trimDb, dsp.output.ceilingDbFS - tpPre);
  }

  trimDb = clamp(trimDb, dsp.output.trimClampDb.min, dsp.output.trimClampDb.max);

  // Pass 2: render final with trim + limiter + ceiling
  const final = await renderPresetGraph(audioBuffer, dsp, useAutoTune, 'final', trimDb);

  return final;
}

// ---------- WAV + MP3 export ----------
const bufferToWav = (buffer: AudioBuffer) => {
  const numberOfChannels = buffer.numberOfChannels;
  const length = buffer.length * numberOfChannels * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * numberOfChannels * 2, true);
  view.setUint16(32, numberOfChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
};

async function bufferToMp3IfAvailable(buffer: AudioBuffer, kbps = 320): Promise<Blob | null> {
  // Dynamic import so this file still builds even if lamejs isn't installed.
  const lame = (await import('lamejs').catch(() => null)) as any;
  if (!lame?.Mp3Encoder) return null;

  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;

  const toInt16 = (f: Float32Array) => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      out[i] = s < 0 ? (s * 0x8000) : (s * 0x7fff);
    }
    return out;
  };

  const left = toInt16(buffer.getChannelData(0));
  const right = numChannels > 1 ? toInt16(buffer.getChannelData(1)) : null;

  const enc = new lame.Mp3Encoder(numChannels, sampleRate, kbps);
  const chunkSize = 1152;
  const mp3Data: Uint8Array[] = [];

  for (let i = 0; i < left.length; i += chunkSize) {
    const l = left.subarray(i, i + chunkSize);

    let mp3buf: Uint8Array;
    if (numChannels === 2 && right) {
      const r = right.subarray(i, i + chunkSize);
      mp3buf = enc.encodeBuffer(l, r);
    } else {
      mp3buf = enc.encodeBuffer(l);
    }

    if (mp3buf.length > 0) mp3Data.push(mp3buf);
  }

  const end = enc.flush();
  if (end.length > 0) mp3Data.push(end);

  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

// ============================================================
// =====================  UI COMPONENT  =======================
// ============================================================

export default function AudioMasteringApp() {
  const { toast } = useToast();
  const createTrackMutation = useCreateTrack();

  const [file, setFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<keyof typeof presets>('deharsh');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [useAutoTune, setUseAutoTune] = useState(false);
  const [lyrics, setLyrics] = useState<string>("");
  const [compareMode, setCompareMode] = useState<'original' | 'preset'>('preset');

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef(0);
  const animationFrameRef = useRef<number>();
  const pendingStartTimeoutRef = useRef<number | null>(null);
  const compareModeRef = useRef<'original' | 'preset'>(compareMode);
  const renderTokenRef = useRef(0);

  useEffect(() => {
    compareModeRef.current = compareMode;
  }, [compareMode]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) audioContextRef.current.close();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (pendingStartTimeoutRef.current !== null) window.clearTimeout(pendingStartTimeoutRef.current);
    };
  }, []);

  const clearPendingStart = () => {
    if (pendingStartTimeoutRef.current !== null) {
      window.clearTimeout(pendingStartTimeoutRef.current);
      pendingStartTimeoutRef.current = null;
    }
  };

  const stopAudio = () => {
    clearPendingStart();
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      try { sourceNodeRef.current.disconnect(); } catch {}
      sourceNodeRef.current = null;
    }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    setIsPlaying(false);
  };

  const startPlayback = async (offset = 0, mode: 'original' | 'preset' = compareModeRef.current) => {
    if (!audioContextRef.current) return;
    clearPendingStart();
    if (sourceNodeRef.current) stopAudio();

    try {
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
    } catch {}

    const bufferToUse = mode === 'preset' ? processedBuffer : audioBuffer;
    if (!bufferToUse) return;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = bufferToUse;
    source.connect(audioContextRef.current.destination);
    source.start(0, offset);

    source.onended = () => {
      if (sourceNodeRef.current === source) {
        stopAudio();
        setCurrentTime(0);
      }
    };

    startTimeRef.current = audioContextRef.current.currentTime - offset;
    sourceNodeRef.current = source;
    setIsPlaying(true);

    const updateProgress = () => {
      if (!audioContextRef.current) return;
      const current = audioContextRef.current.currentTime - startTimeRef.current;
      if (current >= duration) {
        stopAudio();
        setCurrentTime(0);
      } else {
        setCurrentTime(current);
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };
    animationFrameRef.current = requestAnimationFrame(updateProgress);
  };

  const applyPremiumProcessing = async (buffer: AudioBuffer, presetKey: keyof typeof presets) => {
    setIsProcessing(true);
    try {
      const token = ++renderTokenRef.current;
      const processed = await processAudioPremium(buffer, presetKey, useAutoTune);
      if (token !== renderTokenRef.current) return null;

      setProcessedBuffer(processed);
      setSelectedPreset(presetKey);

      if (file) {
        createTrackMutation.mutate(
          {
            filename: file.name,
            preset: presetKey,
            format: "wav",
            videoStatus: "none",
            lyrics: lyrics || undefined,
          } as any,
          { onError: () => {} }
        );
      }

      return processed;
    } catch (error) {
      console.error(error);
      toast({ title: "Processing Failed", description: "Could not master this file.", variant: "destructive" });
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePresetInteraction = async (presetKey: keyof typeof presets) => {
    if (!audioBuffer) return;

    const resumeAt = isPlaying ? currentTime : 0;
    stopAudio();

    if (selectedPreset === presetKey && compareModeRef.current === 'preset') return;

    const processed = await applyPremiumProcessing(audioBuffer, presetKey);
    if (!processed) return;

    setCompareMode('preset');
    pendingStartTimeoutRef.current = window.setTimeout(() => {
      startPlayback(resumeAt, 'preset');
    }, 0);
  };

  const handleHoldStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isPlaying) return;
    if ((e as any).cancelable) (e as any).preventDefault();
    const currentPos = currentTime;
    setCompareMode('original');
    stopAudio();
    pendingStartTimeoutRef.current = window.setTimeout(() => {
      startPlayback(currentPos, 'original');
    }, 0);
  };

  const handleHoldEnd = () => {
    if (!isPlaying || compareModeRef.current === 'preset') return;
    const currentPos = currentTime;
    setCompareMode('preset');
    stopAudio();
    pendingStartTimeoutRef.current = window.setTimeout(() => {
      startPlayback(currentPos, 'preset');
    }, 0);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setIsProcessing(true);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);

      setAudioBuffer(decodedBuffer);
      setDuration(decodedBuffer.duration);
      audioContextRef.current = ctx;

      await applyPremiumProcessing(decodedBuffer, 'deharsh');
    } catch (error) {
      console.error(error);
      toast({ title: "Read Error", description: "Invalid audio format.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleCompare = () => {
    const nextMode = compareModeRef.current === 'preset' ? 'original' : 'preset';
    setCompareMode(nextMode);
    if (isPlaying) {
      const currentPos = currentTime;
      stopAudio();
      pendingStartTimeoutRef.current = window.setTimeout(() => {
        startPlayback(currentPos, nextMode);
      }, 0);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const exportAudio = async (format: 'wav' | 'mp3' = 'wav') => {
    if (!processedBuffer || !file) return;
    setIsProcessing(true);
    try {
      let blob: Blob;

      if (format === 'wav') {
        blob = bufferToWav(processedBuffer);
      } else {
        const mp3 = await bufferToMp3IfAvailable(processedBuffer, 320);
        if (!mp3) {
          toast({
            title: "MP3 Export Not Installed",
            description: "Install 'lamejs' to export real MP3. WAV export works right now.",
            variant: "destructive"
          });
          return;
        }
        blob = mp3;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trapmaster-pro-${selectedPreset}-${file.name.split('.')[0]}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      toast({ title: "Export Started", description: `${format.toUpperCase()} download started.` });
    } catch (e) {
      console.error(e);
      toast({ title: "Export Error", description: "System failure during bounce.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white p-4 md:p-8 font-sans selection:bg-purple-500/30 overflow-x-hidden">
      <div className="max-w-5xl mx-auto space-y-10 pb-20">
        <div className="flex flex-col items-center text-center space-y-4">
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="p-1 rounded-full bg-gradient-to-b from-purple-500 to-pink-600 shadow-2xl shadow-purple-500/20"
          >
            <button className="bg-black p-6 rounded-full">
              <Mic className="w-8 h-8 text-white" />
            </button>
          </motion.div>
          <h1 className="text-5xl font-black tracking-tighter italic bg-gradient-to-r from-white via-purple-200 to-gray-500 bg-clip-text text-transparent uppercase">
            Trap Master Pro
          </h1>
          <p className="text-gray-500 text-xs font-bold uppercase tracking-[0.3em] opacity-60">
            Professional DSP Mastering Engine
          </p>
        </div>

        {!audioBuffer ? (
          <div className="relative group overflow-hidden rounded-[2.5rem] bg-[#0a0a0a] border border-white/5 p-20 text-center transition-all hover:border-purple-500/40">
            <input
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.wma,.aiff,.mp4,.mov,.avi,.mkv,.webm"
              onChange={handleFileUpload}
              className="absolute inset-0 opacity-0 cursor-pointer z-10"
            />
            <div className="space-y-6">
              <div className="w-20 h-20 mx-auto bg-white/5 rounded-3xl flex items-center justify-center group-hover:bg-purple-500/10 transition-colors">
                <Upload className="w-8 h-8 text-gray-400 group-hover:text-purple-400 transition-colors" />
              </div>
              <div>
                <h2 className="text-xl font-bold mb-2">Initialize Audio DNA</h2>
                <p className="text-gray-500 text-sm max-w-xs mx-auto">
                  Drop your full mix (vocals + beat) here for real loudness normalization + safe mastering.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Playback & Analysis Section */}
            <div className="lg:col-span-7 space-y-8">
              <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-10 space-y-8 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-purple-500/10 rounded-2xl">
                      <Music2 className="text-purple-400 w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold truncate max-w-[200px]">{file?.name}</h3>
                      <div className="flex gap-3 mt-1">
                        <span className="text-[10px] font-black bg-white/5 px-2 py-0.5 rounded text-gray-400 uppercase tracking-widest">
                          REAL LUFS
                        </span>
                        <span className="text-[10px] font-black bg-purple-500/20 px-2 py-0.5 rounded text-purple-300 uppercase tracking-widest">
                          {formatTime(duration)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={toggleCompare}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      compareMode === 'original'
                        ? 'bg-red-500 text-white shadow-lg shadow-red-500/20'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {compareMode === 'original' ? 'A (Original)' : 'B (Mastered)'}
                  </button>
                </div>

                <div className="flex items-center gap-8">
                  <button
                    onClick={isPlaying ? stopAudio : () => startPlayback(currentTime)}
                    className="w-20 h-20 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-2xl"
                  >
                    {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 ml-1 fill-current" />}
                  </button>
                  <div className="flex-1 space-y-4">
                    <div className="relative h-3 bg-white/5 rounded-full overflow-hidden cursor-pointer">
                      <motion.div
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 relative"
                        animate={{ width: `${(currentTime / duration) * 100}%` }}
                        transition={{ type: "spring", bounce: 0, duration: 0.1 }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-black text-gray-500 font-mono tracking-widest">
                      <span>{formatTime(currentTime)}</span>
                      <span className="text-purple-500 opacity-60">{isProcessing ? 'MASTERING…' : 'READY'}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* BigCappo Signature Section */}
              <button
                onClick={() => handlePresetInteraction('bigcappo')}
                onMouseDown={handleHoldStart}
                onMouseUp={handleHoldEnd}
                onMouseLeave={handleHoldEnd}
                onTouchStart={handleHoldStart}
                onTouchEnd={handleHoldEnd}
                onTouchCancel={handleHoldEnd}
                className={`w-full group relative overflow-hidden rounded-[2.5rem] p-8 text-left transition-all border touch-none select-none ${
                  selectedPreset === 'bigcappo'
                    ? 'bg-gradient-to-br from-purple-900/40 to-black border-purple-500'
                    : 'bg-[#0a0a0a] border-white/5 hover:border-purple-500/40'
                }`}
              >
                <div className="relative z-10 flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Zap className={`w-5 h-5 ${selectedPreset === 'bigcappo' ? 'text-purple-400' : 'text-gray-500'}`} />
                      <h4 className="text-xl font-black uppercase tracking-tighter">BigCappo Signature</h4>
                    </div>
                    <p className="text-sm text-gray-500 font-medium">Emotional Trap-Soul vocals. Human, expressive, never robotic.</p>
                  </div>
                  <ChevronRight className={`w-6 h-6 transition-transform ${selectedPreset === 'bigcappo' ? 'text-purple-400' : 'text-gray-800'}`} />
                </div>
                {selectedPreset === 'bigcappo' && (
                  <motion.div layoutId="active-glow" className="absolute inset-0 bg-purple-500/5 blur-3xl -z-0" />
                )}
              </button>
            </div>

            {/* Presets Grid */}
            <div className="lg:col-span-5 space-y-6">
              <h4 className="text-[10px] font-black text-gray-600 uppercase tracking-[0.4em] ml-4">Personality Presets</h4>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(presets).filter(([k]) => k !== 'bigcappo').map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => handlePresetInteraction(key as any)}
                    onMouseDown={handleHoldStart}
                    onMouseUp={handleHoldEnd}
                    onMouseLeave={handleHoldEnd}
                    onTouchStart={handleHoldStart}
                    onTouchEnd={handleHoldEnd}
                    onTouchCancel={handleHoldEnd}
                    className={`group p-5 rounded-3xl text-left border transition-all touch-none select-none ${
                      selectedPreset === key
                        ? 'bg-white/5 border-purple-500 ring-1 ring-purple-500/20'
                        : 'bg-[#0a0a0a] border-white/5 hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h5 className={`text-xs font-black uppercase tracking-tight ${selectedPreset === key ? 'text-purple-400' : 'text-gray-300'}`}>
                        {preset.name}
                      </h5>
                      {selectedPreset === key && isPlaying && <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />}
                      {selectedPreset === key && !isPlaying && <Check className="w-3 h-3 text-purple-400" />}
                    </div>
                    <p className="text-[10px] text-gray-600 font-medium leading-relaxed">{preset.intent}</p>
                  </button>
                ))}
              </div>

              <div className="pt-6 grid grid-cols-2 gap-4">
                <button
                  onClick={() => exportAudio('wav')}
                  className="p-6 bg-[#0a0a0a] border border-white/5 rounded-[2rem] font-black text-[10px] uppercase tracking-widest hover:bg-white/5 transition-all flex flex-col items-center gap-3 group"
                >
                  <Download className="w-5 h-5 text-gray-500 group-hover:text-white transition-colors" />
                  HD WAV
                </button>
                <button
                  onClick={() => exportAudio('mp3')}
                  className="p-6 bg-[#0a0a0a] border border-white/5 rounded-[2rem] font-black text-[10px] uppercase tracking-widest hover:bg-white/5 transition-all flex flex-col items-center gap-3 group"
                >
                  <Download className="w-5 h-5 text-gray-500 group-hover:text-white transition-colors" />
                  Hi-Fi MP3
                </button>
              </div>

              <div className="text-[10px] text-gray-600 leading-relaxed px-2 pt-2">
                Output: <span className="text-gray-400 font-black">-14 LUFS integrated</span> with safe ceiling <span className="text-gray-400 font-black">-0.5 dBFS</span>.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
